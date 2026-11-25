/**
 * Thin, stateless call to the Claude Messages API.
 * Content passes through memory only. Nothing here logs or stores it.
 */

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const VERDICTS = ['On track', 'Slipping', 'Lying to yourself', 'Paused'] as const;

export interface SaakshiOutput {
  verdict: (typeof VERDICTS)[number];
  headline: string;
  evidence: { claim: string; source: string }[];
  excuses: { date: string; quote: string }[];
  callOut: string;
  proof: string;
  oneChange: string;
  tip: string;
  raiseTheBar: string;
  question: string;
}

export async function callClaude(opts: {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: 0,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }]
    })
  });
  if (!res.ok) {
    // Status only. The body may echo input, so it is not logged or returned.
    throw new Error(`AI request failed with status ${res.status}`);
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  if (!text) throw new Error('AI returned no text');
  return text;
}

export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

const str = (v: unknown, max = 1200) => (typeof v === 'string' ? v.slice(0, max) : '');

export function normaliseSaakshi(raw: unknown): SaakshiOutput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const verdict = VERDICTS.includes(o.verdict as never) ? (o.verdict as SaakshiOutput['verdict']) : 'Slipping';
  const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T, max = 8): T[] =>
    Array.isArray(v) ? v.slice(0, max).map((x) => map((x ?? {}) as Record<string, unknown>)) : [];
  const out: SaakshiOutput = {
    verdict,
    headline: str(o.headline, 300),
    evidence: list(o.evidence, (x) => ({ claim: str(x.claim, 400), source: str(x.source, 200) })),
    excuses: list(o.excuses, (x) => ({ date: str(x.date, 10), quote: str(x.quote, 300) })),
    callOut: str(o.callOut),
    proof: str(o.proof),
    oneChange: str(o.oneChange, 400),
    tip: str(o.tip, 600),
    raiseTheBar: str(o.raiseTheBar, 400),
    question: str(o.question, 300)
  };
  if (!out.headline || !out.oneChange || !out.question) throw new Error('AI output was incomplete');
  return out;
}

export interface GoalVerdict {
  id: string;
  ok: boolean;
  reason: string;
}

export function normaliseGate(raw: unknown, ids: string[]): GoalVerdict[] {
  const arr = ((raw ?? {}) as { verdicts?: unknown }).verdicts;
  const got = Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
  return ids.map((id) => {
    const v = got.find((x) => x && x.id === id);
    return v
      ? { id, ok: v.ok === true, reason: str(v.reason, 300) || (v.ok ? 'Accepted.' : 'Rejected.') }
      : { id, ok: false, reason: 'Saakshi did not judge this goal. Try again.' };
  });
}
