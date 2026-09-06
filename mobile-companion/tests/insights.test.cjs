const test = require('node:test');
const assert = require('node:assert/strict');
const { createInsightService } = require('../src/insights/engine.cjs');

function memoryStorage() { const data = new Map(); return { getItemAsync: async (key) => data.get(key) || null, setItemAsync: async (key, value) => data.set(key, value) }; }
const patient = { unlocked: true, role: 'patient' };
const facts = [{ kind: 'action', value: 'Called the pharmacy', confidence: 0.9 }, { kind: 'time', value: 'This morning', confidence: 0.8 }];

test('keeps an audit without storing the submitted source note', async () => {
  const storage = memoryStorage();
  const service = createInsightService({ storage, getSession: () => patient, now: () => new Date('2026-09-06T18:00:00.000Z') });
  const item = await service.record({ factsUsed: facts, factsShown: facts.slice(0, 1), purpose: 'care_fact_extraction', context: ['harder_hours_window'] });
  assert.equal((await service.list()).length, 1);
  assert.equal(item.factsShown.length, 1);
  assert.doesNotMatch(JSON.stringify(await service.list()), /raw source note/i);
  assert.equal((await service.metrics()).averageFactsShown, 1);
});

test('uses local feedback only for the experimental review threshold', async () => {
  const service = createInsightService({ storage: memoryStorage(), getSession: () => patient });
  const first = await service.record({ factsUsed: facts, factsShown: facts.slice(0, 1) });
  await service.feedback(first.id, false);
  const metrics = await service.metrics();
  assert.equal(metrics.irrelevantRate, 1);
  assert.equal(metrics.personalizedReviewThreshold, 0.68);
  assert.equal(metrics.unauthorizedAccesses, 0);
});

test('denies audit reads and writes outside unlocked patient mode', async () => {
  const service = createInsightService({ storage: memoryStorage(), getSession: () => ({ unlocked: true, role: 'caretaker' }) });
  await assert.rejects(() => service.list(), /Unlock patient mode/);
  await assert.rejects(() => service.record({ factsUsed: facts, factsShown: facts }), /Unlock patient mode/);
});

test('turns reviewed facts into a removable private recall card and finds it by task words', async () => {
  const service = createInsightService({ storage: memoryStorage(), getSession: () => patient, now: () => new Date('2026-09-06T09:00:00.000Z') });
  const card = await service.saveRecallCard({ label: 'Call pharmacy about refill', facts });
  const found = await service.findRecallCard('did I call pharmacy refill');
  assert.equal(found.card.id, card.id);
  assert.equal(found.score, 1);
  assert.equal(await service.removeRecallCard(card.id), true);
  assert.equal(await service.findRecallCard('call pharmacy refill'), null);
});

test('recall cards do not claim task completion and reject weak labels', async () => {
  const service = createInsightService({ storage: memoryStorage(), getSession: () => patient });
  await assert.rejects(() => service.saveRecallCard({ label: 'ok', facts }), /short label/);
  await assert.rejects(() => service.findRecallCard('did'), /few task words/);
});

test('stores only a notification handle and delay with a recall card', async () => {
  const service = createInsightService({ storage: memoryStorage(), getSession: () => patient });
  const card = await service.saveRecallCard({ label: 'Call pharmacy about refill', facts, notificationId: 'local-notification-123', remindAfterMinutes: 60 });
  assert.equal(card.notificationId, 'local-notification-123');
  assert.equal(card.remindAfterMinutes, 60);
  assert.doesNotMatch(JSON.stringify(card), /source note/i);
});
