/// <reference types="vite/client" />
// Timing uses the real clock. Each known sample is paired with an unknown one taken right next to it,
// in alternating order, and the median of the pair ratios is compared: load that slows the machine
// slows both halves of a pair, and a burst that hits one pair cannot move the median. A missing dummy
// hash (a full scrypt per password check) still shows in every pair.
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { FREE_FAILURES } from './lib/signInThrottle';
import { modules } from './test.setup';

const SITE_URL = 'http://localhost:4000';
const EMAIL = 'maya.okafor@example.com';
const PASSWORD = 'sandbar sunset spike 2026';
const WRONG = 'not the password at all';
const PAIRS = 11;
const MAX_RATIO = 1.5;

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}
type T = ReturnType<typeof setup>;

async function post(t: T, path: string, body: unknown) {
  const response = await t.fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE_URL },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, status: response.status, text };
}

async function timed(t: T, email: string) {
  const start = performance.now();
  const answer = await post(t, 'sign-in/email', { email, password: WRONG });
  return { ...answer, ms: performance.now() - start };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('SITE_URL', SITE_URL);
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  vi.stubEnv('IS_TEST', 'true');
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('a wrong password for a known address and for an unknown one: same answer, same time', async () => {
  const t = setup();
  const up = await post(t, 'sign-up/email', {
    name: 'Maya Okafor',
    email: EMAIL,
    password: PASSWORD,
    adultConfirmed: true,
  });
  expect(up.status).toBe(200);
  await timed(t, EMAIL); // warm-up: module load, first scrypt
  await timed(t, 'warm.up@example.com');

  const known: Awaited<ReturnType<typeof timed>>[] = [];
  const unknown: Awaited<ReturnType<typeof timed>>[] = [];
  let knownFailures = 1;
  for (let i = 0; i < PAIRS; i++) {
    if (knownFailures === FREE_FAILURES - 1) {
      // A correct password clears the failure count, so no known sample is throttled.
      const signedIn = await post(t, 'sign-in/email', { email: EMAIL, password: PASSWORD });
      expect(signedIn.status).toBe(200);
      knownFailures = 0;
    }
    // Each unknown address is new, so no unknown sample is throttled.
    const nobody = `nobody.${i}@example.com`;
    if (i % 2 === 0) {
      unknown.push(await timed(t, nobody));
      known.push(await timed(t, EMAIL));
    } else {
      known.push(await timed(t, EMAIL));
      unknown.push(await timed(t, nobody));
    }
    knownFailures++;
  }
  for (const answer of [...known, ...unknown]) expect(answer.status).toBe(401);
  expect(new Set([...known, ...unknown].map((a) => a.text)).size).toBe(1);
  const names = (a: (typeof known)[number]) =>
    [...a.response.headers.keys()].filter((name) => name !== 'date').sort();
  expect(names(unknown[0])).toEqual(names(known[0]));

  const ratio = median(known.map((k, i) => k.ms / (unknown[i]?.ms ?? 0)));
  const ms = (answers: typeof known) => answers.map((a) => a.ms.toFixed(0)).join(', ');
  expect(
    Math.max(ratio, 1 / ratio),
    `known/unknown per pair, median ${ratio.toFixed(2)}; known ${ms(known)} ms; unknown ${ms(unknown)} ms`,
  ).toBeLessThan(MAX_RATIO);
}, 120_000);
