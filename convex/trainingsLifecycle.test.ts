/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { insertDraftTraining, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// 2027-02-01, a Monday, at noon UTC.
const NOW = Date.UTC(2027, 1, 1, 12, 0, 0);
const SLUGS = { orgSlug: 'gulf', trainingSlug: 'tuesday-serving-clinic' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const trainingId = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
      locations: [{ name: 'North Beach Sand Courts', address: '1 Beach Rd' }],
      leagues: [],
    });
    const location = (await ctx.db.query('locations').first())!._id;
    const userId = await ctx.db.insert('users', {
      authUserId: 'admin',
      name: 'admin',
      adultConfirmedAt: 1,
    });
    await ctx.db.insert('memberships', {
      userId,
      organizationId,
      role: 'orgAdmin',
      leagueIds: [],
    });
    return insertDraftTraining(ctx, organizationId, {
      name: 'Tuesday Serving Clinic',
      slug: 'tuesday-serving-clinic',
      sport: 'beachVolleyball',
      locationIds: [location],
      coachName: 'Dana Ruiz',
    });
  });
  const admin = t.withIdentity({
    subject: 'admin',
    issuer: 'http://127.0.0.1:3211',
    email: 'admin@example.test',
    emailVerified: false,
    name: 'admin',
    sessionId: 's1',
  });
  return { t, admin, trainingId };
}

type Harness = Awaited<ReturnType<typeof setup>>;

const schedule = (s: Harness) =>
  s.admin.mutation(api.trainingClasses.schedule, {
    trainingId: s.trainingId,
    weekday: 2,
    startTime: '18:00',
    endTime: '19:00',
    firstDate: '2027-02-02',
    weeks: 3,
    placesPerClass: 10,
    registrationDeadline: '2027-02-01',
    allowSingleRegistration: false,
  });

const classIds = (s: Harness) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query('trainingClasses').collect())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => row._id),
  );

// A whole row: a bare `undefined` returned from `t.run` comes back as `null`.
const lastClassDate = async (s: Harness) =>
  (await s.t.run(async (ctx) => (await ctx.db.get('trainings', s.trainingId))!)).lastClassDate;

async function listedEverywhere(s: Harness): Promise<boolean[]> {
  const page = await s.t.query(api.trainings.listPublic, { organizationSlug: 'gulf', page: 1 });
  const browse = await s.t.query(api.search.programsBrowse, { page: 1, withTraining: true });
  const search = await s.t.query(api.search.programs, { q: 'serving', withTraining: true });
  return [
    page.rows.length === 1,
    browse.rows.some((row) => row.type === 'training'),
    browse.typeCounts.some(({ type }) => type === 'training'),
    search.rows.some((row) => row.type === 'training'),
  ];
}

describe('a training program through schedule, publish, cancel and restore', () => {
  test('is never public as a draft, then public everywhere once published', async () => {
    const s = await setup();
    await schedule(s);
    expect(await s.t.query(api.trainings.getPublicPage, SLUGS)).toBeNull();
    expect(await listedEverywhere(s)).toEqual([false, false, false, false]);
    expect(await lastClassDate(s)).toBe('2027-02-16');

    await s.admin.mutation(api.trainings.publish, { trainingId: s.trainingId });
    expect((await s.t.query(api.trainings.getPublicPage, SLUGS))?.classes).toHaveLength(3);
    expect(await listedEverywhere(s)).toEqual([true, true, true, true]);
  });

  test('a published program whose every class is cancelled is listed nowhere and its page has no class', async () => {
    const s = await setup();
    await schedule(s);
    await s.admin.mutation(api.trainings.publish, { trainingId: s.trainingId });
    for (const trainingClassId of await classIds(s)) {
      await s.admin.mutation(api.trainingClasses.cancel, { trainingClassId });
    }
    expect(await lastClassDate(s)).toBeUndefined();
    const page = await s.t.query(api.trainings.getPublicPage, SLUGS);
    expect(page?.classes).toEqual([]);
    expect(page?.everyClassCancelled).toBe(true);
    expect(await listedEverywhere(s)).toEqual([false, false, false, false]);

    const [first] = await classIds(s);
    await s.admin.mutation(api.trainingClasses.restore, { trainingClassId: first });
    expect(await lastClassDate(s)).toBe('2027-02-02');
    expect(await listedEverywhere(s)).toEqual([true, true, true, true]);
    expect(
      (await s.t.query(api.trainings.getPublicPage, SLUGS))?.everyClassCancelled,
    ).toBeUndefined();
  });

  test('a program whose held classes have all passed is ended, not cancelled', async () => {
    const s = await setup();
    await schedule(s);
    await s.admin.mutation(api.trainings.publish, { trainingId: s.trainingId });
    vi.setSystemTime(Date.UTC(2027, 1, 20, 12, 0, 0));
    const page = await s.t.query(api.trainings.getPublicPage, SLUGS);
    expect(page?.classes).toEqual([]);
    expect(page?.everyClassCancelled).toBeUndefined();
    expect(await listedEverywhere(s)).toEqual([false, false, false, false]);
  });

  test('two publishes at once both succeed and leave one published program', async () => {
    const s = await setup();
    await schedule(s);
    await Promise.all([
      s.admin.mutation(api.trainings.publish, { trainingId: s.trainingId }),
      s.admin.mutation(api.trainings.publish, { trainingId: s.trainingId }),
    ]);
    const row = await s.t.run(async (ctx) => ({
      training: await ctx.db.get('trainings', s.trainingId),
      programs: await ctx.db.query('programs').collect(),
    }));
    expect(row.training?.status).toBe('published');
    expect(row.programs.map(({ status }) => status)).toEqual(['published']);
  });

  test('a call from before training was searchable, with no withTraining, gets no training row and no count', async () => {
    const s = await setup();
    await schedule(s);
    await s.admin.mutation(api.trainings.publish, { trainingId: s.trainingId });
    const browse = await s.t.query(api.search.programsBrowse, { page: 1 });
    const search = await s.t.query(api.search.programs, { q: 'serving' });
    const camps = await s.t.query(api.search.programsBrowse, { page: 1, withCamps: true });
    for (const result of [browse, search, camps]) {
      expect(result.rows).toEqual([]);
      expect(result.typeCounts.some(({ type }) => type === 'training')).toBe(false);
    }
  });
});
