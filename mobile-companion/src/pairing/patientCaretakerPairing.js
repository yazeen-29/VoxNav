import { clearInMemorySession, restoreSession, signInPatientAnonymously, trustedDirectorySupabase } from '../cloud/trustedDirectoryVault';

const PATIENT_SESSION_KEY = 'cbc-patient-pairing-session-v1';

function clientOrThrow() {
  if (!trustedDirectorySupabase) throw new Error('Cloud pairing is not configured on this device.');
  return trustedDirectorySupabase;
}

function sessionRecord(session) {
  return JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token });
}

export async function ensurePatientPairingSession(storage) {
  const saved = await storage.getItemAsync(PATIENT_SESSION_KEY);
  if (saved) {
    try {
      const restored = await restoreSession(JSON.parse(saved));
      if (restored) {
        await storage.setItemAsync(PATIENT_SESSION_KEY, sessionRecord(restored));
        return restored;
      }
    } catch {
      // A removed/revoked anonymous account is replaced only after biometric
      // unlock on this device.
    }
  }
  const created = await signInPatientAnonymously();
  if (!created) throw new Error('Could not create the patient pairing identity. Enable Anonymous Sign-ins in Supabase Auth.');
  await storage.setItemAsync(PATIENT_SESSION_KEY, sessionRecord(created));
  return created;
}

export async function createInvite(secretHash) {
  const { data, error } = await clientOrThrow().rpc('create_patient_pairing_invite', { p_secret_hash: secretHash });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function patientInvites() {
  const { data, error } = await clientOrThrow().from('patient_pairing_invites')
    .select('id, state, caretaker_label, expires_at, created_at')
    .in('state', ['open', 'claimed'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function decideInvite(id, approve) {
  const { error } = await clientOrThrow().rpc('decide_patient_pairing_invite', { p_invite_id: id, p_approve: approve });
  if (error) throw error;
}

export async function claimInvite(secret, caretakerLabel) {
  const { error } = await clientOrThrow().rpc('claim_patient_pairing_invite', { p_secret: secret, p_caretaker_label: caretakerLabel.trim() });
  if (error) throw error;
}

export async function caretakerPairings() {
  const { data, error } = await clientOrThrow().from('patient_caretaker_pairings')
    .select('id, caretaker_label, created_at, revoked_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export { clearInMemorySession };
