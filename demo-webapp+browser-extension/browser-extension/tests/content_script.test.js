const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.style = {};
    this.listeners = {};
    this.isConnected = true;
    this.innerHTML = '';
  }
  set textContent(value) { this._textContent = String(value); this.innerHTML = this._textContent; }
  get textContent() { return this._textContent || ''; }
  setAttribute() {}
  addEventListener(type, listener) { this.listeners[type] = listener; }
  closest() { return null; }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  focus() {}
  remove() { this.isConnected = false; if (this.id) this.document.elements.delete(this.id); }
}

function loadContentScript() {
  const document = {
    elements: new Map(),
    listeners: {},
    documentElement: new FakeElement('html'),
    activeElement: new FakeElement('active'),
    addEventListener(type, listener) { this.listeners[type] = listener; },
    createElement() { const element = new FakeElement(); element.document = this; return element; },
    getElementById(id) { return this.elements.get(id) || null; },
  };
  document.body = {
    appendChild(element) { element.document = document; if (element.id) document.elements.set(element.id, element); },
  };
  const timers = [];
  class FakeWebSocket {
    static instances = [];
    constructor() { FakeWebSocket.instances.push(this); }
    close() { this.closed = true; }
    send(message) { this.sent = message; }
  }
  const browser = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'getExtensionState') return Promise.resolve({ enabled: true, sensitivityThreshold: 0.33 });
        return Promise.resolve();
      },
    },
  };
  const windowObject = {
    listeners: {},
    location: { origin: 'http://127.0.0.1:3000' },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    postMessage(message) { this.lastPosted = message; },
    setTimeout(callback) { timers.push(callback); return callback; },
    clearTimeout() {},
  };
  const context = {
    browser,
    chrome: browser,
    document,
    WebSocket: FakeWebSocket,
    performance: { now: () => 10 },
    window: windowObject,
    Date,
    console: { info() {}, log() {} },
  };
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, '..', 'content_script.js'), 'utf8'),
    context,
    { filename: 'content_script.js' },
  );
  return { document, timers, FakeWebSocket, windowObject };
}

function demoButton(id) {
  return { id, closest: (selector) => (selector === 'button' ? { id } : null) };
}

test('rapid repeated clicks create only one context request', () => {
  const { document, FakeWebSocket } = loadContentScript();
  const click = document.listeners.click;
  click({ target: demoButton('send-doc') });
  click({ target: demoButton('send-doc') });
  click({ target: demoButton('transfer-money') });
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('a stalled backend request shows the timeout feedback and releases the lock', () => {
  const { document, timers, FakeWebSocket } = loadContentScript();
  document.listeners.click({ target: demoButton('send-doc') });
  assert.equal(timers.length, 1);
  timers[0]();
  const modal = document.getElementById('cbc-context-modal');
  assert.ok(modal);
  assert.match(modal.innerHTML, /did not respond within 5 seconds/);
  document.listeners.click({ target: demoButton('send-doc') });
  assert.equal(FakeWebSocket.instances.length, 2);
});

test('local vault context is displayed locally but never added to the WebSocket payload', () => {
  const { document, FakeWebSocket, windowObject } = loadContentScript();
  windowObject.listeners.message({
    source: windowObject,
    data: {
      source: 'cbc-vault',
      type: 'vaultContextSnapshot',
      version: 1,
      contextByAction: { 'send-doc': ['Private invoice reminder'] },
    },
  });
  document.listeners.click({ target: demoButton('send-doc') });
  const socket = FakeWebSocket.instances[0];
  socket.onopen();
  assert.doesNotMatch(socket.sent, /Private invoice reminder/);
  socket.onmessage({ data: JSON.stringify({
    score: 0.8,
    explanation: 'Synthetic backend context.',
    privacy_log: { used: [], not_used: [] },
    processing_ms: 1,
  }) });
  assert.match(document.getElementById('cbc-context-modal').innerHTML, /Private invoice reminder/);
});
