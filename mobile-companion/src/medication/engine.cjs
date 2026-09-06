const { createStore } = require('./store.cjs');
const FOUR_HOURS = 4 * 60 * 60 * 1000;
const POLICY = Object.freeze({ medication_taken: Object.freeze({ purpose: 'medication_recall', maxFacts: 2, allowedContext: Object.freeze(['medication_routines', 'medication_checks']) }) });

function authorize(session, request) {
  if (!session || session.role !== 'patient' || !session.unlocked || !Number.isSafeInteger(session.epoch) || request?.actionType !== 'medication_taken' || request?.purpose !== POLICY.medication_taken.purpose) {
    throw new Error('Unlock the patient device to use medication recall.');
  }
  return POLICY.medication_taken;
}

function assess(routine, now) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime()) || (routine.lastEntry && routine.lastEntry.recordedAt > now)) {
    throw new Error('The medication check is unavailable because the recorded time is ahead of this device’s clock. Check the device date and time, then try again.');
  }
  const repeated = routine.lastEntry !== null && now - routine.lastEntry.recordedAt <= FOUR_HOURS;
  return { decision: repeated ? 'discontinuity' : 'consistent', score: repeated ? 1 : 0 };
}

function recallMessage(check, now = Date.now()) {
  const facts = check.flag.contextFactsUsed;
  const date = new Date(facts[1].value);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = date.toDateString() === new Date(now).toDateString() ? '' : ` on ${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return `You recorded ${facts[0].value} at ${time}${day}.`;
}

function createMedicationService({ storage, getSession, clock = Date.now }) {
  const store = createStore(storage);
  let queue = Promise.resolve();
  const requestDefault = { actionType: 'medication_taken', purpose: 'medication_recall' };

  function run(request, operation) {
    let captured;
    try { captured = getSession(); authorize(captured, request); } catch (error) { return Promise.reject(error); }
    const guard = () => {
      const current = getSession();
      authorize(current, request);
      if (current.epoch !== captured.epoch) throw new Error('This session ended. Unlock the patient device to continue.');
    };
    const result = queue.then(async () => {
      guard();
      const value = await operation(await store.index(guard), guard);
      guard();
      return value;
    });
    queue = result.catch(() => {});
    return result;
  }

  return {
    load(request = requestDefault) {
      return run(request, async (index, guard) => {
        const routines = [];
        for (let id = 0; id < index.routines.length; id += 1) routines.push(await store.routine(index, id, guard));
        const pending = index.pending === null ? null : await store.check(index, index.pending, guard);
        return { routines, pending };
      });
    },
    addRoutine(label, request = requestDefault) {
      return run(request, async (index, guard) => {
        const cleaned = typeof label === 'string' ? label.trim() : '';
        if (!cleaned || cleaned.length > 60 || /[\u0000-\u001f\u007f]/.test(cleaned)) throw new Error('Use a routine name between 1 and 60 characters.');
        if (index.routines.length >= 10) throw new Error('This device already has 10 medication routines.');
        for (let id = 0; id < index.routines.length; id += 1) {
          const existing = await store.routine(index, id, guard);
          if (existing.label.toLocaleLowerCase() === cleaned.toLocaleLowerCase()) throw new Error('A routine with that name already exists.');
        }
        const routine = { v: 1, id: index.routines.length, label: cleaned, lastEntry: null };
        await store.commit(index, { routine }, guard);
        return routine;
      });
    },
    record(routineId, request = requestDefault) {
      return run(request, async (index, guard) => {
        if (index.pending !== null) throw new Error('Review the earlier medication check before recording another entry.');
        const routine = await store.routine(index, routineId, guard);
        const now = clock();
        const result = assess(routine, now);
        const id = index.seq + 1;
        const check = { v: 1, id, routineId, actionType: 'medication_taken', createdAt: now, ...result, flag: null, resolution: 'recorded', resolvedAt: now, entryId: id };
        if (result.decision === 'discontinuity') {
          check.priorEntry = routine.lastEntry;
          check.flag = { id, type: 'action_discontinuity', reason: 'same_routine_within_four_hours', contextFactsUsed: [{ type: 'routine', value: routine.label }, { type: 'recorded_at', value: routine.lastEntry.recordedAt }] };
          check.resolution = 'pending';
          check.resolvedAt = null;
          check.entryId = null;
          await store.commit(index, { check }, guard);
        } else {
          routine.lastEntry = { id, recordedAt: now, source: 'self_reported' };
          await store.commit(index, { routine, check }, guard);
        }
        return check;
      });
    },
    resolve(checkId, resolution, request = requestDefault) {
      return run(request, async (index, guard) => {
        if (!['kept', 'recorded'].includes(resolution)) throw new Error('Choose whether to keep the earlier record or record another entry.');
        if (index.pending !== checkId) throw new Error('This medication check is no longer pending. Reload the medication routines.');
        const check = await store.check(index, checkId, guard);
        const routine = await store.routine(index, check.routineId, guard);
        const now = clock();
        assess(routine, now);
        if (now < check.createdAt) throw new Error('The device clock changed. Check the date and time, then try again.');
        if (routine.lastEntry?.id !== check.priorEntry.id) throw new Error('The earlier medication record changed. Reload the medication routines.');
        check.resolution = resolution;
        check.resolvedAt = now;
        check.entryId = resolution === 'recorded' ? index.seq + 1 : null;
        if (resolution === 'recorded') routine.lastEntry = { id: check.entryId, recordedAt: now, source: 'self_reported' };
        await store.commit(index, { check, ...(resolution === 'recorded' ? { routine } : {}) }, guard);
        return check;
      });
    },
    listHistory(request = requestDefault) {
      return run(request, async (index, guard) => {
        const records = await Promise.all(index.checks.map((ref) => store.check(index, ref[0], guard)));
        return records.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).map((record) => ({
          domain: 'medication', id: record.id, createdAt: record.createdAt, actionType: record.actionType,
          title: record.flag?.contextFactsUsed?.[0]?.value || 'Medication routine', decision: record.decision,
          resolution: record.resolution, reason: record.flag?.reason || null, factsShown: record.flag?.contextFactsUsed || [],
        }));
      });
    },
  };
}

module.exports = { createMedicationService, authorize, assess, recallMessage, FOUR_HOURS, POLICY };
