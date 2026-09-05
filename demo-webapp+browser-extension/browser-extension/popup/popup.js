const browserApi = typeof browser !== 'undefined' ? browser : chrome;
const SENSITIVITY_LEVELS = [
  { threshold: 0, label: 'High — all risk levels' },
  { threshold: 0.33, label: 'Balanced — medium and high risk' },
  { threshold: 0.66, label: 'Low — high risk only' },
];

let extensionEnabled = true;
let sensitivityThreshold = 0.33;
let lastPrivacyLog = null;

const toggleCheckbox = document.getElementById('toggle-checkbox');
const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValue = document.getElementById('sensitivity-value');
const statusText = document.getElementById('status-text');
const privacyLogContent = document.getElementById('privacy-log-content');
const clearLogBtn = document.getElementById('clear-log-btn');

document.addEventListener('DOMContentLoaded', () => {
  loadExtensionState();
  toggleCheckbox.addEventListener('change', toggleExtension);
  sensitivitySlider.addEventListener('input', updateSensitivityLabel);
  sensitivitySlider.addEventListener('change', saveSensitivity);
  clearLogBtn.addEventListener('click', clearPrivacyLog);
  updateUI();
});

function thresholdIndex(threshold) {
  return SENSITIVITY_LEVELS.reduce((closest, level, index) => (
    Math.abs(level.threshold - threshold) < Math.abs(SENSITIVITY_LEVELS[closest].threshold - threshold) ? index : closest
  ), 0);
}

function thresholdFromSlider() {
  return SENSITIVITY_LEVELS[Number(sensitivitySlider.value)].threshold;
}

function loadExtensionState() {
  browserApi.storage.local.get(['enabled', 'sensitivityThreshold', 'lastPrivacyLog']).then((result) => {
    extensionEnabled = result.enabled !== false;
    sensitivityThreshold = Number.isFinite(Number(result.sensitivityThreshold)) ? Number(result.sensitivityThreshold) : 0.33;
    lastPrivacyLog = result.lastPrivacyLog || null;
    updateUI();
  });
}

function toggleExtension() {
  extensionEnabled = toggleCheckbox.checked;
  browserApi.runtime.sendMessage({ type: 'toggleExtension', enabled: extensionEnabled });
  updateUI();
}

function updateSensitivityLabel() {
  sensitivityValue.textContent = SENSITIVITY_LEVELS[Number(sensitivitySlider.value)].label;
}

function saveSensitivity() {
  sensitivityThreshold = thresholdFromSlider();
  browserApi.runtime.sendMessage({ type: 'setSensitivity', sensitivityThreshold });
  updateUI();
}

function clearPrivacyLog() {
  lastPrivacyLog = null;
  browserApi.runtime.sendMessage({ type: 'clearPrivacyLog' });
  updateUI();
}

function updateUI() {
  toggleCheckbox.checked = extensionEnabled;
  sensitivitySlider.value = String(thresholdIndex(sensitivityThreshold));
  updateSensitivityLabel();
  if (extensionEnabled) {
    statusText.textContent = 'Extension is ON';
    statusText.style.backgroundColor = '#d5f5e3';
    statusText.style.color = '#166534';
  } else {
    statusText.textContent = 'Extension is OFF';
    statusText.style.backgroundColor = '#fadbd8';
    statusText.style.color = '#b91c1c';
  }
  renderPrivacyLog(lastPrivacyLog);
}

function renderPrivacyLog(privacyLog) {
  privacyLogContent.replaceChildren();
  if (!privacyLog || (!privacyLog.used?.length && !privacyLog.not_used?.length)) {
    privacyLogContent.textContent = 'No actions yet';
    return;
  }
  appendLogItem('USED:', privacyLog.used, 'used');
  appendLogItem('NOT USED:', privacyLog.not_used, 'not-used');
}

function appendLogItem(label, items, className) {
  if (!Array.isArray(items) || !items.length) return;
  const item = document.createElement('div');
  item.className = `log-item ${className}`;
  const strong = document.createElement('strong');
  strong.textContent = `${label} `;
  item.append(strong, document.createTextNode(items.join(', ')));
  privacyLogContent.appendChild(item);
}

browserApi.runtime.onMessage.addListener((message) => {
  if (message.type === 'extensionStateUpdate') {
    extensionEnabled = message.enabled;
    if (Number.isFinite(Number(message.sensitivityThreshold))) sensitivityThreshold = Number(message.sensitivityThreshold);
    updateUI();
  }
  if (message.type === 'privacyLogUpdate') {
    lastPrivacyLog = message.privacyLog;
    updateUI();
  }
});
