import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { trustedDirectorySupabase } from '../cloud/trustedDirectoryVault';
import { createInvite, decideInvite, ensurePatientPairingSession, patientInvites } from './patientCaretakerPairing';

const WARM = { ink: '#34271f', muted: '#705e51', paper: '#fffaf3', accent: '#9d4e32', line: '#e9dbca' };

export default function PatientPairing() {
  const [invite, setInvite] = useState(null);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('A caretaker can connect only after you create a one-time code and approve their request.');

  const refresh = async () => {
    try {
      await ensurePatientPairingSession(SecureStore);
      setPending(await patientInvites());
    } catch (error) { setMessage(error?.message || 'Could not check pairing requests.'); }
  };

  useEffect(() => {
    if (!trustedDirectorySupabase) return undefined;
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, []);

  async function makeInvite() {
    setBusy(true);
    try {
      await ensurePatientPairingSession(SecureStore);
      const bytes = await Crypto.getRandomBytesAsync(32);
      const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      const hash = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, secret, { encoding: Crypto.CryptoEncoding.HEX })).toLowerCase();
      const created = await createInvite(hash);
      setInvite({ secret, expiresAt: created.expires_at });
      await refresh();
      setMessage('Show this QR only to the intended caretaker. Their request still needs your approval.');
    } catch (error) { setMessage(error?.message || 'Could not create a pairing code. Enable Anonymous Sign-ins in Supabase Auth, then try again.'); }
    finally { setBusy(false); }
  }

  async function decide(item, approve) {
    setBusy(true);
    try {
      await decideInvite(item.id, approve);
      setInvite(null);
      await refresh();
      setMessage(approve ? `${item.caretaker_label} is paired. No private records are shared until encrypted key sharing is added.` : 'Pairing request rejected.');
    } catch (error) { setMessage(error?.message || 'Could not update this pairing request.'); }
    finally { setBusy(false); }
  }

  if (!trustedDirectorySupabase) return <View style={styles.card}><Text style={styles.title}>Connect a caretaker phone</Text><Text style={styles.copy}>Cloud pairing is not configured yet on this patient phone.</Text></View>;

  return <View style={styles.card}>
    <Text style={styles.title}>Connect a caretaker phone</Text>
    <Text style={styles.copy}>This patient phone stays biometric-only. Create a 10-minute code, let the caretaker scan it on their own phone, then approve the named request below.</Text>
    {invite ? <View style={styles.qrBox}><QRCode value={`cbc-pair-v1:${invite.secret}`} size={190} /><Text selectable style={styles.code}>Pairing code: {invite.secret}</Text><Text style={styles.status}>Expires {new Date(invite.expiresAt).toLocaleTimeString()}.</Text></View> : <Pressable style={styles.button} onPress={makeInvite} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Creating code…' : 'Create caretaker QR code'}</Text></Pressable>}
    {pending.filter((item) => item.state === 'claimed').map((item) => <View key={item.id} style={styles.request}><Text style={styles.requestTitle}>Pair with {item.caretaker_label}?</Text><Text style={styles.copy}>Approving creates a connection only. It does not give access to your contacts, face templates, reminders, or other records yet.</Text><View style={styles.row}><Pressable style={styles.button} onPress={() => decide(item, true)} disabled={busy}><Text style={styles.buttonText}>Approve pairing</Text></Pressable><Pressable style={styles.secondary} onPress={() => decide(item, false)} disabled={busy}><Text style={styles.secondaryText}>Reject</Text></Pressable></View></View>)}
    <Text style={styles.status}>{message}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: WARM.paper, borderWidth: 1, borderColor: WARM.line, borderRadius: 18, padding: 18, gap: 10 }, title: { color: WARM.ink, fontSize: 18, fontWeight: '800' }, copy: { color: WARM.muted, lineHeight: 20 }, qrBox: { alignItems: 'center', gap: 10, backgroundColor: '#fff', padding: 14, borderRadius: 12 }, code: { color: WARM.ink, fontSize: 11, textAlign: 'center' }, status: { color: WARM.muted, lineHeight: 19, fontSize: 13 }, request: { borderTopWidth: 1, borderTopColor: WARM.line, paddingTop: 12, gap: 8 }, requestTitle: { color: WARM.ink, fontWeight: '800' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, button: { alignSelf: 'flex-start', borderRadius: 9, backgroundColor: WARM.accent, paddingHorizontal: 14, paddingVertical: 11 }, buttonText: { color: WARM.paper, fontWeight: '800' }, secondary: { alignSelf: 'flex-start', borderRadius: 9, borderWidth: 1, borderColor: '#cba98f', paddingHorizontal: 14, paddingVertical: 10 }, secondaryText: { color: '#75432f', fontWeight: '800' }
});
