// Firestore rules tests. Run inside the emulator:
//   npx firebase-tools emulators:exec --only firestore --project demo-blackbook "npm --prefix rules-tests test"
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let env;
const ENV = { v: 1, iv: 'aXY=', ct: 'Y2lwaGVy' };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-blackbook',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

test('owner writes allowed metadata on their user doc', async () => {
  await assertSucceeds(setDoc(doc(alice(), 'users/alice'), { timezone: 'Asia/Kolkata', reminderTime: '21:00', channels: { push: false, email: true } }));
});

test('user doc rejects content fields', async () => {
  await assertFails(setDoc(doc(alice(), 'users/alice'), { timezone: 'Asia/Kolkata', notes: 'plaintext secret' }));
});

test('another user cannot read the user doc or vault', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/alice'), { timezone: 'Asia/Kolkata' });
    await setDoc(doc(ctx.firestore(), 'users/alice/vault/main'), { v: 1 });
  });
  await assertFails(getDoc(doc(bob(), 'users/alice')));
  await assertFails(getDoc(doc(bob(), 'users/alice/vault/main')));
  await assertSucceeds(getDoc(doc(alice(), 'users/alice/vault/main')));
});

test('signed-out users get nothing', async () => {
  await assertFails(getDoc(doc(anon(), 'users/alice')));
  await assertFails(setDoc(doc(anon(), 'users/alice'), { timezone: 'x' }));
});

test('encrypted check-in is accepted', async () => {
  await assertSucceeds(setDoc(doc(alice(), 'users/alice/cycles/c1/checkins/2027-01-01'), { date: '2027-01-01', enc: ENV, updatedAt: 1 }));
});

test('plaintext check-in is rejected', async () => {
  await assertFails(setDoc(doc(alice(), 'users/alice/cycles/c1/checkins/2027-01-01'), { date: '2027-01-01', note: 'late call again' }));
  await assertFails(setDoc(doc(alice(), 'users/alice/cycles/c1/checkins/2027-01-01'), { date: '2027-01-01', enc: ENV, note: 'leak' }));
});

test('malformed envelope is rejected', async () => {
  await assertFails(setDoc(doc(alice(), 'users/alice/cycles/c1/audit/main'), { enc: { ...ENV, extra: 'x' } }));
  await assertFails(setDoc(doc(alice(), 'users/alice/cycles/c1/audit/main'), { enc: { v: 1, iv: 'a' } }));
});

test('a user cannot write into another user tree', async () => {
  await assertFails(setDoc(doc(bob(), 'users/alice/cycles/c1/reviews/1'), { index: 1, day: 15, enc: ENV }));
});

test('encrypted review and cycle docs are accepted', async () => {
  await assertSucceeds(setDoc(doc(alice(), 'users/alice/cycles/c1'), { number: 1, startDate: '2027-01-01', status: 'active', enc: ENV }));
  await assertSucceeds(setDoc(doc(alice(), 'users/alice/cycles/c1/reviews/1'), { index: 1, day: 15, enc: ENV, updatedAt: 1 }));
});

test('rate-limit counters are server only', async () => {
  await assertFails(getDoc(doc(alice(), 'limits/alice')));
  await assertFails(setDoc(doc(alice(), 'limits/alice'), { day: '2027-01-01', count: 0 }));
});
