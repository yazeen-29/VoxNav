const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrustedPersonService } = require('../src/trustedPeople/store.cjs');

function memoryStorage() {
  const data = new Map();
  return { data, getItemAsync: async (key) => data.get(key) || null, setItemAsync: async (key, value) => data.set(key, value), deleteItemAsync: async (key) => data.delete(key) };
}
const embedding = 'A'.repeat(1024);
const session = { unlocked: true, role: 'patient' };

test('enrolls a consented local profile and lists no embedding', async () => {
  const storage = memoryStorage();
  const service = createTrustedPersonService({ storage, getSession: () => session, now: () => '2026-09-06T00:00:00.000Z', makeId: () => 'asha' });
  await service.enroll({ name: '  Asha   Rao ', relationship: 'Daughter', phone: '+91 999', note: 'Visits Sunday' }, embedding);
  assert.deepEqual(await service.list(), [{ id: 'asha', name: 'Asha Rao', relationship: 'Daughter', phone: '+91 999', note: 'Visits Sunday', templateCount: 1, createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' }]);
  assert.match(storage.data.get('cbc-trusted-person-template-v1-asha-asha'), /^A/);
  assert.doesNotMatch(JSON.stringify(await service.list()), /embedding/);
});

test('matches only above the conservative local threshold', async () => {
  const storage = memoryStorage();
  const service = createTrustedPersonService({ storage, getSession: () => session, makeId: () => 'sam' });
  await service.enroll('Sam', embedding);
  assert.equal((await service.findBest(embedding, async () => 0.71)), null);
  assert.deepEqual(await service.findBest(embedding, async () => 0.82), { id: 'sam', name: 'Sam', similarity: 0.82 });
});

test('removes the individual local profile', async () => {
  const storage = memoryStorage();
  const service = createTrustedPersonService({ storage, getSession: () => session, makeId: () => 'person' });
  const enrolled = await service.enroll('Person', embedding);
  assert.equal(await service.remove(enrolled.id), true);
  assert.deepEqual(await service.list(), []);
  assert.equal(storage.data.has('cbc-trusted-person-v1-person'), false);
});

test('keeps up to three separate local templates per trusted person', async () => {
  const storage = memoryStorage();
  let next = 0;
  const service = createTrustedPersonService({ storage, getSession: () => session, makeId: () => `id-${next++}` });
  const person = await service.enroll('Asha', embedding);
  await service.addTemplate(person.id, embedding);
  const third = await service.addTemplate(person.id, embedding);
  assert.equal(third.templateCount, 3);
  await assert.rejects(() => service.addTemplate(person.id, embedding), /up to 3/);
});

test('requires the unlocked patient session', async () => {
  const storage = memoryStorage();
  const service = createTrustedPersonService({ storage, getSession: () => ({ unlocked: false, role: 'patient' }) });
  await assert.rejects(() => service.enroll('Asha', embedding), /Unlock patient mode/);
});

test('rejects object values instead of saving object-object as a person name', async () => {
  const storage = memoryStorage();
  const service = createTrustedPersonService({ storage, getSession: () => session });
  await assert.rejects(() => service.enroll({ name: { unexpected: 'object' } }, embedding), /plain-text trusted person name/);
});

test('exports and merges an encrypted-sync snapshot without exposing templates in list', async () => {
  const sourceStorage = memoryStorage();
  const source = createTrustedPersonService({ storage: sourceStorage, getSession: () => session, makeId: (() => { let value = 0; return () => `source-${value++}`; })() });
  await source.enroll({ name: 'Asha', relationship: 'Daughter', phone: '+91 999', note: 'Sunday visits' }, embedding);
  const snapshot = await source.exportSnapshot();
  const targetStorage = memoryStorage();
  const target = createTrustedPersonService({ storage: targetStorage, getSession: () => session });
  assert.equal(await target.mergeSnapshot(snapshot), true);
  assert.deepEqual((await target.list()).map(({ name, relationship, phone, note, templateCount }) => ({ name, relationship, phone, note, templateCount })), [{ name: 'Asha', relationship: 'Daughter', phone: '+91 999', note: 'Sunday visits', templateCount: 1 }]);
});
