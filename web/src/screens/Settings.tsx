import { useState } from 'react';
import { useApp } from '../state';
import { signOut, auth } from '../lib/firebase';
import { enablePush, isIOS, isInstalled } from '../lib/push';
import { loadVault, saveVault } from '../lib/repo';
import { rewrapPassphrase } from '../lib/crypto';
import { forgetKey } from '../lib/keystore';
import { CYCLE_DAYS } from '../lib/cycle';
import { toMarkdown } from '../lib/exportMd';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings() {
  const { repo, meta, refresh, lock, day, cycleId, today, go } = useApp();
  const [time, setTime] = useState(meta.reminderTime);
  const [email, setEmail] = useState(meta.email ?? '');
  const [emailOn, setEmailOn] = useState(meta.channels?.email ?? true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');

  const say = (m: string) => {
    setErr('');
    setMsg(m);
  };
  const fail = (e: unknown) => {
    setMsg('');
    setErr((e as Error).message);
  };

  async function saveReminders() {
    try {
      await repo.updateMeta({ reminderTime: time, email: email || undefined, channels: { push: meta.channels?.push ?? false, email: emailOn } });
      await refresh();
      say('Reminders saved.');
    } catch (e) {
      fail(e);
    }
  }

  async function turnOnPush() {
    try {
      const token = await enablePush();
      const tokens = Array.from(new Set([...(meta.pushTokens ?? []), token])).slice(-5);
      await repo.updateMeta({ pushTokens: tokens, channels: { push: true, email: emailOn } });
      await refresh();
      say('Push reminders are on for this device.');
    } catch (e) {
      fail(e);
    }
  }

  async function changePassphrase() {
    try {
      const vault = await loadVault(repo.uid);
      if (!vault) throw new Error('Vault not found');
      await saveVault(repo.uid, await rewrapPassphrase(vault, { passphrase: oldPass }, newPass));
      setOldPass('');
      setNewPass('');
      say('Passphrase changed. Your recovery key still works.');
    } catch (e) {
      fail(e);
    }
  }

  async function nextCycle() {
    try {
      const cycles = await repo.cycles();
      const cur = cycles.find((c) => c.id === cycleId)!;
      await repo.closeCycle(cycleId, cur.meta);
      await repo.createCycle({ number: cur.meta.number + 1, startDate: today, status: 'active', prevCycleId: cycleId });
      await refresh();
      go('audit');
    } catch (e) {
      fail(e);
    }
  }

  async function exportJson() {
    download(`black-notebook-${today}.json`, JSON.stringify(await repo.exportAll(), null, 2), 'application/json');
  }
  async function exportMd() {
    download(`black-notebook-${today}.md`, toMarkdown(await repo.exportAll()), 'text/markdown');
  }

  async function deleteAll() {
    try {
      await repo.deleteEverything();
      await forgetKey(repo.uid);
      await auth.currentUser?.delete().catch(() => undefined);
      await signOut();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <h1>Settings</h1>
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">{err}</p>}

      {day > CYCLE_DAYS && (
        <div className="card accent-border">
          <h3>Start the next cycle</h3>
          <p className="quiet small">Day 91 starts from your last answers. You only change what is no longer true.</p>
          <button className="primary block" onClick={nextCycle}>
            Start the next 90 days today
          </button>
        </div>
      )}

      <div className="card">
        <h3>Reminders</h3>
        <p className="quiet small">
          One nudge a day, skipped once you have checked in. Reminders never contain anything you wrote.
        </p>
        <label>Time ({meta.timezone})</label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <label className="row">
          <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
          <span>Email reminders</span>
        </label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <button className="block" style={{ marginTop: 10 }} onClick={saveReminders}>
          Save reminders
        </button>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />
        <p className="small">
          Push on this device: <b>{meta.channels?.push ? 'on' : 'off'}</b>
        </p>
        {isIOS() && !isInstalled() && (
          <p className="quiet small">On iPhone, tap Share, then Add to Home Screen, then open the app from there to allow push.</p>
        )}
        <button className="block" onClick={turnOnPush}>
          Turn on push for this device
        </button>
      </div>

      <div className="card">
        <h3>Your data</h3>
        <p className="quiet small">Exports are decrypted on this device. Keep the files somewhere private.</p>
        <div className="row">
          <button className="grow" onClick={exportJson}>Export JSON</button>
          <button className="grow" onClick={exportMd}>Export Markdown</button>
        </div>
      </div>

      <div className="card">
        <h3>Security</h3>
        <label>Current passphrase</label>
        <input type="password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} autoComplete="current-password" />
        <label>New passphrase</label>
        <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
        <button className="block" style={{ marginTop: 10 }} disabled={!oldPass || newPass.length < 12} onClick={changePassphrase}>
          Change passphrase
        </button>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="grow" onClick={lock}>Lock now</button>
          <button className="grow" onClick={() => forgetKey(repo.uid).then(signOut)}>Sign out</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ color: 'var(--bad)' }}>Delete everything</h3>
        <p className="quiet small">Deletes every cycle, your encryption key and your account. This cannot be undone.</p>
        <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder="Type DELETE" />
        <button className="danger block" style={{ marginTop: 10 }} disabled={confirmDelete !== 'DELETE'} onClick={deleteAll}>
          Delete my notebook
        </button>
      </div>
    </>
  );
}
