/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FREE_FAILURES, HARD_LIMIT, IDLE_ROW_LIFETIME_MS } from './lib/signInThrottle';
import schema from './schema';
import { modules } from './test.setup';

const START = Date.parse('2026-11-01T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const KEY = 'sprayed.address@example.com';

function setup() {
  return convexTest(schema, modules);
}
type T = ReturnType<typeof setup>;

const rows = (t: T) => t.run((ctx) => ctx.db.query('signInFailures').collect());

const pendingExpiries = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect()).filter(
      (job) => job.name.includes('expire') && job.state.kind === 'pending',
    ),
  );

// A direct call leaves the first scheduled run pending, so only a rescheduled run is later than it.
const expiriesAfter = async (t: T, time: number) =>
  (await pendingExpiries(t)).filter((job) => job.scheduledTime > time);

const begin = (t: T, key = KEY) => t.mutation(internal.signInThrottle.begin, { key });

const expire = (t: T, id: Id<'signInFailures'>) =>
  t.mutation(internal.signInThrottle.expire, { id });

async function onlyRowId(t: T): Promise<Id<'signInFailures'>> {
  const [row] = await rows(t);
  if (!row) throw new Error('No signInFailures row');
  return row._id;
}

describe('stale signInFailures rows', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('a first failure schedules its row to expire a day later', async () => {
    const t = setup();
    await begin(t);
    const id = await onlyRowId(t);
    const jobs = await pendingExpiries(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.scheduledTime).toBe(START + IDLE_ROW_LIFETIME_MS);
    expect(jobs[0]?.args).toEqual([{ id }]);
  });

  test('a later failure on the same row schedules nothing more', async () => {
    const t = setup();
    await begin(t);
    vi.setSystemTime(START + HOUR);
    await begin(t);
    expect(await pendingExpiries(t)).toHaveLength(1);
  });

  test('a row below the threshold with no attempt for a day is deleted', async () => {
    const t = setup();
    for (let i = 1; i < FREE_FAILURES; i++) await begin(t);
    const [row] = await rows(t);
    if (!row) throw new Error('No signInFailures row');
    const lastAttempt = row.blockedUntil;
    vi.setSystemTime(lastAttempt + IDLE_ROW_LIFETIME_MS - 1);
    await expire(t, row._id);
    expect(await rows(t)).toHaveLength(1);
    vi.setSystemTime(lastAttempt + IDLE_ROW_LIFETIME_MS);
    await expire(t, row._id);
    expect(await rows(t)).toEqual([]);
    expect(await expiriesAfter(t, lastAttempt + IDLE_ROW_LIFETIME_MS)).toHaveLength(0);
  });

  test('a row tried again within the day is kept and checked again a day after that attempt', async () => {
    const t = setup();
    await begin(t);
    const id = await onlyRowId(t);
    vi.setSystemTime(START + 12 * HOUR);
    await begin(t);
    vi.setSystemTime(START + IDLE_ROW_LIFETIME_MS);
    await expire(t, id);
    expect(await rows(t)).toMatchObject([{ failures: 2 }]);
    const jobs = await pendingExpiries(t);
    expect(jobs.map((job) => job.scheduledTime)).toContain(
      START + 12 * HOUR + IDLE_ROW_LIFETIME_MS,
    );
  });

  test.each([FREE_FAILURES, HARD_LIMIT])(
    'a row with %i failures is kept and not checked again',
    async (failures) => {
      const t = setup();
      await begin(t);
      const id = await onlyRowId(t);
      await t.run((ctx) => ctx.db.patch('signInFailures', id, { failures }));
      vi.setSystemTime(START + 30 * IDLE_ROW_LIFETIME_MS);
      await expire(t, id);
      expect(await rows(t)).toMatchObject([{ failures }]);
      expect(await expiriesAfter(t, START + IDLE_ROW_LIFETIME_MS)).toHaveLength(0);
    },
  );

  test('a row a sign-in already deleted leaves nothing to do, and a new row gets its own expiry', async () => {
    const t = setup();
    await begin(t);
    const oldId = await onlyRowId(t);
    await t.mutation(internal.signInThrottle.clear, { key: KEY });
    vi.setSystemTime(START + HOUR);
    await begin(t);
    const newId = await onlyRowId(t);
    vi.setSystemTime(START + IDLE_ROW_LIFETIME_MS);
    await expire(t, oldId);
    expect(await rows(t)).toMatchObject([{ _id: newId, failures: 1 }]);
    const jobs = await pendingExpiries(t);
    expect(jobs.map((job): unknown => job.args)).toContainEqual([{ id: newId }]);
  });

  test('only the idle row goes when another address is still being tried', async () => {
    const t = setup();
    await begin(t, 'idle@example.com');
    vi.setSystemTime(START + 20 * HOUR);
    await begin(t, 'busy@example.com');
    const idle = (await rows(t)).find((row) => row.email === 'idle@example.com');
    if (!idle) throw new Error('No row for the idle address');
    vi.setSystemTime(START + IDLE_ROW_LIFETIME_MS);
    await expire(t, idle._id);
    expect((await rows(t)).map((row) => row.email)).toEqual(['busy@example.com']);
  });
});

describe('the scheduled expiry runs on its own', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('a single sprayed address leaves no row once its day has passed', async () => {
    const t = setup();
    await begin(t);
    vi.setSystemTime(START + 6 * HOUR);
    await begin(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows(t)).toEqual([]);
    expect(await pendingExpiries(t)).toHaveLength(0);
  });
});
