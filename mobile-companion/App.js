import { useEffect, useState } from 'react';
import { NativeModules, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const WARM = { ink: '#34271f', muted: '#705e51', paper: '#fffaf3', background: '#f8f1e7', accent: '#9d4e32', line: '#e9dbca' };
const listener = NativeModules.CbcNotificationListener;
const accessGate = NativeModules.CbcAccessGate;
const CHAT_APPS = [
  { label: 'WhatsApp', packageName: 'com.whatsapp' },
  { label: 'Telegram', packageName: 'org.telegram.messenger' },
  { label: 'Messenger', packageName: 'com.facebook.orca' },
];
const DEFAULT_KEYWORDS = ['money', 'payment', 'transfer', '₹'];

function friendlyAppName(packageName) {
  if (packageName === 'manual-share') return 'Shared by you';
  return CHAT_APPS.find((app) => app.packageName === packageName)?.label || 'Selected app';
}

export default function App() {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('Check device biometrics before unlocking private context.');
  const [biometricState, setBiometricState] = useState('checking');
  const [unlocked, setUnlocked] = useState(false);
  const [selectedApps, setSelectedApps] = useState([]);
  const [keywordText, setKeywordText] = useState(DEFAULT_KEYWORDS.join(', '));
  const [listenerEnabled, setListenerEnabled] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [approvedReminders, setApprovedReminders] = useState([]);
  const [role, setRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [caretakerPasswordSet, setCaretakerPasswordSet] = useState(false);
  const [caretakerPassword, setCaretakerPassword] = useState('');
  const [confirmCaretakerPassword, setConfirmCaretakerPassword] = useState('');

  useEffect(() => {
    SecureStore.getItemAsync('cbc-mobile-role')
      .then(async (storedRole) => {
        setRole(storedRole === 'patient' || storedRole === 'caretaker' ? storedRole : null);
        if (storedRole === 'caretaker' && accessGate) setCaretakerPasswordSet(await accessGate.hasCaretakerPassword());
      })
      .catch(() => setStatus('Could not load the access role for this device.'))
      .finally(() => setRoleLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
      .then(([hasHardware, isEnrolled]) => setBiometricState(hasHardware && isEnrolled ? 'ready' : 'unavailable'))
      .catch(() => setBiometricState('unavailable'));
  }, []);

  useEffect(() => {
    if (!unlocked || !listener) return undefined;
    const refresh = async () => {
      setListenerEnabled(await listener.isNotificationAccessEnabled());
      setCandidates(await listener.getPendingCandidates());
    };
    refresh().catch(() => setStatus('Could not read notification-review status.'));
    const interval = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(interval);
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    SecureStore.getItemAsync('cbc-approved-reminders')
      .then((stored) => setApprovedReminders(JSON.parse(stored || '[]')))
      .catch(() => setStatus('Could not read approved reminders stored on this device.'));
  }, [unlocked]);

  async function unlockWithBiometric() {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock your private context', cancelLabel: 'Not now', disableDeviceFallback: true, biometricsSecurityLevel: 'strong' });
    if (result.success) { setUnlocked(true); setStatus('Private context unlocked for this app session.'); }
    else setStatus('Biometric verification was not completed. Your context remains locked.');
  }

  async function chooseRole(nextRole) {
    if (nextRole === 'caretaker' && !accessGate) {
      setStatus('Caretaker password access requires the Android development build.');
      return;
    }
    await SecureStore.setItemAsync('cbc-mobile-role', nextRole);
    setRole(nextRole);
    if (nextRole === 'caretaker') setCaretakerPasswordSet(await accessGate.hasCaretakerPassword());
    setStatus(nextRole === 'patient' ? 'Patient mode uses this device biometric only.' : 'Create a caretaker password for this device.');
  }

  async function createCaretakerPassword() {
    if (caretakerPassword !== confirmCaretakerPassword) { setStatus('The caretaker passwords do not match.'); return; }
    try {
      await accessGate.setCaretakerPassword(caretakerPassword);
      setCaretakerPassword('');
      setConfirmCaretakerPassword('');
      setCaretakerPasswordSet(true);
      setStatus('Caretaker password set. Use it to unlock this caretaker device.');
    } catch (error) { setStatus(error?.message || 'Could not set caretaker password. Use at least 12 characters.'); }
  }

  async function unlockAsCaretaker() {
    try {
      if (await accessGate.verifyCaretakerPassword(caretakerPassword)) {
        setCaretakerPassword('');
        setUnlocked(true);
        setStatus('Caretaker view unlocked for this app session.');
      } else setStatus('That caretaker password is not correct.');
    } catch (error) { setStatus('Could not verify the caretaker password.'); }
  }

  async function savePreference() {
    await SecureStore.setItemAsync('cbc-mobile-last-note', note.trim());
    setStatus('Saved locally. This is visible only after biometric unlock on this device.');
    setNote('');
  }

  function toggleApp(packageName) {
    setSelectedApps((current) => current.includes(packageName) ? current.filter((app) => app !== packageName) : [...current, packageName]);
  }

  async function enableConsentBasedDetection() {
    if (!listener) {
      setStatus('Notification review requires the Android development build. Expo Go cannot include this native listener.');
      return;
    }
    if (!selectedApps.length) { setStatus('Select at least one chat app before enabling detection.'); return; }
    const keywords = keywordText.split(',').map((keyword) => keyword.trim()).filter(Boolean);
    if (!keywords.length) { setStatus('Add at least one keyword.'); return; }
    if (Platform.Version >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    await listener.saveConfiguration(selectedApps, keywords);
    await listener.openNotificationAccessSettings();
    setStatus('In Android settings, enable notification access for Context Companion. Only the selected apps and keywords will be reviewed locally.');
  }

  async function decideCandidate(candidate, save) {
    if (save) {
      const current = JSON.parse((await SecureStore.getItemAsync('cbc-approved-reminders')) || '[]');
      const approvedReminder = { id: candidate.id, app: friendlyAppName(candidate.packageName), keyword: candidate.keyword, reminder: candidate.preview, approvedAt: new Date().toISOString() };
      const updated = [approvedReminder, ...current].slice(0, 50);
      await SecureStore.setItemAsync('cbc-approved-reminders', JSON.stringify(updated));
      setApprovedReminders(updated);
      setStatus('Approved reminder saved locally. It can be shared with the trusted caretaker after encrypted-vault sync is connected.');
    } else {
      setStatus('Candidate discarded. No reminder was saved.');
    }
    await listener.discardCandidate(candidate.id);
    setCandidates((current) => current.filter((item) => item.id !== candidate.id));
  }

  if (roleLoading) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}><Text style={styles.status}>Preparing private access…</Text></View></SafeAreaView>;

  if (!role) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Who is using this device?</Text>
    <Text style={styles.lockCopy}>Patient mode has no password to remember. Caretaker mode uses a separate password and never unlocks the patient’s phone.</Text>
    <Pressable style={styles.button} onPress={() => chooseRole('patient')}><Text style={styles.buttonText}>Patient — use biometric</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={() => chooseRole('caretaker')}><Text style={styles.secondaryButtonText}>Caretaker — use password</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  if (role === 'caretaker' && !caretakerPasswordSet) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Set caretaker password</Text>
    <Text style={styles.lockCopy}>Use at least 12 characters. The password itself is never stored; this device keeps only a salted verifier.</Text>
    <TextInput value={caretakerPassword} onChangeText={setCaretakerPassword} placeholder="Caretaker password" secureTextEntry style={styles.input} autoCapitalize="none" autoCorrect={false} />
    <TextInput value={confirmCaretakerPassword} onChangeText={setConfirmCaretakerPassword} placeholder="Confirm caretaker password" secureTextEntry style={styles.input} autoCapitalize="none" autoCorrect={false} />
    <Pressable style={styles.button} onPress={createCaretakerPassword}><Text style={styles.buttonText}>Set password</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  if (!unlocked && role === 'caretaker') return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Caretaker access</Text>
    <Text style={styles.lockCopy}>Use the caretaker password for this device. It does not unlock the patient’s phone.</Text>
    <TextInput value={caretakerPassword} onChangeText={setCaretakerPassword} placeholder="Caretaker password" secureTextEntry style={styles.input} autoCapitalize="none" autoCorrect={false} onSubmitEditing={unlockAsCaretaker} />
    <Pressable style={styles.button} onPress={unlockAsCaretaker}><Text style={styles.buttonText}>Unlock caretaker view</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  if (!unlocked) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Unlock private context</Text>
    <Text style={styles.lockCopy}>Use your device biometric. On Android this is typically a fingerprint; on iPhone it can be Face ID or Touch ID.</Text>
    {biometricState === 'checking' ? <Text style={styles.status}>Checking biometric availability…</Text> : biometricState === 'ready' ? <Pressable style={styles.button} onPress={unlockWithBiometric}><Text style={styles.buttonText}>Unlock with biometric</Text></Pressable> : <Text style={styles.status}>No enrolled strong biometric was found. Ask a trusted care partner to help set up the device biometric first.</Text>}
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.brand}><View style={styles.mark}><Text style={styles.markText}>C</Text></View><Text style={styles.brandText}>Context Companion</Text><Text style={styles.badge}>{role === 'caretaker' ? 'Caretaker' : 'Patient'}</Text></View>
    <Text style={styles.eyebrow}>CONSENT-BASED CONTEXT</Text>
    <Text style={styles.title}>Review a reminder before it is saved.</Text>
    <Text style={styles.copy}>Unapproved matches are temporary, local, and automatically expire. Approved reminders stay on this device until encrypted caretaker sharing is set up.</Text>

    {role === 'caretaker' ? <View style={styles.card}><Text style={styles.cardTitle}>Caretaker console</Text><Text style={styles.cardCopy}>This password protects the caretaker device. Encrypted patient pairing is the next step; until then, this device can show only its own local reminders.</Text></View> : null}

    <View style={styles.card}>
      <Text style={styles.cardTitle}>Selected chat apps</Text>
      <Text style={styles.cardCopy}>Choose only apps whose notification previews you want reviewed. The app never reads full chat histories.</Text>
      <View style={styles.choiceRow}>{CHAT_APPS.map((app) => <Pressable key={app.packageName} style={[styles.choice, selectedApps.includes(app.packageName) && styles.choiceSelected]} onPress={() => toggleApp(app.packageName)}><Text style={[styles.choiceText, selectedApps.includes(app.packageName) && styles.choiceTextSelected]}>{selectedApps.includes(app.packageName) ? '✓ ' : ''}{app.label}</Text></Pressable>)}</View>
      <Text style={styles.label}>Keywords, separated by commas</Text>
      <TextInput value={keywordText} onChangeText={setKeywordText} style={styles.input} autoCapitalize="none" />
      <Pressable style={styles.button} onPress={enableConsentBasedDetection}><Text style={styles.buttonText}>Enable notification review</Text></Pressable>
      <Text style={styles.status}>{listenerEnabled ? 'Notification review is enabled for the selected apps.' : 'Notification review is not enabled yet.'}</Text>
    </View>

    <View style={styles.card}><Text style={styles.cardTitle}>Review before saving</Text><Text style={styles.cardCopy}>A keyword match never becomes a reminder automatically. Review it with the patient/caretaker before saving.</Text>
      {!candidates.length ? <Text style={styles.status}>No pending matches.</Text> : candidates.map((candidate) => <View key={candidate.id} style={styles.candidate}><Text style={styles.candidateMeta}>{friendlyAppName(candidate.packageName)} · matched “{candidate.keyword}”</Text><Text style={styles.candidatePreview}>{candidate.preview}</Text><View style={styles.actionRow}><Pressable style={styles.button} onPress={() => decideCandidate(candidate, true)}><Text style={styles.buttonText}>Save reminder</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => decideCandidate(candidate, false)}><Text style={styles.secondaryButtonText}>Discard</Text></Pressable></View></View>)}</View>

    <View style={styles.card}><Text style={styles.cardTitle}>Approved reminders</Text><Text style={styles.cardCopy}>These are the reminders explicitly saved during review.</Text>
      {!approvedReminders.length ? <Text style={styles.status}>No approved reminders yet.</Text> : approvedReminders.map((reminder) => <View key={reminder.id} style={styles.candidate}><Text style={styles.candidateMeta}>{reminder.app} · matched “{reminder.keyword}”</Text><Text style={styles.candidatePreview}>{reminder.reminder}</Text></View>)}</View>

    <View style={styles.card}><Text style={styles.cardTitle}>Save an outgoing message</Text><Text style={styles.cardCopy}>In a chat app, select a message you wrote, tap Share, then choose Context Companion. It will appear here for review; sent messages are never collected automatically.</Text></View>

    <View style={styles.card}><Text style={styles.cardTitle}>Private context</Text><Text style={styles.cardCopy}>Add a manual reminder when needed.</Text><TextInput value={note} onChangeText={setNote} placeholder="Example: Confirm the appointment time" style={styles.input} multiline /><Pressable style={styles.button} onPress={savePreference}><Text style={styles.buttonText}>Save locally</Text></Pressable></View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WARM.background }, page: { padding: 24, gap: 18 }, lockPage: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', padding: 28, gap: 18 }, lockTitle: { color: WARM.ink, fontFamily: 'Georgia', fontSize: 38, fontWeight: '700', letterSpacing: -1 }, lockCopy: { color: WARM.muted, fontSize: 16, lineHeight: 24 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 24 }, mark: { width: 32, height: 32, borderRadius: 10, backgroundColor: WARM.accent, alignItems: 'center', justifyContent: 'center' }, markText: { color: WARM.paper, fontSize: 20, fontWeight: '800' }, brandText: { color: WARM.ink, fontWeight: '800' }, badge: { marginLeft: 'auto', color: '#76513c', backgroundColor: '#fff1d7', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, fontSize: 12, fontWeight: '700' }, eyebrow: { color: WARM.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: WARM.ink, fontFamily: 'Georgia', fontSize: 39, fontWeight: '700', letterSpacing: -1.2, lineHeight: 43 }, copy: { color: WARM.muted, fontSize: 16, lineHeight: 24 }, card: { backgroundColor: WARM.paper, borderWidth: 1, borderColor: WARM.line, borderRadius: 18, padding: 18, gap: 10 }, cardTitle: { color: WARM.ink, fontSize: 18, fontWeight: '800' }, cardCopy: { color: WARM.muted, lineHeight: 20 }, label: { color: WARM.ink, fontSize: 13, fontWeight: '700', marginTop: 4 }, input: { minHeight: 46, borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 10, backgroundColor: '#fffdfa', padding: 11, color: WARM.ink, textAlignVertical: 'top' }, button: { alignSelf: 'flex-start', borderRadius: 9, backgroundColor: WARM.accent, paddingHorizontal: 14, paddingVertical: 11 }, buttonText: { color: WARM.paper, fontWeight: '800' }, secondaryButton: { alignSelf: 'flex-start', borderRadius: 9, borderWidth: 1, borderColor: '#cba98f', paddingHorizontal: 14, paddingVertical: 10 }, secondaryButtonText: { color: '#75432f', fontWeight: '800' }, status: { color: WARM.muted, lineHeight: 19, fontSize: 13 }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 8 }, choiceSelected: { borderColor: WARM.accent, backgroundColor: '#fae2d6' }, choiceText: { color: WARM.muted, fontSize: 13, fontWeight: '700' }, choiceTextSelected: { color: WARM.accent }, candidate: { borderTopWidth: 1, borderTopColor: WARM.line, paddingTop: 12, gap: 8 }, candidateMeta: { color: WARM.accent, fontSize: 12, fontWeight: '800' }, candidatePreview: { color: WARM.ink, lineHeight: 20 }, actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' }
});
