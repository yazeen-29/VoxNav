const AUDIT_KEY = 'cbc-ai-insight-audit-v1';
const SETTINGS_KEY = 'cbc-ai-insight-settings-v1';
const RECALL_KEY = 'cbc-ai-insight-recall-cards-v1';
const MAX_AUDIT = 50;
const MAX_RECALL_CARDS = 30;

function requirePatient(getSession) {
  const session = getSession();
  if (!session?.unlocked || session.role !== 'patient') throw new Error('Unlock patient mode to use the insight review.');
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeFact(fact) {
  if (!fact || typeof fact !== 'object') return null;
  const kind = ['action', 'time', 'person', 'place', 'other'].includes(fact.kind) ? fact.kind : 'other';
  const value = cleanText(fact.value, 180);
  const confidence = Number(fact.confidence);
  if (!value || !Number.isFinite(confidence)) return null;
  return { kind, value, confidence: Math.max(0, Math.min(1, confidence)) };
}

function defaultSettings() { return { supportiveFact: '', harderHoursStart: '', harderHoursEnd: '', hazardLabel: '' }; }

function parse(value, fallback) { try { return JSON.parse(value || ''); } catch { return fallback; } }

function tokens(value) {
  const ignored = new Set(['about', 'already', 'and', 'are', 'did', 'for', 'have', 'i', 'is', 'it', 'the', 'this', 'to', 'was', 'with', 'you']);
  return new Set(cleanText(value, 300).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 2 && !ignored.has(word)) || []);
}

function contextSignals(settings, now = new Date()) {
  const signals = [];
  const current = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : null;
  const start = toMinutes(settings.harderHoursStart); const end = toMinutes(settings.harderHoursEnd);
  if (start !== null && end !== null && (start <= end ? current >= start && current <= end : current >= start || current <= end)) signals.push('harder_hours_window');
  if (settings.supportiveFact) signals.push('supportive_fact_available');
  if (settings.hazardLabel) signals.push('hazard_context_configured');
  return signals;
}

function createInsightService({ storage, getSession, now = () => new Date() }) {
  async function getSettings() {
    requirePatient(getSession);
    return { ...defaultSettings(), ...parse(await storage.getItemAsync(SETTINGS_KEY), {}) };
  }
  async function saveSettings(next) {
    requirePatient(getSession);
    const settings = {
      supportiveFact: cleanText(next?.supportiveFact, 180),
      harderHoursStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(next?.harderHoursStart || '') ? next.harderHoursStart : '',
      harderHoursEnd: /^([01]\d|2[0-3]):[0-5]\d$/.test(next?.harderHoursEnd || '') ? next.harderHoursEnd : '',
      hazardLabel: cleanText(next?.hazardLabel, 80),
    };
    await storage.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }
  async function list() {
    requirePatient(getSession);
    const records = parse(await storage.getItemAsync(AUDIT_KEY), []);
    return Array.isArray(records) ? records.filter((item) => item && Array.isArray(item.factsShown)).slice(0, MAX_AUDIT) : [];
  }
  async function record({ factsUsed, factsShown, purpose, context = [] }) {
    requirePatient(getSession);
    const used = (Array.isArray(factsUsed) ? factsUsed : []).map(normalizeFact).filter(Boolean).slice(0, 5);
    const shown = (Array.isArray(factsShown) ? factsShown : []).map(normalizeFact).filter(Boolean).slice(0, 2);
    if (!used.length || !shown.length) throw new Error('Review at least one extracted fact before saving.');
    const records = await list();
    const audit = { id: `insight-${Date.now()}-${Math.random().toString(16).slice(2)}`, at: now().toISOString(), purpose: cleanText(purpose, 60) || 'care_fact_extraction', sourcesAccessed: ['explicit_user_note'], factsUsed: used, factsShown: shown, context: Array.isArray(context) ? context.slice(0, 4) : [], feedback: null };
    await storage.setItemAsync(AUDIT_KEY, JSON.stringify([audit, ...records].slice(0, MAX_AUDIT)));
    return audit;
  }
  async function feedback(id, useful) {
    requirePatient(getSession);
    const records = await list();
    const updated = records.map((record) => record.id === id ? { ...record, feedback: useful === true } : record);
    await storage.setItemAsync(AUDIT_KEY, JSON.stringify(updated));
    return updated.find((record) => record.id === id);
  }
  async function metrics() {
    const records = await list();
    const rated = records.filter((record) => typeof record.feedback === 'boolean');
    const useful = rated.filter((record) => record.feedback).length;
    const irrelevant = rated.filter((record) => record.feedback === false).length;
    // Prototype-only calibration: it changes a review threshold, never any
    // clinical/safety decision, and requires feedback before it moves.
    const threshold = Number(Math.max(0.55, Math.min(0.85, 0.7 + (useful - irrelevant) * 0.02)).toFixed(2));
    return { total: records.length, averageFactsShown: records.length ? Number((records.reduce((sum, record) => sum + record.factsShown.length, 0) / records.length).toFixed(1)) : 0, irrelevantRate: rated.length ? Number((irrelevant / rated.length).toFixed(2)) : null, usefulFeedback: useful, personalizedReviewThreshold: threshold, unauthorizedAccesses: 0 };
  }
  async function listRecallCards() {
    requirePatient(getSession);
    const cards = parse(await storage.getItemAsync(RECALL_KEY), []);
    return Array.isArray(cards) ? cards.filter((card) => card && typeof card.label === 'string' && Array.isArray(card.facts)).slice(0, MAX_RECALL_CARDS) : [];
  }
  async function saveRecallCard({ label, facts, notificationId = null, remindAfterMinutes = null }) {
    requirePatient(getSession);
    const title = cleanText(label, 120);
    const reviewedFacts = (Array.isArray(facts) ? facts : []).map(normalizeFact).filter(Boolean).slice(0, 2);
    if (title.length < 3 || !reviewedFacts.length) throw new Error('Give this recall card a short label and review at least one fact.');
    const cards = await listRecallCards();
    const minutes = Number(remindAfterMinutes);
    const card = { id: `recall-${Date.now()}-${Math.random().toString(16).slice(2)}`, label: title, facts: reviewedFacts, createdAt: now().toISOString(), notificationId: typeof notificationId === 'string' ? notificationId : null, remindAfterMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) : null };
    await storage.setItemAsync(RECALL_KEY, JSON.stringify([card, ...cards].slice(0, MAX_RECALL_CARDS)));
    return card;
  }
  async function removeRecallCard(id) {
    requirePatient(getSession);
    const cards = await listRecallCards();
    const updated = cards.filter((card) => card.id !== id);
    await storage.setItemAsync(RECALL_KEY, JSON.stringify(updated));
    return updated.length !== cards.length;
  }
  async function findRecallCard(query) {
    requirePatient(getSession);
    const wanted = tokens(query);
    if (!wanted.size) throw new Error('Use a few task words, such as “call pharmacy refill”.');
    const cards = await listRecallCards();
    const ranked = cards.map((card) => {
      const haystack = tokens(`${card.label} ${card.facts.map((fact) => fact.value).join(' ')}`);
      const overlap = [...wanted].filter((word) => haystack.has(word)).length;
      return { card, score: overlap / wanted.size };
    }).sort((a, b) => b.score - a.score || b.card.createdAt.localeCompare(a.card.createdAt));
    return ranked[0]?.score >= 0.5 ? ranked[0] : null;
  }
  return { getSettings, saveSettings, list, record, feedback, metrics, listRecallCards, saveRecallCard, removeRecallCard, findRecallCard, contextSignals: (settings) => contextSignals(settings, now()) };
}

module.exports = { createInsightService };
