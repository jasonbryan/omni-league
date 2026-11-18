/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  insertDraftTraining,
  insertTenant,
  insertTrainingClasses,
  publishTraining,
} from './lib/tenantWrites';
import type { TrainingPattern } from './lib/trainingPattern';
import type { Sport } from './lib/sports';
import schema from './schema';
import { modules } from './test.setup';

// 2027-02-01, a Monday, at noon UTC.
const NOW = Date.UTC(2027, 1, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// 2027-02-02 is a Tuesday.
const PATTERN: TrainingPattern = {
  weekday: 2,
  startTime: '18:00',
  endTime: '19:00',
  firstDate: '2027-02-02',
  weeks: 3,
  placesPerClass: 12,
  registrationDeadline: '2027-02-01',
  allowSingleRegistration: false,
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const location = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    return {
      organizationA,
      organizationB,
      alpha: await location(organizationA, 'Alpha Field'),
      bField: await location(organizationB, 'B Field'),
    };
  });
  type Ids = typeof ids;
  async function add(
    name: string,
    options: {
      organization?: 'organizationA' | 'organizationB';
      sport?: Sport;
      publish?: boolean;
      pattern?: Partial<TrainingPattern>;
      minimumAge?: number;
    } = {},
  ) {
    const { organization = 'organizationA', sport = 'beachVolleyball', publish = true } = options;
    return t.run(async (ctx) => {
      const organizationId = ids[organization];
      const trainingId = await insertDraftTraining(ctx, organizationId, {
        name,
        slug: name.toLowerCase().replaceAll(' ', '-'),
        sport,
        locationIds: [organization === 'organizationA' ? ids.alpha : ids.bField],
        coachName: 'Dana Ruiz',
        ...(options.minimumAge !== undefined && { minimumAge: options.minimumAge }),
      });
      const training = (await ctx.db.get('trainings', trainingId))!;
      await insertTrainingClasses(ctx, training, { ...PATTERN, ...options.pattern });
      if (publish) await publishTraining(ctx, (await ctx.db.get('trainings', trainingId))!);
      return trainingId;
    });
  }
  return { t, ...ids, add } satisfies { t: unknown } & Ids & { add: unknown };
}

const list = (s: Awaited<ReturnType<typeof setup>>, page = 1, sport?: Sport) =>
  s.t.query(api.trainings.listPublic, {
    organizationSlug: 'org-a',
    page,
    ...(sport !== undefined && { sport }),
  });

describe('trainings.listPublic', () => {
  test('lists a published training program with its pattern, coach, ages, and place names', async () => {
    const s = await setup();
    await s.add('Tuesday Serving Clinic', { minimumAge: 16 });
    expect(await list(s)).toEqual({
      rows: [
        {
          name: 'Tuesday Serving Clinic',
          slug: 'tuesday-serving-clinic',
          sportName: 'Beach volleyball',
          coachName: 'Dana Ruiz',
          minimumAge: 16,
          locationNames: ['Alpha Field'],
          weekday: 2,
          startTime: '18:00',
          endTime: '19:00',
          firstDate: '2027-02-02',
          registrationDeadline: '2027-02-01',
          weeks: 3,
          lastClassDate: '2027-02-16',
        },
      ],
      page: 1,
      pageCount: 1,
      total: 1,
    });
  });

  test('lists no draft, no program of another organization, and none whose classes have all passed', async () => {
    const s = await setup();
    await s.add('Draft Clinic', { publish: false });
    await s.add('Other Clinic', { organization: 'organizationB' });
    await s.add('Ended Clinic', { pattern: { firstDate: '2027-02-02', weeks: 1 } });
    await s.add('Open Clinic');
    vi.setSystemTime(Date.UTC(2027, 1, 10, 12, 0, 0));
    expect((await list(s)).rows.map((row) => row.name)).toEqual(['Open Clinic']);
    vi.setSystemTime(Date.UTC(2027, 1, 20, 12, 0, 0));
    expect(await list(s)).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test('is empty for an unknown organization', async () => {
    const s = await setup();
    expect(
      await s.t.query(api.trainings.listPublic, { organizationSlug: 'nowhere', page: 1 }),
    ).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test('lists only the chosen sport', async () => {
    const s = await setup();
    await s.add('Sand Clinic');
    await s.add('Ball Clinic', { sport: 'soccer' });
    expect((await list(s, 1, 'soccer')).rows.map((row) => row.name)).toEqual(['Ball Clinic']);
    expect((await list(s, 1, 'beachVolleyball')).rows.map((row) => row.name)).toEqual([
      'Sand Clinic',
    ]);
    expect((await list(s)).total).toBe(2);
  });

  test('pages 7 programs 5 and 2, and a page past the last shows page 1', async () => {
    const s = await setup();
    for (let i = 1; i <= 7; i++) await s.add(`Clinic ${i}`, { pattern: { weeks: i } });
    const first = await list(s);
    const second = await list(s, 2);
    expect([first.rows.length, first.page, first.pageCount, first.total]).toEqual([5, 1, 2, 7]);
    expect([second.rows.length, second.page]).toEqual([2, 2]);
    expect((await list(s, 3)).page).toBe(1);
    expect([...first.rows, ...second.rows].map((row) => row.name)).toEqual(
      Array.from({ length: 7 }, (_, i) => `Clinic ${i + 1}`),
    );
  });

  test('drops a program whose classes were all cancelled', async () => {
    const s = await setup();
    const trainingId = await s.add('Cancelled Clinic', { pattern: { weeks: 1 } });
    const only = await s.t.run(async (ctx) => (await ctx.db.query('trainingClasses').first())!);
    const admin = s.t.withIdentity({
      subject: 'admin-a',
      issuer: 'http://127.0.0.1:3211',
      email: 'admin-a@example.test',
      emailVerified: false,
      name: 'admin-a',
      sessionId: 's1',
    });
    await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        authUserId: 'admin-a',
        name: 'admin-a',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId: s.organizationA,
        role: 'orgAdmin',
        leagueIds: [],
      });
    });
    expect((await list(s)).rows).toHaveLength(1);
    await admin.mutation(api.trainingClasses.cancel, { trainingClassId: only._id });
    expect((await list(s)).rows).toEqual([]);
    expect(trainingId).toBeDefined();
  });
});
