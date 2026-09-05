// Runs on the synthetic demo page. It requests the minimum necessary context
// before a selected high-consequence action; it never makes the decision.
const browserApi = typeof browser !== 'undefined' ? browser : chrome;
const DEFAULT_SENSITIVITY_THRESHOLD = 0.33;
const REQUEST_TIMEOUT_MS = 5000;
const VAULT_CONTEXT_LIMIT = 3;
const VAULT_CONTEXT_MAX_LENGTH = 280;

let extensionEnabled = true;
let sensitivityThreshold = DEFAULT_SENSITIVITY_THRESHOLD;
let requestInFlight = false;
let snoozedUntil = 0;
let previouslyFocusedElement = null;
let vaultContextByAction = {};

const actionMap = {
  'send-doc': { action: 'SEND_DOCUMENT', target: { recipient: 'john@example.com', document_id: 'Medical_Report.pdf' } },
  'delete-file': { action: 'DELETE_FILE', target: { document_id: 'temp_file.txt' } },
  'cancel-appt': { action: 'CANCEL_APPT', target: { recipient: 'Dr. Smith' } },
  'transfer-money': { action: 'TRANSFER', target: { recipient: 'Alice', amount: 100 } },
};

function normaliseThreshold(value) {
  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
    ? threshold
    : DEFAULT_SENSITIVITY_THRESHOLD;
}

function applyExtensionState(state) {
  if (typeof state.enabled === 'boolean') extensionEnabled = state.enabled;
  if (Object.prototype.hasOwnProperty.call(state, 'sensitivityThreshold')) {
    sensitivityThreshold = normaliseThreshold(state.sensitivityThreshold);
  }
  document.documentElement.style.outline = extensionEnabled ? '3px solid #2563eb' : '';
  document.documentElement.style.outlineOffset = extensionEnabled ? '-3px' : '';
  if (!extensionEnabled) dismissDecisionUI();
}

browserApi.runtime.onMessage.addListener((message) => {
  if (message.type === 'extensionStateUpdate') applyExtensionState(message);
});

browserApi.runtime.sendMessage({ type: 'getExtensionState' })
  .then((response) => applyExtensionState(response || {}))
  .catch(() => applyExtensionState({ enabled: true }));

// The React demo publishes only locally matched user-created context through
// this same-page bridge. It is never included in the WebSocket request.
function sanitiseVaultSnapshot(contextByAction) {
  if (!contextByAction || typeof contextByAction !== 'object') return null;
  const snapshot = {};
  Object.keys(actionMap).forEach((actionId) => {
    const items = Array.isArray(contextByAction[actionId]) ? contextByAction[actionId] : [];
    snapshot[actionId] = items
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim().slice(0, VAULT_CONTEXT_MAX_LENGTH))
      .filter(Boolean)
      .slice(0, VAULT_CONTEXT_LIMIT);
  });
  return snapshot;
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'cbc-vault' || event.data?.type !== 'vaultContextSnapshot' || event.data?.version !== 1) return;
  const snapshot = sanitiseVaultSnapshot(event.data.contextByAction);
  if (snapshot) vaultContextByAction = snapshot;
});

window.postMessage({ source: 'cbc-extension', type: 'requestVaultContext', version: 1 }, window.location.origin);

// Direct capture avoids Firefox's page/content-script CustomEvent boundary.
document.addEventListener('click', (event) => {
  const button = event.target.closest && event.target.closest('button');
  const action = button && actionMap[button.id];
  if (!action || !extensionEnabled) return;

  if (Date.now() < snoozedUntil) {
    announce('Context reminders are snoozed for this tab.');
    return;
  }
  if (requestInFlight) {
    announce('Context request already in progress.');
    return;
  }
  requestContext(action, button.id);
}, true);

function requestContext(action, actionId) {
  requestInFlight = true;
  const startedAt = performance.now();
  const ws = new WebSocket('ws://localhost:8000/ws/audio');
  let completed = false;

  const finish = () => {
    requestInFlight = false;
    window.clearTimeout(timeout);
  };
  const fail = (message) => {
    if (completed) return;
    completed = true;
    finish();
    try { ws.close(); } catch (_) { /* Socket may not have opened. */ }
    if (extensionEnabled) showDecisionUI(message, { used: [], not_used: [] }, {});
  };
  const timeout = window.setTimeout(() => fail('The context service did not respond within 5 seconds. Please try again.'), REQUEST_TIMEOUT_MS);

  ws.onopen = () => ws.send(JSON.stringify(action));
  ws.onerror = () => fail('Could not connect to the local context service.');
  ws.onmessage = ({ data }) => {
    if (completed) return;
    completed = true;
    finish();
    ws.close();
    try {
      const response = JSON.parse(data);
      if (response.error || !response.explanation) {
        showDecisionUI(response.error || 'The context service returned an incomplete response.', { used: [], not_used: [] }, {});
        return;
      }
      const latencyMs = Math.round(performance.now() - startedAt);
      const localContext = vaultContextByAction[actionId] || [];
      const privacyLog = addLocalVaultAudit(response.privacy_log || {}, localContext.length);
      browserApi.runtime.sendMessage({ type: 'privacyLogUpdate', privacyLog });
      console.info(`[CBC] End-to-end context latency: ${latencyMs} ms (backend: ${response.processing_ms ?? 'n/a'} ms)`);

      if (Number(response.score) >= sensitivityThreshold) {
        showDecisionUI(appendLocalContext(response.explanation, localContext), privacyLog, { latencyMs, score: response.score });
      } else {
        announce('This action is below your current sensitivity setting; no context panel was shown.');
      }
    } catch (_) {
      showDecisionUI('The context service returned an unreadable response.', { used: [], not_used: [] }, {});
    }
  };
}

function appendLocalContext(explanation, localContext) {
  if (!localContext.length) return explanation;
  const reminders = localContext.map((item) => `“${item}”`).join(' ');
  return `${explanation} A private reminder you saved: ${reminders}`;
}

function addLocalVaultAudit(privacyLog, localContextCount) {
  const used = Array.isArray(privacyLog.used) ? [...privacyLog.used] : [];
  const notUsed = Array.isArray(privacyLog.not_used) ? [...privacyLog.not_used] : [];
  if (localContextCount) used.push(`Local encrypted vault: ${localContextCount} user-added context item${localContextCount === 1 ? '' : 's'}`);
  return { ...privacyLog, used, not_used: notUsed };
}

function showDecisionUI(explanation, privacyLog, metadata) {
  dismissDecisionUI(false);
  previouslyFocusedElement = document.activeElement;
  const used = Array.isArray(privacyLog.used) ? privacyLog.used.join('; ') : 'No data';
  const notUsed = Array.isArray(privacyLog.not_used) ? privacyLog.not_used.join('; ') : 'No data';
  const latency = Number.isFinite(metadata.latencyMs) ? `<p style="margin:0 0 12px;font-size:13px;color:#475569">Context ready in ${metadata.latencyMs} ms.</p>` : '';
  const modal = document.createElement('div');
  modal.id = 'cbc-context-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'cbc-modal-title');
  modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(15,23,42,.55);font-family:system-ui,sans-serif;';
  modal.innerHTML = `<section style="width:min(460px,calc(100% - 32px));background:#fff;border-radius:14px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.3);color:#172033"><h2 id="cbc-modal-title" style="margin:0 0 12px;font-size:21px">Context Before Consequence</h2><p style="font-size:16px;line-height:1.5">${escapeHtml(explanation)}</p>${latency}<div style="margin:18px 0;padding:14px;background:#f1f5f9;border-radius:8px;font-size:13px;line-height:1.45"><strong>Privacy audit</strong><br><b>Used:</b> ${escapeHtml(used)}<br><b>Not used:</b> ${escapeHtml(notUsed)}</div><details style="margin:0 0 18px;font-size:14px;line-height:1.45"><summary style="cursor:pointer;font-weight:600">Why am I seeing this?</summary><p>This optional guardrail shows a short context check when an action meets your sensitivity setting. It does not diagnose, decide, or act for you. This demo uses synthetic data only.</p></details><div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px"><button data-cbc-snooze style="padding:9px 14px">Snooze 5 min</button><button data-cbc-disable style="padding:9px 14px">Turn off</button><button data-cbc-close style="padding:9px 14px">Cancel</button><button data-cbc-close style="padding:9px 14px;background:#2563eb;color:white;border:0;border-radius:6px">Continue</button></div></section>`;
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-cbc-close]')) dismissDecisionUI();
    if (event.target.closest('[data-cbc-snooze]')) {
      snoozedUntil = Date.now() + (5 * 60 * 1000);
      dismissDecisionUI();
      announce('Context reminders snoozed for 5 minutes in this tab.');
    }
    if (event.target.closest('[data-cbc-disable]')) {
      browserApi.runtime.sendMessage({ type: 'toggleExtension', enabled: false });
      dismissDecisionUI();
      announce('Context Before Consequence is turned off.');
    }
  });
  modal.addEventListener('keydown', trapModalFocus);
  document.body.appendChild(modal);
  modal.querySelector('[data-cbc-close]')?.focus();
}

function trapModalFocus(event) {
  const modal = event.currentTarget;
  if (event.key === 'Escape') {
    event.preventDefault();
    dismissDecisionUI();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [...modal.querySelectorAll('button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled);
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function dismissDecisionUI(restoreFocus = true) {
  const modal = document.getElementById('cbc-context-modal');
  if (!modal) return;
  modal.remove();
  if (restoreFocus && previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
  previouslyFocusedElement = null;
}

function announce(message) {
  let status = document.getElementById('cbc-live-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'cbc-live-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px);white-space:nowrap;';
    document.body.appendChild(status);
  }
  status.textContent = message;
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = String(value);
  return node.innerHTML;
}

console.log('[CBC] Content script ready');
