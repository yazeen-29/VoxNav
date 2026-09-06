import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
const { recallMessage } = require('./engine.cjs');

function nextHour() { const date = new Date(); date.setMinutes(0, 0, 0); date.setHours(date.getHours() + 1); return date; }
function localDateTime(value) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }

export default function Appointments({ service, onLock, onChanged }) {
  const [upcoming, setUpcoming] = useState([]);
  const [archived, setArchived] = useState([]);
  const [pending, setPending] = useState(null);
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState(nextHour);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('Loading appointments…');
  const [showWhy, setShowWhy] = useState(false);
  const [modalError, setModalError] = useState('');
  const mounted = useRef(false);
  const working = useRef(false);
  const heading = useRef(null);
  const actionButtons = useRef({});
  const returnFocus = useRef(null);

  function focus(ref) { const node = findNodeHandle(ref); if (node) AccessibilityInfo.setAccessibilityFocus(node); }
  async function refresh() {
    const state = await service.load();
    if (!mounted.current) return;
    setUpcoming(state.upcoming); setArchived(state.archived); setPending(state.pending); setLoaded(true);
    onChanged?.();
  }
  async function perform(operation) {
    if (working.current) return;
    working.current = true; setBusy(true); setModalError('');
    try {
      const status = await operation();
      if (!mounted.current) return;
      await refresh();
      if (mounted.current) setMessage(status);
    } catch (error) {
      if (mounted.current) { const text = error?.message || 'The appointment check is unavailable. Try again.'; setMessage(text); setModalError(text); }
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; perform(async () => 'Appointment records stay on this device.'); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!pending && returnFocus.current !== null) {
      const id = returnFocus.current; returnFocus.current = null;
      const timer = setTimeout(() => { if (mounted.current) focus(actionButtons.current[id]); }, 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pending]);
  function openPicker() {
    if (busy || pending || Platform.OS !== 'android') return;
    const now = new Date();
    DateTimePickerAndroid.open({ value: scheduledAt, mode: 'date', minimumDate: now, onChange: (event, date) => {
      if (event.type !== 'set' || !date) return;
      DateTimePickerAndroid.open({ value: date, mode: 'time', onChange: (timeEvent, time) => {
        if (timeEvent.type !== 'set' || !time) return;
        setScheduledAt(time);
      } });
    } });
  }
  function button(label, onPress, disabled = busy, secondary = false, extra = {}) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]} {...extra}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
  }
  function resolve(resolution) {
    const current = pending;
    perform(async () => {
      await service.resolve(current.id, resolution);
      if (!mounted.current) return;
      returnFocus.current = current.appointmentId; setShowWhy(false);
      return resolution === 'kept' ? 'Kept the earlier completion record.' : 'Appointment marked incomplete. You can record its completion when ready.';
    });
  }
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.heading}>Appointments</Text>
    <Text style={styles.copy}>Create a local appointment and record it as completed when you choose. A repeat check uses only this appointment and its earlier recorded completion time.</Text>
    <TextInput accessibilityLabel="Appointment name" value={title} onChangeText={setTitle} editable={loaded && !busy && !pending && upcoming.length < 20} maxLength={60} placeholder="Example: Pharmacy refill" style={styles.input} />
    {button(`Scheduled: ${localDateTime(scheduledAt)}`, openPicker, !loaded || busy || !!pending || upcoming.length >= 20, true, { accessibilityLabel: `Choose appointment date and time. Currently ${localDateTime(scheduledAt)}` })}
    {button('Add appointment', () => perform(async () => { await service.add(title, scheduledAt.getTime()); if (mounted.current) { setTitle(''); setScheduledAt(nextHour()); } return 'Appointment saved locally.'; }), !loaded || busy || !!pending || upcoming.length >= 20)}
    {loaded && upcoming.length === 0 ? <Text style={styles.copy}>No upcoming appointments yet.</Text> : null}
    {upcoming.map((appointment) => <View key={appointment.id} style={styles.item}>
      <Text style={styles.name}>{appointment.title}</Text><Text style={styles.copy}>{localDateTime(appointment.scheduledAt)}</Text>
      {button('Mark completed', () => perform(async () => { const check = await service.complete(appointment.id); setShowWhy(false); return check.decision === 'discontinuity' ? 'Review the earlier completion record.' : 'Appointment completion saved locally.'; }), !loaded || busy || !!pending, false, { accessibilityLabel: `Mark ${appointment.title} completed`, ref: (node) => { actionButtons.current[appointment.id] = node; } })}
    </View>)}
    {archived.length ? <View style={styles.archive}><Text style={styles.subheading}>Completed appointments</Text>{archived.map((appointment) => <View key={appointment.id} style={styles.item}>
      <Text style={styles.name}>{appointment.title}</Text><Text style={styles.copy}>Recorded completed: {localDateTime(appointment.completedAt)}</Text>
      {button('Mark incomplete', () => perform(async () => { await service.markIncomplete(appointment.id); return 'Appointment marked incomplete. You can record completion later.'; }), !loaded || busy || !!pending, true, { accessibilityLabel: `Mark ${appointment.title} incomplete` })}
    </View>)}</View> : null}
    <Text accessibilityLiveRegion="polite" style={styles.status}>{busy ? 'Checking local appointment records…' : message}</Text>
    {button('Reload appointments', () => perform(async () => 'Appointments reloaded.'), busy || !!pending, true)}
    <Modal visible={!!pending} transparent animationType="fade" onShow={() => focus(heading.current)} onRequestClose={onLock}>
      <View style={styles.backdrop}><ScrollView accessibilityViewIsModal style={styles.dialog} contentContainerStyle={styles.dialogContent}>
        <Text ref={heading} accessible accessibilityRole="header" style={styles.heading}>{pending ? recallMessage(pending) : ''}</Text>
        <Text style={styles.copy}>Would you like to keep that completion record or mark this appointment incomplete?</Text>
        {button('Keep earlier completion', () => resolve('kept'))}
        {button('Mark appointment incomplete', () => resolve('corrected'), busy, true)}
        {button('Why am I seeing this?', () => setShowWhy((value) => !value), busy, true, { accessibilityState: { disabled: busy, expanded: showWhy } })}
        {showWhy ? <Text style={styles.copy}>This appointment was already recorded as completed. This check used only the appointment name and that recorded time. It does not verify attendance.</Text> : null}
        {button('Lock private context', onLock, false, true)}
        {modalError ? <Text accessibilityLiveRegion="polite" style={styles.status}>{modalError}</Text> : null}
      </ScrollView></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fffaf3', borderWidth: 1, borderColor: '#e9dbca', borderRadius: 18, padding: 18, gap: 12 }, heading: { color: '#34271f', fontSize: 20, fontWeight: '800' }, subheading: { color: '#34271f', fontSize: 17, fontWeight: '800' }, copy: { color: '#705e51', fontSize: 15, lineHeight: 22 }, input: { minHeight: 48, borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 10, padding: 11, color: '#34271f', backgroundColor: '#fffdfa' }, button: { minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', borderRadius: 9, backgroundColor: '#9d4e32', paddingHorizontal: 14, paddingVertical: 12 }, buttonText: { color: '#fffaf3', fontWeight: '800', fontSize: 15 }, secondary: { backgroundColor: '#fffaf3', borderWidth: 1, borderColor: '#cba98f' }, secondaryText: { color: '#75432f' }, disabled: { opacity: 0.5 }, item: { borderTopWidth: 1, borderTopColor: '#e9dbca', paddingTop: 12, gap: 8 }, archive: { gap: 10 }, name: { color: '#34271f', fontSize: 17, fontWeight: '700' }, status: { color: '#705e51', fontSize: 14, lineHeight: 21 }, backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(30, 22, 17, 0.65)' }, dialog: { backgroundColor: '#fffaf3', borderRadius: 18, maxHeight: '90%', flexGrow: 0 }, dialogContent: { padding: 24, gap: 16 },
});
