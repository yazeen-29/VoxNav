import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Modal, NativeModules, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import MedicationRoutines from './src/medication/MedicationRoutines';
import Appointments from './src/appointments/Appointments';
import RecentChecks from './src/history/RecentChecks';
import TrustedPeople from './src/trustedPeople/TrustedPeople';
import CaretakerCloudSetup from './src/cloud/TrustedDirectoryCloudSync';
import InsightReview from './src/insights/InsightReview';
import { clearInMemorySession } from './src/cloud/trustedDirectoryVault';
const { createMedicationService } = require('./src/medication/engine.cjs');
const { createAppointmentService } = require('./src/appointments/engine.cjs');
const { createTrustedPersonService } = require('./src/trustedPeople/store.cjs');
const { createInsightService } = require('./src/insights/engine.cjs');

const WARM = { ink: '#34271f', muted: '#705e51', paper: '#fffaf3', background: '#f8f1e7', accent: '#9d4e32', line: '#e9dbca' };
const listener = NativeModules.CbcNotificationListener;
const accessGate = NativeModules.CbcAccessGate;
const trustedPersonGate = NativeModules.CbcTrustedPerson;
const vaultCrypto = NativeModules.CbcVaultCrypto;
const CHAT_APPS = [
  { label: 'WhatsApp', packageName: 'com.whatsapp' },
  { label: 'Telegram', packageName: 'org.telegram.messenger' },
  { label: 'Messenger', packageName: 'com.facebook.orca' },
  { label: 'Gmail', packageName: 'com.google.android.gm' },
];
const DEFAULT_KEYWORDS = ['money', 'payment', 'transfer', '₹', 'send', 'sent', 'receive', 'received', 'delete', 'deleted', 'cancel', 'cancelled', 'approve', 'approved'];
const CLOSE_FRIEND_NUMBER = '+919947057277';
const HOME_DIRECTIONS_URL = 'https://www.google.com/maps/dir/?api=1&destination=MA%20College%2C%20Kothamangalam';

function friendlyAppName(packageName) {
  if (packageName === 'manual-share') return 'Shared by you';
  return CHAT_APPS.find((app) => app.packageName === packageName)?.label || 'Selected app';
}

function TutorialButton() {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="How to use this app" style={styles.tutorialButton} onPress={() => setOpen(true)}><Text style={styles.tutorialButtonText}>? How to use this app</Text></Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={styles.tutorialBackdrop}><View style={styles.tutorialSheet}><ScrollView contentContainerStyle={styles.tutorialContent}>
        <Text style={styles.tutorialTitle}>Let’s do this together</Text>
        <Text style={styles.tutorialIntro}>You do not need to remember everything. Use this app one small step at a time.</Text>
        <TutorialStep number="1" title="Unlock with your fingerprint" copy="Tap “Unlock with biometric”. This keeps your private information on your phone." />
        <TutorialStep number="2" title="Check a task when unsure" copy="Use “Did I already handle this?” and type a few words, like “call pharmacy refill”." />
        <TutorialStep number="3" title="Save a gentle reminder" copy="Write what happened, review it, name it, then choose when you want a reminder." />
        <TutorialStep number="4" title="Review WhatsApp carefully" copy="The app only checks notification previews from apps you choose. Nothing is saved unless you approve it." />
        <TutorialStep number="5" title="Ask for help or find your way home" copy="Use “Call close friend” for support or “Find my way home” to open Google Maps. This app is not emergency or medical advice; use local emergency services if you feel unsafe." />
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => setOpen(false)}><Text style={styles.buttonText}>I understand</Text></Pressable>
      </ScrollView></View></View>
    </Modal>
  </>;
}

function TutorialStep({ number, title, copy }) {
  return <View style={styles.tutorialStep}><View style={styles.tutorialNumber}><Text style={styles.tutorialNumberText}>{number}</Text></View><View style={styles.tutorialStepText}><Text style={styles.tutorialStepTitle}>{title}</Text><Text style={styles.tutorialStepCopy}>{copy}</Text></View></View>;
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
  const [historyVersion, setHistoryVersion] = useState(0);
  const session = useRef({ role: null, unlocked: false, epoch: 0 });
  const authenticating = useRef(false);
  const authenticationAttempt = useRef(0);
  const systemDialogInProgress = useRef(false);
  const medicationService = useRef(null);
  const appointmentService = useRef(null);
  const trustedPersonService = useRef(null);
  const insightService = useRef(null);
  if (!medicationService.current) medicationService.current = createMedicationService({ storage: SecureStore, getSession: () => session.current });
  if (!appointmentService.current) appointmentService.current = createAppointmentService({ storage: SecureStore, getSession: () => session.current });
  if (!trustedPersonService.current) trustedPersonService.current = createTrustedPersonService({ storage: SecureStore, getSession: () => session.current });
  if (!insightService.current) insightService.current = createInsightService({ storage: SecureStore, getSession: () => session.current });

  function lockSession() {
    vaultCrypto?.lock?.().catch(() => {});
    // Cloud sessions are in-memory only. Clearing one on every app lock means
    // a caretaker cloud login cannot survive as an alternate access path.
    clearInMemorySession().catch(() => {});
    session.current = { role: session.current.role, unlocked: false, epoch: session.current.epoch + 1 };
    setUnlocked(false);
    setCandidates([]);
    setApprovedReminders([]);
    setNote('');
    setSelectedApps([]);
    setKeywordText(DEFAULT_KEYWORDS.join(', '));
    setCaretakerPassword('');
    setConfirmCaretakerPassword('');
    setStatus('Private context is locked. Unlock to continue.');
  }

  async function logoutAndChooseRole() {
    // A role is only a local device preference. Logging out ends this session
    // and removes that preference; it does not delete any private records or
    // the caretaker password verifier.
    authenticationAttempt.current += 1;
    lockSession();
    try {
      await SecureStore.deleteItemAsync('cbc-mobile-role');
      setRole(null);
      setCaretakerPasswordSet(false);
      setStatus('Logged out. Choose the role for this device.');
    } catch {
      setStatus('Could not log out on this device. Try again.');
    }
  }

  function beginSession(nextRole) {
    session.current = { role: nextRole, unlocked: true, epoch: session.current.epoch + 1 };
    setUnlocked(true);
  }

  function isCurrent(epoch) {
    return session.current.unlocked && session.current.epoch === epoch;
  }

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // Some Android devices report "background" while an OS-owned permission
      // sheet is visible. Preserve the current session only during a declared
      // system dialog; ordinary backgrounding still locks immediately.
      if (state === 'background') {
        if (systemDialogInProgress.current) return;
        authenticationAttempt.current += 1;
        lockSession();
      }
    });
    return () => { subscription.remove(); };
  }, []);

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
    const epoch = session.current.epoch;
    let active = true;
    const refresh = async () => {
      const enabled = await listener.isNotificationAccessEnabled();
      if (!active || !isCurrent(epoch)) return;
      const pending = await listener.getPendingCandidates();
      if (!active || !isCurrent(epoch)) return;
      setListenerEnabled(enabled);
      setCandidates(pending);
    };
    refresh().catch(() => { if (active && isCurrent(epoch)) setStatus('Could not read notification-review status.'); });
    const interval = setInterval(() => refresh().catch(() => {}), 3000);
    return () => { active = false; clearInterval(interval); };
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    const epoch = session.current.epoch;
    let active = true;
    SecureStore.getItemAsync('cbc-approved-reminders')
      .then((stored) => { if (active && isCurrent(epoch)) setApprovedReminders(JSON.parse(stored || '[]')); })
      .catch(() => { if (active && isCurrent(epoch)) setStatus('Could not read approved reminders stored on this device.'); });
    return () => { active = false; };
  }, [unlocked]);

  async function unlockWithBiometric() {
    if (authenticating.current) return;
    authenticating.current = true;
    const attempt = ++authenticationAttempt.current;
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock your private context', cancelLabel: 'Not now', disableDeviceFallback: true, biometricsSecurityLevel: 'strong' });
      if (result.success && attempt === authenticationAttempt.current && AppState.currentState === 'active') { beginSession('patient'); setStatus('Private context unlocked for this app session.'); }
      else setStatus('Biometric verification was not completed. Your context remains locked.');
    } catch { setStatus('Biometric verification is unavailable. Your context remains locked.'); }
    finally { authenticating.current = false; }
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
    if (authenticating.current) return;
    authenticating.current = true;
    const epoch = session.current.epoch;
    try {
      if (await accessGate.verifyCaretakerPassword(caretakerPassword)) {
        if (session.current.epoch !== epoch || AppState.currentState !== 'active') return;
        setCaretakerPassword('');
        beginSession('caretaker');
        setStatus('Caretaker view unlocked for this app session.');
      } else setStatus('That caretaker password is not correct.');
    } catch (error) { setStatus('Could not verify the caretaker password.'); }
    finally { authenticating.current = false; }
  }

  async function savePreference() {
    const epoch = session.current.epoch;
    await SecureStore.setItemAsync('cbc-mobile-last-note', note.trim());
    if (!isCurrent(epoch)) return;
    setStatus('Saved locally. This is visible only after biometric unlock on this device.');
    setNote('');
  }

  async function callCloseFriend() {
    try {
      const url = `tel:${CLOSE_FRIEND_NUMBER}`;
      if (!(await Linking.canOpenURL(url))) throw new Error('This device cannot open its phone app.');
      await Linking.openURL(url);
    } catch (error) { setStatus(error?.message || 'Could not open the phone app.'); }
  }

  async function findWayHome() {
    try {
      await Linking.openURL(HOME_DIRECTIONS_URL);
    } catch (error) { setStatus(error?.message || 'Could not open directions. Install or enable Google Maps, then try again.'); }
  }

  function shareReviewedSummary() {
    if (!approvedReminders.length) { setStatus('There are no approved reminders to share yet. Review and save an item first.'); return; }
    const items = approvedReminders.slice(0, 10).map((item, index) => `${index + 1}. Reviewed ${item.app} item · keyword “${item.keyword}” · saved ${new Date(item.approvedAt).toLocaleString()}`);
    const message = ['Context Companion — patient-approved summary', `Generated: ${new Date().toLocaleString()}`, '', ...items, '', 'This summary contains reviewed reminder metadata only. It does not include full chat or email notification previews.'].join('\n');
    Alert.alert('Share reviewed summary?', 'This opens Android’s share sheet. Choose the close friend yourself; nothing is sent automatically.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: () => Share.share({ title: 'Context Companion summary', message }).catch(() => setStatus('Could not open the share sheet.')) },
    ]);
  }

  function toggleApp(packageName) {
    setSelectedApps((current) => current.includes(packageName) ? current.filter((app) => app !== packageName) : [...current, packageName]);
  }

  async function enableConsentBasedDetection() {
    if (!listener) {
      setStatus('Notification review requires the Android development build. Expo Go cannot include this native listener.');
      return;
    }
    if (!selectedApps.length) { setStatus('Select at least one notification app before enabling detection.'); return; }
    const keywords = keywordText.split(',').map((keyword) => keyword.trim()).filter(Boolean);
    if (!keywords.length) { setStatus('Add at least one keyword.'); return; }
    if (Platform.Version >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    await listener.saveConfiguration(selectedApps, keywords);
    await listener.openNotificationAccessSettings();
    setStatus('In Android settings, enable notification access for Context Companion. Only the selected apps and keywords will be reviewed locally.');
  }

  async function decideCandidate(candidate, save) {
    const epoch = session.current.epoch;
    if (save) {
      const current = JSON.parse((await SecureStore.getItemAsync('cbc-approved-reminders')) || '[]');
      if (!isCurrent(epoch)) return;
      const approvedReminder = { id: candidate.id, app: friendlyAppName(candidate.packageName), keyword: candidate.keyword, reminder: candidate.preview, approvedAt: new Date().toISOString() };
      const updated = [approvedReminder, ...current].slice(0, 50);
      await SecureStore.setItemAsync('cbc-approved-reminders', JSON.stringify(updated));
      if (!isCurrent(epoch)) return;
      setApprovedReminders(updated);
      setStatus('Approved reminder saved locally. It can be shared with the trusted caretaker after encrypted-vault sync is connected.');
    } else {
      setStatus('Candidate discarded. No reminder was saved.');
    }
    await listener.discardCandidate(candidate.id);
    if (!isCurrent(epoch)) return;
    setCandidates((current) => current.filter((item) => item.id !== candidate.id));
  }

  if (roleLoading) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}><Text style={styles.status}>Preparing private access…</Text><TutorialButton /></View></SafeAreaView>;

  if (!role) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Who is using this device?</Text>
    <Text style={styles.lockCopy}>Patient mode has no password to remember. Caretaker mode uses a separate password and never unlocks the patient’s phone.</Text>
    <Pressable style={styles.button} onPress={() => chooseRole('patient')}><Text style={styles.buttonText}>Patient — use biometric</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={() => chooseRole('caretaker')}><Text style={styles.secondaryButtonText}>Caretaker — use password</Text></Pressable>
    <TutorialButton />
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  if (role === 'caretaker' && !caretakerPasswordSet) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Set caretaker password</Text>
    <Text style={styles.lockCopy}>Use at least 12 characters. The password itself is never stored; this device keeps only a salted verifier.</Text>
    <TextInput value={caretakerPassword} onChangeText={setCaretakerPassword} placeholder="Caretaker password" secureTextEntry style={styles.input} autoCapitalize="none" autoCorrect={false} />
    <TextInput value={confirmCaretakerPassword} onChangeText={setConfirmCaretakerPassword} placeholder="Confirm caretaker password" secureTextEntry style={styles.input} autoCapitalize="none" autoCorrect={false} />
    <Pressable style={styles.button} onPress={createCaretakerPassword}><Text style={styles.buttonText}>Set password</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={logoutAndChooseRole}><Text style={styles.secondaryButtonText}>Choose a different role</Text></Pressable>
    <TutorialButton />
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  if (!unlocked && role === 'caretaker') return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Caretaker access</Text>
    <Text style={styles.lockCopy}>Use the caretaker password for this device. It does not unlock the patient’s phone.</Text>
    <TextInput value={caretakerPassword} onChangeText={setCaretakerPassword} placeholder="Caretaker password" secureTextEntry style={styles.input} autoCapitalize="none" autoCorrect={false} onSubmitEditing={unlockAsCaretaker} />
    <Pressable style={styles.button} onPress={unlockAsCaretaker}><Text style={styles.buttonText}>Unlock caretaker view</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={logoutAndChooseRole}><Text style={styles.secondaryButtonText}>Choose a different role</Text></Pressable>
    <TutorialButton />
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  if (!unlocked) return <SafeAreaView style={styles.safe}><View style={styles.lockPage}>
    <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
    <Text style={styles.lockTitle}>Unlock private context</Text>
    <Text style={styles.lockCopy}>Use your device biometric. On Android this is typically a fingerprint; on iPhone it can be Face ID or Touch ID.</Text>
    {biometricState === 'checking' ? <Text style={styles.status}>Checking biometric availability…</Text> : biometricState === 'ready' ? <Pressable style={styles.button} onPress={unlockWithBiometric}><Text style={styles.buttonText}>Unlock with biometric</Text></Pressable> : <Text style={styles.status}>No enrolled strong biometric was found. Ask a trusted care partner to help set up the device biometric first.</Text>}
    <Pressable accessibilityRole="button" style={styles.callFriendButton} onPress={callCloseFriend}><Text style={styles.callFriendText}>☎ Call close friend</Text><Text style={styles.callFriendNumber}>+91 99470 57277</Text></Pressable>
    <Pressable accessibilityRole="button" style={[styles.callFriendButton, { backgroundColor: '#e8eefb', borderColor: '#4369a8' }]} onPress={findWayHome}><Text style={[styles.callFriendText, { color: '#294f89' }]}>⌖ Find my way home</Text><Text style={[styles.callFriendNumber, { color: '#426598' }]}>Open Google Maps to M.A. College, Kothamangalam</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={logoutAndChooseRole}><Text style={styles.secondaryButtonText}>Choose a different role</Text></Pressable>
    <TutorialButton />
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={[styles.page, styles.pageWithSessionControl]}>
    <View style={styles.brand}><View style={styles.mark}><Text style={styles.markText}>C</Text></View><Text style={styles.brandText}>Context Companion</Text><Text style={styles.badge}>{role === 'caretaker' ? 'Caretaker' : 'Patient'}</Text></View>
    <TutorialButton />
    {role === 'patient' ? <Pressable accessibilityRole="button" style={styles.callFriendButton} onPress={callCloseFriend}><Text style={styles.callFriendText}>☎ Call close friend</Text><Text style={styles.callFriendNumber}>+91 99470 57277</Text></Pressable> : null}
    {role === 'patient' ? <Pressable accessibilityRole="button" style={[styles.callFriendButton, { backgroundColor: '#e8eefb', borderColor: '#4369a8' }]} onPress={findWayHome}><Text style={[styles.callFriendText, { color: '#294f89' }]}>⌖ Find my way home</Text><Text style={[styles.callFriendNumber, { color: '#426598' }]}>Open Google Maps to M.A. College, Kothamangalam</Text></Pressable> : null}
    {role === 'patient' ? <Pressable accessibilityRole="button" style={[styles.callFriendButton, { backgroundColor: '#f8ead7', borderColor: '#aa6c2e' }]} onPress={shareReviewedSummary}><Text style={[styles.callFriendText, { color: '#81490f' }]}>⇧ Share reviewed summary</Text><Text style={[styles.callFriendNumber, { color: '#95642c' }]}>Choose the close friend in the Android share sheet</Text></Pressable> : null}
    <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={lockSession}><Text style={styles.secondaryButtonText}>Lock private context</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={logoutAndChooseRole}><Text style={styles.secondaryButtonText}>Log out / switch role</Text></Pressable>
    {role === 'patient' ? <TrustedPeople key={`trusted-people-${session.current.epoch}`} service={trustedPersonService.current} nativeGate={trustedPersonGate} /> : null}
    {role === 'patient' ? <InsightReview key={`insight-review-${session.current.epoch}`} service={insightService.current} onSystemDialog={(visible) => { systemDialogInProgress.current = visible; }} /> : null}
    {role === 'patient' ? <Appointments key={`appointments-${session.current.epoch}`} service={appointmentService.current} onLock={lockSession} onChanged={() => setHistoryVersion((value) => value + 1)} /> : null}
    {role === 'patient' ? <MedicationRoutines key={`medication-${session.current.epoch}`} service={medicationService.current} onLock={lockSession} onChanged={() => setHistoryVersion((value) => value + 1)} /> : null}
    {role === 'patient' ? <RecentChecks key={`history-${session.current.epoch}`} medicationService={medicationService.current} appointmentService={appointmentService.current} refreshKey={historyVersion} /> : null}
    <Text style={styles.eyebrow}>CONSENT-BASED CONTEXT</Text>
    <Text style={styles.title}>Review a reminder before it is saved.</Text>
    <Text style={styles.copy}>Unapproved matches are temporary, local, and automatically expire. Approved reminders stay on this device until encrypted caretaker sharing is set up.</Text>

    {role === 'caretaker' ? <><View style={styles.card}><Text style={styles.cardTitle}>Caretaker console</Text><Text style={styles.cardCopy}>This password protects the caretaker device. It does not unlock patient data. Pairing must be approved on the patient’s device before any data can be shared.</Text></View><CaretakerCloudSetup /></> : null}

    <View style={styles.card}>
      <Text style={styles.cardTitle}>Selected notification apps</Text>
      <Text style={styles.cardCopy}>Choose only apps whose notification previews you want reviewed. The app never reads chat histories or email inboxes.</Text>
      <View style={styles.choiceRow}>{CHAT_APPS.map((app) => <Pressable key={app.packageName} style={[styles.choice, selectedApps.includes(app.packageName) && styles.choiceSelected]} onPress={() => toggleApp(app.packageName)}><Text style={[styles.choiceText, selectedApps.includes(app.packageName) && styles.choiceTextSelected]}>{selectedApps.includes(app.packageName) ? '✓ ' : ''}{app.label}</Text></Pressable>)}</View>
      <Text style={styles.label}>Keywords, separated by commas</Text>
      <TextInput value={keywordText} onChangeText={setKeywordText} style={styles.input} autoCapitalize="none" />
      <Text style={styles.status}>Action words such as “send” and “approve” are broad, so keep only the keywords you genuinely want to review.</Text>
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
  </ScrollView><Pressable accessibilityRole="button" accessibilityLabel="Log out and switch role" style={styles.floatingLogout} onPress={logoutAndChooseRole}><Text style={styles.floatingLogoutText}>Log out / switch role</Text></Pressable></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WARM.background }, page: { padding: 24, gap: 18 }, pageWithSessionControl: { paddingBottom: 96 }, lockPage: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', padding: 28, gap: 18 }, lockTitle: { color: WARM.ink, fontFamily: 'Georgia', fontSize: 38, fontWeight: '700', letterSpacing: -1 }, lockCopy: { color: WARM.muted, fontSize: 16, lineHeight: 24 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 24 }, mark: { width: 32, height: 32, borderRadius: 10, backgroundColor: WARM.accent, alignItems: 'center', justifyContent: 'center' }, markText: { color: WARM.paper, fontSize: 20, fontWeight: '800' }, brandText: { color: WARM.ink, fontWeight: '800' }, badge: { marginLeft: 'auto', color: '#76513c', backgroundColor: '#fff1d7', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, fontSize: 12, fontWeight: '700' }, eyebrow: { color: WARM.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: WARM.ink, fontFamily: 'Georgia', fontSize: 39, fontWeight: '700', letterSpacing: -1.2, lineHeight: 43 }, copy: { color: WARM.muted, fontSize: 16, lineHeight: 24 }, card: { backgroundColor: WARM.paper, borderWidth: 1, borderColor: WARM.line, borderRadius: 18, padding: 18, gap: 10 }, cardTitle: { color: WARM.ink, fontSize: 18, fontWeight: '800' }, cardCopy: { color: WARM.muted, lineHeight: 20 }, label: { color: WARM.ink, fontSize: 13, fontWeight: '700', marginTop: 4 }, input: { minHeight: 46, borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 10, backgroundColor: '#fffdfa', padding: 11, color: WARM.ink, textAlignVertical: 'top' }, button: { alignSelf: 'flex-start', borderRadius: 9, backgroundColor: WARM.accent, paddingHorizontal: 14, paddingVertical: 11 }, buttonText: { color: WARM.paper, fontWeight: '800' }, secondaryButton: { alignSelf: 'flex-start', borderRadius: 9, borderWidth: 1, borderColor: '#cba98f', paddingHorizontal: 14, paddingVertical: 10 }, secondaryButtonText: { color: '#75432f', fontWeight: '800' }, floatingLogout: { position: 'absolute', right: 20, bottom: 20, borderRadius: 99, backgroundColor: WARM.ink, paddingHorizontal: 18, paddingVertical: 13, elevation: 4 }, floatingLogoutText: { color: WARM.paper, fontWeight: '800' }, status: { color: WARM.muted, lineHeight: 19, fontSize: 13 }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 8 }, choiceSelected: { borderColor: WARM.accent, backgroundColor: '#fae2d6' }, choiceText: { color: WARM.muted, fontSize: 13, fontWeight: '700' }, choiceTextSelected: { color: WARM.accent }, candidate: { borderTopWidth: 1, borderTopColor: WARM.line, paddingTop: 12, gap: 8 }, candidateMeta: { color: WARM.accent, fontSize: 12, fontWeight: '800' }, candidatePreview: { color: WARM.ink, lineHeight: 20 }, actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' }, tutorialButton: { alignSelf: 'flex-start', borderWidth: 2, borderColor: WARM.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff4e9' }, tutorialButtonText: { color: WARM.accent, fontSize: 15, fontWeight: '800' }, tutorialBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(38, 27, 19, 0.45)' }, tutorialSheet: { maxHeight: '88%', backgroundColor: WARM.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 }, tutorialContent: { padding: 24, gap: 18 }, tutorialTitle: { color: WARM.ink, fontFamily: 'Georgia', fontSize: 30, fontWeight: '700' }, tutorialIntro: { color: WARM.muted, fontSize: 17, lineHeight: 25 }, tutorialStep: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, tutorialNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: WARM.accent, alignItems: 'center', justifyContent: 'center' }, tutorialNumberText: { color: WARM.paper, fontWeight: '800' }, tutorialStepText: { flex: 1, gap: 3 }, tutorialStepTitle: { color: WARM.ink, fontSize: 17, fontWeight: '800' }, tutorialStepCopy: { color: WARM.muted, fontSize: 15, lineHeight: 22 }, callFriendButton: { alignSelf: 'stretch', backgroundColor: '#e7f3ec', borderWidth: 2, borderColor: '#2e7354', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, gap: 2 }, callFriendText: { color: '#1e5c42', fontSize: 18, fontWeight: '800' }, callFriendNumber: { color: '#326c54', fontSize: 14, fontWeight: '700' }
});
