// Single source of truth for popup/content-script state.
const browserApi = typeof browser !== 'undefined' ? browser : chrome;
let extensionEnabled = true;
let sensitivityThreshold = 0.33;

function normaliseThreshold(value) {
  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.33;
}

function broadcastState() {
  browserApi.tabs.query({}).then((tabs) => {
    tabs.forEach((tab) => {
      browserApi.tabs.sendMessage(tab.id, {
        type: 'extensionStateUpdate',
        enabled: extensionEnabled,
        sensitivityThreshold,
      })
        .catch(() => {});
    });
  });
}

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'getExtensionState':
      sendResponse({ enabled: extensionEnabled, sensitivityThreshold });
      return false;
    case 'toggleExtension':
      extensionEnabled = Boolean(message.enabled);
      browserApi.storage.local.set({ enabled: extensionEnabled });
      broadcastState();
      sendResponse({ ok: true });
      return false;
    case 'setSensitivity':
      sensitivityThreshold = normaliseThreshold(message.sensitivityThreshold);
      browserApi.storage.local.set({ sensitivityThreshold });
      broadcastState();
      sendResponse({ ok: true, sensitivityThreshold });
      return false;
    case 'privacyLogUpdate':
      browserApi.storage.local.set({ lastPrivacyLog: message.privacyLog });
      return false;
    case 'clearPrivacyLog':
      browserApi.storage.local.remove('lastPrivacyLog');
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

browserApi.storage.local.get(['enabled', 'sensitivityThreshold']).then(({ enabled, sensitivityThreshold: savedThreshold }) => {
  extensionEnabled = enabled !== false;
  sensitivityThreshold = normaliseThreshold(savedThreshold);
  broadcastState();
});
