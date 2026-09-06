const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAppointmentService, recallMessage, ROOT, PREFIX, MAX_ACTIVE, MAX_ARCHIVED } = require('../src/appointments/engine.cjs');

function fixture() {
  const values = new Map(); const reads = []; const writes = [];
  let now = Date.UTC(2026, 8, 8, 9, 0); let session = { role: 'patient', unlocked: true, epoch: 1 };
  const storage = { async getItemAsync(key) { reads.push(key); return values.get(key) ?? null; }, async setItemAsync(key, value) { writes.push(key); values.set(key, value); }, async deleteItemAsync(key) { values.delete(key); } };
  const makeService = () => createAppointmentService({ storage, getSession: () => session, clock: () => now });
  return { values, reads, writes, storage, service: makeService(), makeService, get now() { return now; }, set now(value) { now = value; }, get session() { return session; }, set session(value) { session = value; } };
}
async function appointment(f, title = 'Pharmacy refill', offset = 3600000) { return f.service.add(title, f.now + offset); }
async function history(f) { return f.service.listHistory(); }

test('a first completion is local and a repeat produces a two-fact discontinuity', async () => {
  const f = fixture(); const item = await appointment(f); const first = await f.service.complete(item.id);
  assert.equal(first.decision, 'consistent'); assert.equal((await f.service.load()).archived[0].id, item.id);
  f.now += 10 * 60 * 1000;
  const repeated = await f.service.complete(item.id);
  assert.equal(repeated.decision, 'discontinuity'); assert.equal(repeated.score, 1);
  assert.deepEqual(repeated.flag.contextFactsUsed, [{ type: 'appointment', value: 'Pharmacy refill' }, { type: 'recorded_at', value: first.completedAt }]);
  assert.equal((await f.makeService().load()).pending.id, repeated.id);
  assert.match(recallMessage(repeated, f.now), /^You recorded Pharmacy refill as completed at /);
  assert.equal((await history(f)).length, 2);
});

test('same title on different dates is a different appointment', async () => {
  const f = fixture(); const early = await appointment(f, 'Clinic visit', 3600000); const late = await appointment(f, 'Clinic visit', 86400000);
  await f.service.complete(early.id);
  assert.equal((await f.service.complete(late.id)).decision, 'consistent');
});

test('keep earlier completion preserves archive and correction returns it to upcoming', async () => {
  const f = fixture(); const item = await appointment(f); const completed = await f.service.complete(item.id); f.now += 1;
  const repeat = await f.service.complete(item.id); await f.service.resolve(repeat.id, 'kept');
  assert.equal((await f.service.load()).archived[0].completedAt, completed.completedAt);
  const repeatAgain = await f.service.complete(item.id); f.now += 1; await f.service.resolve(repeatAgain.id, 'corrected');
  const state = await f.service.load(); assert.equal(state.pending, null); assert.equal(state.upcoming[0].id, item.id); assert.equal(state.upcoming[0].completedAt, null);
  const items = await history(f); assert.equal(items[0].resolution, 'corrected');
});

test('direct mark incomplete creates a correction history event', async () => {
  const f = fixture(); const item = await appointment(f); await f.service.complete(item.id); f.now += 1;
  const correction = await f.service.markIncomplete(item.id);
  assert.equal(correction.actionType, 'appointment_completion_corrected');
  assert.equal((await f.service.load()).upcoming[0].id, item.id);
  assert.equal((await history(f))[0].actionType, 'appointment_completion_corrected');
});

test('past schedules and malformed titles are rejected without writes', async () => {
  const f = fixture(); const before = new Map(f.values);
  for (const [title, time] of [['Past', f.now - 1], ['', f.now + 1], ['bad\nname', f.now + 1], ['x'.repeat(61), f.now + 1], ['Valid', NaN]]) await assert.rejects(f.service.add(title, time));
  assert.deepEqual(f.values, before);
});

test('active appointments cap at twenty and completed archive evicts the oldest after twenty', async () => {
  const f = fixture();
  for (let index = 0; index < MAX_ACTIVE; index += 1) await appointment(f, `Upcoming ${index}`, 3600000 + index);
  await assert.rejects(appointment(f, 'Over limit'), /20 upcoming/);
  const f2 = fixture(); const ids = [];
  for (let index = 0; index < MAX_ARCHIVED + 2; index += 1) { const item = await appointment(f2, `Completed ${index}`, 3600000 + index); ids.push(item.id); await f2.service.complete(item.id); f2.now += 1; }
  const state = await f2.service.load(); assert.equal(state.archived.length, MAX_ARCHIVED); assert.deepEqual(state.archived.map((item) => item.id).sort((a, b) => a - b), ids.slice(-MAX_ARCHIVED));
  assert.equal((await history(f2)).length, 20);
});

test('a correction cannot exceed the active appointment limit', async () => {
  const f = fixture(); const completed = await appointment(f, 'Completed'); await f.service.complete(completed.id);
  for (let index = 0; index < MAX_ACTIVE; index += 1) await appointment(f, `Upcoming ${index}`, 3600000 + index);
  await assert.rejects(f.service.markIncomplete(completed.id), /20 upcoming/);
});

test('denied roles, locked sessions, action types and purposes never touch appointment storage', async () => {
  for (const session of [{ role: 'caretaker', unlocked: true, epoch: 1 }, { role: 'patient', unlocked: false, epoch: 1 }]) {
    const f = fixture(); f.session = session;
    for (const action of [() => f.service.load(), () => f.service.add('Appointment', f.now + 1), () => f.service.complete(1), () => f.service.listHistory()]) await assert.rejects(action(), /Unlock/);
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
  for (const request of [{ actionType: 'medication_taken', purpose: 'appointment_recall' }, { actionType: 'appointment_completed', purpose: 'notification_review' }]) {
    const f = fixture(); await assert.rejects(f.service.load(request), /Unlock/); assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
});

test('session changes, corrupt data, and failed writes fail closed without replacing the root index', async () => {
  const f = fixture(); const item = await appointment(f); const rootBefore = f.values.get(ROOT);
  const originalRead = f.storage.getItemAsync;
  f.storage.getItemAsync = async (key) => { const value = await originalRead(key); f.session = { role: 'patient', unlocked: false, epoch: 2 }; return value; };
  await assert.rejects(f.service.load(), /Unlock/); f.session = { role: 'patient', unlocked: true, epoch: 3 }; f.storage.getItemAsync = originalRead;
  const originalWrite = f.storage.setItemAsync; let writes = 0;
  f.storage.setItemAsync = async (key, value) => { if (++writes === 2) throw new Error('device failure'); await originalWrite(key, value); };
  await assert.rejects(f.service.complete(item.id), /preserved/); assert.equal(f.values.get(ROOT), rootBefore); f.storage.setItemAsync = originalWrite;
  const root = JSON.parse(f.values.get(ROOT)); f.values.set(`${PREFIX}.appointment.${item.id}.${root.appointments[0][1]}`, '{bad json');
  await assert.rejects(f.makeService().load(), /preserved/);
});

test('appointment service uses only its private namespace and no network', async () => {
  const f = fixture(); f.values.set('cbc-approved-reminders', 'unrelated'); const originalFetch = global.fetch; global.fetch = () => { throw new Error('network forbidden'); };
  try { const item = await appointment(f); await f.service.complete(item.id); assert.ok([...f.reads, ...f.writes].every((key) => key.startsWith(PREFIX))); } finally { global.fetch = originalFetch; }
});
