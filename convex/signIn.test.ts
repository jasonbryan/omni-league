/// <reference types="vite/client" />
// The clock is faked with `Date` only, so scrypt and the component keep real timers.
import betterAuthTest from '@convex-dev/better-auth/test';
import type { GenericCtx } from '@convex-dev/better-auth';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { createAuth } from './auth';
import { HARD_LIMIT } from './lib/signInThrottle';
import schema from './schema';
import { modules } from './test.setup';

const SITE_URL = 'http://localhost:4000';
const EMAIL = 'maya.okafor@example.com';
const PASSWORD = 'sandbar sunset spike 2026';
const WRONG = 'not the password at all';
const UNKNOWN = 'nobody.here@example.com';
const START = new Date('2026-10-10T12:00:00Z');
const MINUTE = 60_000;

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}
type T = ReturnType<typeof setup>;

interface Answer {
  status: number;
  json: Record<string, unknown>;
  headers: Headers;
}

async function post(
  t: T,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const response = await t.fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE_URL, ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers,
  };
}

const signIn = (t: T, email: string, password: string, headers?: Record<string, string>) =>
  post(t, 'sign-in/email', { email, password }, headers);

async function signUp(t: T, email = EMAIL) {
  const answer = await post(t, 'sign-up/email', {
    name: 'Maya Okafor',
    email,
    password: PASSWORD,
    adultConfirmed: true,
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
}

const rows = (t: T) => t.run((ctx) => ctx.db.query('signInFailures').collect());

async function sessionCount(t: T): Promise<number> {
  return t.run(async (ctx) => {
    const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'session',
      paginationOpts: { numItems: 100, cursor: null },
    })) as { page: unknown[] };
    return page.length;
  });
}

async function fail(t: T, email: string, count: number): Promise<Answer[]> {
  const answers: Answer[] = [];
  for (let i = 0; i < count; i++) {
    const answer = await signIn(t, email, WRONG);
    expect(answer.status, `attempt ${i + 1}: ${JSON.stringify(answer.json)}`).toBe(401);
    answers.push(answer);
  }
  return answers;
}

const advance = (ms: number) => {
  vi.setSystemTime(new Date(Date.now() + ms));
};

async function storedBlockedUntil(t: T): Promise<number> {
  const [row] = await rows(t);
  if (!row) throw new Error('no sign-in failures are stored');
  return row.blockedUntil;
}

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('SITE_URL', SITE_URL);
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  // IS_TEST turns the breached-password check off, so sign-up makes no outside call. The per-address
  // throttle stays on under IS_TEST.
  vi.stubEnv('IS_TEST', 'true');
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sign-in', () => {
  test('a seeded user signs in with the right password and gets a session and a token', async () => {
    const t = setup();
    await signUp(t);
    const before = await sessionCount(t);
    const { status, json, headers } = await signIn(t, EMAIL, PASSWORD);
    expect(status, JSON.stringify(json)).toBe(200);
    expect(json['token']).toEqual(expect.any(String));
    expect(headers.get('set-better-auth-cookie') ?? headers.get('set-cookie')).toBeTruthy();
    expect(await sessionCount(t)).toBe(before + 1);
    expect(await rows(t)).toEqual([]);
  }, 30_000);

  test('the address matches in any letter case', async () => {
    const t = setup();
    await signUp(t);
    expect((await signIn(t, 'Maya.Okafor@EXAMPLE.com', PASSWORD)).status).toBe(200);
  }, 30_000);

  test('a wrong password and an unknown email get the same status and body', async () => {
    const t = setup();
    await signUp(t);
    const wrong = await signIn(t, EMAIL, WRONG);
    const unknown = await signIn(t, UNKNOWN, WRONG);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
    expect(wrong.json).toMatchObject({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    });
  }, 30_000);
});

describe('per-address throttle', () => {
  test('after 5 failures, a sixth attempt with the correct password gets 429 and the wait', async () => {
    const t = setup();
    await signUp(t);
    const sessions = await sessionCount(t);
    await fail(t, EMAIL, 5);

    const sixth = await signIn(t, EMAIL, PASSWORD);
    expect(sixth.status).toBe(429);
    expect(sixth.json).toEqual({
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many attempts. Try again in 1 minute.',
      retryAfterSeconds: 60,
    });
    expect(sixth.headers.get('retry-after')).toBe('60');
    expect(await sessionCount(t)).toBe(sessions);
    vi.setSystemTime(new Date((await storedBlockedUntil(t)) - 30_000));
    const waiting = await signIn(t, EMAIL, PASSWORD);
    expect(waiting.status).toBe(429);
    expect(waiting.json['retryAfterSeconds']).toBe(30);
    expect(waiting.json['message']).toBe('Too many attempts. Try again in 1 minute.');
  }, 60_000);

  test('the wait ends after a minute, doubles with each failure, and a success clears the row', async () => {
    const t = setup();
    await signUp(t);
    const failingFrom = Date.now();
    await fail(t, EMAIL, 5);
    const firstWait = (await storedBlockedUntil(t)) - failingFrom;
    expect(firstWait).toBeGreaterThanOrEqual(MINUTE);
    expect(firstWait).toBeLessThan(MINUTE + 1000);

    vi.setSystemTime(new Date(await storedBlockedUntil(t)));
    await fail(t, EMAIL, 1);
    const afterSix = await signIn(t, EMAIL, PASSWORD);
    expect(afterSix.status).toBe(429);
    expect(afterSix.json).toMatchObject({
      message: 'Too many attempts. Try again in 2 minutes.',
      retryAfterSeconds: 120,
    });

    vi.setSystemTime(new Date(await storedBlockedUntil(t)));
    const ok = await signIn(t, EMAIL, PASSWORD);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(await rows(t)).toEqual([]);
    await fail(t, EMAIL, 1);
    expect((await rows(t)).map((row) => row.failures)).toEqual([1]);
  }, 60_000);

  test('an unknown address gets the identical sequence: five 401s, then 429', async () => {
    const t = setup();
    await signUp(t);
    const known = await fail(t, EMAIL, 5);
    const unknown = await fail(t, UNKNOWN, 5);
    expect(unknown.map((a) => a.json)).toEqual(known.map((a) => a.json));

    const knownSixth = await signIn(t, EMAIL, PASSWORD);
    const unknownSixth = await signIn(t, UNKNOWN, PASSWORD);
    expect(unknownSixth.status).toBe(429);
    expect(unknownSixth.json).toEqual(knownSixth.json);
    expect(unknownSixth.headers.get('retry-after')).toBe(knownSixth.headers.get('retry-after'));

    advance(MINUTE);
    const knownNext = await signIn(t, EMAIL, WRONG);
    const unknownNext = await signIn(t, UNKNOWN, WRONG);
    expect(unknownNext.status).toBe(knownNext.status);
    expect(unknownNext.json).toEqual(knownNext.json);
  }, 120_000);

  test('every spelling of one address shares one row', async () => {
    const t = setup();
    await signUp(t);
    await fail(t, 'Maya.Okafor@Example.com', 3);
    await fail(t, EMAIL, 2);
    expect(await rows(t)).toMatchObject([{ email: EMAIL, failures: 5 }]);
    expect((await signIn(t, 'MAYA.OKAFOR@example.com', PASSWORD)).status).toBe(429);
  }, 60_000);

  test('parallel guesses are counted before they are checked: at most 5 reach the password', async () => {
    const t = setup();
    await signUp(t);
    const answers = await Promise.all(Array.from({ length: 9 }, () => signIn(t, EMAIL, WRONG)));
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
    expect(await rows(t)).toMatchObject([{ failures: 5 }]);
  }, 120_000);

  test('a body that is not a sign-in (no string email) is refused by Better Auth and counted nowhere', async () => {
    const t = setup();
    for (const body of [{}, { email: 42, password: WRONG }, { email: null }, [], 'text']) {
      const { status } = await post(t, 'sign-in/email', body);
      expect(status, JSON.stringify(body)).toBe(400);
    }
    expect(await rows(t)).toEqual([]);
  });

  test('an address of 300 characters is throttled under a short digest key', async () => {
    const t = setup();
    const long = `${'a'.repeat(300)}@example.com`;
    await fail(t, long, 1);
    const [row] = await rows(t);
    expect(row?.email).toMatch(/^sha256:[0-9a-f]{64}$/);
  }, 30_000);
});

describe('hard limit', () => {
  const seedFailures = (t: T, email: string, failures: number) =>
    t.run((ctx) =>
      ctx.db.insert('signInFailures', { email, failures, blockedUntil: Date.now() - 1 }),
    );

  test('after 100 consecutive failures the correct password is refused, after any wait', async () => {
    const t = setup();
    await signUp(t);
    expect(HARD_LIMIT).toBe(100);
    await seedFailures(t, EMAIL, HARD_LIMIT - 1);
    await fail(t, EMAIL, 1);

    for (const wait of [0, 61 * MINUTE, 24 * 60 * MINUTE, 400 * 24 * 60 * MINUTE]) {
      advance(wait);
      const { status, json } = await signIn(t, EMAIL, PASSWORD);
      expect(status, `after ${wait}`).toBe(429);
      expect(json).toEqual({
        code: 'SIGN_IN_LOCKED',
        message: 'Password sign-in is locked for this email address.',
      });
    }
    expect(await rows(t)).toMatchObject([{ email: EMAIL, failures: HARD_LIMIT }]);
  }, 60_000);

  test('an unknown address gets the same refusal after the same sequence', async () => {
    const t = setup();
    await signUp(t);
    for (const email of [EMAIL, UNKNOWN]) {
      await seedFailures(t, email, HARD_LIMIT - 1);
      await fail(t, email, 1);
    }
    advance(3 * 60 * MINUTE);
    const known = await signIn(t, EMAIL, PASSWORD);
    const unknown = await signIn(t, UNKNOWN, PASSWORD);
    expect(unknown.status).toBe(429);
    expect(unknown.json).toEqual(known.json);
    expect(unknown.json['code']).toBe('SIGN_IN_LOCKED');
  }, 60_000);

  test('the 100th attempt, if correct, still signs in and clears the row', async () => {
    const t = setup();
    await signUp(t);
    await seedFailures(t, EMAIL, HARD_LIMIT - 1);
    expect((await signIn(t, EMAIL, PASSWORD)).status).toBe(200);
    expect(await rows(t)).toEqual([]);
  }, 30_000);
});

describe('only internal functions read or write signInFailures', () => {
  const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts', '!./_generated/**'], {
    eager: true,
    query: '?raw',
    import: 'default',
  });

  test('the table is named only in the schema, the throttle, and the IS_TEST test seed', () => {
    const users = Object.entries(sources)
      .filter(([, text]) => text.includes('signInFailures'))
      .map(([path]) => path)
      .sort();
    expect(users).toEqual(['./schema.ts', './signInThrottle.ts', './testing.ts']);
  });

  test('convex/signInThrottle.ts registers internal functions only', () => {
    const text = sources['./signInThrottle.ts'] ?? '';
    expect(text).toMatch(/internalMutation\(/);
    expect(text).not.toMatch(/(?<![.\w])(query|mutation|action|httpAction)\(/);
    expect(text).not.toMatch(/\binternalQuery\b|\binternalAction\b/);
  });
});

describe('per-IP limiter', () => {
  test('the limiter ships off, keyed on cf-connecting-ip once it is on', () => {
    const options = createAuth({} as GenericCtx<DataModel>).options;
    expect(options.rateLimit).toEqual({ enabled: false, storage: 'database' });
    expect(options.advanced?.ipAddress?.ipAddressHeaders).toEqual(['cf-connecting-ip']);
  });

  test('no number of sign-ins from one address is limited per IP', async () => {
    const t = setup();
    await signUp(t);
    const headers = { 'cf-connecting-ip': '203.0.113.9' };
    for (let i = 0; i < 4; i++)
      expect((await signIn(t, EMAIL, PASSWORD, headers)).status).toBe(200);
  }, 60_000);
});
