/**
 * Pure reminder planning. Works only from plaintext metadata: timezone,
 * reminder time, cycle start date, last check-in date, reviews done and
 * which phase documents exist. It never needs, and cannot read, content.
 */

export interface UserMeta {
  timezone?: string;
  reminderTime?: string;
  channels?: { push?: boolean; email?: boolean };
  email?: string;
  pushTokens?: string[];
  activeCycleId?: string;
  cycleStart?: string;
  lastCheckin?: string;
  reviewsDone?: number;
  lastSent?: Record<string, string>;
}

export type Kind = 'daily' | 'missed' | 'review' | 'phase' | 'complete';

export interface Reminder {
  kind: Kind;
  title: string;
  body: string;
  url: string;
  channels: ('push' | 'email')[];
}

const DAY_MS = 86_400_000;
const toUTC = (iso: string) => Date.parse(iso + 'T00:00:00Z');
export const addDays = (iso: string, n: number) => new Date(toUTC(iso) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);

export function localNow(tz: string, now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** True if the local time falls in [target, target + window). */
const inWindow = (minutes: number, target: number, window: number) => minutes >= target && minutes < target + window;

export function planReminders(
  u: UserMeta,
  now: Date,
  phaseExists: (n: 2 | 3) => boolean,
  windowMinutes = 15
): Reminder[] {
  if (!u.cycleStart || !u.activeCycleId) return [];
  const tz = u.timezone || 'Asia/Kolkata';
  const { date: today, minutes } = localNow(tz, now);
  const day = daysBetween(u.cycleStart, today) + 1;
  if (day < 1) return [];
  const channels: ('push' | 'email')[] = [];
  if (u.channels?.push && (u.pushTokens?.length ?? 0) > 0) channels.push('push');
  if (u.channels?.email && u.email) channels.push('email');
  if (channels.length === 0) return [];

  const sent = u.lastSent ?? {};
  const notSentToday = (k: Kind) => sent[k] !== today;
  const remindAt = toMinutes(u.reminderTime || '21:00');
  const out: Reminder[] = [];
  const reviewsDone = u.reviewsDone ?? 0;
  const nextReviewDay = (reviewsDone + 1) * 15;

  if (day > 90) {
    if (day <= 97 && inWindow(minutes, remindAt, windowMinutes) && !sent.complete) {
      out.push({
        kind: 'complete',
        title: '90 days are done',
        body: 'Finish your last review, then start the next cycle from where you are now.',
        url: '/',
        channels
      });
    }
    return out;
  }

  // Review due: at the daily time, on or after the review day, until it is done.
  if (reviewsDone < 6 && day >= nextReviewDay && inWindow(minutes, remindAt, windowMinutes) && notSentToday('review')) {
    out.push({
      kind: 'review',
      title: `Review ${reviewsDone + 1} is due`,
      body: 'Saakshi has 15 days of evidence waiting. Answer for yourself first.',
      url: '/',
      channels
    });
  }

  // Daily nudge: skipped once today's check-in exists.
  if (u.lastCheckin !== today && inWindow(minutes, remindAt, windowMinutes) && notSentToday('daily') && out.length === 0) {
    out.push({ kind: 'daily', title: `Day ${day} of 90`, body: 'Two taps. Kept or missed.', url: '/', channels: channels.includes('push') ? ['push'] : channels });
  }

  // Missed two days: 10:00 local, push and email.
  const last = u.lastCheckin;
  const missedTwo = day >= 3 && (!last || daysBetween(last, today) >= 3);
  if (missedTwo && inWindow(minutes, 10 * 60, windowMinutes) && notSentToday('missed')) {
    out.push({
      kind: 'missed',
      title: 'Two days with no record',
      body: 'Missing days are counted as missed. Saakshi will see the gap. Check in today.',
      url: '/',
      channels
    });
  }

  // Phase setup: 09:00 on days 31 and 61 (and the next two days) if the phase is not set up.
  for (const [n, startDay] of [[2, 31], [3, 61]] as const) {
    if (day >= startDay && day <= startDay + 2 && !phaseExists(n) && inWindow(minutes, 9 * 60, windowMinutes) && notSentToday('phase')) {
      out.push({
        kind: 'phase',
        title: `Month ${n} starts now`,
        body: n === 2 ? 'Set your routine and 3 non-negotiables.' : 'Set measurable goals. Saakshi rejects vague ones.',
        url: '/',
        channels
      });
    }
  }
  return out;
}
