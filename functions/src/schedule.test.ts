import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReminders, type UserMeta } from './schedule';
import { extractJson, normaliseGate, normaliseSaakshi } from './ai';

// 21:05 IST on 2027-01-12 = 15:35 UTC. Cycle started 2027-01-01, so it is Day 12.
const at = (iso: string) => new Date(iso);
const base: UserMeta = {
  timezone: 'Asia/Kolkata',
  reminderTime: '21:00',
  channels: { push: true, email: true },
  email: 'me@example.com',
  pushTokens: ['t1'],
  activeCycleId: 'c1',
  cycleStart: '2027-01-01',
  lastCheckin: '2027-01-11',
  reviewsDone: 0
};
const none = () => true;

test('daily nudge inside the window, push only', () => {
  const r = planReminders(base, at('2027-01-12T15:35:00Z'), none);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'daily');
  assert.deepEqual(r[0].channels, ['push']);
  assert.match(r[0].title, /Day 12/);
});

test('no nudge after checking in today', () => {
  assert.equal(planReminders({ ...base, lastCheckin: '2027-01-12' }, at('2027-01-12T15:35:00Z'), none).length, 0);
});

test('no nudge outside the 15 minute window', () => {
  assert.equal(planReminders(base, at('2027-01-12T15:50:00Z'), none).length, 0);
});

test('no duplicate after a send today', () => {
  assert.equal(planReminders({ ...base, lastSent: { daily: '2027-01-12' } }, at('2027-01-12T15:35:00Z'), none).length, 0);
});

test('review due replaces the daily nudge', () => {
  // Day 15 = 2027-01-15
  const r = planReminders(base, at('2027-01-15T15:35:00Z'), none);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'review');
  assert.deepEqual(r[0].channels, ['push', 'email']);
});

test('missed two days escalates at 10:00 local', () => {
  // 10:05 IST = 04:35 UTC on 2027-01-12, last check-in 2027-01-09
  const r = planReminders({ ...base, lastCheckin: '2027-01-09' }, at('2027-01-12T04:35:00Z'), none);
  assert.equal(r[0].kind, 'missed');
});

test('phase 2 setup reminder only when phase 2 is missing', () => {
  // Day 31 = 2027-01-31, 09:05 IST = 03:35 UTC
  const missing = planReminders(base, at('2027-01-31T03:35:00Z'), () => false);
  assert.equal(missing[0]?.kind, 'phase');
  assert.equal(planReminders(base, at('2027-01-31T03:35:00Z'), () => true).length, 0);
});

test('no channels means no reminders', () => {
  assert.equal(planReminders({ ...base, channels: { push: false, email: false } }, at('2027-01-12T15:35:00Z'), none).length, 0);
});

test('extracts JSON wrapped in prose or fences', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('normalises Saakshi output and rejects unknown verdicts', () => {
  const out = normaliseSaakshi({
    verdict: 'Excellent',
    headline: 'You kept 41%.',
    evidence: [{ claim: 'x', source: 'y' }],
    excuses: [],
    callOut: 'c',
    proof: 'p',
    oneChange: 'o',
    tip: 't',
    raiseTheBar: '',
    question: 'q'
  });
  assert.equal(out.verdict, 'Slipping');
  assert.throws(() => normaliseSaakshi({ verdict: 'Slipping' }));
});

test('goal gate fails closed for goals the model skipped', () => {
  const v = normaliseGate({ verdicts: [{ id: 'a', ok: true, reason: 'Fine.' }] }, ['a', 'b']);
  assert.equal(v[0].ok, true);
  assert.equal(v[1].ok, false);
});
