import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { requestCareSuggestion } from '../ai/careFactExtraction';
import { ensurePatientPairingSession } from '../pairing/patientCaretakerPairing';

const WARM = { ink: '#34271f', muted: '#705e51', paper: '#fffaf3', accent: '#9d4e32', line: '#e9dbca' };

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });

export default function InsightReview({ service, onSystemDialog }) {
  const [note, setNote] = useState(''); const [review, setReview] = useState(null); const [shown, setShown] = useState(1);
  const [recallLabel, setRecallLabel] = useState(''); const [remindAfterMinutes, setRemindAfterMinutes] = useState('60'); const [recallCards, setRecallCards] = useState([]); const [recallQuery, setRecallQuery] = useState(''); const [recallResult, setRecallResult] = useState(null);
  const [settings, setSettings] = useState({ supportiveFact: '', harderHoursStart: '', harderHoursEnd: '', hazardLabel: '' });
  const [audit, setAudit] = useState([]); const [metrics, setMetrics] = useState(null); const [why, setWhy] = useState(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('Optional prototype: submit a short note you choose. AI suggestions always need your review.');
  const refresh = async () => { try { const [nextSettings, nextAudit, nextMetrics, nextCards] = await Promise.all([service.getSettings(), service.list(), service.metrics(), service.listRecallCards()]); setSettings(nextSettings); setAudit(nextAudit); setMetrics(nextMetrics); setRecallCards(nextCards); } catch (error) { setMessage(error?.message || 'Could not load local insight review.'); } };
  useEffect(() => {
    refresh();
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('recall-followups', {
        name: 'Recall follow-ups',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      }).catch(() => {});
    }
  }, []);

  async function extract() {
    if (!note.trim()) { setMessage('Enter a short note first.'); return; }
    setBusy(true);
    try { await ensurePatientPairingSession(SecureStore); const suggestion = await requestCareSuggestion({ operation: 'extract', text: note }); setReview(suggestion); setRecallLabel(suggestion?.facts?.[0]?.value || ''); setShown(1); setMessage('Review the suggested facts. Nothing has been saved.'); }
    catch (error) { setMessage(error?.message || 'Could not extract review suggestions. Check the development AI setup.'); }
    finally { setBusy(false); }
  }
  async function minimumContext() {
    if (!review?.facts?.length) return;
    setBusy(true);
    try { await ensurePatientPairingSession(SecureStore); const result = await requestCareSuggestion({ operation: 'sufficiency', text: note, candidateFacts: review.facts.slice(0, shown) }); if (!result.sufficient && shown < review.facts.length) { setShown((value) => value + 1); setMessage(`One more fact was added: ${result.reason}`); } else setMessage(result.sufficient ? `Current context is sufficient: ${result.reason}` : `No further extracted fact is available: ${result.reason}`); }
    catch (error) { setMessage(error?.message || 'Could not check minimum context.'); }
    finally { setBusy(false); }
  }
  async function saveReview() {
    if (!review?.facts?.length) return;
    setBusy(true);
    let notificationId = null;
    try {
      const selectedFacts = review.facts.slice(0, shown); const minutes = Number(remindAfterMinutes);
      if (recallLabel.trim().length < 3) throw new Error('Give the recall card a short label first.');
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('Use a reminder delay from 1 minute to 7 days.');
      let permission;
      onSystemDialog?.(true);
      try { permission = await Notifications.requestPermissionsAsync(); }
      finally { onSystemDialog?.(false); }
      if (!permission.granted) throw new Error('Allow notifications to schedule this follow-up reminder.');
      notificationId = await Notifications.scheduleNotificationAsync({ content: { title: `Revisit: ${recallLabel.trim()}`, body: 'You saved a reviewed recall card. Check whether you want to take the next step.', sound: 'default', ...(Platform.OS === 'android' ? { channelId: 'recall-followups' } : {}) }, trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(60, minutes * 60), repeats: false } });
      const signals = service.contextSignals(settings);
      const [item, card] = await Promise.all([service.record({ factsUsed: review.facts, factsShown: selectedFacts, purpose: 'care_fact_extraction', context: signals }), service.saveRecallCard({ label: recallLabel, facts: selectedFacts, notificationId, remindAfterMinutes: minutes })]);
      setAudit((current) => [item, ...current]); setRecallCards((current) => [card, ...current]); setMetrics(await service.metrics()); setReview(null); setRecallLabel(''); setNote(''); setMessage(`Saved a private recall card and scheduled a gentle follow-up in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    } catch (error) { if (notificationId) await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {}); setMessage(error?.message || 'Could not save reviewed facts.'); }
    finally { setBusy(false); }
  }
  async function saveSettings() { setBusy(true); try { const next = await service.saveSettings(settings); setSettings(next); setMessage('Prototype context signals saved locally. They are not clinical predictions or live location monitoring.'); } catch (error) { setMessage(error?.message || 'Could not save context settings.'); } finally { setBusy(false); } }
  async function rate(item, useful) { try { await service.feedback(item.id, useful); await refresh(); setMessage('Feedback saved locally for the experimental review threshold.'); } catch (error) { setMessage(error?.message || 'Could not save feedback.'); } }
  async function findRecall() { try { const result = await service.findRecallCard(recallQuery); setRecallResult(result); setMessage(result ? 'Found a reviewed earlier record. Confirm it still applies before relying on it.' : 'No matching reviewed recall card was found.'); } catch (error) { setMessage(error?.message || 'Could not search recall cards.'); } }
  async function removeRecall(card) { try { if (card.notificationId) await Notifications.cancelScheduledNotificationAsync(card.notificationId); await service.removeRecallCard(card.id); setRecallCards((current) => current.filter((item) => item.id !== card.id)); if (recallResult?.card?.id === card.id) setRecallResult(null); setMessage('Recall card and its scheduled follow-up were removed from this phone.'); } catch (error) { setMessage(error?.message || 'Could not remove recall card.'); } }

  return <View style={styles.card}>
    <Text style={styles.title}>Minimum-context insight review</Text>
    <Text style={styles.copy}>Explicit notes only. The app does not read chats, contacts, photos, or medication records. This is not medical advice.</Text>
    <TextInput value={note} onChangeText={setNote} placeholder="Example: I called the pharmacy about the refill" multiline maxLength={1200} style={styles.input} />
    <Pressable style={styles.button} onPress={extract} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Reviewing…' : 'Extract review suggestions'}</Text></Pressable>
    {review ? <View style={styles.review}><Text style={styles.section}>Suggested minimum context</Text>{review.facts.slice(0, shown).map((fact, index) => <Text key={`${fact.kind}-${index}`} style={styles.fact}>• {fact.value}</Text>)}<Text style={styles.status}>{review.caution}</Text><TextInput value={recallLabel} onChangeText={setRecallLabel} placeholder="Name this recall card, for example Call pharmacy" maxLength={120} style={styles.input} /><TextInput value={remindAfterMinutes} onChangeText={setRemindAfterMinutes} placeholder="Remind me after minutes" keyboardType="number-pad" maxLength={5} style={styles.input} /><Text style={styles.status}>A gentle local follow-up is scheduled after this delay. It does not claim the task was completed.</Text><View style={styles.row}><Pressable style={styles.secondary} onPress={minimumContext} disabled={busy}><Text style={styles.secondaryText}>Check if this is enough</Text></Pressable><Pressable style={styles.button} onPress={saveReview} disabled={busy}><Text style={styles.buttonText}>Save & schedule follow-up</Text></Pressable></View></View> : null}
    <Text style={styles.section}>Did I already handle this?</Text>
    <Text style={styles.copy}>Try task words such as “call pharmacy refill”. Results are reviewed records, not proof that a task was completed.</Text>
    <TextInput value={recallQuery} onChangeText={setRecallQuery} placeholder="Example: call pharmacy refill" maxLength={180} style={styles.input} />
    <Pressable style={styles.secondary} onPress={findRecall}><Text style={styles.secondaryText}>Check earlier reviewed records</Text></Pressable>
    {recallResult ? <View style={styles.recallResult}><Text style={styles.fact}>Earlier reviewed record: {recallResult.card.label}</Text><Text style={styles.status}>Saved {new Date(recallResult.card.createdAt).toLocaleString()}. Context: {recallResult.card.facts.map((fact) => fact.value).join('; ')}.</Text></View> : null}
    {recallCards.slice(0, 3).map((card) => <View key={card.id} style={styles.audit}><Text style={styles.status}>{card.label} · {new Date(card.createdAt).toLocaleDateString()}</Text><Pressable onPress={() => removeRecall(card)}><Text style={styles.remove}>Remove recall card</Text></Pressable></View>)}
    <Text style={styles.section}>Prototype context signals</Text>
    <TextInput value={settings.supportiveFact} onChangeText={(value) => setSettings({ ...settings, supportiveFact: value })} placeholder="Supportive fact, optional" maxLength={180} style={styles.input} />
    <View style={styles.row}><TextInput value={settings.harderHoursStart} onChangeText={(value) => setSettings({ ...settings, harderHoursStart: value })} placeholder="Harder hours start HH:MM" maxLength={5} style={[styles.input, styles.time]} /><TextInput value={settings.harderHoursEnd} onChangeText={(value) => setSettings({ ...settings, harderHoursEnd: value })} placeholder="End HH:MM" maxLength={5} style={[styles.input, styles.time]} /></View>
    <TextInput value={settings.hazardLabel} onChangeText={(value) => setSettings({ ...settings, hazardLabel: value })} placeholder="Hazard label, optional (not GPS)" maxLength={80} style={styles.input} />
    <Pressable style={styles.secondary} onPress={saveSettings} disabled={busy}><Text style={styles.secondaryText}>Save context signals</Text></Pressable>
    <Text style={styles.section}>Private audit & explainability</Text>
    {metrics ? <Text style={styles.status}>{metrics.total} reviews · {metrics.averageFactsShown} avg facts shown · unauthorized accesses: {metrics.unauthorizedAccesses} · experimental threshold {metrics.personalizedReviewThreshold}</Text> : null}
    {audit.slice(0, 3).map((item) => <View key={item.id} style={styles.audit}><Text style={styles.status}>{new Date(item.at).toLocaleString()} · {item.factsShown.length} fact{item.factsShown.length === 1 ? '' : 's'} shown</Text><View style={styles.row}><Pressable onPress={() => setWhy(why === item.id ? null : item.id)}><Text style={styles.link}>Why was I shown this?</Text></Pressable><Pressable onPress={() => rate(item, true)}><Text style={styles.link}>Useful</Text></Pressable><Pressable onPress={() => rate(item, false)}><Text style={styles.link}>Not useful</Text></Pressable></View>{why === item.id ? <Text style={styles.status}>Sources: {item.sourcesAccessed.join(', ')}. Context: {item.context.length ? item.context.join(', ') : 'none'}. Facts shown: {item.factsShown.map((fact) => fact.value).join('; ')}.</Text> : null}</View>)}
    <Text style={styles.status}>{message}</Text>
  </View>;
}

const styles = StyleSheet.create({ card: { backgroundColor: WARM.paper, borderWidth: 1, borderColor: WARM.line, borderRadius: 18, padding: 18, gap: 10 }, title: { color: WARM.ink, fontSize: 18, fontWeight: '800' }, section: { color: WARM.ink, fontSize: 14, fontWeight: '800', marginTop: 4 }, copy: { color: WARM.muted, lineHeight: 20 }, input: { minHeight: 46, borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 10, backgroundColor: '#fffdfa', padding: 11, color: WARM.ink, textAlignVertical: 'top' }, time: { flex: 1 }, review: { borderTopWidth: 1, borderTopColor: WARM.line, paddingTop: 10, gap: 8 }, recallResult: { backgroundColor: '#f7eadb', borderRadius: 10, padding: 10, gap: 5 }, fact: { color: WARM.ink, lineHeight: 20 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }, button: { alignSelf: 'flex-start', borderRadius: 9, backgroundColor: WARM.accent, paddingHorizontal: 14, paddingVertical: 11 }, buttonText: { color: WARM.paper, fontWeight: '800' }, secondary: { alignSelf: 'flex-start', borderRadius: 9, borderWidth: 1, borderColor: '#cba98f', paddingHorizontal: 12, paddingVertical: 10 }, secondaryText: { color: '#75432f', fontWeight: '800' }, status: { color: WARM.muted, lineHeight: 19, fontSize: 13 }, audit: { borderTopWidth: 1, borderTopColor: WARM.line, paddingTop: 8, gap: 6 }, link: { color: WARM.accent, fontSize: 13, fontWeight: '700' }, remove: { color: '#9b392a', fontSize: 13, fontWeight: '700' } });
