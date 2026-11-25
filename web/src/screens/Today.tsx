import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import type { Checkin, MetricLog, Phase } from '../lib/types';
import { CYCLE_DAYS, addDays, canEditCheckin, dayOfCycle, dueReview, phaseForDay, weekStart } from '../lib/cycle';
import { activeOn } from '../lib/scores';

const PHASE_NAME = { 1: 'Cut out', 2: 'Building', 3: 'Expansion' } as const;

export function Today() {
  const { repo, cycleId, today, day, meta, go } = useApp();
  const [date, setDate] = useState(today);
  const [phase, setPhase] = useState<Phase | null | undefined>(undefined);
  const [hasAudit, setHasAudit] = useState(true);
  const [ci, setCi] = useState<Checkin>({ date: today, results: {}, note: '' });
  const [metric, setMetric] = useState<MetricLog | null>(null);
  const [msg, setMsg] = useState('');

  const d = dayOfCycle(meta.cycleStart!, date);
  const n = phaseForDay(Math.min(Math.max(d, 1), CYCLE_DAYS));
  const due = dueReview(day, meta.reviewsDone ?? 0);
  const editable = canEditCheckin(date, new Date(), meta.timezone);

  useEffect(() => {
    setMsg('');
    (async () => {
      const [p, a, c] = await Promise.all([repo.getPhase(cycleId, n), repo.getAudit(cycleId), repo.getCheckin(cycleId, date)]);
      setPhase(p);
      setHasAudit(!!a);
      setCi(c ?? { date, results: {}, note: '' });
      if (n === 3) {
        const ws = weekStart(date);
        const all = await repo.metrics(cycleId);
        setMetric(all.find((m) => m.weekStart === ws) ?? { weekStart: ws, values: {} });
      } else setMetric(null);
    })();
  }, [repo, cycleId, date, n]);

  const active = useMemo(() => (phase?.commitments ?? []).filter((c) => activeOn(c, d)), [phase, d]);

  if (day > CYCLE_DAYS) {
    return (
      <>
        <h1>Cycle complete</h1>
        <p className="quiet">Day {day}. The 90 days are over. Finish any open review, then start the next cycle from Settings.</p>
        <button className="primary block" onClick={() => go('settings')}>
          Start the next cycle
        </button>
      </>
    );
  }
  if (day < 1) return <><h1>Starts {meta.cycleStart}</h1><p className="quiet">Use the time to write your audit.</p><button className="primary block" onClick={() => go('audit')}>Write the audit</button></>;

  async function save() {
    await repo.saveCheckin(cycleId, ci);
    if (metric) {
      const values = Object.fromEntries(Object.entries(metric.values).filter(([, v]) => Number.isFinite(v)));
      if (Object.keys(values).length) await repo.saveMetric(cycleId, { ...metric, values });
    }
    setMsg(Object.values(ci.results).every(Boolean) && active.length ? 'All kept. Saved.' : 'Saved. Saakshi will see it as it is.');
  }

  const markedAll = active.every((c) => ci.results[c.id] !== undefined);

  return (
    <>
      <p className="quiet small">
        Day {d} of {CYCLE_DAYS} · Month {n}, {PHASE_NAME[n]}
      </p>
      <div className="progress">
        <div style={{ width: `${(d / CYCLE_DAYS) * 100}%` }} />
      </div>
      <div className="row between">
        <h1>{date === today ? 'Today' : 'Yesterday'}</h1>
        <button className="link" onClick={() => setDate(date === today ? addDays(today, -1) : today)}>
          {date === today ? 'Yesterday' : 'Today'}
        </button>
      </div>

      {due && (
        <div className="banner">
          <b>Review {due.index} is due.</b> Saakshi has 15 days of evidence waiting.
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => go('review')}>Open review</button>
          </div>
        </div>
      )}
      {!hasAudit && (
        <div className="banner">
          <b>No audit yet.</b> Without it Saakshi cannot hold you to your own words.
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => go('audit')}>Write the audit</button>
          </div>
        </div>
      )}
      {phase === null && (
        <div className="banner">
          <b>Month {n} is not set up.</b>
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => go('plan')}>Set up Month {n}</button>
          </div>
        </div>
      )}

      {active.map((c) => {
        const v = ci.results[c.id];
        return (
          <div className="commit" key={c.id}>
            <div className="text">{c.text}</div>
            <div className="toggle">
              <button
                disabled={!editable}
                className={v === true ? 'on kept' : ''}
                onClick={() => setCi({ ...ci, results: { ...ci.results, [c.id]: true } })}
              >
                Kept
              </button>
              <button
                disabled={!editable}
                className={v === false ? 'on missed' : ''}
                onClick={() => setCi({ ...ci, results: { ...ci.results, [c.id]: false } })}
              >
                Missed
              </button>
            </div>
          </div>
        );
      })}

      {active.length > 0 && (
        <>
          <label>One line, optional. What happened?</label>
          <input disabled={!editable} value={ci.note} maxLength={280} onChange={(e) => setCi({ ...ci, note: e.target.value })} />
        </>
      )}

      {n === 3 && metric && phase && phase.goals.length > 0 && (
        <div className="card">
          <h3>This week's numbers</h3>
          <p className="quiet small">Log the latest value once a week. Trajectory is computed from these.</p>
          {phase.goals.map((g) => (
            <div key={g.id}>
              <label>
                {g.title} ({g.metric}), target {g.target}
              </label>
              <input
                type="number"
                disabled={!editable}
                value={Number.isFinite(metric.values[g.id]) ? metric.values[g.id] : ''}
                onChange={(e) =>
                  setMetric({ ...metric, values: { ...metric.values, [g.id]: e.target.value === '' ? NaN : Number(e.target.value) } })
                }
              />
            </div>
          ))}
        </div>
      )}

      {!editable && <p className="quiet small">Check-ins close after 48 hours so the record stays honest.</p>}
      {editable && active.length > 0 && (
        <button className="primary block" style={{ marginTop: 16 }} disabled={!markedAll} onClick={save}>
          {markedAll ? 'Save check-in' : 'Mark every commitment first'}
        </button>
      )}
      {msg && <p className="ok">{msg}</p>}
    </>
  );
}
