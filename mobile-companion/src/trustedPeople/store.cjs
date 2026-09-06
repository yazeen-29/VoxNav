const INDEX_KEY = 'cbc-trusted-person-index-v1';
const PROFILE_PREFIX = 'cbc-trusted-person-v1-';
const TEMPLATE_PREFIX = 'cbc-trusted-person-template-v1-';
const MAX_PEOPLE = 10;
const MAX_TEMPLATES_PER_PERSON = 3;

function profileKey(id) { return `${PROFILE_PREFIX}${id}`; }
function templateKey(personId, templateId) { return `${TEMPLATE_PREFIX}${personId}-${templateId}`; }

function parseIndex(raw) {
  try {
    const parsed = JSON.parse(raw || '{"people":[]}');
    return Array.isArray(parsed.people) ? parsed.people : [];
  } catch { return []; }
}

function validateName(value) {
  if (typeof value !== 'string') throw new Error('Use a plain-text trusted person name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 50) throw new Error('Use a trusted person name between 1 and 50 characters.');
  return name;
}

function cleanText(value, label, maxLength) {
  if (value != null && typeof value !== 'string') throw new Error(`${label} must be plain text.`);
  const text = (value || '').trim().replace(/\s+/g, ' ');
  if (text.length > maxLength) throw new Error(`${label} can be at most ${maxLength} characters.`);
  return text;
}

function normaliseDetails(details = {}) {
  return {
    name: validateName(details.name),
    relationship: cleanText(details.relationship, 'Relationship', 40),
    phone: cleanText(details.phone, 'Phone number', 30),
    note: cleanText(details.note, 'Private note', 280),
  };
}

function validateEmbedding(value) {
  // 192 float32 values, base64 encoded: 768 bytes / 1024 base64 chars.
  if (typeof value !== 'string' || value.length < 900 || value.length > 1_200) throw new Error('The local face template was not valid. Try again.');
  return value;
}

function assertPatientSession(getSession) {
  const session = getSession();
  if (!session?.unlocked || session.role !== 'patient') throw new Error('Unlock patient mode to manage trusted people.');
}

function createTrustedPersonService({ storage, getSession, now = () => new Date().toISOString(), makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }) {
  async function readProfile(id) {
    const profile = JSON.parse(await storage.getItemAsync(profileKey(id)) || 'null');
    if (!profile?.id || !profile?.name) return null;
    return profile;
  }

  async function embeddingsFor(profile) {
    // Supports the original single-template profile format without forcing a
    // rewrite of an already enrolled person.
    if (profile.embedding) return [profile.embedding];
    const ids = Array.isArray(profile.templateIds) ? profile.templateIds : [];
    const values = await Promise.all(ids.map((id) => storage.getItemAsync(templateKey(profile.id, id))));
    return values.filter((value) => {
      try { return Boolean(validateEmbedding(value)); } catch { return false; }
    });
  }

  async function snapshotTemplatesFor(profile) {
    if (profile.embedding) return [{ id: 'legacy', value: profile.embedding }];
    const ids = Array.isArray(profile.templateIds) ? profile.templateIds : [];
    const pairs = await Promise.all(ids.map(async (id) => ({ id, value: await storage.getItemAsync(templateKey(profile.id, id)) })));
    return pairs.filter((pair) => typeof pair.id === 'string' && pair.id.length <= 128 && (() => {
      try { validateEmbedding(pair.value); return true; } catch { return false; }
    })());
  }

  function publicPerson(profile, templateCount) {
    return {
      id: profile.id,
      name: profile.name,
      relationship: profile.relationship || '',
      phone: profile.phone || '',
      note: profile.note || '',
      templateCount,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  async function list() {
    assertPatientSession(getSession);
    const people = parseIndex(await storage.getItemAsync(INDEX_KEY));
    const loaded = await Promise.all(people.map(async (person) => {
      try {
        const profile = await readProfile(person.id);
        if (!profile) return null;
        const templates = await embeddingsFor(profile);
        if (!templates.length) return null;
        return publicPerson(profile, templates.length);
      } catch { return null; }
    }));
    return loaded.filter(Boolean);
  }

  async function enroll(detailsValue, embeddingValue) {
    assertPatientSession(getSession);
    const details = normaliseDetails(typeof detailsValue === 'string' ? { name: detailsValue } : detailsValue);
    const embedding = validateEmbedding(embeddingValue);
    const people = parseIndex(await storage.getItemAsync(INDEX_KEY));
    if (people.length >= MAX_PEOPLE) throw new Error(`This device can keep up to ${MAX_PEOPLE} trusted people. Remove one before adding another.`);
    const id = makeId();
    const timestamp = now();
    const templateId = makeId();
    const profile = { id, ...details, templateIds: [templateId], createdAt: timestamp, updatedAt: timestamp };
    await storage.setItemAsync(profileKey(id), JSON.stringify(profile));
    await storage.setItemAsync(templateKey(id, templateId), embedding);
    await storage.setItemAsync(INDEX_KEY, JSON.stringify({ version: 2, people: [...people, { id, name: details.name }] }));
    return publicPerson(profile, 1);
  }

  async function addTemplate(personId, embeddingValue) {
    assertPatientSession(getSession);
    const embedding = validateEmbedding(embeddingValue);
    const profile = await readProfile(personId);
    if (!profile) throw new Error('That trusted person is no longer on this device.');
    const templates = await embeddingsFor(profile);
    if (templates.length >= MAX_TEMPLATES_PER_PERSON) throw new Error(`Each person can keep up to ${MAX_TEMPLATES_PER_PERSON} local samples.`);
    const templateId = makeId();
    const templateIds = [...(profile.templateIds || []), templateId];
    // Migrate an older single-template profile on the first added sample.
    if (profile.embedding) {
      const legacyId = 'legacy';
      await storage.setItemAsync(templateKey(profile.id, legacyId), profile.embedding);
      templateIds.unshift(legacyId);
      delete profile.embedding;
    }
    const updated = { ...profile, templateIds, updatedAt: now() };
    await storage.setItemAsync(templateKey(profile.id, templateId), embedding);
    await storage.setItemAsync(profileKey(profile.id), JSON.stringify(updated));
    return publicPerson(updated, templateIds.length);
  }

  async function remove(id) {
    assertPatientSession(getSession);
    const people = parseIndex(await storage.getItemAsync(INDEX_KEY));
    if (!people.some((person) => person.id === id)) return false;
    const profile = await readProfile(id);
    if (profile?.templateIds) await Promise.all(profile.templateIds.map((templateId) => storage.deleteItemAsync(templateKey(id, templateId))));
    await storage.deleteItemAsync(profileKey(id));
    await storage.setItemAsync(INDEX_KEY, JSON.stringify({ version: 1, people: people.filter((person) => person.id !== id) }));
    return true;
  }

  async function findBest(embeddingValue, compare) {
    assertPatientSession(getSession);
    const embedding = validateEmbedding(embeddingValue);
    const people = parseIndex(await storage.getItemAsync(INDEX_KEY));
    let best = null;
    for (const person of people) {
      try {
        const profile = await readProfile(person.id);
        if (!profile) continue;
        for (const template of await embeddingsFor(profile)) {
          const similarity = Number(await compare(embedding, template));
          if (Number.isFinite(similarity) && (!best || similarity > best.similarity)) best = { id: profile.id, name: profile.name, similarity };
        }
      } catch { /* An unreadable profile is skipped rather than exposed. */ }
    }
    return best && best.similarity >= 0.72 ? best : null;
  }

  async function exportSnapshot() {
    assertPatientSession(getSession);
    const index = parseIndex(await storage.getItemAsync(INDEX_KEY));
    const people = [];
    for (const item of index) {
      try {
        const profile = await readProfile(item.id);
        if (!profile) continue;
        const templates = await snapshotTemplatesFor(profile);
        if (!templates.length) continue;
        people.push({
          id: profile.id, name: profile.name, relationship: profile.relationship || '', phone: profile.phone || '', note: profile.note || '',
          createdAt: profile.createdAt, updatedAt: profile.updatedAt, templates,
        });
      } catch { /* Skip corrupt local entries rather than exporting them. */ }
    }
    return { version: 1, exportedAt: now(), people };
  }

  async function mergeSnapshot(snapshot) {
    assertPatientSession(getSession);
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.people) || snapshot.people.length > MAX_PEOPLE) throw new Error('The cloud trusted-directory backup was not valid.');
    const index = parseIndex(await storage.getItemAsync(INDEX_KEY));
    const byId = new Map(index.map((person) => [person.id, person]));
    let changed = false;
    for (const incoming of snapshot.people) {
      try {
        if (typeof incoming?.id !== 'string' || incoming.id.length > 128 || !Array.isArray(incoming.templates) || !incoming.templates.length || incoming.templates.length > MAX_TEMPLATES_PER_PERSON) continue;
        const details = normaliseDetails(incoming);
        const templates = incoming.templates.map((template) => {
          if (typeof template?.id !== 'string' || template.id.length > 128) throw new Error('Bad template id');
          return { id: template.id, value: validateEmbedding(template.value) };
        });
        const current = await readProfile(incoming.id);
        const incomingTime = Date.parse(incoming.updatedAt || '');
        const currentTime = Date.parse(current?.updatedAt || '');
        if (current && Number.isFinite(currentTime) && (!Number.isFinite(incomingTime) || incomingTime <= currentTime)) continue;
        if (current?.templateIds) await Promise.all(current.templateIds.map((templateId) => storage.deleteItemAsync(templateKey(current.id, templateId))));
        const profile = { id: incoming.id, ...details, templateIds: templates.map((template) => template.id), createdAt: incoming.createdAt || now(), updatedAt: incoming.updatedAt || now() };
        await Promise.all(templates.map((template) => storage.setItemAsync(templateKey(profile.id, template.id), template.value)));
        await storage.setItemAsync(profileKey(profile.id), JSON.stringify(profile));
        byId.set(profile.id, { id: profile.id, name: profile.name });
        changed = true;
      } catch { /* A malformed encrypted record never overwrites local data. */ }
    }
    if (changed) await storage.setItemAsync(INDEX_KEY, JSON.stringify({ version: 2, people: [...byId.values()].slice(0, MAX_PEOPLE) }));
    return changed;
  }

  return { list, enroll, addTemplate, remove, findBest, exportSnapshot, mergeSnapshot, constants: { INDEX_KEY, PROFILE_PREFIX, TEMPLATE_PREFIX, MAX_PEOPLE, MAX_TEMPLATES_PER_PERSON } };
}

module.exports = { createTrustedPersonService, validateName, validateEmbedding, normaliseDetails };
