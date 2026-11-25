import { useEffect, useState } from 'react';
import { useApp, uid } from '../state';
import type { Commitment, Goal, GoalArea, Phase } from '../lib/types';
import { addDays, phaseForDay } from '../lib/cycle';
import { activeOn } from '../lib/scores';
import { checkGoals, type GoalVerdict } from '../lib/goalGate';

const PHASE_INFO = {
  1: { name: 'Month 1: Cut out and clean up', goal: "Remove what's dragging you down", max: 2, hint: 'A stop list and one small daily habit, like waking at the same time or finishing one task a day.' },
  2: { name: 'Month 2: Building', goal: 'Build consistency. Become someone you can trust.', max: 3, hint: 'A morning and night routine and exactly 3 non-negotiable daily commitments.' },
  3: { name: 'Month 3: Expansion', goal: 'Real growth. Raise your standard of living.', max: 5, hint: 'Measurable goals for money, productivity and personal growth, and harder commitments.' }
} as const;

const blank = (n: 1 | 2 | 3): Phase => ({
  phase: n,
  goal: PHASE_INFO[n].goal,
  stopList: [],
  routine: { morning: '', night: '' },
  commitments: [],
  goals: []
});

export function Plan() {
  const { repo, cycleId, day, meta, go } = useApp();
  const current = phaseForDay(Math.min(Math.max(day, 1), 90));
  const [n, setN] = useState<1 | 2 | 3>(current);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [exists, setExists] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [gate, setGate] = useState<GoalVerdict[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPhase(null);
    setGate(null);
    (async () => {
      const p = await repo.getPhase(cycleId, n);
      setExists(!!p);
      if (p) return setPhase(p);
      // Carry commitments forward from the previous month so nothing silently disappears.
      const prev = n > 1 ? await repo.getPhase(cycleId, n - 1) : null;
      const startDay = (n - 1) * 30 + 1;
      const carried: Commitment[] = (prev?.commitments ?? [])
        .filter((c) => activeOn(c, startDay - 1))
        .map((c) => ({ ...c, id: uid(), createdDay: startDay, retiredDay: undefined, initialLevel: c.level }));
      setPhase({ ...blank(n), commitments: carried, routine: prev?.routine ?? { morning: '', night: '' } });
    })();
  }, [repo, cycleId, n]);

  if (!phase) return <p className="quiet">Decrypting…</p>;
  const ph: Phase = phase;
  const info = PHASE_INFO[n];
  const startDay = (n - 1) * 30 + 1;
  const editDay = Math.max(day, startDay);
  const active = phase.commitments.filter((c) => activeOn(c, editDay));
  const readOnly = n < current;

  const update = (p: Partial<Phase>) => setPhase({ ...ph, ...p });
  const updateC = (id: string, p: Partial<Commitment>) =>
    update({ commitments: ph.commitments.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const updateG = (id: string, p: Partial<Goal>) => update({ goals: ph.goals.map((g) => (g.id === id ? { ...g, ...p } : g)) });

  async function save() {
    setErr('');
    setMsg('');
    if (n === 2 && active.length !== 3) return setErr('Month 2 needs exactly 3 non-negotiable commitments.');
    if (active.length === 0) return setErr('Add at least one daily commitment.');
    if (active.some((c) => !c.text.trim())) return setErr('Every commitment needs words.');
    if (n === 3) {
      setBusy(true);
      try {
        const verdicts = await checkGoals(ph.goals, { cycleStart: meta.cycleStart! });
        setGate(verdicts);
        if (ph.goals.length === 0 || verdicts.some((v) => !v.ok)) {
          setBusy(false);
          return setErr(ph.goals.length === 0 ? 'Month 3 needs at least one measurable goal.' : 'Saakshi rejected at least one goal. Fix it and save again.');
        }
      } catch (e) {
        setBusy(false);
        return setErr((e as Error).message);
      }
      setBusy(false);
    }
    await repo.savePhase(cycleId, ph);
    setExists(true);
    setMsg('Saved and encrypted');
  }

  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        {([1, 2, 3] as const).map((k) => (
          <button key={k} className={k === n ? 'primary' : ''} onClick={() => setN(k)}>
            Month {k}
          </button>
        ))}
      </div>
      <h1 style={{ marginTop: 16 }}>{info.name}</h1>
      <p className="accent">{phase.goal}</p>
      <p className="quiet small">
        Days {startDay} to {startDay + 29}. {info.hint}
      </p>
      {readOnly && <p className="quiet small">This month is over. It is shown as it was.</p>}

      <h2>Stop doing</h2>
      <p className="quiet small">One per line. Excessive social media, people who drain you, bad habits.</p>
      <textarea
        disabled={readOnly}
        value={phase.stopList.join('\n')}
        onChange={(e) => update({ stopList: e.target.value.split('\n') })}
      />

      {n >= 2 && (
        <>
          <h2>Routine</h2>
          <label>Morning</label>
          <input disabled={readOnly} value={phase.routine.morning} onChange={(e) => update({ routine: { ...phase.routine, morning: e.target.value } })} />
          <label>Night</label>
          <input disabled={readOnly} value={phase.routine.night} onChange={(e) => update({ routine: { ...phase.routine, night: e.target.value } })} />
        </>
      )}

      <h2>Daily commitments</h2>
      <p className="quiet small">
        {active.length} of {info.max}. Lowering a commitment or dropping it counts as drift, and Saakshi will see it.
      </p>
      {active.map((c) => (
        <div className="card" key={c.id}>
          <input disabled={readOnly} value={c.text} placeholder="e.g. Up at 6:00" onChange={(e) => updateC(c.id, { text: e.target.value })} />
          <div className="row between" style={{ marginTop: 8 }}>
            <span className="quiet small">Difficulty</span>
            <div className="toggle">
              {[1, 2, 3].map((l) => (
                <button key={l} disabled={readOnly} className={c.level === l ? 'primary' : ''} onClick={() => updateC(c.id, { level: l })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {!readOnly && (
            <button
              className="link small"
              style={{ marginTop: 8 }}
              onClick={() =>
                exists && c.createdDay < editDay
                  ? updateC(c.id, { retiredDay: editDay })
                  : update({ commitments: phase.commitments.filter((x) => x.id !== c.id) })
              }
            >
              Drop this commitment
            </button>
          )}
        </div>
      ))}
      {!readOnly && active.length < info.max && (
        <button
          className="block"
          onClick={() =>
            update({
              commitments: [
                ...phase.commitments,
                { id: uid(), text: '', createdDay: exists ? editDay : startDay, level: 2, initialLevel: 2 }
              ]
            })
          }
        >
          Add commitment
        </button>
      )}

      {n === 3 && (
        <>
          <h2>Measurable goals</h2>
          <p className="quiet small">
            Each goal needs a weekly number, where you are now, where you will be, and by when. Saakshi rejects anything
            vague.
          </p>
          {phase.goals.map((g) => {
            const v = gate?.find((x) => x.id === g.id);
            return (
              <div className={`card ${v && !v.ok ? 'accent-border' : ''}`} key={g.id}>
                <select disabled={readOnly} value={g.area} onChange={(e) => updateG(g.id, { area: e.target.value as GoalArea })}>
                  <option value="money">Money</option>
                  <option value="productivity">Productivity</option>
                  <option value="growth">Personal growth</option>
                </select>
                <label>Goal</label>
                <input disabled={readOnly} value={g.title} placeholder="Close 2 new consulting clients" onChange={(e) => updateG(g.id, { title: e.target.value })} />
                <label>Weekly number you will log</label>
                <input disabled={readOnly} value={g.metric} placeholder="signed clients (total)" onChange={(e) => updateG(g.id, { metric: e.target.value })} />
                <div className="row">
                  <div className="grow">
                    <label>Now</label>
                    <input disabled={readOnly} type="number" value={g.baseline} onChange={(e) => updateG(g.id, { baseline: Number(e.target.value) })} />
                  </div>
                  <div className="grow">
                    <label>Target</label>
                    <input disabled={readOnly} type="number" value={g.target} onChange={(e) => updateG(g.id, { target: Number(e.target.value) })} />
                  </div>
                </div>
                <label>Deadline</label>
                <input disabled={readOnly} type="date" value={g.deadline} onChange={(e) => updateG(g.id, { deadline: e.target.value })} />
                {v && <p className={v.ok ? 'ok' : 'error'}>{v.reason}</p>}
              </div>
            );
          })}
          {!readOnly && (
            <button
              className="block"
              onClick={() =>
                update({
                  goals: [
                    ...phase.goals,
                    { id: uid(), area: 'money', title: '', metric: '', baseline: 0, target: 0, deadline: addDays(meta.cycleStart!, 89) }
                  ]
                })
              }
            >
              Add goal
            </button>
          )}
        </>
      )}

      {!readOnly && (
        <>
          {err && <p className="error">{err}</p>}
          {msg && <p className="ok">{msg}</p>}
          <button className="primary block" style={{ marginTop: 16 }} disabled={busy} onClick={save}>
            {busy ? 'Saakshi is checking your goals…' : 'Save plan'}
          </button>
          {msg && (
            <button className="block" style={{ marginTop: 8 }} onClick={() => go('today')}>
              Go to today
            </button>
          )}
        </>
      )}
    </>
  );
}
