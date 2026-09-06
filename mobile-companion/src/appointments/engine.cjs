const MAX_BYTES = 2048;
const PREFIX = 'cbc-appointments-v1';
const ROOT = `${PREFIX}.index`;
const MAX_ACTIVE = 20;
const MAX_ARCHIVED = 20;
const MAX_CHECKS = 20;
const storageError = () => new Error('Appointment records could not be read or saved. Your earlier records have been preserved. Try again.');
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const timestamp = (value) => integer(value) && Number.isFinite(new Date(value).getTime());
const byteLength = (value) => encodeURIComponent(value).replace(/%[A-F\d]{2}/gi, '_').length;
const appointmentKey = (id, bank) => `${PREFIX}.appointment.${id}.${bank}`;
const checkKey = (slot, bank) => `${PREFIX}.check.${slot}.${bank}`;

const POLICY = Object.freeze({ appointment_completed: Object.freeze({ purpose: 'appointment_recall', maxFacts: 2, allowedContext: Object.freeze(['appointments', 'appointment_checks']) }) });

function validTitle(title) {
  return typeof title === 'string' && title.trim() === title && title.length > 0 && title.length <= 60 && !/[\u0000-\u001f\u007f]/.test(title);
}

function validAppointment(record, id) {
  return record?.v === 1 && record.id === id && validTitle(record.title) && timestamp(record.scheduledAt)
    && (record.status === 'scheduled' && record.completedAt === null || record.status === 'completed' && timestamp(record.completedAt));
}

function validIndex(index) {
  if (!index || index.v !== 1 || !integer(index.seq) || !Array.isArray(index.appointments) || index.appointments.length > MAX_ACTIVE + MAX_ARCHIVED || !Array.isArray(index.checks) || index.checks.length > MAX_CHECKS) return false;
  if (!index.appointments.every((ref) => Array.isArray(ref) && ref.length === 2 && integer(ref[0]) && ref[0] <= index.seq && (ref[1] === 0 || ref[1] === 1))) return false;
  if (!index.checks.every((ref) => Array.isArray(ref) && ref.length === 4 && integer(ref[0]) && ref[0] <= index.seq && integer(ref[1]) && integer(ref[2]) && ref[2] < MAX_CHECKS && (ref[3] === 0 || ref[3] === 1))) return false;
  return new Set(index.appointments.map((ref) => ref[0])).size === index.appointments.length
    && new Set(index.checks.map((ref) => ref[0])).size === index.checks.length
    && new Set(index.checks.map((ref) => ref[2])).size === index.checks.length
    && (index.pending === null || index.checks.some((ref) => ref[0] === index.pending));
}

function validFacts(facts, title, completedAt) {
  return Array.isArray(facts) && facts.length === 2 && facts[0]?.type === 'appointment' && facts[0]?.value === title && facts[1]?.type === 'recorded_at' && facts[1]?.value === completedAt;
}

function validCheck(record, ref) {
  if (record?.v !== 1 || record.id !== ref[0] || record.appointmentId !== ref[1] || !timestamp(record.createdAt)) return false;
  if (record.actionType === 'appointment_completion_corrected') return record.decision === 'corrected' && record.score === 0 && record.flag === null && record.resolution === 'corrected' && timestamp(record.resolvedAt) && validTitle(record.title);
  if (record.actionType !== 'appointment_completed' || !validTitle(record.title)) return false;
  if (record.decision === 'consistent') return record.score === 0 && record.flag === null && record.resolution === 'recorded' && timestamp(record.resolvedAt) && record.completedAt === record.resolvedAt;
  if (record.decision !== 'discontinuity' || record.score !== 1 || !timestamp(record.priorCompletedAt)) return false;
  const facts = record.flag?.contextFactsUsed;
  if (record.flag?.id !== record.id || record.flag?.type !== 'action_discontinuity' || record.flag?.reason !== 'appointment_already_recorded_completed' || !validFacts(facts, record.title, record.priorCompletedAt)) return false;
  return record.resolution === 'pending' ? record.resolvedAt === null : ['kept', 'corrected'].includes(record.resolution) && timestamp(record.resolvedAt);
}

function authorize(session, request) {
  if (!session || session.role !== 'patient' || !session.unlocked || !Number.isSafeInteger(session.epoch) || request?.actionType !== 'appointment_completed' || request?.purpose !== POLICY.appointment_completed.purpose) throw new Error('Unlock the patient device to use appointment recall.');
  return POLICY.appointment_completed;
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
    if (value === null) return { v: 1, seq: 0, appointments: [], checks: [], pending: null };
    if (!validIndex(value)) throw storageError();
    return value;
  }
  async function appointment(manifest, id, guard) {
    const ref = manifest.appointments.find((item) => item[0] === id);
    if (!ref) throw new Error('This appointment is no longer available. Reload appointments.');
    const value = await read(appointmentKey(ref[0], ref[1]), guard);
    if (!validAppointment(value, id)) throw storageError();
    return value;
  }
  async function check(manifest, id, guard) {
    const ref = manifest.checks.find((item) => item[0] === id);
    if (!ref) throw storageError();
    const value = await read(checkKey(ref[2], ref[3]), guard);
    if (!validCheck(value, ref) || (value.resolution === 'pending') !== (manifest.pending === id)) throw storageError();
    return value;
  }
  async function commit(previous, changes, guard) {
    const next = { ...previous, seq: previous.seq + 1, appointments: previous.appointments.map((item) => [...item]), checks: previous.checks.map((item) => [...item]) };
    const writes = [];
    const obsolete = [];
    for (const record of changes.appointments || []) {
      if (!validAppointment(record, record.id)) throw storageError();
      const old = previous.appointments.find((item) => item[0] === record.id);
      if (!old && previous.appointments.some((item) => item[0] === record.id)) throw storageError();
      const bank = old?.[1] === 0 ? 1 : 0;
      const ref = [record.id, bank];
      next.appointments = old ? next.appointments.map((item) => item[0] === record.id ? ref : item) : [...next.appointments, ref];
      writes.push([appointmentKey(record.id, bank), record]);
      if (old) obsolete.push(appointmentKey(record.id, old[1]));
    }
    for (const id of changes.removeAppointments || []) {
      const ref = next.appointments.find((item) => item[0] === id);
      if (!ref || id === previous.pending) throw storageError();
      next.appointments = next.appointments.filter((item) => item[0] !== id);
      obsolete.push(appointmentKey(ref[0], ref[1]));
    }
    if (changes.check) {
      const record = changes.check;
      const old = previous.checks.find((item) => item[0] === record.id);
      const evicted = !old && previous.checks.length === MAX_CHECKS ? previous.checks[0] : null;
      if (evicted?.[0] === previous.pending) throw storageError();
      const occupied = new Set(previous.checks.map((item) => item[2]));
      const slot = old ? old[2] : evicted ? evicted[2] : Array.from({ length: MAX_CHECKS }, (_, index) => index).find((index) => !occupied.has(index));
      const oldBank = old ? old[3] : evicted?.[3];
      const bank = oldBank === 0 ? 1 : 0;
      const ref = [record.id, record.appointmentId, slot, bank];
      if (!validCheck(record, ref)) throw storageError();
      next.checks = old ? next.checks.map((item) => item[0] === record.id ? ref : item) : [...next.checks.filter((item) => item[0] !== evicted?.[0]), ref];
      next.pending = record.resolution === 'pending' ? record.id : null;
      writes.push([checkKey(slot, bank), record]);
      if (oldBank !== undefined) obsolete.push(checkKey(slot, oldBank));
    }
    if (!validIndex(next)) throw storageError();
    const serialized = [...writes, [ROOT, next]].map(([key, value]) => {
      const json = JSON.stringify(value);
      if (byteLength(json) >= MAX_BYTES) throw storageError();
      return [key, json];
    });
    try { for (const [key, value] of serialized) { guard(); await storage.setItemAsync(key, value); } } catch { guard(); throw storageError(); }
    for (const key of obsolete) { try { await storage.deleteItemAsync(key); } catch { /* Reused fixed slots or stale unreachable data are safe. */ } }
    return next;
  }
  return { index, appointment, check, commit };
}

function createAppointmentService({ storage, getSession, clock = Date.now }) {
  const store = createStore(storage);
  let queue = Promise.resolve();
  const requestDefault = { actionType: 'appointment_completed', purpose: 'appointment_recall' };
  function run(request, operation) {
    let captured;
    try { captured = getSession(); authorize(captured, request); } catch (error) { return Promise.reject(error); }
    const guard = () => { const current = getSession(); authorize(current, request); if (current.epoch !== captured.epoch) throw new Error('This session ended. Unlock the patient device to continue.'); };
    const result = queue.then(async () => { guard(); const value = await operation(await store.index(guard), guard); guard(); return value; });
    queue = result.catch(() => {});
    return result;
  }
  async function allAppointments(index, guard) { return Promise.all(index.appointments.map((ref) => store.appointment(index, ref[0], guard))); }
  async function evictArchived(index, appointments) {
    const archived = appointments.filter((item) => item.status === 'completed').sort((a, b) => a.completedAt - b.completedAt);
    return archived.length > MAX_ARCHIVED ? archived.slice(0, archived.length - MAX_ARCHIVED).map((item) => item.id) : [];
  }
  function correction(id, appointment, now) { return { v: 1, id, appointmentId: appointment.id, actionType: 'appointment_completion_corrected', title: appointment.title, createdAt: now, decision: 'corrected', score: 0, flag: null, resolution: 'corrected', resolvedAt: now }; }
  return {
    load(request = requestDefault) {
      return run(request, async (index, guard) => {
        const appointments = await allAppointments(index, guard);
        const pending = index.pending === null ? null : await store.check(index, index.pending, guard);
        return { upcoming: appointments.filter((item) => item.status === 'scheduled').sort((a, b) => a.scheduledAt - b.scheduledAt), archived: appointments.filter((item) => item.status === 'completed').sort((a, b) => b.completedAt - a.completedAt), pending };
      });
    },
    add(title, scheduledAt, request = requestDefault) {
      return run(request, async (index, guard) => {
        const cleaned = typeof title === 'string' ? title.trim() : '';
        const now = clock();
        if (!validTitle(cleaned)) throw new Error('Use an appointment name between 1 and 60 characters.');
        if (!timestamp(scheduledAt) || scheduledAt < now) throw new Error('Choose an appointment time that is now or later.');
        const appointments = await allAppointments(index, guard);
        if (appointments.filter((item) => item.status === 'scheduled').length >= MAX_ACTIVE) throw new Error('This device already has 20 upcoming appointments.');
        const appointment = { v: 1, id: index.seq + 1, title: cleaned, scheduledAt, status: 'scheduled', completedAt: null };
        await store.commit(index, { appointments: [appointment] }, guard);
        return appointment;
      });
    },
    complete(appointmentId, request = requestDefault) {
      return run(request, async (index, guard) => {
        if (index.pending !== null) throw new Error('Review the earlier appointment check before recording another completion.');
        const appointment = await store.appointment(index, appointmentId, guard);
        const now = clock();
        if (!timestamp(now)) throw new Error('The appointment check is unavailable. Check the device date and time, then try again.');
        const id = index.seq + 1;
        if (appointment.status === 'completed') {
          const check = { v: 1, id, appointmentId, actionType: 'appointment_completed', title: appointment.title, createdAt: now, decision: 'discontinuity', score: 1, priorCompletedAt: appointment.completedAt, flag: { id, type: 'action_discontinuity', reason: 'appointment_already_recorded_completed', contextFactsUsed: [{ type: 'appointment', value: appointment.title }, { type: 'recorded_at', value: appointment.completedAt }] }, resolution: 'pending', resolvedAt: null };
          await store.commit(index, { check }, guard);
          return check;
        }
        appointment.status = 'completed';
        appointment.completedAt = now;
        const check = { v: 1, id, appointmentId, actionType: 'appointment_completed', title: appointment.title, createdAt: now, decision: 'consistent', score: 0, flag: null, resolution: 'recorded', resolvedAt: now, completedAt: now };
        const appointments = await allAppointments(index, guard);
        const removeAppointments = await evictArchived(index, appointments.map((item) => item.id === appointment.id ? appointment : item));
        await store.commit(index, { appointments: [appointment], removeAppointments, check }, guard);
        return check;
      });
    },
    resolve(checkId, resolution, request = requestDefault) {
      return run(request, async (index, guard) => {
        if (!['kept', 'corrected'].includes(resolution) || index.pending !== checkId) throw new Error('This appointment check is no longer pending. Reload appointments.');
        const check = await store.check(index, checkId, guard);
        const appointment = await store.appointment(index, check.appointmentId, guard);
        const now = clock();
        if (!timestamp(now) || now < check.createdAt || appointment.status !== 'completed' || appointment.completedAt !== check.priorCompletedAt) throw new Error('The appointment record changed. Reload appointments.');
        if (resolution === 'corrected' && (await allAppointments(index, guard)).filter((item) => item.status === 'scheduled').length >= MAX_ACTIVE) throw new Error('This device already has 20 upcoming appointments.');
        check.resolution = resolution;
        check.resolvedAt = now;
        if (resolution === 'corrected') { appointment.status = 'scheduled'; appointment.completedAt = null; }
        await store.commit(index, { appointments: resolution === 'corrected' ? [appointment] : [], check }, guard);
        return check;
      });
    },
    markIncomplete(appointmentId, request = requestDefault) {
      return run(request, async (index, guard) => {
        if (index.pending !== null) throw new Error('Review the earlier appointment check before changing an appointment.');
        const appointment = await store.appointment(index, appointmentId, guard);
        const now = clock();
        if (appointment.status !== 'completed' || !timestamp(now)) throw new Error('This appointment is not recorded as completed.');
        if ((await allAppointments(index, guard)).filter((item) => item.status === 'scheduled').length >= MAX_ACTIVE) throw new Error('This device already has 20 upcoming appointments.');
        appointment.status = 'scheduled'; appointment.completedAt = null;
        const event = correction(index.seq + 1, appointment, now);
        await store.commit(index, { appointments: [appointment], check: event }, guard);
        return event;
      });
    },
    listHistory(request = requestDefault) {
      return run(request, async (index, guard) => {
        const records = await Promise.all(index.checks.map((ref) => store.check(index, ref[0], guard)));
        return records.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).map((record) => ({ domain: 'appointment', id: record.id, createdAt: record.createdAt, actionType: record.actionType, title: record.title, decision: record.decision, resolution: record.resolution, reason: record.flag?.reason || null, factsShown: record.flag?.contextFactsUsed || [] }));
      });
    },
  };
}

function recallMessage(check, now = Date.now()) {
  const facts = check.flag.contextFactsUsed;
  const date = new Date(facts[1].value);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = date.toDateString() === new Date(now).toDateString() ? '' : ` on ${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return `You recorded ${facts[0].value} as completed at ${time}${day}.`;
}

module.exports = { createAppointmentService, authorize, recallMessage, POLICY, PREFIX, ROOT, byteLength, MAX_ACTIVE, MAX_ARCHIVED, MAX_CHECKS };
