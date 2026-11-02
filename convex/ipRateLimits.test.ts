/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import crons from './crons';
import { PRUNE_BATCH_SIZE } from './ipRateLimits';
import { IP_LIMIT_MAX, IP_LIMIT_WINDOW_SECONDS } from './lib/ipRateLimit';
import schema from './schema';
import { modules } from './test.setup';

const KEY = '203.0.113.9|/sign-in/email';
const RULE = { window: IP_LIMIT_WINDOW_SECONDS, max: IP_LIMIT_MAX };
const T0 = new Date('2026-11-01T12:00:00Z').getTime();
const SECOND = 1000;

const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;

const consume = (t: T, key = KEY, rule: { window: number; max: number } = RULE) =>
  t.mutation(internal.ipRateLimits.consume, { key, ...rule });

const rows = (t: T) => t.run((ctx) => ctx.db.query('ipRateLimits').collect());

const at = (ms: number) => {
  vi.setSystemTime(new Date(T0 + ms));
};

// convex-test, like Convex, moves each transaction's clock past the last commit, so requests sent
// at one frozen instant land a millisecond apart. The window runs from the last allowed one.
async function lastRequest(t: T): Promise<number> {
  const [row] = await rows(t);
  if (!row) throw new Error('no per-IP limit row is stored');
  return row.lastRequest;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('consume', () => {
  test('a first request is allowed and opens a window that expires with the rule', async () => {
    const t = setup();
    expect(await consume(t)).toEqual({ allowed: true, retryAfter: null });
    expect(await rows(t)).toMatchObject([
      { key: KEY, count: 1, lastRequest: T0, expiresAt: T0 + 10 * SECOND },
    ]);
  });

  test('allows 3 requests in 10 s and refuses the 4th with the seconds left, writing nothing', async () => {
    const t = setup();
    for (const ms of [0, 2 * SECOND, 3 * SECOND]) {
      at(ms);
      expect(await consume(t)).toEqual({ allowed: true, retryAfter: null });
    }
    const before = await rows(t);
    expect(before).toMatchObject([{ count: 3, lastRequest: T0 + 3 * SECOND }]);
    at(4 * SECOND);
    expect(await consume(t)).toEqual({ allowed: false, retryAfter: 9 });
    expect(await rows(t)).toEqual(before);
  });

  test('refusals do not move lastRequest: refused at +5 s, +9 s and exactly +10 s, allowed at +10.001 s', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) expect((await consume(t)).allowed).toBe(true);
    const last = await lastRequest(t);
    const after = (ms: number) => vi.setSystemTime(new Date(last + ms));
    after(5 * SECOND);
    expect(await consume(t)).toEqual({ allowed: false, retryAfter: 5 });
    after(9 * SECOND);
    expect(await consume(t)).toEqual({ allowed: false, retryAfter: 1 });
    after(10 * SECOND);
    expect(await consume(t)).toEqual({ allowed: false, retryAfter: 0 });
    expect(await rows(t)).toMatchObject([{ count: 3, lastRequest: last }]);
    after(10 * SECOND + 1);
    expect(await consume(t)).toEqual({ allowed: true, retryAfter: null });
    expect(await rows(t)).toMatchObject([
      { count: 1, lastRequest: last + 10 * SECOND + 1, expiresAt: last + 20 * SECOND + 1 },
    ]);
  });

  test('each key has its own count', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) await consume(t);
    expect((await consume(t)).allowed).toBe(false);
    expect((await consume(t, '198.51.100.7|/sign-in/email')).allowed).toBe(true);
    expect((await consume(t, '203.0.113.9|/sign-up/email')).allowed).toBe(true);
  });

  test('a row expires by its own rule, so a 1-hour rule holds for the hour', async () => {
    const t = setup();
    const hour = { window: 3600, max: 5 };
    for (let i = 0; i < 5; i++) await consume(t, KEY, hour);
    const last = await lastRequest(t);
    expect(await rows(t)).toMatchObject([{ expiresAt: last + 3600 * SECOND }]);
    vi.setSystemTime(new Date(last + 59 * 60 * SECOND));
    await t.mutation(internal.ipRateLimits.prune, {});
    expect(await consume(t, KEY, hour)).toEqual({ allowed: false, retryAfter: 60 });
  });

  test('9 requests at once: exactly 3 are allowed', async () => {
    const t = setup();
    const answers = await Promise.all(Array.from({ length: 9 }, () => consume(t)));
    expect(answers.filter((a) => a.allowed)).toHaveLength(3);
    expect(await rows(t)).toMatchObject([{ count: 3 }]);
  });

  test.each([
    ['a key over 300 characters', { key: `${'x'.repeat(287)}|/sign-in/email` }],
    ['a window of 0', { window: 0 }],
    ['a negative window', { window: -10 }],
    ['a fractional window', { window: 1.5 }],
    ['a max of 0', { max: 0 }],
    ['a fractional max', { max: 2.5 }],
  ])('refuses %s and writes nothing', async (_, change) => {
    const t = setup();
    await expect(
      t.mutation(internal.ipRateLimits.consume, { key: KEY, ...RULE, ...change }),
    ).rejects.toThrow();
    expect(await rows(t)).toEqual([]);
  });

  test('a key of exactly 300 characters is counted', async () => {
    const t = setup();
    const key = `${'x'.repeat(285)}|/sign-in/email`;
    expect(key).toHaveLength(300);
    expect((await consume(t, key)).allowed).toBe(true);
  });
});

describe('prune', () => {
  const insert = (t: T, key: string, expiresAt: number) =>
    t.run((ctx) =>
      ctx.db.insert('ipRateLimits', { key, count: 1, lastRequest: expiresAt - 10_000, expiresAt }),
    );

  test('deletes rows whose expiresAt has passed and leaves live rows', async () => {
    const t = setup();
    await insert(t, 'old|/sign-in/email', T0 - 1);
    await insert(t, 'older|/sign-up/email', T0 - 60 * 60 * SECOND);
    await insert(t, 'live|/sign-in/email', T0 + 5 * SECOND);
    await t.mutation(internal.ipRateLimits.prune, {});
    expect((await rows(t)).map((row) => row.key)).toEqual(['live|/sign-in/email']);
  });

  test('runs again until no expired row is left when there are more than one batch', async () => {
    vi.useFakeTimers();
    at(0);
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < PRUNE_BATCH_SIZE + 5; i++) {
        await ctx.db.insert('ipRateLimits', {
          key: `198.51.100.${i}|/sign-in/email`,
          count: 1,
          lastRequest: T0 - 20 * SECOND,
          expiresAt: T0 - 10 * SECOND,
        });
      }
    });
    await insert(t, 'live|/sign-in/email', T0 + 5 * SECOND);
    await t.mutation(internal.ipRateLimits.prune, {});
    expect(await rows(t)).toHaveLength(6);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await rows(t)).map((row) => row.key)).toEqual(['live|/sign-in/email']);
  });

  test('is scheduled every hour', () => {
    expect(Object.values(crons.crons)).toEqual([
      {
        name: 'ipRateLimits:prune',
        args: [{}],
        schedule: { type: 'hourly' },
      },
    ]);
  });
});

describe('only internal functions read or write ipRateLimits', () => {
  const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts', '!./_generated/**'], {
    eager: true,
    query: '?raw',
    import: 'default',
  });

  test('the table and its functions are named only in the schema, its module, the auth options, and the cron list', () => {
    const users = Object.entries(sources)
      .filter(([, text]) => text.includes('ipRateLimits'))
      .map(([path]) => path)
      .sort();
    expect(users).toEqual(['./auth.ts', './crons.ts', './ipRateLimits.ts', './schema.ts']);
  });

  test('convex/ipRateLimits.ts registers internal mutations only', () => {
    const text = sources['./ipRateLimits.ts'] ?? '';
    expect(text).toMatch(/internalMutation\(/);
    expect(text).not.toMatch(/(?<![.\w])(query|mutation|action|httpAction)\(/);
    expect(text).not.toMatch(/\binternalQuery\b|\binternalAction\b/);
  });
});
