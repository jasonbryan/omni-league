/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { TRAINING_PUBLISH_MESSAGES } from './lib/trainingInput';
import type { TrainingPattern } from './lib/trainingPattern';
import {
  insertDraftCamp,
  insertDraftTraining,
  insertTenant,
  insertTrainingClasses,
} from './lib/tenantWrites';
import schema from './schema';
import { insertTournamentProgram, modules } from './test.setup';

// 2027-02-01, a Monday, at noon UTC.
const NOW = Date.UTC(2027, 1, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
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
      locations: [
        { name: 'Alpha Field', address: '1 Alpha St' },
        { name: 'bravo Beach', address: '2 Bravo St' },
      ],
      leagues: [],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const locationIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const alpha = await locationIn(organizationA, 'Alpha Field');
    const bravo = await locationIn(organizationA, 'bravo Beach');
    const bField = await locationIn(organizationB, 'B Field');
    const training = async (
      organizationId: Id<'organizations'>,
      locationIds: Id<'locations'>[],
      name: string,
      slug: string,
    ) => {
      const trainingId = await insertDraftTraining(ctx, organizationId, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds,
        coachName: 'Dana Ruiz',
        minimumAge: 16,
      });
      return { trainingId, programId: (await ctx.db.get('trainings', trainingId))!.programId };
    };
    const tuesday = await training(
      organizationA,
      [bravo, alpha],
      'Tuesday Serving Clinic',
      'tuesday-serving-clinic',
    );
    const thursday = await training(
      organizationA,
      [alpha],
      'Thursday Passing Clinic',
      'thursday-passing-clinic',
    );
    const trainingB = await training(organizationB, [bField], 'B Clinic', 'b-clinic');
    const member = async (
      authUserId: string,
      membership: {
        organizationId: Id<'organizations'>;
        role: 'orgAdmin' | 'leagueOrganizer';
        programIds?: Id<'programs'>[];
      } | null,
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (membership) {
        await ctx.db.insert('memberships', {
          userId,
          organizationId: membership.organizationId,
          role: membership.role,
          leagueIds: [],
          ...(membership.programIds && { programIds: membership.programIds }),
        });
      }
    };
    await member('admin-a', { organizationId: organizationA, role: 'orgAdmin' });
    await member('assigned-a', {
      organizationId: organizationA,
      role: 'leagueOrganizer',
      programIds: [tuesday.programId],
    });
    await member('unassigned-a', {
      organizationId: organizationA,
      role: 'leagueOrganizer',
      programIds: [thursday.programId],
    });
    await member('admin-b', { organizationId: organizationB, role: 'orgAdmin' });
    await member('stranger', null);
    const camp = await insertDraftCamp(ctx, organizationA, {
      name: 'Junior Camp',
      slug: 'junior-camp',
      sport: 'beachVolleyball',
      locationIds: [alpha],
      minimumAge: 9,
      maximumAge: 14,
    });
    await insertTournamentProgram(ctx, organizationA, 'Gulf Coast Beach Open', 'gulf-coast-open');
    return { organizationA, organizationB, alpha, tuesday, thursday, trainingB, camp };
  });
  const as = (authUserId: string) => t.withIdentity(identity(authUserId));
  return {
    t,
    ...ids,
    adminA: as('admin-a'),
    assignedA: as('assigned-a'),
    unassignedA: as('unassigned-a'),
    adminB: as('admin-b'),
    stranger: as('stranger'),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['org admin of another organization', s.adminB, 'Not allowed'],
    ['league organizer not assigned to the training program', s.unassignedA, 'Not allowed'],
    ['non-member', s.stranger, 'Not allowed'],
  ] as const;
}

async function schedule(
  s: Setup,
  training: { trainingId: Id<'trainings'> },
  change: Partial<TrainingPattern> = {},
) {
  await s.t.run(async (ctx) => {
    await insertTrainingClasses(ctx, (await ctx.db.get('trainings', training.trainingId))!, {
      ...PATTERN,
      ...change,
    });
  });
}

const statusOf = (s: Setup, training: { programId: Id<'programs'> }) =>
  s.t.run(async (ctx) => (await ctx.db.get('programs', training.programId))!.status);

const snapshot = (t: Setup['t']) =>
  t.run(async (ctx) => ({
    trainings: await ctx.db.query('trainings').collect(),
    programs: await ctx.db.query('programs').collect(),
    trainingClasses: await ctx.db.query('trainingClasses').collect(),
    organizations: await ctx.db.query('organizations').collect(),
    memberships: await ctx.db.query('memberships').collect(),
  }));

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string; message: string }>).data;
}

describe('trainings.publish', () => {
  test('an org admin publishes a training program with classes: its program and its training row read published and nothing else changes', async () => {
    const s = await setup();
    await schedule(s, s.tuesday);
    const before = await snapshot(s.t);
    expect(
      await s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId }),
    ).toBeNull();
    const after = await snapshot(s.t);
    expect(
      after.programs.filter(
        (program) => program.type === 'training' && program.status === 'published',
      ),
    ).toMatchObject([{ _id: s.tuesday.programId, type: 'training' }]);
    const published = after.trainings.find((row) => row._id === s.tuesday.trainingId);
    expect(published).toMatchObject({
      status: 'published',
      sport: 'beachVolleyball',
      lastClassDate: '2027-02-16',
    });
    expect({
      ...after,
      programs: after.programs.map((program) =>
        program._id === s.tuesday.programId ? { ...program, status: 'draft' as const } : program,
      ),
      trainings: after.trainings.map((row) =>
        row._id === s.tuesday.trainingId ? { ...row, status: 'draft' as const } : row,
      ),
    }).toEqual(before);
  });

  test('keeps the words a search finds the program by, without division words', async () => {
    const s = await setup();
    const draft = await s.t.run((ctx) => ctx.db.get('programs', s.tuesday.programId));
    expect(draft?.searchText).toBe(
      'Tuesday Serving Clinic Beach volleyball Org A bravo Beach Alpha Field',
    );
    await schedule(s, s.tuesday);
    await s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId });
    const program = await s.t.run((ctx) => ctx.db.get('programs', s.tuesday.programId));
    expect(program?.searchText).toBe(
      'Tuesday Serving Clinic Beach volleyball Org A bravo Beach Alpha Field',
    );
  });

  test('refuses a training program with no class as "Schedule the classes first." and keeps the draft', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId })),
    ).toEqual({ code: 'noClasses', message: 'Schedule the classes first.' });
    expect(TRAINING_PUBLISH_MESSAGES.noClasses).toBe('Schedule the classes first.');
    expect(await statusOf(s, s.tuesday)).toBe('draft');
  });

  test('refuses a training program whose classes are all cancelled', async () => {
    const s = await setup();
    await schedule(s, s.tuesday);
    await s.t.run(async (ctx) => {
      for (const row of await ctx.db.query('trainingClasses').collect()) {
        await ctx.db.patch('trainingClasses', row._id, { status: 'cancelled' });
      }
    });
    expect(
      await refusal(s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId })),
    ).toMatchObject({ code: 'noClasses' });
    expect(await statusOf(s, s.tuesday)).toBe('draft');
  });

  test('publishing a published training program changes nothing', async () => {
    const s = await setup();
    await schedule(s, s.tuesday);
    await s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId });
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses an unauthenticated caller, an org admin of another organization, and a league organizer not assigned to the training program, and keeps the draft', async () => {
    const s = await setup();
    await schedule(s, s.tuesday);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await statusOf(s, s.tuesday)).toBe('draft');
  });

  test('refuses a caller who may not organize the training program before it says there is no class', async () => {
    const s = await setup();
    await expect(
      s.unassignedA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId }),
    ).rejects.toThrow('Not allowed');
  });

  test('a league organizer assigned to the training program publishes it', async () => {
    const s = await setup();
    await schedule(s, s.tuesday);
    await s.assignedA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId });
    expect(await statusOf(s, s.tuesday)).toBe('published');
  });

  test("refuses another organization's training program to an org admin, and one that does not exist", async () => {
    const s = await setup();
    await schedule(s, s.trainingB);
    await expect(
      s.adminA.mutation(api.trainings.publish, { trainingId: s.trainingB.trainingId }),
    ).rejects.toThrow('Not allowed');
    await s.t.run((ctx) => ctx.db.delete('trainings', s.thursday.trainingId));
    await expect(
      s.adminA.mutation(api.trainings.publish, { trainingId: s.thursday.trainingId }),
    ).rejects.toThrow('Not allowed');
  });
});

describe('the training row keeps its status, sport, and last class date', () => {
  const rowOf = (s: Setup) =>
    s.t.run(async (ctx) => {
      const row = (await ctx.db.get('trainings', s.tuesday.trainingId))!;
      return { status: row.status, sport: row.sport, lastClassDate: row.lastClassDate };
    });

  test('a draft has its status and sport and no class date until classes are scheduled', async () => {
    const s = await setup();
    expect(await rowOf(s)).toEqual({
      status: 'draft',
      sport: 'beachVolleyball',
      lastClassDate: undefined,
    });
    await schedule(s, s.tuesday);
    expect(await rowOf(s)).toEqual({
      status: 'draft',
      sport: 'beachVolleyball',
      lastClassDate: '2027-02-16',
    });
  });

  test('cancelling the last class moves the date to the class before it, and restoring it moves it back', async () => {
    const s = await setup();
    await schedule(s, s.tuesday);
    const last = await s.t.run(async (ctx) =>
      (await ctx.db.query('trainingClasses').collect()).find((row) => row.date === '2027-02-16')!,
    );
    await s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: last._id });
    expect((await rowOf(s)).lastClassDate).toBe('2027-02-09');
    await s.adminA.mutation(api.trainingClasses.restore, { trainingClassId: last._id });
    expect((await rowOf(s)).lastClassDate).toBe('2027-02-16');
  });

  test('cancelling every class leaves no class date', async () => {
    const s = await setup();
    await schedule(s, s.tuesday, { weeks: 1 });
    const only = await s.t.run(async (ctx) => (await ctx.db.query('trainingClasses').first())!);
    await s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: only._id });
    expect((await rowOf(s)).lastClassDate).toBeUndefined();
  });
});

describe('trainings.getPublicPage', () => {
  const slugs = { orgSlug: 'org-a', trainingSlug: 'tuesday-serving-clinic' };

  async function published(s: Setup) {
    await schedule(s, s.tuesday);
    await s.t.run(async (ctx) => {
      const rows = await ctx.db.query('trainingClasses').collect();
      const second = rows.find((row) => row.date === '2027-02-09')!;
      await ctx.db.patch('trainingClasses', second._id, { registeredCount: 5 });
      const third = rows.find((row) => row.date === '2027-02-16')!;
      await ctx.db.patch('trainingClasses', third._id, { registeredCount: 12 });
    });
    await s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId });
  }

  test('gives a signed-out caller the published training program with its classes in date order and the places left of each', async () => {
    const s = await setup();
    await published(s);
    expect(await s.t.query(api.trainings.getPublicPage, slugs)).toEqual({
      organization: { name: 'Org A', slug: 'org-a' },
      name: 'Tuesday Serving Clinic',
      slug: 'tuesday-serving-clinic',
      sportName: 'Beach volleyball',
      coachName: 'Dana Ruiz',
      minimumAge: 16,
      locations: [
        { name: 'bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      pattern: {
        weekday: 2,
        startTime: '18:00',
        endTime: '19:00',
        firstDate: '2027-02-02',
        weeks: 3,
        registrationDeadline: '2027-02-01',
      },
      classes: [
        { date: '2027-02-02', startTime: '18:00', endTime: '19:00', placesLeft: 12 },
        { date: '2027-02-09', startTime: '18:00', endTime: '19:00', placesLeft: 7 },
        { date: '2027-02-16', startTime: '18:00', endTime: '19:00', placesLeft: 0 },
      ],
    });
  });

  test('holds no id and no registrant data', async () => {
    const s = await setup();
    await published(s);
    const page = await s.t.query(api.trainings.getPublicPage, slugs);
    expect(JSON.stringify(page)).not.toMatch(/"_id"|trainingClassId|registeredCount|userId/);
  });

  test('leaves out the classes that had passed and the cancelled ones', async () => {
    const s = await setup();
    await published(s);
    await s.t.run(async (ctx) => {
      const rows = await ctx.db.query('trainingClasses').collect();
      await ctx.db.patch('trainingClasses', rows.find((row) => row.date === '2027-02-09')!._id, {
        status: 'cancelled',
      });
    });
    vi.setSystemTime(Date.UTC(2027, 1, 3, 12, 0, 0));
    const page = await s.t.query(api.trainings.getPublicPage, slugs);
    expect(page?.classes.map((row) => row.date)).toEqual(['2027-02-16']);
  });

  test('lists no class once every class has passed, and still answers', async () => {
    const s = await setup();
    await published(s);
    vi.setSystemTime(Date.UTC(2027, 1, 20, 12, 0, 0));
    const page = await s.t.query(api.trainings.getPublicPage, slugs);
    expect(page?.name).toBe('Tuesday Serving Clinic');
    expect(page?.classes).toEqual([]);
  });

  test('gives every caller the same answer', async () => {
    const s = await setup();
    await published(s);
    const anonymous = await s.t.query(api.trainings.getPublicPage, slugs);
    expect(await s.adminA.query(api.trainings.getPublicPage, slugs)).toEqual(anonymous);
    expect(await s.adminB.query(api.trainings.getPublicPage, slugs)).toEqual(anonymous);
  });

  test('is null for a draft, even for its org admin, and answers once it is published', async () => {
    const s = await setup();
    await schedule(s, s.tuesday);
    expect(await s.t.query(api.trainings.getPublicPage, slugs)).toBeNull();
    expect(await s.adminA.query(api.trainings.getPublicPage, slugs)).toBeNull();
    await s.adminA.mutation(api.trainings.publish, { trainingId: s.tuesday.trainingId });
    expect(await s.t.query(api.trainings.getPublicPage, slugs)).not.toBeNull();
  });

  test("is null for an unknown organization, an unknown web address, a camp's, a tournament's, and another organization's", async () => {
    const s = await setup();
    await published(s);
    for (const args of [
      { orgSlug: 'nowhere', trainingSlug: 'tuesday-serving-clinic' },
      { orgSlug: 'org-a', trainingSlug: 'no-such-training' },
      { orgSlug: 'org-a', trainingSlug: 'junior-camp' },
      { orgSlug: 'org-a', trainingSlug: 'gulf-coast-open' },
      { orgSlug: 'org-b', trainingSlug: 'tuesday-serving-clinic' },
    ]) {
      expect(await s.t.query(api.trainings.getPublicPage, args), JSON.stringify(args)).toBeNull();
    }
  });

  test('leaves out a location of another organization', async () => {
    const s = await setup();
    await published(s);
    const foreign = await s.t.run(async (ctx) =>
      (await ctx.db.query('locations').collect()).find((row) => row.name === 'B Field')!,
    );
    await s.t.run(async (ctx) => {
      const program = (await ctx.db.get('programs', s.tuesday.programId))!;
      await ctx.db.patch('programs', program._id, {
        locationIds: [...program.locationIds, foreign._id],
      });
    });
    const page = await s.t.query(api.trainings.getPublicPage, slugs);
    expect(page?.locations.map((row) => row.name)).toEqual(['bravo Beach', 'Alpha Field']);
  });

  test('is null for a published program that has no pattern', async () => {
    const s = await setup();
    await published(s);
    await s.t.run((ctx) => ctx.db.patch('trainings', s.tuesday.trainingId, { pattern: undefined }));
    expect(await s.t.query(api.trainings.getPublicPage, slugs)).toBeNull();
  });
});
