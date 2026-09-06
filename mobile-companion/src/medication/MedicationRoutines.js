import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
const { recallMessage } = require('./engine.cjs');

export default function MedicationRoutines({ service, onLock, onChanged }) {
  const [routines, setRoutines] = useState([]);
  const [pending, setPending] = useState(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('Loading medication routines…');
  const [showWhy, setShowWhy] = useState(false);
  const [modalError, setModalError] = useState('');
  const mounted = useRef(false);
  const working = useRef(false);
  const recallHeading = useRef(null);
  const routineButtons = useRef({});
  const returnFocus = useRef(null);

  function focus(ref) {
    const node = findNodeHandle(ref);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }

  async function refresh() {
    const state = await service.load();
    if (!mounted.current) return;
    setRoutines(state.routines);
    setPending(state.pending);
    setLoaded(true);
    onChanged?.();
  }

  async function perform(operation) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setModalError('');
    try {
      const status = await operation();
      if (!mounted.current) return;
      await refresh();
      if (mounted.current) setMessage(status);
    } catch (error) {
      if (mounted.current) {
        const text = error?.message || 'The medication check is unavailable. Try again.';
        setMessage(text);
        setModalError(text);
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    perform(async () => 'Medication records stay on this device.');
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!pending && returnFocus.current !== null) {
      const routineId = returnFocus.current;
      returnFocus.current = null;
      const timer = setTimeout(() => { if (mounted.current) focus(routineButtons.current[routineId]); }, 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pending]);

  function resolve(resolution) {
    const current = pending;
    perform(async () => {
      await service.resolve(current.id, resolution);
      if (!mounted.current) return;
      returnFocus.current = current.routineId;
      setShowWhy(false);
      return resolution === 'kept' ? 'Kept the earlier record. No new medication entry was added.' : 'Another self-reported medication entry was saved locally.';
    });
  }

  function button(title, onPress, disabled = busy, secondary = false, extra = {}) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]} {...extra}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text></Pressable>;
  }

  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.heading}>Medication routines</Text>
    <Text style={styles.copy}>Record a routine when you choose. If it was recorded within four hours, you can review the earlier time. These are your logs, not dosage instructions.</Text>
    <TextInput accessibilityLabel="Medication routine name" value={label} onChangeText={setLabel} editable={loaded && !busy && !pending && routines.length < 10} maxLength={60} placeholder="Example: Morning medication" style={styles.input} />
    {button('Add routine', () => perform(async () => {
      await service.addRoutine(label);
      if (mounted.current) setLabel('');
      return 'Medication routine added locally.';
    }), !loaded || busy || !!pending || routines.length >= 10)}
    {loaded && routines.length === 0 ? <Text style={styles.copy}>Add a named routine to start recording.</Text> : null}
    {routines.map((routine) => <View key={routine.id} style={styles.routine}>
      <Text style={styles.name}>{routine.label}</Text>
      {routine.lastEntry ? <Text style={styles.copy}>Last recorded: {new Date(routine.lastEntry.recordedAt).toLocaleString()}</Text> : <Text style={styles.copy}>No entry recorded yet.</Text>}
      {button('Record as taken', () => perform(async () => {
        const check = await service.record(routine.id);
        if (mounted.current) setShowWhy(false);
        return check.decision === 'discontinuity' ? 'Review the earlier medication record.' : 'Self-reported medication entry saved locally.';
      }), !loaded || busy || !!pending, false, { accessibilityLabel: `Record ${routine.label} as taken`, ref: (node) => { routineButtons.current[routine.id] = node; } })}
    </View>)}
    <Text accessibilityLiveRegion="polite" style={styles.status}>{busy ? 'Checking local medication records…' : message}</Text>
    {button('Reload medication routines', () => perform(async () => 'Medication routines reloaded.'), busy || !!pending, true)}
    <Modal visible={!!pending} transparent animationType="fade" onShow={() => focus(recallHeading.current)} onRequestClose={onLock}>
      <View style={styles.backdrop}><ScrollView accessibilityViewIsModal style={styles.dialog} contentContainerStyle={styles.dialogContent}>
        <Text ref={recallHeading} accessible accessibilityRole="header" style={styles.heading}>{pending ? recallMessage(pending) : ''}</Text>
        <Text style={styles.copy}>Would you like to keep that record or add another entry?</Text>
        {button('Keep earlier record', () => resolve('kept'))}
        {button('Record another entry', () => resolve('recorded'), busy, true)}
        {button('Why am I seeing this?', () => setShowWhy((value) => !value), busy, true, { accessibilityState: { disabled: busy, expanded: showWhy } })}
        {showWhy ? <Text style={styles.copy}>The same routine was recorded within four hours of this attempt. This check uses only the routine name and the earlier recorded time. It does not confirm that medication was taken.</Text> : null}
        {button('Lock private context', onLock, false, true)}
        {modalError ? <Text accessibilityLiveRegion="polite" style={styles.status}>{modalError}</Text> : null}
        {modalError ? button('Reload medication routines', () => perform(async () => 'Medication routines reloaded.'), busy, true) : null}
        {busy ? <Text accessibilityLiveRegion="polite" style={styles.status}>Saving your choice…</Text> : null}
      </ScrollView></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fffaf3', borderWidth: 1, borderColor: '#e9dbca', borderRadius: 18, padding: 18, gap: 12 },
  heading: { color: '#34271f', fontSize: 20, fontWeight: '800' },
  copy: { color: '#705e51', fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 10, padding: 11, color: '#34271f', backgroundColor: '#fffdfa' },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', borderRadius: 9, backgroundColor: '#9d4e32', paddingHorizontal: 14, paddingVertical: 12 },
  buttonText: { color: '#fffaf3', fontWeight: '800', fontSize: 15 },
  secondary: { backgroundColor: '#fffaf3', borderWidth: 1, borderColor: '#cba98f' },
  secondaryText: { color: '#75432f' },
  disabled: { opacity: 0.5 },
  routine: { borderTopWidth: 1, borderTopColor: '#e9dbca', paddingTop: 12, gap: 8 },
  name: { color: '#34271f', fontSize: 17, fontWeight: '700' },
  status: { color: '#705e51', fontSize: 14, lineHeight: 21 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(30, 22, 17, 0.65)' },
  dialog: { backgroundColor: '#fffaf3', borderRadius: 18, maxHeight: '90%', flexGrow: 0 },
  dialogContent: { padding: 24, gap: 16 },
});
