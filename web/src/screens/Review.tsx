import { useEffect, useState } from 'react';
import { useApp } from '../state';
import type { Review, SaakshiOutput, Scores } from '../lib/types';
import { dueReview, phaseForDay, reviewWindow } from '../lib/cycle';
import { computeScores } from '../lib/scores';
import { askSaakshi } from '../lib/saakshi';

export function ReviewScreen() {
  const { repo, cycleId, day, meta, refresh } = useApp();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [rating, setRating] = useState(5);
  const [closer, setCloser] = useState('');
  const [weak, setWeak] = useState('');
  const [adjust, setAdjust] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = () => repo.reviews(cycleId).then(setReviews);
  useEffect(() => {
    load();
  }, [repo, cycleId]);

  if (!reviews) return <p className="quiet">Decrypting…</p>;
  const due = dueReview(day, reviews.length);

  async function runSaakshi(review: Review): Promise<SaakshiOutput> {
    const window = reviewWindow(meta.cycleStart!, review.day);
    const [audit, phases, checkins, metrics] = await Promise.all([
      repo.getAudit(cycleId),
      repo.phases(cycleId),
      repo.checkins(cycleId),
      repo.metrics(cycleId)
    ]);
    const phase = phases.find((p) => p.phase === phaseForDay(review.day)) ?? null;
    const previous = reviews!.filter((r) => r.index < review.index).pop() ?? null;
    return askSaakshi({
      day: review.day,
      scores: review.scores,
      audit,
      phase,
      checkins: window.map((d) => checkins[d] ?? { date: d, results: {}, note: '(no check-in)' }),
      metrics,
      self: { rating: review.rating, closer: review.closer, weak: review.weak, adjust: review.adjust },
      previous: previous ? { index: previous.index, saakshi: previous.saakshi, disputed: previous.disputed } : null
    });
  }

  async function submit() {
    if (!due) return;
    setErr('');
    setBusy('Computing your scores…');
    try {
      const window = reviewWindow(meta.cycleStart!, due.day);
      const [audit, phases, checkins, metrics] = await Promise.all([
        repo.getAudit(cycleId),
        repo.phases(cycleId),
        repo.checkins(cycleId),
        repo.metrics(cycleId)
      ]);
      const scores: Scores = computeScores({
        cycleStart: meta.cycleStart!,
        window,
        phases,
        checkins,
        metrics,
        audit,
        selfRating: rating,
        reviewDate: window[window.length - 1]
      });
      const review: Review = { index: due.index, day: due.day, rating, closer, weak, adjust, scores, createdAt: Date.now() };
      // Save first, so the answers are never lost if the relay is down.
      await repo.saveReview(cycleId, review);
      await repo.updateMeta({ reviewsDone: due.index });
      setBusy('Saakshi is reading the evidence…');
      try {
        review.saakshi = await runSaakshi(review);
        await repo.saveReview(cycleId, review);
      } catch (e) {
        setErr(`Saakshi could not be reached: ${(e as Error).message}. Your answers and scores are saved. Try again below.`);
      }
      setCloser('');
      setWeak('');
      setAdjust('');
      await refresh();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function retry(r: Review) {
    setBusy('Saakshi is reading the evidence…');
    setErr('');
    try {
      const updated = { ...r, saakshi: await runSaakshi(r) };
      await repo.saveReview(cycleId, updated);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function dispute(r: Review, text: string) {
    await repo.saveReview(cycleId, { ...r, disputed: text });
    await load();
  }

  return (
    <>
      <h1>Review</h1>
      {due ? (
        <div className="card accent-border stack">
          <h3>
            Review {due.index}, Day {due.day}
          </h3>
          <p className="quiet small">Answer for yourself first. Saakshi speaks after.</p>
          <label>Rate these 15 days, honestly: {rating}/10</label>
          <input type="range" min={1} max={10} value={rating} onChange={(e) => setRating(Number(e.target.value))} />
          <label>What did I do that brings me closer to the life I want?</label>
          <textarea value={closer} onChange={(e) => setCloser(e.target.value)} />
          <label>Where was I weak?</label>
          <textarea value={weak} onChange={(e) => setWeak(e.target.value)} />
          <label>What will I adjust?</label>
          <textarea value={adjust} onChange={(e) => setAdjust(e.target.value)} />
          {err && <p className="error">{err}</p>}
          <button className="primary block" disabled={!!busy || !closer || !weak || !adjust} onClick={submit}>
            {busy || 'Hand it to Saakshi'}
          </button>
        </div>
      ) : (
        <p className="quiet">
          Next review on Day {(reviews.length + 1) * 15}. {reviews.length >= 6 ? 'All six reviews are done for this cycle.' : ''}
        </p>
      )}
      {!due && err && <p className="error">{err}</p>}
      {[...reviews].reverse().map((r) => (
        <ReviewCard key={r.index} r={r} busy={!!busy} onRetry={() => retry(r)} onDispute={(t) => dispute(r, t)} />
      ))}
    </>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function verdictClass(v?: string) {
  if (v === 'On track') return 'on-track';
  if (v === 'Slipping') return 'slipping';
  if (v === 'Lying to yourself') return 'lying';
  return 'paused';
}

export function ScoreGrid({ s, rating }: { s: Scores; rating: number }) {
  return (
    <div className="scores">
      <div className="score"><b>{pct(s.consistency)}</b><span>Consistency ({s.kept}/{s.planned})</span></div>
      <div className="score"><b>{s.trajectory === null ? 'n/a' : s.trajectory.toFixed(2)}</b><span>Trajectory (1.0 = on pace)</span></div>
      <div className="score"><b>{s.honestyGap > 0 ? '+' : ''}{s.honestyGap.toFixed(2)}</b><span>Honesty gap (you said {rating}/10)</span></div>
      <div className="score"><b>{s.drift}</b><span>Drift</span></div>
      <div className="score"><b>{pct(s.repeatRate)}</b><span>Misses matching your old patterns</span></div>
      <div className="score"><b>{s.bestRun ? `${s.bestRun.days} days` : 'none'}</b><span>Best run</span></div>
    </div>
  );
}

function ReviewCard({ r, busy, onRetry, onDispute }: { r: Review; busy: boolean; onRetry: () => void; onDispute: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const s = r.saakshi;
  return (
    <div className="card">
      <div className="row between">
        <span className="pill">Review {r.index} · Day {r.day}</span>
        {s && <span className={`verdict ${verdictClass(s.verdict)}`} style={{ fontSize: 16 }}>{s.verdict}</span>}
      </div>
      {s ? (
        <>
          <p style={{ marginTop: 12, fontWeight: 600 }}>{s.headline}</p>
          <ScoreGrid s={r.scores} rating={r.rating} />
          {s.evidence.length > 0 && (
            <>
              <h3>Evidence</h3>
              <ul className="plain">
                {s.evidence.map((e, i) => (
                  <li key={i}>
                    {e.claim} <span className="quiet small">({e.source})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.excuses.length > 0 && (
            <>
              <h3>Excuses on record</h3>
              {s.excuses.map((e, i) => (
                <blockquote key={i}>
                  {e.date}: "{e.quote}"
                </blockquote>
              ))}
            </>
          )}
          <h3 className="accent">What you don't want to hear</h3>
          <p>{s.callOut}</p>
          <h3>Proof you can</h3>
          <p>{s.proof}</p>
          <div className="banner">
            <b>One change:</b> {s.oneChange}
            <p style={{ margin: '8px 0 0' }}>
              <b>Tip:</b> {s.tip}
            </p>
            {s.raiseTheBar && (
              <p style={{ margin: '8px 0 0' }}>
                <b>Raise the bar:</b> {s.raiseTheBar}
              </p>
            )}
          </div>
          <p className="quiet">
            <b>Sit with this:</b> {s.question}
          </p>
          {r.disputed ? (
            <p className="quiet small">You disputed this: "{r.disputed}". Saakshi will ask for evidence next time.</p>
          ) : open ? (
            <>
              <textarea placeholder="Evidence, not reasons." value={text} onChange={(e) => setText(e.target.value)} />
              <button disabled={!text} onClick={() => onDispute(text)}>
                Record dispute
              </button>
            </>
          ) : (
            <button className="link small" onClick={() => setOpen(true)}>
              I disagree
            </button>
          )}
        </>
      ) : (
        <>
          <ScoreGrid s={r.scores} rating={r.rating} />
          <button className="primary" disabled={busy} onClick={onRetry}>
            Ask Saakshi
          </button>
        </>
      )}
    </div>
  );
}
