import { useEffect, useState } from 'react';
import { useApp } from '../state';
import type { Audit, CycleMeta, Review } from '../lib/types';
import { addDays } from '../lib/cycle';

interface Row {
  id: string;
  meta: CycleMeta;
  reviews: Review[];
  audit: Audit | null;
}

const COMPARE: { label: string; get: (a: Audit) => string }[] = [
  { label: 'Financially', get: (a) => a.whereAmI.financial },
  { label: 'Every day', get: (a) => a.whereAmI.daily },
  { label: 'Pretending', get: (a) => a.whereAmI.pretending },
  { label: 'Putting off', get: (a) => a.whereAmI.puttingOff },
  { label: 'Patterns', get: (a) => a.whatHappened.patterns }
];

export function History() {
  const { repo } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const cycles = (await repo.cycles()).sort((a, b) => b.meta.number - a.meta.number);
      setRows(
        await Promise.all(
          cycles.map(async (c) => ({ ...c, reviews: await repo.reviews(c.id), audit: await repo.getAudit(c.id) }))
        )
      );
    })();
  }, [repo]);

  if (!rows) return <p className="quiet">Decrypting…</p>;

  return (
    <>
      <h1>History</h1>
      {rows.map((c, idx) => {
        const prev = rows[idx + 1];
        const avg =
          c.reviews.length > 0 ? c.reviews.reduce((s, r) => s + r.scores.consistency, 0) / c.reviews.length : null;
        return (
          <div className="card" key={c.id}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Cycle {c.meta.number}</h3>
              <span className="pill">{c.meta.status}</span>
            </div>
            <p className="quiet small">
              {c.meta.startDate} to {addDays(c.meta.startDate, 89)}
              {avg !== null && ` · average consistency ${Math.round(avg * 100)}%`}
            </p>
            {c.reviews.map((r) => (
              <div className="row between small" key={r.index}>
                <span>Day {r.day}</span>
                <span>{Math.round(r.scores.consistency * 100)}%</span>
                <span className="quiet">{r.saakshi?.verdict ?? 'no verdict'}</span>
              </div>
            ))}
            {prev?.audit && c.audit && (
              <details style={{ marginTop: 12 }}>
                <summary className="accent">Then and now: cycle {prev.meta.number} vs {c.meta.number}</summary>
                {COMPARE.map((f) => (
                  <div key={f.label} style={{ marginTop: 8 }}>
                    <p className="quiet small">{f.label}</p>
                    <blockquote>{f.get(prev.audit!) || '(blank)'}</blockquote>
                    <p>{f.get(c.audit!) || '(blank)'}</p>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}
