import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { Repo } from '../lib/repo';
import type { UserMeta } from '../lib/types';
import { addDays, todayISO } from '../lib/cycle';

export function Onboarding({ user, repo, meta, onDone }: { user: User; repo: Repo; meta: UserMeta | null; onDone: () => void }) {
  const tz = meta?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const [start, setStart] = useState(todayISO(tz));
  const [time, setTime] = useState(meta?.reminderTime || '21:00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function begin() {
    setBusy(true);
    setErr('');
    try {
      await repo.setMeta({
        timezone: tz,
        reminderTime: time,
        channels: meta?.channels ?? { push: false, email: true },
        email: meta?.email ?? user.email ?? undefined,
        createdAt: meta?.createdAt ?? Date.now()
      });
      const cycles = await repo.cycles();
      const prev = cycles.sort((a, b) => b.meta.number - a.meta.number)[0];
      await repo.createCycle({ number: (prev?.meta.number ?? 0) + 1, startDate: start, status: 'active', prevCycleId: prev?.id });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <h1>Start a 90-day cycle</h1>
      <p className="quiet">
        Day 1 is the audit. Days 1 to 30 cut out what drags you down, 31 to 60 build consistency, 61 to 90 expand.
        Saakshi reviews you every 15 days.
      </p>
      <label>Day 1</label>
      <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      <p className="quiet small">Ends on {addDays(start, 89)}</p>
      <label>Daily reminder time ({tz})</label>
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      {err && <p className="error">{err}</p>}
      <button className="primary block" style={{ marginTop: 16 }} disabled={busy} onClick={begin}>
        Begin with the audit
      </button>
    </div>
  );
}
