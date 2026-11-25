import { useEffect, useState } from 'react';
import { useApp } from '../state';
import type { Audit } from '../lib/types';

type Q = { section: keyof Audit; key: string; q: string };

const STEPS: { title: string; tag: string; qs: Q[] }[] = [
  {
    title: '1. Where am I?',
    tag: 'The raw truth. No sugarcoating.',
    qs: [
      { section: 'whereAmI', key: 'financial', q: 'Your life today, financially. Numbers, not feelings.' },
      { section: 'whereAmI', key: 'emotional', q: 'Your life today, emotionally.' },
      { section: 'whereAmI', key: 'physical', q: 'Your life today, physically.' },
      { section: 'whereAmI', key: 'daily', q: 'What do you actually do every day?' },
      { section: 'whereAmI', key: 'pretending', q: 'What are you pretending to do?' },
      { section: 'whereAmI', key: 'puttingOff', q: 'What are you putting off?' }
    ]
  },
  {
    title: '2. Where should I be?',
    tag: 'The standard you know you should have.',
    qs: [
      { section: 'whereShouldIBe', key: 'earning', q: 'How much should you be earning? Give a number.' },
      { section: 'whereShouldIBe', key: 'routine', q: 'What should your routine look like?' },
      { section: 'whereShouldIBe', key: 'becoming', q: 'Who should you have become by now?' },
      { section: 'whereShouldIBe', key: 'discipline', q: 'What level of discipline do you know you should have?' }
    ]
  },
  {
    title: '3. What happened?',
    tag: 'Without blaming anyone.',
    qs: [
      { section: 'whatHappened', key: 'decisions', q: 'What decisions brought you here?' },
      { section: 'whatHappened', key: 'patterns', q: 'What patterns do you keep repeating?' },
      { section: 'whatHappened', key: 'sabotage', q: 'Where did you sabotage yourself?' },
      { section: 'whatHappened', key: 'weak', q: 'Where were you weak?' },
      { section: 'whatHappened', key: 'stopped', q: 'What did you stop doing?' }
    ]
  }
];

export const emptyAudit = (): Audit => ({
  whereAmI: { financial: '', emotional: '', physical: '', daily: '', pretending: '', puttingOff: '' },
  whereShouldIBe: { earning: '', routine: '', becoming: '', discipline: '' },
  whatHappened: { decisions: '', patterns: '', sabotage: '', weak: '', stopped: '' }
});

export function AuditWizard() {
  const { repo, cycleId, day, go } = useApp();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [locked, setLocked] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [i, setI] = useState(0);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    (async () => {
      const mine = await repo.getAudit(cycleId);
      if (mine) {
        setAudit(mine);
        setLocked(day > 1);
        return;
      }
      // New cycle: start from the previous cycle's answers.
      const cycles = await repo.cycles();
      const prevId = cycles.find((c) => c.id === cycleId)?.meta.prevCycleId;
      const prev = prevId ? await repo.getAudit(prevId) : null;
      setPrefilled(!!prev);
      setAudit(prev ?? emptyAudit());
    })();
  }, [repo, cycleId, day]);

  if (!audit) return <p className="quiet">Decrypting…</p>;

  const flat = STEPS.flatMap((s) => s.qs.map((q) => ({ ...q, step: s })));
  const cur = flat[i];
  const value = (audit[cur.section] as Record<string, string>)[cur.key];

  const set = (v: string) =>
    setAudit({ ...audit, [cur.section]: { ...(audit[cur.section] as Record<string, string>), [cur.key]: v } } as Audit);

  async function save(next?: number) {
    await repo.saveAudit(cycleId, audit!);
    setSaved('Saved and encrypted');
    if (next !== undefined) setI(next);
  }

  if (locked) {
    return (
      <>
        <h1>Your audit</h1>
        <p className="quiet">Locked after Day 1. You revise it in the next cycle, not this one.</p>
        {STEPS.map((s) => (
          <div className="card" key={s.title}>
            <h3 className="accent">{s.title}</h3>
            {s.qs.map((q) => (
              <div key={q.key}>
                <p className="quiet small">{q.q}</p>
                <p>{(audit[q.section] as Record<string, string>)[q.key] || '(blank)'}</p>
              </div>
            ))}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <p className="quiet small">
        Question {i + 1} of {flat.length}
      </p>
      <div className="progress">
        <div style={{ width: `${((i + 1) / flat.length) * 100}%` }} />
      </div>
      <h1>{cur.step.title}</h1>
      <p className="accent">{cur.step.tag}</p>
      {prefilled && <p className="quiet small">Pre-filled from your last cycle. Change what is no longer true.</p>}
      <div className="card">
        <label style={{ color: 'var(--ink)', fontSize: 17 }}>{cur.q}</label>
        <textarea value={value} onChange={(e) => set(e.target.value)} autoFocus />
      </div>
      {cur.step.title.startsWith('1') && i === 5 && (
        <p className="quiet small">This part hurts. It needs to, so you can see what you need to change.</p>
      )}
      <div className="row">
        <button disabled={i === 0} onClick={() => save(i - 1)}>
          Back
        </button>
        <div className="grow" />
        {i < flat.length - 1 ? (
          <button className="primary" onClick={() => save(i + 1)}>
            Next
          </button>
        ) : (
          <button
            className="primary"
            onClick={async () => {
              await save();
              go('plan');
            }}
          >
            Finish and set Month 1
          </button>
        )}
      </div>
      {saved && <p className="ok">{saved}</p>}
    </>
  );
}
