import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { addVaultRecord, loadEncryptedRecords, loadEnvelope, mergeEncryptedRecords, readVaultRecords, saveEnvelope } from './lib/localVault';
import { createVault, recoverVault, unlockVault } from './lib/vaultCrypto';
import { supabase, syncEncryptedRecords } from './lib/supabase';
import { publishVaultSnapshot } from './lib/extensionBridge';
import { biometricAvailable, biometricConfigured, enrollBiometric, removeBiometric, verifyBiometric } from './lib/biometricGate';
import './styles.css';

const actions = [
  { id: 'send-doc', label: 'Send document', description: 'Share a document with a recipient.', icon: '↗', tone: 'terracotta' },
  { id: 'delete-file', label: 'Delete file', description: 'Remove a file from this demo workspace.', icon: '⌫', tone: 'amber' },
  { id: 'cancel-appt', label: 'Cancel appointment', description: 'Cancel a scheduled appointment.', icon: '◷', tone: 'rose' },
  { id: 'transfer-money', label: 'Transfer $100', description: 'Send a sample transfer to Alice.', icon: '$', tone: 'sage' },
];

const recordTypes = [
  ['trusted_contact', 'Trusted contact'],
  ['reminder', 'Reminder'],
  ['action_note', 'Action note'],
];

function ActionCard({ action, isSelected, onSelect }) {
  return (
    <button id={action.id} className={`action-card ${action.tone} ${isSelected ? 'selected' : ''}`} type="button" onClick={() => onSelect(action)} aria-describedby={`${action.id}-description`}>
      <span className="card-icon" aria-hidden="true">{action.icon}</span>
      <span className="card-copy">
        <span className="card-title">{action.label}</span>
        <span className="card-description" id={`${action.id}-description`}>{action.description}</span>
      </span>
      <span className="card-arrow" aria-hidden="true">→</span>
    </button>
  );
}

function VaultAccess({ envelope, onUnlock, onCreate, biometricLocked, onBiometricUnlock }) {
  const [passphrase, setPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [mode, setMode] = useState('passphrase');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      if (!envelope) {
        await onCreate(passphrase);
      } else if (mode === 'recovery') {
        await onUnlock(await recoverVault(recoveryKey.trim(), envelope));
      } else {
        await onUnlock(await unlockVault(passphrase, envelope));
      }
    } catch (cause) {
      setError(cause.message || 'Could not unlock the vault.');
    }
  }

  if (biometricLocked) return <section className="vault-access" aria-labelledby="vault-heading"><p className="eyebrow">DEVICE BIOMETRIC CHECK</p><h2 id="vault-heading">Unlock with your device</h2><p>Your browser will ask the device to verify you. On supported Apple devices this can be Face ID; other devices may offer a fingerprint, Windows Hello, or a device PIN.</p><button className="primary-button" type="button" onClick={onBiometricUnlock}>Verify with device biometric</button></section>;

  return (
    <section className="vault-access" aria-labelledby="vault-heading">
      <p className="eyebrow">YOUR PRIVATE CONTEXT</p>
      <h2 id="vault-heading">{envelope ? 'Unlock your context vault' : 'Create your context vault'}</h2>
      <p>{envelope ? 'Your reminders are encrypted in this browser. Supabase can only store encrypted copies when you enable sync.' : 'Choose a vault passphrase. It stays on this device and is never sent to a server.'}</p>
      <form onSubmit={submit} className="vault-form">
        {envelope && <div className="mode-switch"><button type="button" className={mode === 'passphrase' ? 'active' : ''} onClick={() => setMode('passphrase')}>Passphrase</button><button type="button" className={mode === 'recovery' ? 'active' : ''} onClick={() => setMode('recovery')}>Recovery key</button></div>}
        {mode === 'recovery' ? <label>Recovery key<input required value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} autoComplete="off" /></label> : <label>Vault passphrase<input required minLength="12" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete={envelope ? 'current-password' : 'new-password'} /></label>}
        <button className="primary-button" type="submit">{envelope ? 'Unlock vault' : 'Create encrypted vault'}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

function VaultPanel({ vaultKey, onLockVault, setRecords, recoveryKey, setRecoveryKey, records, biometricEnabled, onSetBiometric, onRemoveBiometric }) {
  const [type, setType] = useState('reminder');
  const [appliesTo, setAppliesTo] = useState('all');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');

  async function addContext(event) {
    event.preventDefault();
    if (!text.trim()) return;
    const value = { type, appliesTo, text: text.trim(), createdAt: new Date().toISOString() };
    await addVaultRecord(vaultKey, value);
    const updated = await readVaultRecords(vaultKey);
    setRecords(updated);
    setText('');
    setStatus('Encrypted context item saved locally.');
  }

  function lockVault() {
    onLockVault();
    setStatus('Vault locked.');
  }

  async function copyRecoveryKey() {
    await navigator.clipboard.writeText(recoveryKey);
    setStatus('Recovery key copied. Store it somewhere safe; it will not be shown again after you leave this page.');
  }

  return (
    <section className="vault-panel" aria-labelledby="vault-heading">
      <div className="section-heading">
        <div><p className="eyebrow">ENCRYPTED ON THIS DEVICE</p><h2 id="vault-heading">My context vault</h2></div>
        <button className="text-button" type="button" onClick={lockVault}>Lock vault</button>
      </div>
      <div className="biometric-card"><div><strong>Device biometric unlock</strong><p>{biometricEnabled ? 'Enabled for this browser profile. It gates vault access before the passphrase step.' : 'Set up Face ID, Touch ID, Windows Hello, or another platform biometric when your browser supports it.'}</p></div>{biometricEnabled ? <button className="text-button" type="button" onClick={onRemoveBiometric}>Remove device biometric</button> : <button className="text-button" type="button" onClick={onSetBiometric}>Set up device biometric</button>}</div>
      {recoveryKey && <div className="recovery-card"><strong>Save your recovery key now.</strong><span>{recoveryKey}</span><button type="button" onClick={copyRecoveryKey}>Copy key</button><button type="button" className="text-button" onClick={() => setRecoveryKey('')}>I saved it</button></div>}
      <form className="context-form" onSubmit={addContext}>
        <label>Type<select value={type} onChange={(event) => setType(event.target.value)}>{recordTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Use before<select value={appliesTo} onChange={(event) => setAppliesTo(event.target.value)}><option value="all">Any supported action</option>{actions.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}</select></label>
        <label className="context-text">Private reminder or note<textarea required value={text} onChange={(event) => setText(event.target.value)} placeholder="Example: Alice's transfer is for the September invoice." maxLength="280" /></label>
        <button className="primary-button" type="submit">Add encrypted context</button>
      </form>
      <div className="vault-list" aria-live="polite">
        {records.length ? records.map(({ encrypted, value }) => <article key={encrypted.id}><span>{recordTypes.find(([key]) => key === value.type)?.[1] || 'Context'}</span><p>{value.text}</p><small>Applies before: {value.appliesTo === 'all' ? 'any supported action' : actions.find((action) => action.id === value.appliesTo)?.label}</small></article>) : <p className="empty-state">No context saved yet. Add a reminder or trusted-contact note above.</p>}
      </div>
      {status && <p className="inline-status" role="status">{status}</p>}
    </section>
  );
}

function CloudSync({ vaultKey, setRecords }) {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(supabase ? 'Sign in to sync ciphertext only.' : 'Cloud sync is not configured on this demo.');

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(event) {
    event.preventDefault();
    setStatus('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setStatus(error ? error.message : 'Signed in. Your vault remains encrypted locally.');
  }

  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    setStatus(error ? error.message : 'Check your email to confirm the account.');
  }

  async function sync() {
    try {
      setStatus('Syncing encrypted records…');
      const remote = await syncEncryptedRecords(session.user.id, loadEncryptedRecords());
      mergeEncryptedRecords(remote);
      setRecords(await readVaultRecords(vaultKey));
      setStatus('Encrypted records synced. Supabase received no reminder text.');
    } catch (cause) {
      setStatus(cause.message || 'Sync failed.');
    }
  }

  if (!supabase) return <section className="sync-panel"><p className="eyebrow">OPTIONAL CLOUD SYNC</p><h2>Encrypted sync is ready to configure</h2><p>{status} Copy `.env.example` to `.env.local`, add your Supabase URL and anon key, then apply the included migration.</p></section>;
  if (!session) return <section className="sync-panel"><p className="eyebrow">OPTIONAL CLOUD SYNC</p><h2>Sync encrypted copies across devices</h2><form onSubmit={signIn} className="sync-form"><label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Account password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary-button" type="submit">Sign in</button><button className="text-button" type="button" onClick={signUp}>Create account</button></form><p className="inline-status" role="status">{status}</p></section>;
  return <section className="sync-panel"><p className="eyebrow">OPTIONAL CLOUD SYNC</p><h2>Cloud account connected</h2><p>{session.user.email}. Your vault passphrase and reminder text never leave this device.</p><button className="primary-button" type="button" onClick={sync}>Sync encrypted records</button><button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button><p className="inline-status" role="status">{status}</p></section>;
}

function App() {
  const [selectedAction, setSelectedAction] = useState(null);
  const [envelope, setEnvelope] = useState(loadEnvelope);
  const [vaultKey, setVaultKey] = useState(null);
  const [records, setRecords] = useState([]);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [biometricEnabled, setBiometricEnabled] = useState(biometricConfigured);
  const [biometricVerified, setBiometricVerified] = useState(!biometricConfigured());
  const [biometricError, setBiometricError] = useState('');

  async function unlock(key) {
    setVaultKey(key);
    setRecords(await readVaultRecords(key));
  }

  async function create(passphrase) {
    const vault = await createVault(passphrase);
    saveEnvelope(vault.envelope);
    setEnvelope(vault.envelope);
    setRecoveryKey(vault.recoveryKey);
    await unlock(vault.vaultKey);
  }

  async function setUpBiometric() {
    try {
      setBiometricError('');
      await enrollBiometric();
      setBiometricEnabled(true);
      setBiometricVerified(true);
    } catch (cause) { setBiometricError(cause.message || 'Could not set up device biometrics.'); }
  }

  async function unlockWithBiometric() {
    try {
      setBiometricError('');
      await verifyBiometric();
      setBiometricVerified(true);
    } catch (cause) { setBiometricError(cause.message || 'Device verification was not completed.'); }
  }

  function disableBiometric() {
    removeBiometric();
    setBiometricEnabled(false);
    setBiometricVerified(true);
  }

  function lockVault() {
    setVaultKey(null);
    setRecords([]);
    if (biometricEnabled) setBiometricVerified(false);
  }

  const relevantRecords = useMemo(() => selectedAction ? records.filter(({ value }) => value.appliesTo === 'all' || value.appliesTo === selectedAction.id) : [], [records, selectedAction]);

  useEffect(() => {
    publishVaultSnapshot(vaultKey ? records : []);
  }, [vaultKey, records]);

  useEffect(() => {
    const respondToExtension = (event) => {
      if (event.source !== window || event.data?.source !== 'cbc-extension' || event.data?.type !== 'requestVaultContext') return;
      publishVaultSnapshot(vaultKey ? records : []);
    };
    window.addEventListener('message', respondToExtension);
    return () => window.removeEventListener('message', respondToExtension);
  }, [vaultKey, records]);

  return (
    <div className="app-shell"><main className="dashboard">
      <header className="hero"><div className="brand-row"><div className="brand-mark" aria-hidden="true">C</div><span className="brand-name">Context Before Consequence</span><span className="demo-badge">Privacy-first demo</span></div><p className="eyebrow">DECISION SUPPORT, NOT AUTOMATION</p><h1>A moment of context before an important action.</h1><p className="intro">The extension can show a small reminder before an action. Your context stays encrypted, and the choice is always yours.</p></header>
      <section className="actions-panel" aria-labelledby="actions-heading"><div className="section-heading"><div><p className="eyebrow">TRY THE DEMO</p><h2 id="actions-heading">What would you like to do?</h2></div><span className="extension-note"><span aria-hidden="true">●</span> Extension checks context</span></div><div className="actions-grid">{actions.map((action) => <ActionCard action={action} isSelected={selectedAction?.id === action.id} key={action.id} onSelect={setSelectedAction} />)}</div></section>
      <aside className="activity-panel" aria-label="Local context match"><span className="activity-icon" aria-hidden="true">✦</span><div><strong>Local context match</strong><p id="demo-status" role="status">{selectedAction ? `${relevantRecords.length} encrypted item${relevantRecords.length === 1 ? '' : 's'} match ${selectedAction.label}. The browser extension remains in control of its own demo flow.` : 'Choose an action to see which unlocked vault items match locally.'}</p></div></aside>
      {biometricError && <p className="form-error" role="alert">{biometricError}</p>}
      {vaultKey ? <><VaultPanel vaultKey={vaultKey} onLockVault={lockVault} setRecords={setRecords} recoveryKey={recoveryKey} setRecoveryKey={setRecoveryKey} records={records} biometricEnabled={biometricEnabled} onSetBiometric={setUpBiometric} onRemoveBiometric={disableBiometric} /><CloudSync vaultKey={vaultKey} setRecords={setRecords} /></> : <VaultAccess envelope={envelope} onUnlock={unlock} onCreate={create} biometricLocked={biometricEnabled && !biometricVerified} onBiometricUnlock={unlockWithBiometric} />}
      <footer>All data in this experience is fictional unless you add it yourself. Added context is encrypted in this browser before optional sync.</footer>
    </main></div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
