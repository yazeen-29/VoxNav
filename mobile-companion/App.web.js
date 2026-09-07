import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const STORAGE_KEY = 'cbc-web-confidence-timeline-v1';
const CLINICAL_STORAGE_KEY = 'cbc-web-clinical-context-v1';
const CHECKIN_STORAGE_KEY = 'cbc-web-confidence-checkins-v1';
const COLORS = { ink: '#30251f', muted: '#705e51', paper: '#fffaf3', background: '#f7f0e6', accent: '#9d4e32', green: '#28624b', line: '#e7d9c8', amber: '#f6ead7' };

function hoursAgo(hours, task) {
  return { id: `${task}-${hours}`, task, at: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(), confirmed: true };
}

function demoEvents() {
  return [hoursAgo(3, 'Call pharmacy about refill'), hoursAgo(28, 'Call pharmacy about refill'), hoursAgo(51, 'Call pharmacy about refill'), hoursAgo(6, 'Check appointment time'), hoursAgo(31, 'Check appointment time'), hoursAgo(74, 'Take evening medication')];
}

function timeBand(iso) {
  const hour = new Date(iso).getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

function extractOnlyStatedClinicalFacts(text) {
  const facts = []; const source = String(text || '');
  const score = (name) => {
    const match = source.match(new RegExp(`\\b${name}\\s*(?:score)?\\s*[:=-]?\\s*(\\d{1,2})\\s*\\/\\s*30\\b`, 'i'));
    if (match) facts.push({ id: `${name}-${match[1]}`, type: `${name.toLowerCase()}_score`, label: `${name.toUpperCase()} score`, value: `${match[1]}/30` });
  };
  score('mmse'); score('moca');
  if (/\bUTI\b|urinary tract infection/i.test(source)) facts.push({ id: 'uti', type: 'lab_finding', label: 'Documented finding', value: 'UTI mentioned in the supplied text' });
  if (/\bB12 deficiency\b/i.test(source)) facts.push({ id: 'b12', type: 'lab_finding', label: 'Documented finding', value: 'B12 deficiency mentioned in the supplied text' });
  const medication = source.match(/\b(?:started|stopped|increased|decreased|changed)\s+([A-Za-z][A-Za-z -]{2,50})/i);
  if (medication) facts.push({ id: `med-${medication[0]}`, type: 'medication_change', label: 'Medication change', value: medication[0].trim() });
  return facts.slice(0, 5);
}

function retrieveDocumentSections(documentText, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).map((term) => term.replace(/[^a-z0-9]/g, '')).filter((term) => term.length > 2);
  if (!terms.length) return [];
  return String(documentText || '').split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map((section, index) => {
    const lower = section.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    return { section: section.trim(), score, index };
  }).filter((item) => item.score > 0 && item.section).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3);
}

export default function WebDashboard() {
  const [events, setEvents] = useState([]);
  const [task, setTask] = useState('');
  const [clinicalText, setClinicalText] = useState('');
  const [clinicalCandidates, setClinicalCandidates] = useState([]);
  const [clinicalFacts, setClinicalFacts] = useState([]);
  const [ragQuery, setRagQuery] = useState('');
  const [ragResults, setRagResults] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('This dashboard is using local demo data until you add confirmed events.');

  useEffect(() => {
    try {
      const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
      setEvents(saved ? JSON.parse(saved) : demoEvents());
      const savedFacts = globalThis.localStorage?.getItem(CLINICAL_STORAGE_KEY);
      setClinicalFacts(savedFacts ? JSON.parse(savedFacts) : []);
      const savedCheckIns = globalThis.localStorage?.getItem(CHECKIN_STORAGE_KEY);
      setCheckIns(savedCheckIns ? JSON.parse(savedCheckIns) : []);
    } catch { setEvents(demoEvents()); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(events)); } catch {}
  }, [events, ready]);

  useEffect(() => {
    if (!ready) return;
    try { globalThis.localStorage?.setItem(CLINICAL_STORAGE_KEY, JSON.stringify(clinicalFacts)); } catch {}
  }, [clinicalFacts, ready]);

  useEffect(() => {
    if (!ready) return;
    try { globalThis.localStorage?.setItem(CHECKIN_STORAGE_KEY, JSON.stringify(checkIns)); } catch {}
  }, [checkIns, ready]);

  const insight = useMemo(() => {
    const byTask = new Map(); const bands = { morning: 0, afternoon: 0, evening: 0 };
    events.forEach((event) => { byTask.set(event.task, (byTask.get(event.task) || 0) + 1); bands[timeBand(event.at)] += 1; });
    const repeated = [...byTask.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
    const commonBand = Object.entries(bands).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return { repeated, commonBand, weekCount: events.filter((event) => new Date(event.at).getTime() >= weekAgo).length };
  }, [events]);

  function addEvent() {
    const clean = task.trim();
    if (clean.length < 3) { setMessage('Add a short, confirmed task such as “Called pharmacy about refill”.'); return; }
    setEvents((current) => [{ id: `${Date.now()}-${clean}`, task: clean, at: new Date().toISOString(), confirmed: true }, ...current]);
    setTask(''); setMessage('Confirmed event added only in this browser. It is not a medical conclusion.');
  }
  function restoreDemo() { setEvents(demoEvents()); setMessage('Demo data restored locally in this browser.'); }
  function clearEvents() { setEvents([]); setMessage('Local dashboard events cleared from this browser.'); }
  function reviewClinicalText() {
    const candidates = extractOnlyStatedClinicalFacts(clinicalText);
    setClinicalCandidates(candidates);
    setMessage(candidates.length ? 'Review each extracted fact before confirming. Nothing has been added yet.' : 'No supported fact was found. This prototype only recognises clearly written MMSE/MoCA scores, UTI, B12 deficiency, and simple medication changes.');
  }
  function retrieveClinicalContext() {
    const results = retrieveDocumentSections(clinicalText, ragQuery);
    setRagResults(results);
    setMessage(results.length ? 'Relevant document sections found. Read the source text before confirming any fact.' : 'No matching section found. Try words such as medication, MMSE, UTI, or appointment.');
  }
  function confirmClinicalFact(fact) {
    setClinicalFacts((current) => [{ ...fact, id: `${fact.id}-${Date.now()}`, confirmedAt: new Date().toISOString(), source: 'Human-reviewed local prototype text' }, ...current]);
    setClinicalCandidates((current) => current.filter((item) => item.id !== fact.id));
    setMessage('Clinical context confirmed locally. It annotates the snapshot only; it does not diagnose or alter alerts.');
  }
  function addCheckIn(value) {
    setCheckIns((current) => [{ id: `${Date.now()}-${value}`, value, at: new Date().toISOString() }, ...current].slice(0, 60));
    setMessage(`Check-in saved locally: ${value}. This is a self-report, not a clinical assessment.`);
  }
  const checkInSummary = useMemo(() => {
    const recent = checkIns.filter((item) => new Date(item.at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000);
    return { total: recent.length, uncertain: recent.filter((item) => item.value === 'Uncertain').length, help: recent.filter((item) => item.value === 'Need help').length };
  }, [checkIns]);

  return <ScrollView contentContainerStyle={styles.page}>
    <View style={styles.hero}>
      <View><Text style={styles.kicker}>CONTEXT COMPANION · WEB PROTOTYPE</Text><Text style={styles.title}>Memory Confidence Timeline</Text><Text style={styles.subtitle}>A calm view of explicitly confirmed task patterns—not surveillance, a diagnosis, or proof that a task happened.</Text></View>
      <View style={styles.badge}><Text style={styles.badgeText}>LOCAL BROWSER DATA</Text></View>
    </View>

    <View style={styles.notice}><Text style={styles.noticeTitle}>Consent boundary</Text><Text style={styles.noticeText}>This dashboard never reads chats, GPS, contacts, photos, or health records. Add only events the patient has confirmed. Nothing here is automatically sent to a caretaker.</Text></View>

    <View style={styles.grid}>
      <Metric value={String(insight.weekCount)} label="confirmed events this week" />
      <Metric value={insight.repeated.length ? String(insight.repeated.length) : '0'} label="tasks revisited more than once" />
      <Metric value={insight.weekCount ? insight.commonBand : '—'} label="most common check-in time" />
      <Metric value={String(checkInSummary.uncertain)} label="self-reported uncertain check-ins this week" />
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>Today’s confidence check-in</Text>
      <Text style={styles.copy}>A patient chooses this themselves. It is a personal check-in, not a cognitive test or diagnosis.</Text>
      <View style={styles.checkInRow}><Pressable onPress={() => addCheckIn('Confident')} style={[styles.checkInButton, { backgroundColor: '#e7f3ec', borderColor: '#2e7354' }]}><Text style={[styles.checkInText, { color: '#1e5c42' }]}>I feel confident</Text></Pressable><Pressable onPress={() => addCheckIn('Uncertain')} style={[styles.checkInButton, { backgroundColor: '#f8ead7', borderColor: '#aa6c2e' }]}><Text style={[styles.checkInText, { color: '#81490f' }]}>I feel uncertain</Text></Pressable><Pressable onPress={() => addCheckIn('Need help')} style={[styles.checkInButton, { backgroundColor: '#f7e1df', borderColor: '#a0463d' }]}><Text style={[styles.checkInText, { color: '#813630' }]}>I need help</Text></Pressable></View>
      <Text style={styles.status}>Last 7 days: {checkInSummary.total} check-ins · {checkInSummary.uncertain} uncertain · {checkInSummary.help} asked for help.</Text>
    </View>

    <View style={styles.twoColumn}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Level 5 · Clinical context review</Text>
        <Text style={styles.copy}>Prototype only: paste de-identified sample text, not a real medical record. The extractor returns only clearly stated facts. Nothing is saved until a human confirms each fact.</Text>
        <TextInput value={clinicalText} onChangeText={setClinicalText} placeholder="Sample: MMSE score: 22/30. UTI positive. Started donepezil." multiline style={[styles.input, styles.clinicalInput]} maxLength={1000} />
        <Pressable onPress={reviewClinicalText} style={styles.primary}><Text style={styles.primaryText}>Extract facts for review</Text></Pressable>
        {clinicalCandidates.map((fact) => <View key={fact.id} style={styles.factReview}><View style={styles.eventContent}><Text style={styles.eventTitle}>{fact.label}</Text><Text style={styles.copy}>{fact.value}</Text></View><Pressable onPress={() => confirmClinicalFact(fact)}><Text style={styles.link}>Confirm</Text></Pressable></View>)}
        <Text style={styles.subheading}>Document-grounded lookup</Text>
        <Text style={styles.copy}>Ask about the pasted document. This local prototype retrieves matching sections and never diagnoses.</Text>
        <TextInput value={ragQuery} onChangeText={setRagQuery} placeholder="Question: what medication changed?" style={styles.input} maxLength={120} />
        <Pressable onPress={retrieveClinicalContext} style={styles.secondary}><Text style={styles.secondaryText}>Find relevant context</Text></Pressable>
        {ragResults.map((result) => <View key={`${result.index}-${result.section}`} style={styles.retrieval}><Text style={styles.retrievalLabel}>Source section {result.index + 1} · matched {result.score} term{result.score === 1 ? '' : 's'}</Text><Text style={styles.copy}>{result.section}</Text></View>)}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Composite snapshot</Text>
        <Text style={styles.copy}>This period has {insight.weekCount} confirmed activity event{insight.weekCount === 1 ? '' : 's'} and {insight.repeated.length} repeated task pattern{insight.repeated.length === 1 ? '' : 's'}.</Text>
        <Text style={styles.copy}>{clinicalFacts.length ? `Human-confirmed clinical context: ${clinicalFacts.slice(0, 3).map((fact) => `${fact.label} ${fact.value}`).join('; ')}.` : 'No clinical context has been confirmed.'}</Text>
        <View style={styles.action}><Text style={styles.actionTitle}>Safety rule</Text><Text style={styles.copy}>Confirmed facts are shown alongside behaviour patterns. They never diagnose, suppress an alert, or silently change a threshold.</Text></View>
        {clinicalFacts.map((fact) => <View key={fact.id} style={styles.pattern}><Text style={styles.patternTitle}>{fact.label}: {fact.value}</Text><Text style={styles.copy}>Confirmed {formatWhen(fact.confirmedAt)} · {fact.source}</Text></View>)}
      </View>
    </View>

    <View style={styles.twoColumn}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add a confirmed activity</Text>
        <Text style={styles.copy}>Use this only after someone explicitly confirms it. Example: “Called pharmacy about refill”.</Text>
        <TextInput value={task} onChangeText={setTask} onSubmitEditing={addEvent} placeholder="Confirmed task" style={styles.input} maxLength={120} />
        <Pressable onPress={addEvent} style={styles.primary}><Text style={styles.primaryText}>Add to timeline</Text></Pressable>
        <Text style={styles.status}>{message}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Gentle pattern summary</Text>
        {insight.repeated.length ? insight.repeated.slice(0, 3).map(([label, count]) => <View key={label} style={styles.pattern}><Text style={styles.patternTitle}>{label}</Text><Text style={styles.copy}>Revisited {count} times. Consider a shorter reminder or an optional check-in—confirm with the person first.</Text></View>) : <Text style={styles.copy}>No repeated confirmed tasks yet. That is simply a lack of dashboard data, not a conclusion.</Text>}
        {insight.weekCount ? <View style={styles.action}><Text style={styles.actionTitle}>Possible next step</Text><Text style={styles.copy}>Most confirmed check-ins are in the {insight.commonBand}. Try scheduling gentle reminders at a personally preferred time.</Text></View> : null}
      </View>
    </View>

    <View style={styles.card}>
      <View style={styles.timelineHeader}><View><Text style={styles.cardTitle}>Recent confidence timeline</Text><Text style={styles.copy}>Each entry is a reviewable, human-confirmed event.</Text></View><View style={styles.actions}><Pressable onPress={restoreDemo}><Text style={styles.link}>Use demo data</Text></Pressable><Pressable onPress={clearEvents}><Text style={styles.danger}>Clear local data</Text></Pressable></View></View>
      {events.length ? [...events].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12).map((event) => <View key={event.id} style={styles.event}><View style={styles.dot} /><View style={styles.eventContent}><Text style={styles.eventTitle}>{event.task}</Text><Text style={styles.copy}>{formatWhen(event.at)} · Confirmed by user</Text></View><Text style={styles.confirmed}>CONFIRMED</Text></View>) : <Text style={styles.copy}>No local events. Add a confirmed activity or load demo data.</Text>}
    </View>
  </ScrollView>;
}

function Metric({ value, label }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }

const styles = StyleSheet.create({
  page: { backgroundColor: COLORS.background, minHeight: '100%', padding: 28, gap: 18 }, hero: { maxWidth: 1120, width: '100%', alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 20, paddingVertical: 18 }, kicker: { color: COLORS.accent, fontWeight: '800', letterSpacing: 1.2, fontSize: 11 }, title: { color: COLORS.ink, fontSize: 42, fontWeight: '800', marginTop: 8 }, subtitle: { color: COLORS.muted, fontSize: 16, lineHeight: 24, maxWidth: 720, marginTop: 10 }, badge: { alignSelf: 'flex-start', backgroundColor: '#e4f0e8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }, badgeText: { color: COLORS.green, fontWeight: '800', fontSize: 11 }, notice: { maxWidth: 1120, width: '100%', alignSelf: 'center', borderLeftWidth: 4, borderColor: COLORS.accent, backgroundColor: COLORS.amber, borderRadius: 12, padding: 16, gap: 5 }, noticeTitle: { color: COLORS.ink, fontWeight: '800', fontSize: 16 }, noticeText: { color: COLORS.muted, lineHeight: 21 }, grid: { maxWidth: 1120, width: '100%', alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, metric: { flexGrow: 1, flexBasis: 220, backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 18, gap: 4 }, metricValue: { fontSize: 30, color: COLORS.ink, fontWeight: '800', textTransform: 'capitalize' }, metricLabel: { color: COLORS.muted, fontSize: 13, lineHeight: 18 }, twoColumn: { maxWidth: 1120, width: '100%', alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, card: { flexGrow: 1, flexBasis: 420, backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 18, gap: 12, alignSelf: 'stretch' }, cardTitle: { color: COLORS.ink, fontSize: 19, fontWeight: '800' }, subheading: { color: COLORS.ink, fontSize: 15, fontWeight: '800', marginTop: 8 }, copy: { color: COLORS.muted, lineHeight: 20, fontSize: 14 }, input: { borderWidth: 1, borderColor: '#ceb8a1', color: COLORS.ink, borderRadius: 10, padding: 12, backgroundColor: '#fffdf9', minHeight: 46 }, clinicalInput: { minHeight: 120, textAlignVertical: 'top' }, primary: { backgroundColor: COLORS.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 15, alignSelf: 'flex-start' }, primaryText: { color: 'white', fontWeight: '800' }, secondary: { borderWidth: 1, borderColor: COLORS.accent, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 15, alignSelf: 'flex-start' }, secondaryText: { color: COLORS.accent, fontWeight: '800' }, retrieval: { borderLeftWidth: 3, borderColor: COLORS.green, backgroundColor: '#eef6f0', borderRadius: 8, padding: 10, gap: 4 }, retrievalLabel: { color: COLORS.green, fontSize: 12, fontWeight: '800' }, status: { color: COLORS.green, fontSize: 13, lineHeight: 19 }, pattern: { borderTopWidth: 1, borderColor: COLORS.line, paddingTop: 10, gap: 4 }, action: { backgroundColor: '#e9f3ed', borderRadius: 10, padding: 12, gap: 4 }, actionTitle: { color: COLORS.green, fontWeight: '800' }, timelineHeader: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }, actions: { flexDirection: 'row', gap: 14, alignItems: 'center' }, link: { color: COLORS.accent, fontWeight: '800', fontSize: 13 }, danger: { color: '#a02f2a', fontWeight: '800', fontSize: 13 }, event: { flexDirection: 'row', gap: 11, alignItems: 'center', borderTopWidth: 1, borderColor: COLORS.line, paddingTop: 11 }, dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.green }, eventContent: { flex: 1, gap: 2 }, confirmed: { color: COLORS.green, fontWeight: '800', fontSize: 10, letterSpacing: .5 }, factReview: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f7eadb', borderRadius: 10, padding: 10 }, checkInRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, checkInButton: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 }, checkInText: { fontWeight: '800', fontSize: 14 },
});
