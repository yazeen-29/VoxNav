import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Auth persistence is deliberately off. A long-lived cloud token should not
// become an alternate route around the patient device's biometric session.
export const trustedDirectorySupabase = url && publishableKey
  ? createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

function clientOrThrow() {
  if (!trustedDirectorySupabase) throw new Error('Cloud backup is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  return trustedDirectorySupabase;
}

export async function getSession() {
  const { data, error } = await clientOrThrow().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const { data, error } = await clientOrThrow().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data.session;
}

export async function signUp(email, password) {
  const { data, error } = await clientOrThrow().auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const { error } = await clientOrThrow().auth.signOut();
  if (error) throw error;
}

// Clear only this process's in-memory token on app lock. Patient pairing keeps
// its anonymous-device session in SecureStore and restores it only after the
// patient has passed the device biometric again.
export async function clearInMemorySession() {
  const { error } = await clientOrThrow().auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export async function restoreSession(session) {
  const { data, error } = await clientOrThrow().auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;
  return data.session;
}

export async function signInPatientAnonymously() {
  const { data, error } = await clientOrThrow().auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}

export async function readVault(userId) {
  const { data, error } = await clientOrThrow().from('trusted_directory_vaults')
    .select('ciphertext, iv, key_envelope, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ciphertext: data.ciphertext, iv: data.iv, envelope: JSON.stringify(data.key_envelope), updatedAt: data.updated_at } : null;
}

export async function writeVault(userId, encrypted, envelope) {
  const { error } = await clientOrThrow().from('trusted_directory_vaults').upsert({
    user_id: userId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    key_envelope: JSON.parse(envelope),
    format_version: 1,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
