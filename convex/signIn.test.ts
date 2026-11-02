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
  const ADDRESS = { 'cf-connecting-ip': '203.0.113.9' };
  const OTHER = { 'cf-connecting-ip': '198.51.100.7' };
  const SECOND = 1000;

  const limitRows = (t: T) => t.run((ctx) => ctx.db.query('ipRateLimits').collect());

  async function windowStart(t: T, key: string): Promise<number> {
    const row = (await limitRows(t)).find((r) => r.key === key);
    if (!row) throw new Error(`no per-IP limit row for ${key}`);
    return row.lastRequest;
  }

  const signUpAs = (t: T, email: string, headers: Record<string, string>) =>
    post(
      t,
      'sign-up/email',
      { name: 'Maya Okafor', email, password: PASSWORD, adultConfirmed: true },
      headers,
    );

  async function get(t: T, path: string, headers: Record<string, string>): Promise<number> {
    const response = await t.fetch(`/api/auth/${path}`, {
      headers: { origin: SITE_URL, ...headers },
    });
    await response.text();
    return response.status;
  }

  async function authUserEmails(t: T): Promise<string[]> {
    return t.run(async (ctx) => {
      const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { numItems: 100, cursor: null },
      })) as { page: { email: string }[] };
      return page.map((user) => user.email).sort();
    });
  }

  beforeEach(() => {
    // The limit is off under IS_TEST. With it unset the breached-password check is on, so its range
    // request is answered here.
    vi.stubEnv('IS_TEST', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('0018A45C4D1DEF81644B54AB7F969B88D65:0'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('is on outside IS_TEST for sign-in and sign-up only, counted in the project store, keyed on cf-connecting-ip', () => {
    const { rateLimit, advanced } = createAuth({} as GenericCtx<DataModel>).options;
    expect(rateLimit?.enabled).toBe(true);
    expect(rateLimit?.customStorage?.consume).toEqual(expect.any(Function));
    expect(Object.entries(rateLimit?.customRules ?? {})).toEqual([
      ['/sign-in/*', { window: 10, max: 3 }],
      ['/sign-up/*', { window: 10, max: 3 }],
      ['/**', false],
    ]);
    expect(advanced?.ipAddress).toEqual({ ipAddressHeaders: ['cf-connecting-ip'] });
  });

  test('is off under IS_TEST', () => {
    vi.stubEnv('IS_TEST', 'true');
    expect(createAuth({} as GenericCtx<DataModel>).options.rateLimit?.enabled).toBe(false);
  });

  test('the 4th sign-in from one address within 10 s gets 429 with the wait; another address still signs in', async () => {
    const t = setup();
    await signUp(t);
    for (let i = 0; i < 3; i++) {
      const answer = await signIn(t, EMAIL, PASSWORD, ADDRESS);
      expect(answer.status, `sign-in ${i + 1}`).toBe(200);
      advance(2 * SECOND);
    }
    const fourth = await signIn(t, EMAIL, PASSWORD, ADDRESS);
    expect(fourth.status).toBe(429);
    expect(fourth.json).toEqual({ message: 'Too many requests. Please try again later.' });
    const retryAfter = Number(fourth.headers.get('x-retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(10);
    expect(fourth.headers.get('access-control-allow-origin')).toBe(SITE_URL);
    expect((await signIn(t, EMAIL, PASSWORD, OTHER)).status).toBe(200);
  }, 60_000);

  test('the 4th sign-up from one address within 10 s gets 429 and creates no user', async () => {
    const t = setup();
    for (let i = 1; i <= 3; i++) {
      const answer = await signUpAs(t, `new${i}@example.com`, ADDRESS);
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    }
    const fourth = await signUpAs(t, 'new4@example.com', ADDRESS);
    expect(fourth.status).toBe(429);
    expect(await authUserEmails(t)).toEqual([
      'new1@example.com',
      'new2@example.com',
      'new3@example.com',
    ]);
    expect(
      await t.run((ctx) => ctx.db.query('users').collect()).then((users) => users.length),
    ).toBe(3);
  }, 60_000);

  test('9 sign-ins at once from one address: at most 3 get their normal answer, the rest 429', async () => {
    const t = setup();
    await signUp(t);
    const answers = await Promise.all(
      Array.from({ length: 9 }, () => signIn(t, EMAIL, PASSWORD, ADDRESS)),
    );
    const statuses = answers.map((a) => a.status);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(3);
    expect(statuses.filter((s) => s !== 200).every((s) => s === 429)).toBe(true);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(6);
    const row = (await limitRows(t)).find((r) => r.key === '203.0.113.9|/sign-in/email');
    expect(row?.count).toBe(3);
  }, 120_000);

  test('refused at +5 s, +9 s and exactly +10 s after the 3rd sign-in, then allowed at +10.001 s', async () => {
    const t = setup();
    await signUp(t);
    for (let i = 0; i < 3; i++)
      expect((await signIn(t, EMAIL, PASSWORD, ADDRESS)).status).toBe(200);
    const start = await windowStart(t, '203.0.113.9|/sign-in/email');
    for (const ms of [5 * SECOND, 9 * SECOND, 10 * SECOND]) {
      vi.setSystemTime(new Date(start + ms));
      const refused = await signIn(t, EMAIL, PASSWORD, ADDRESS);
      expect(refused.status, `at +${ms} ms`).toBe(429);
      expect(refused.headers.get('x-retry-after')).toBe(String(10 - ms / SECOND));
    }
    expect(await windowStart(t, '203.0.113.9|/sign-in/email')).toBe(start);
    vi.setSystemTime(new Date(start + 10 * SECOND + 1));
    expect((await signIn(t, EMAIL, PASSWORD, ADDRESS)).status).toBe(200);
  }, 60_000);

  test('101 /get-session and 101 /convex/token requests from one address in 10 s all get their normal answer', async () => {
    const t = setup();
    for (const path of ['get-session', 'convex/token']) {
      const first = await get(t, path, ADDRESS);
      expect(first, path).not.toBe(429);
      for (let i = 1; i < 101; i++)
        expect(await get(t, path, ADDRESS), `${path} ${i + 1}`).toBe(first);
    }
    expect(await limitRows(t)).toEqual([]);
  }, 120_000);

  test('a sign-in the per-IP limit refuses leaves the sign-in throttle row unchanged', async () => {
    const t = setup();
    await signUp(t);
    for (let i = 0; i < 3; i++) expect((await signIn(t, EMAIL, WRONG, ADDRESS)).status).toBe(401);
    const before = await rows(t);
    expect(before).toMatchObject([{ email: EMAIL, failures: 3 }]);
    expect((await signIn(t, EMAIL, WRONG, ADDRESS)).status).toBe(429);
    expect(await rows(t)).toEqual(before);
  }, 60_000);

  test('a missing, malformed, or comma-separated cf-connecting-ip shares one bucket', async () => {
    const t = setup();
    await signUp(t);
    const headers: Record<string, string>[] = [
      {},
      { 'cf-connecting-ip': 'not-an-ip' },
      { 'cf-connecting-ip': '203.0.113.9, 198.51.100.7' },
    ];
    for (const [i, h] of headers.entries()) {
      expect((await signIn(t, EMAIL, PASSWORD, h)).status, `request ${i + 1}`).toBe(200);
    }
    expect((await signIn(t, EMAIL, PASSWORD, {})).status).toBe(429);
    // Better Auth keys a request with no usable address as 127.0.0.1 when NODE_ENV is "test" (Vitest)
    // or "development", and as `no-trusted-ip` on a deployment.
    const signInKeys = (await limitRows(t))
      .map((row) => row.key)
      .filter((key) => key.endsWith('/sign-in/email'));
    expect(signInKeys).toEqual(['127.0.0.1|/sign-in/email']);
  }, 60_000);

  test('when the count cannot be stored, the request gets 429 and the error is logged', async () => {
    const t = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The store refuses a key over 300 characters, as it would any failed write.
    const answer = await post(
      t,
      `sign-in/${'x'.repeat(300)}`,
      { email: EMAIL, password: PASSWORD },
      ADDRESS,
    );
    expect(answer.status).toBe(429);
    expect(answer.headers.get('x-retry-after')).toBe('10');
    expect(answer.headers.get('access-control-allow-origin')).toBe(SITE_URL);
    expect(errors).toHaveBeenCalledWith(
      'The per-IP limit could not be counted, so the request is refused',
      expect.any(Error),
    );
    expect(await limitRows(t)).toEqual([]);
  }, 30_000);

  // Two rows for one key make the store's `unique()` read throw on the real sign-in and sign-up paths.
  test.each([
    ['sign-in/email', { email: EMAIL, password: PASSWORD }],
    [
      'sign-up/email',
      { name: 'Maya Okafor', email: 'new@example.com', password: PASSWORD, adultConfirmed: true },
    ],
  ])(
    'when the store throws on /%s, the request gets 429 with CORS headers, is logged, and reaches no route',
    async (path, body) => {
      const t = setup();
      if (path === 'sign-in/email') await signUp(t);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const key = `203.0.113.9|/${path}`;
      await t.run(async (ctx) => {
        for (let i = 0; i < 2; i++) {
          await ctx.db.insert('ipRateLimits', {
            key,
            count: 1,
            lastRequest: Date.now(),
            expiresAt: Date.now() + 10 * SECOND,
          });
        }
      });
      const usersBefore = await authUserEmails(t);
      const answer = await post(t, path, body, ADDRESS);
      expect(answer.status).toBe(429);
      expect(answer.json).toEqual({ message: 'Too many requests. Please try again later.' });
      expect(answer.headers.get('x-retry-after')).toBe('10');
      expect(answer.headers.get('access-control-allow-origin')).toBe(SITE_URL);
      expect(errors).toHaveBeenCalledWith(
        'The per-IP limit could not be counted, so the request is refused',
        expect.any(Error),
      );
      expect(await authUserEmails(t)).toEqual(usersBefore);
      expect(await rows(t)).toEqual([]);
      expect(await sessionCount(t)).toBe(path === 'sign-in/email' ? 1 : 0);
    },
    60_000,
  );

  test('/sign-in/social shares the sign-in rule, and /sign-out is not limited', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      const answer = await post(t, 'sign-in/social', { provider: 'google' }, ADDRESS);
      expect(answer.status, `social ${i + 1}`).not.toBe(429);
    }
    expect((await post(t, 'sign-in/social', { provider: 'google' }, ADDRESS)).status).toBe(429);
    for (let i = 0; i < 5; i++)
      expect((await post(t, 'sign-out', {}, ADDRESS)).status).not.toBe(429);
    expect((await limitRows(t)).map((row) => row.key)).toEqual(['203.0.113.9|/sign-in/social']);
  }, 60_000);
});
