// Copy-on-write records: the small manifest is the sole commit point. Each
// record has two fixed slots, so failed/interrupted writes cannot grow storage.
const PREFIX = 'cbc-medication-v1';
const ROOT = `${PREFIX}.index`;
const MAX_BYTES = 2048;
const storageError = () => new Error('Medication records could not be read or saved. Your earlier records have been preserved. Try again.');
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const timestamp = (n) => integer(n) && Number.isFinite(new Date(n).getTime());
const entryValid = (entry) => entry && integer(entry.id) && timestamp(entry.recordedAt) && entry.source === 'self_reported';
const labelValid = (label) => typeof label === 'string' && label.trim() === label && label.length > 0 && label.length <= 60;
const byteLength = (value) => encodeURIComponent(value).replace(/%[A-F\d]{2}/gi, '_').length;
const routineKey = (id, bank) => `${PREFIX}.routine.${id}.${bank}`;
const checkKey = (slot, bank) => `${PREFIX}.check.${slot}.${bank}`;

function validIndex(index) {
  if (!index || index.v !== 1 || !integer(index.seq) || !Array.isArray(index.routines) || index.routines.length > 10 || !index.routines.every((b) => b === 0 || b === 1)) return false;
  if (!Array.isArray(index.checks) || index.checks.length > 20) return false;
  if (!index.checks.every((ref) => Array.isArray(ref) && ref.length === 4 && integer(ref[0]) && ref[0] <= index.seq && integer(ref[1]) && ref[1] < index.routines.length && integer(ref[2]) && ref[2] < 20 && (ref[3] === 0 || ref[3] === 1))) return false;
  return new Set(index.checks.map((r) => r[0])).size === index.checks.length && new Set(index.checks.map((r) => r[2])).size === index.checks.length && (index.pending === null || index.checks.some((r) => r[0] === index.pending));
}

function validRoutine(record, id) {
  return record?.v === 1 && record.id === id && labelValid(record.label) && (record.lastEntry === null || entryValid(record.lastEntry));
}

function validCheck(record, ref) {
  if (record?.v !== 1 || record.id !== ref[0] || record.routineId !== ref[1] || record.actionType !== 'medication_taken' || !timestamp(record.createdAt)) return false;
  if (record.decision === 'consistent') return record.score === 0 && record.flag === null && record.resolution === 'recorded' && record.entryId === record.id && timestamp(record.resolvedAt);
  if (record.decision !== 'discontinuity' || record.score !== 1 || !entryValid(record.priorEntry)) return false;
  const facts = record.flag?.contextFactsUsed;
  if (record.flag?.id !== record.id || record.flag?.type !== 'action_discontinuity' || record.flag?.reason !== 'same_routine_within_four_hours' || !Array.isArray(facts) || facts.length !== 2 || facts[0].type !== 'routine' || !labelValid(facts[0].value) || facts[1].type !== 'recorded_at' || facts[1].value !== record.priorEntry.recordedAt) return false;
  if (record.createdAt < record.priorEntry.recordedAt || record.createdAt - record.priorEntry.recordedAt > 4 * 60 * 60 * 1000) return false;
  return record.resolution === 'pending' ? record.resolvedAt === null && record.entryId === null : ['kept', 'recorded'].includes(record.resolution) && timestamp(record.resolvedAt) && (record.resolution === 'kept' ? record.entryId === null : integer(record.entryId));
}

function createStore(storage) {
  async function read(key, guard) {
    guard();
    try {
      const value = await storage.getItemAsync(key);
      guard();
      if (value === null) return null;
      if (byteLength(value) >= MAX_BYTES) throw storageError();
      return JSON.parse(value);
    } catch { guard(); throw storageError(); }
  }

  async function index(guard) {
    const value = await read(ROOT, guard);
    if (value === null) return { v: 1, seq: 0, routines: [], checks: [], pending: null };
    if (!validIndex(value)) throw storageError();
    return value;
  }

  async function routine(manifest, id, guard) {
    if (!integer(id) || id >= manifest.routines.length) throw new Error('Choose an existing medication routine.');
    const value = await read(routineKey(id, manifest.routines[id]), guard);
    if (!validRoutine(value, id)) throw storageError();
    return value;
  }

  async function check(manifest, id, guard) {
    const ref = manifest.checks.find((r) => r[0] === id);
    if (!ref) throw storageError();
    const value = await read(checkKey(ref[2], ref[3]), guard);
    if (!validCheck(value, ref) || (value.resolution === 'pending') !== (manifest.pending === id)) throw storageError();
    return value;
  }

  async function commit(previous, changes, guard) {
    const next = { ...previous, seq: previous.seq + 1, routines: [...previous.routines], checks: previous.checks.map((r) => [...r]) };
    const writes = [];
    const obsolete = [];
    if (changes.routine) {
      const record = changes.routine;
      if (!validRoutine(record, record.id) || record.id > previous.routines.length) throw storageError();
      const oldBank = previous.routines[record.id];
      const bank = oldBank === 0 ? 1 : 0;
      next.routines[record.id] = bank;
      writes.push([routineKey(record.id, bank), record]);
      if (oldBank !== undefined) obsolete.push(routineKey(record.id, oldBank));
    }
    if (changes.check) {
      const record = changes.check;
      const old = previous.checks.find((r) => r[0] === record.id);
      const evicted = !old && previous.checks.length === 20 ? previous.checks[0] : null;
      if (evicted?.[0] === previous.pending) throw storageError();
      const occupied = new Set(previous.checks.map((r) => r[2]));
      const slot = old ? old[2] : evicted ? evicted[2] : Array.from({ length: 20 }, (_, i) => i).find((i) => !occupied.has(i));
      const oldBank = old ? old[3] : evicted?.[3];
      const bank = oldBank === 0 ? 1 : 0;
      const ref = [record.id, record.routineId, slot, bank];
      if (!validCheck(record, ref)) throw storageError();
      next.checks = old ? next.checks.map((r) => r[0] === record.id ? ref : r) : [...next.checks.filter((r) => r[0] !== evicted?.[0]), ref];
      next.pending = record.resolution === 'pending' ? record.id : null;
      writes.push([checkKey(slot, bank), record]);
      if (oldBank !== undefined) obsolete.push(checkKey(slot, oldBank));
    }
    if (!validIndex(next)) throw storageError();
    // Validate every size before touching storage. The root is written last.
    const serialized = [...writes, [ROOT, next]].map(([key, value]) => {
      const json = JSON.stringify(value);
      if (byteLength(json) >= MAX_BYTES) throw storageError();
      return [key, json];
    });
    try {
      for (const [key, value] of serialized) {
        guard();
        await storage.setItemAsync(key, value);
      }
    } catch { guard(); throw storageError(); }
    // Cleanup is best effort after commit; never report a committed save as failed.
    for (const key of obsolete) {
      try { await storage.deleteItemAsync(key); } catch { /* Fixed slots are reused on subsequent writes. */ }
    }
    return next;
  }

  return { index, routine, check, commit };
}

module.exports = { createStore, ROOT, PREFIX, byteLength };
