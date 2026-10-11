/// <reference types="vite/client" />
// Tester probe (#63, ADR 0008 "Unknown addresses get exactly the same responses"): a wrong
// password for a known address and for an unknown one must not differ in status, body, header
// names, or in how long the answer takes. Timing is measured with `performance.now()` (the clock is
// not faked here), on medians of interleaved samples, so a missing dummy hash (about 0.4 s of scrypt
// per password check) shows as a large ratio while scheduler noise does not.
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { modules } from './test.setup';

const SITE_URL = 'http://localhost:4000';
const EMAIL = 'maya.okafor@example.com';
const PASSWORD = 'sandbar sunset spike 2026';
const WRONG = 'not the password at all';
const SAMPLES = 4;

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

/** One timed wrong-password sign-in. */
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
  for (let i = 0; i < SAMPLES - 1; i++) {
    // Each unknown address is new, so no sample is throttled; the known address stays below 5.
    unknown.push(await timed(t, `nobody.${i}@example.com`));
    known.push(await timed(t, EMAIL));
  }
  for (const answer of [...known, ...unknown]) expect(answer.status).toBe(401);
  expect(new Set([...known, ...unknown].map((a) => a.text)).size).toBe(1);
  const names = (a: (typeof known)[number]) =>
    [...a.response.headers.keys()].filter((name) => name !== 'date').sort();
  expect(names(unknown[0])).toEqual(names(known[0]));

  const [k, u] = [median(known.map((a) => a.ms)), median(unknown.map((a) => a.ms))];
  const ratio = Math.max(k, u) / Math.min(k, u);
  expect(ratio, `known ${k.toFixed(0)} ms, unknown ${u.toFixed(0)} ms`).toBeLessThan(1.5);
}, 120_000);
