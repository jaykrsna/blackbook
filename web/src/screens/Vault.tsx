import { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  createVault,
  rewrapPassphrase,
  unlockWithPassphrase,
  unlockWithRecovery,
  type VaultDoc
} from '../lib/crypto';
import { saveVault } from '../lib/repo';
import { rememberKey } from '../lib/keystore';
import { signOut } from '../lib/firebase';

export function VaultSetup({ user, onReady }: { user: User; onReady: (dek: CryptoKey) => void }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState<{ doc: VaultDoc; dek: CryptoKey; recoveryKey: string } | null>(null);
  const [check, setCheck] = useState('');
  const [remember, setRemember] = useState(true);

  async function create() {
    setErr('');
    if (pass !== confirm) return setErr('The two passphrases do not match.');
    setBusy(true);
    try {
      setMade(await createVault(pass));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!made) return;
    const lastGroup = made.recoveryKey.split('-').pop()!;
    if (check.trim().toUpperCase() !== lastGroup) return setErr('That does not match the last group of your recovery key.');
    setBusy(true);
    await saveVault(user.uid, made.doc);
    if (remember) await rememberKey(user.uid, made.dek);
    onReady(made.dek);
  }

  if (made) {
    return (
      <div className="center">
        <h1>Your recovery key</h1>
        <p className="quiet">
          Write this down on paper and keep it somewhere safe. It is the only way back in if you forget your passphrase.
          Nobody can reset it for you, because nobody else can read your data.
        </p>
        <div className="recovery">{made.recoveryKey}</div>
        <label>Type the last group to confirm you saved it</label>
        <input value={check} onChange={(e) => setCheck(e.target.value)} autoCapitalize="characters" />
        <label className="row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Keep this device unlocked</span>
        </label>
        {err && <p className="error">{err}</p>}
        <button className="primary block" disabled={busy} onClick={finish}>
          I have saved it
        </button>
      </div>
    );
  }

  return (
    <div className="center">
      <h1>Set your passphrase</h1>
      <p className="quiet">
        Your notebook is encrypted on this device before it is saved. The passphrase never leaves your phone. Use at
        least 12 characters, a short sentence works well.
      </p>
      <label>Passphrase</label>
      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
      <label>Again</label>
      <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      {err && <p className="error">{err}</p>}
      <button className="primary block" style={{ marginTop: 16 }} disabled={busy || pass.length < 12} onClick={create}>
        {busy ? 'Creating your key…' : 'Create my encrypted notebook'}
      </button>
      <button className="link" style={{ marginTop: 16 }} onClick={signOut}>
        Use another account
      </button>
    </div>
  );
}

export function Unlock({ user, vault, onReady }: { user: User; vault: VaultDoc; onReady: (dek: CryptoKey) => void }) {
  const [mode, setMode] = useState<'pass' | 'recovery'>('pass');
  const [secret, setSecret] = useState('');
  const [newPass, setNewPass] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function unlock() {
    setErr('');
    setBusy(true);
    try {
      let dek: CryptoKey;
      if (mode === 'pass') {
        dek = await unlockWithPassphrase(vault, secret);
      } else {
        dek = await unlockWithRecovery(vault, secret);
        if (newPass) await saveVault(user.uid, await rewrapPassphrase(vault, { recoveryKey: secret }, newPass));
      }
      if (remember) await rememberKey(user.uid, dek);
      onReady(dek);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <h1>Unlock</h1>
      <p className="quiet">{user.email}</p>
      {mode === 'pass' ? (
        <>
          <label>Passphrase</label>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="current-password" />
        </>
      ) : (
        <>
          <label>Recovery key</label>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} autoCapitalize="characters" />
          <label>New passphrase (optional, at least 12 characters)</label>
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
        </>
      )}
      <label className="row">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Keep this device unlocked</span>
      </label>
      {err && <p className="error">{err}</p>}
      <button className="primary block" disabled={busy || !secret} onClick={unlock}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <button className="link" style={{ marginTop: 16 }} onClick={() => setMode(mode === 'pass' ? 'recovery' : 'pass')}>
        {mode === 'pass' ? 'Forgot passphrase? Use the recovery key' : 'Use my passphrase'}
      </button>
    </div>
  );
}
