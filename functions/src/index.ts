import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { GOAL_GATE_SYSTEM, SAAKSHI_SYSTEM } from './prompt';
import { callClaude, extractJson, normaliseGate, normaliseSaakshi } from './ai';
import { localNow, planReminders, type Reminder, type UserMeta } from './schedule';

initializeApp();
const db = getFirestore();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const AI_MODEL = defineString('AI_MODEL', { default: 'claude-sonnet-5-5' });
const EMAIL_FROM = defineString('EMAIL_FROM', { default: 'Black Notebook <no-reply@jay.im>' });
const APP_URL = defineString('APP_URL', { default: 'https://bb.jay.im' });
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

const REGION = 'asia-south1';
const MAX_PAYLOAD_BYTES = 200_000;
const DAILY_AI_LIMIT = 20;

/**
 * Per-user daily cap on AI calls. Stores only a counter, never content.
 * Lives outside users/{uid} so clients cannot touch it (rules deny it).
 */
async function rateLimit(uid: string) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`limits/${uid}`);
  const n = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const cur = snap.exists && snap.get('day') === day ? (snap.get('count') as number) : 0;
    t.set(ref, { day, count: cur + 1 });
    return cur + 1;
  });
  if (n > DAILY_AI_LIMIT) throw new HttpsError('resource-exhausted', 'Daily limit for Saakshi reached. Try tomorrow.');
}

function guard(auth: { uid: string } | undefined, data: unknown) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const size = Buffer.byteLength(JSON.stringify(data ?? null));
  if (size > MAX_PAYLOAD_BYTES) throw new HttpsError('invalid-argument', 'Request too large.');
  return auth.uid;
}

/**
 * Saakshi review relay.
 * The device sends decrypted data for one review. It exists here only in
 * memory for the length of the call: no Firestore write, no log of content.
 * The device encrypts the answer before saving it.
 */
export const saakshiReview = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: '256MiB' },
  async (req) => {
    const uid = guard(req.auth, req.data);
    await rateLimit(uid);
    const started = Date.now();
    try {
      const text = await callClaude({
        apiKey: ANTHROPIC_API_KEY.value(),
        model: AI_MODEL.value(),
        system: SAAKSHI_SYSTEM,
        user: JSON.stringify(req.data),
        maxTokens: 2000
      });
      const out = normaliseSaakshi(extractJson(text));
      logger.info('saakshiReview ok', { uid, ms: Date.now() - started, verdict: out.verdict });
      return out;
    } catch (e) {
      logger.warn('saakshiReview failed', { uid, ms: Date.now() - started, error: (e as Error).message });
      throw new HttpsError('unavailable', 'Saakshi could not finish the review. Try again.');
    }
  }
);

/** Goal gate relay. Same rules: in memory only, nothing stored or logged. */
export const saakshiGoalGate = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60 },
  async (req) => {
    const uid = guard(req.auth, req.data);
    await rateLimit(uid);
    const goals = (req.data as { goals?: { id: string }[] })?.goals;
    if (!Array.isArray(goals) || goals.length === 0 || goals.length > 10) {
      throw new HttpsError('invalid-argument', 'Send 1 to 10 goals.');
    }
    try {
      const text = await callClaude({
        apiKey: ANTHROPIC_API_KEY.value(),
        model: AI_MODEL.value(),
        system: GOAL_GATE_SYSTEM,
        user: JSON.stringify({ today: new Date().toISOString().slice(0, 10), goals }),
        maxTokens: 800
      });
      return { verdicts: normaliseGate(extractJson(text), goals.map((g) => String(g.id))) };
    } catch (e) {
      logger.warn('saakshiGoalGate failed', { uid, error: (e as Error).message });
      throw new HttpsError('unavailable', 'Saakshi could not check the goals.');
    }
  }
);

// ---------- reminders ----------

async function sendPush(uid: string, tokens: string[], r: Reminder) {
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    // Data-only: the service worker renders it. No personal content.
    data: { title: r.title, body: r.body, url: r.url, tag: r.kind },
    webpush: { headers: { Urgency: 'normal', TTL: String(6 * 3600) } }
  });
  const dead = tokens.filter((_, i) => {
    const code = res.responses[i].error?.code ?? '';
    return code.includes('registration-token-not-registered') || code.includes('invalid-registration-token');
  });
  if (dead.length) await db.doc(`users/${uid}`).update({ pushTokens: FieldValue.arrayRemove(...dead) });
}

async function sendEmail(to: string, r: Reminder) {
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#111">
<p><b>${r.title}</b></p><p>${r.body}</p><p><a href="${APP_URL.value()}${r.url}">Open your notebook</a></p>
<p style="color:#777;font-size:13px">You get this because reminders are on in Settings.</p></div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM.value(),
      to: [to],
      subject: r.title,
      text: `${r.title}\n\n${r.body}\n\n${APP_URL.value()}${r.url}`,
      html
    })
  });
  if (!res.ok) throw new Error(`email status ${res.status}`);
}

export const reminders = onSchedule(
  { region: REGION, schedule: 'every 15 minutes', timeZone: 'UTC', secrets: [RESEND_API_KEY], timeoutSeconds: 300 },
  async () => {
    const now = new Date();
    const users = await db.collection('users').get();
    let sent = 0;
    for (const doc of users.docs) {
      const u = doc.data() as UserMeta;
      if (!u.activeCycleId) continue;
      const phases = await db.collection(`users/${doc.id}/cycles/${u.activeCycleId}/phases`).select().get();
      const have = new Set(phases.docs.map((d) => d.id));
      const plan = planReminders(u, now, (n) => have.has(String(n)));
      if (plan.length === 0) continue;

      const { date: today } = localNow(u.timezone || 'Asia/Kolkata', now);
      const marks: Record<string, string> = {};
      for (const r of plan) {
        try {
          if (r.channels.includes('push') && u.pushTokens?.length) await sendPush(doc.id, u.pushTokens, r);
          if (r.channels.includes('email') && u.email) await sendEmail(u.email, r);
          marks[`lastSent.${r.kind}`] = today;
          sent++;
        } catch (e) {
          logger.warn('reminder failed', { uid: doc.id, kind: r.kind, error: (e as Error).message });
        }
      }
      if (Object.keys(marks).length) await doc.ref.update(marks);
    }
    logger.info('reminders run', { users: users.size, sent });
  }
);
