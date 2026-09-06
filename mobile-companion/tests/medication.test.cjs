const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMedicationService, FOUR_HOURS, recallMessage } = require('../src/medication/engine.cjs');
const { createStore, ROOT, PREFIX, byteLength } = require('../src/medication/store.cjs');

function fixture() {
  const values = new Map();
  const reads = [];
  const writes = [];
  let now = Date.UTC(2026, 8, 6, 8, 15);
  let session = { role: 'patient', unlocked: true, epoch: 1 };
  const storage = {
    async getItemAsync(key) { reads.push(key); return values.get(key) ?? null; },
    async setItemAsync(key, value) { writes.push(key); assert.ok(byteLength(value) < 2048); values.set(key, value); },
    async deleteItemAsync(key) { values.delete(key); },
  };
  const makeService = () => createMedicationService({ storage, getSession: () => session, clock: () => now });
  return { values, reads, writes, storage, service: makeService(), makeService, get now() { return now; }, set now(value) { now = value; }, get session() { return session; }, set session(value) { session = value; } };
}

async function firstLog(f) {
  const routine = await f.service.addRoutine('Morning medication');
  const check = await f.service.record(routine.id);
  return { routine, check };
}

async function audit(f) {
  const store = createStore(f.storage);
  const guard = () => {};
  const index = await store.index(guard);
  return Promise.all(index.checks.map((ref) => store.check(index, ref[0], guard)));
}

test('first log persists and a two-hour repeat creates a linked, two-fact flag', async () => {
  const f = fixture();
  const { check: first } = await firstLog(f);
  assert.equal(first.decision, 'consistent');
  const original = (await f.service.load()).routines[0].lastEntry;
  f.now += 2 * 60 * 60 * 1000;
  const repeat = await f.service.record(0);
  assert.equal(repeat.score, 1);
  assert.equal(repeat.flag.id, repeat.id);
  assert.equal(repeat.flag.reason, 'same_routine_within_four_hours');
  assert.deepEqual(repeat.flag.contextFactsUsed, [{ type: 'routine', value: 'Morning medication' }, { type: 'recorded_at', value: original.recordedAt }]);
  assert.equal(repeat.priorEntry.id, first.id);
  assert.equal(repeat.resolution, 'pending');
  const restored = await f.makeService().load();
  assert.deepEqual(restored.pending, repeat);
  assert.deepEqual(restored.routines[0].lastEntry, original);
  assert.equal((await audit(f)).length, 2);
});

for (const [delta, expected] of [[0, 'discontinuity'], [FOUR_HOURS, 'discontinuity'], [FOUR_HOURS + 1, 'consistent']]) {
  test(`timestamp boundary ${delta}ms gives ${expected}`, async () => {
    const f = fixture();
    await firstLog(f);
    f.now += delta;
    assert.equal((await f.service.record(0)).decision, expected);
  });
}

test('repeat matching is independent of midnight and recall includes prior date', async () => {
  const f = fixture();
  f.now = new Date(2026, 8, 5, 23, 30).getTime();
  await firstLog(f);
  f.now += 60 * 60 * 1000;
  const repeat = await f.service.record(0);
  assert.equal(repeat.decision, 'discontinuity');
  assert.match(recallMessage(repeat, f.now), / on /);
  assert.doesNotMatch(recallMessage(repeat, repeat.priorEntry.recordedAt), / on /);
  assert.match(recallMessage(repeat, f.now), /^You recorded Morning medication at /);
});

test('another routine does not match and record lookup reads only the selected routine', async () => {
  const f = fixture();
  await firstLog(f);
  const second = await f.service.addRoutine('Evening medication');
  f.reads.length = 0;
  assert.equal((await f.service.record(second.id)).decision, 'consistent');
  assert.deepEqual(f.reads, [ROOT, `${PREFIX}.routine.1.0`]);
});

test('keep earlier record resolves the flag without a new entry', async () => {
  const f = fixture();
  await firstLog(f);
  const before = (await f.service.load()).routines[0].lastEntry;
  f.now += 1000;
  const repeat = await f.service.record(0);
  await f.service.resolve(repeat.id, 'kept');
  const after = await f.makeService().load();
  assert.equal(after.pending, null);
  assert.deepEqual(after.routines[0].lastEntry, before);
  assert.equal((await audit(f))[1].resolution, 'kept');
});

test('override logs once, preserves the earlier facts, and cannot be replayed', async () => {
  const f = fixture();
  await firstLog(f);
  f.now += 1000;
  const repeat = await f.service.record(0);
  f.now += 5000;
  const resolution = await f.service.resolve(repeat.id, 'recorded');
  const after = await f.service.load();
  assert.equal(after.routines[0].lastEntry.recordedAt, f.now);
  assert.equal(after.routines[0].lastEntry.id, resolution.entryId);
  assert.deepEqual((await audit(f))[1].flag, repeat.flag);
  await assert.rejects(f.service.resolve(repeat.id, 'recorded'), /no longer pending/);
});

test('writes are serialized and a pending check prevents further submissions', async () => {
  const f = fixture();
  await f.service.addRoutine('Morning medication');
  const results = await Promise.allSettled([f.service.record(0), f.service.record(0), f.service.record(0)]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.equal(results[0].value.decision, 'consistent');
  assert.equal(results[1].value.resolution, 'pending');
  assert.equal((await audit(f)).length, 2);
});

test('routine names are trimmed, unique, bounded, and capped at ten', async () => {
  const f = fixture();
  assert.equal((await f.service.addRoutine(' Morning medication ')).label, 'Morning medication');
  for (const name of ['', ' ', 'x'.repeat(61), 'bad\nname', 'morning MEDICATION']) await assert.rejects(f.service.addRoutine(name));
  for (let i = 1; i < 10; i += 1) await f.service.addRoutine(`Routine ${i}`);
  await assert.rejects(f.service.addRoutine('Extra'), /10 medication routines/);
  assert.equal((await f.service.load()).routines.length, 10);
});

test('denied roles, locked sessions, actions, and purposes cause zero reads or writes', async () => {
  for (const session of [{ role: 'caretaker', unlocked: true, epoch: 1 }, { role: 'patient', unlocked: false, epoch: 1 }]) {
    const f = fixture(); f.session = session;
    for (const operation of [() => f.service.load(), () => f.service.addRoutine('Morning'), () => f.service.record(0), () => f.service.resolve(1, 'kept')]) await assert.rejects(operation(), /Unlock/);
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
  for (const request of [{ actionType: 'call_made', purpose: 'medication_recall' }, { actionType: '__proto__', purpose: 'medication_recall' }, { actionType: 'medication_taken', purpose: 'notification_review' }]) {
    const f = fixture();
    await assert.rejects(f.service.load(request), /Unlock/);
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
});

test('lock during a read and re-unlock in a new epoch discard the old operation', async () => {
  const f = fixture();
  await firstLog(f);
  const originalRead = f.storage.getItemAsync;
  f.storage.getItemAsync = async (key) => {
    const result = await originalRead(key);
    f.session = { role: 'patient', unlocked: true, epoch: 3 };
    return result;
  };
  f.reads.length = 0;
  await assert.rejects(f.service.load(), /session ended/);
  assert.deepEqual(f.reads, [ROOT]);
});

test('lock during staged writes preserves the previous committed entry', async () => {
  const f = fixture();
  await firstLog(f);
  const before = f.values.get(ROOT);
  f.now += FOUR_HOURS + 1;
  const originalWrite = f.storage.setItemAsync;
  f.storage.setItemAsync = async (key, value) => {
    await originalWrite(key, value);
    f.session = { role: 'patient', unlocked: false, epoch: 2 };
  };
  await assert.rejects(f.service.record(0), /Unlock/);
  assert.equal(f.values.get(ROOT), before);
  f.session = { role: 'patient', unlocked: true, epoch: 3 };
  f.storage.setItemAsync = originalWrite;
  assert.equal((await f.service.load()).routines[0].lastEntry.recordedAt, f.now - FOUR_HOURS - 1);
});

test('future timestamps block checking without changing stored records', async () => {
  const f = fixture();
  await firstLog(f);
  const before = new Map(f.values);
  f.now -= 1;
  await assert.rejects(f.service.record(0), /clock/);
  assert.deepEqual(f.values, before);
});

test('failed record or index writes preserve prior state and permit retry', async () => {
  for (const failAt of [1, 2, 3]) {
    const f = fixture();
    await firstLog(f);
    const before = f.values.get(ROOT);
    f.now += FOUR_HOURS + 1;
    const originalWrite = f.storage.setItemAsync;
    let count = 0;
    f.storage.setItemAsync = async (key, value) => {
      if (++count === failAt) throw new Error('device failure');
      await originalWrite(key, value);
    };
    await assert.rejects(f.service.record(0), /preserved/);
    assert.equal(f.values.get(ROOT), before);
    f.storage.setItemAsync = originalWrite;
    const restored = await f.makeService().load();
    assert.equal(restored.routines[0].lastEntry.recordedAt, f.now - FOUR_HOURS - 1);
    await f.service.record(0);
    assert.equal((await audit(f)).length, 2);
  }
});

test('cleanup failures do not turn a committed save into a reported failure', async () => {
  const f = fixture();
  await firstLog(f);
  f.now += FOUR_HOURS + 1;
  f.storage.deleteItemAsync = async () => { throw new Error('device failure'); };
  assert.equal((await f.service.record(0)).decision, 'consistent');
  assert.equal((await f.service.load()).routines[0].lastEntry.recordedAt, f.now);
});

test('malformed index, routine, and pending check fail closed without overwriting data', async () => {
  for (const target of ['index', 'routine', 'check']) {
    const f = fixture(); await firstLog(f);
    const repeat = await f.service.record(0);
    const index = JSON.parse(f.values.get(ROOT));
    const ref = index.checks.find((r) => r[0] === repeat.id);
    const key = target === 'index' ? ROOT : target === 'routine' ? `${PREFIX}.routine.0.${index.routines[0]}` : `${PREFIX}.check.${ref[2]}.${ref[3]}`;
    f.values.set(key, target === 'index' ? '{bad json' : JSON.stringify({ v: 1, id: 0 }));
    const before = new Map(f.values);
    await assert.rejects(f.service.load(), /preserved/);
    assert.deepEqual(f.values, before);
  }
});

test('retention keeps twenty newest checks and latest entry for every routine', async () => {
  const f = fixture();
  await firstLog(f);
  await f.service.addRoutine('Evening medication');
  await f.service.record(1);
  const ids = [];
  for (let i = 0; i < 30; i += 1) {
    f.now += FOUR_HOURS + 1;
    ids.push((await f.service.record(0)).id);
  }
  assert.deepEqual((await audit(f)).map((c) => c.id), ids.slice(-20));
  const state = await f.service.load();
  assert.ok(state.routines[1].lastEntry);
  assert.equal(state.routines[0].lastEntry.recordedAt, f.now);
  assert.ok(f.values.size <= 61);
  for (const value of f.values.values()) assert.ok(byteLength(value) < 2048);
});

test('full-length Unicode labels and flags stay below SecureStore value limit', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i += 1) await f.service.addRoutine('薬'.repeat(59) + i);
  await f.service.record(0);
  for (let i = 0; i < 25; i += 1) {
    const pending = await f.service.record(0);
    await f.service.resolve(pending.id, 'kept');
  }
  assert.equal((await audit(f)).length, 20);
  for (const value of f.values.values()) assert.ok(byteLength(value) < 2048);
});

test('engine only touches its own local storage namespace and has no network dependency', async () => {
  const f = fixture();
  f.values.set('cbc-approved-reminders', 'private unrelated context');
  f.values.set('cbc-mobile-last-note', 'private note');
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error('Network must never be used'); };
  try {
    await firstLog(f);
    const repeat = await f.service.record(0);
    await f.service.resolve(repeat.id, 'kept');
    assert.ok([...f.reads, ...f.writes].every((key) => key.startsWith(PREFIX)));
    assert.ok(!JSON.stringify(repeat).includes('private'));
  } finally { global.fetch = originalFetch; }
});
