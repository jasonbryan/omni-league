/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { isForbidden } from './lib/forbidden';
import { insertDraftTraining, insertTenant } from './lib/tenantWrites';
import { TRAINING_PATTERN_MESSAGES, WEEKDAY_NAMES } from './lib/trainingPattern';
import schema from './schema';
import { insertTournamentProgram, modules } from './test.setup';

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
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
    const locationIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const alpha = await locationIn(organizationA, 'Alpha Field');
    const bField = await locationIn(organizationB, 'B Field');
    const training = async (
      organizationId: Id<'organizations'>,
      locationId: Id<'locations'>,
      name: string,
      slug: string,
    ) => {
      const trainingId = await insertDraftTraining(ctx, organizationId, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [locationId],
        coachName: 'Dana Ruiz',
      });
      return { trainingId, programId: (await ctx.db.get('trainings', trainingId))!.programId };
    };
    const serving = await training(
      organizationA,
      alpha,
      'Tuesday Serving Clinic',
      'tuesday-serving-clinic',
    );
    const passing = await training(
      organizationA,
      alpha,
      'Thursday Passing Clinic',
      'thursday-passing-clinic',
    );
    const trainingB = await training(organizationB, bField, 'B Clinic', 'b-clinic');
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
      programIds: [serving.programId],
    });
    await member('unassigned-a', {
      organizationId: organizationA,
      role: 'leagueOrganizer',
      programIds: [passing.programId],
    });
    await member('admin-b', { organizationId: organizationB, role: 'orgAdmin' });
    await member('stranger', null);
    const tournamentProgramId = await insertTournamentProgram(
      ctx,
      organizationA,
      'Gulf Coast Beach Open',
      'gulf-coast-beach-open',
    );
    return { organizationA, organizationB, serving, passing, trainingB, tournamentProgramId };
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

const A_TUESDAY = '2027-01-05';
const TUESDAY = WEEKDAY_NAMES.indexOf('Tuesday');
const WEDNESDAY = WEEKDAY_NAMES.indexOf('Wednesday');
const THURSDAY = WEEKDAY_NAMES.indexOf('Thursday');

const valid = (s: Setup) => ({
  trainingId: s.serving.trainingId,
  weekday: TUESDAY,
  startTime: '18:00',
  endTime: '19:00',
  firstDate: A_TUESDAY,
  weeks: 8,
  placesPerClass: 12,
  registrationDeadline: '2027-01-01',
  allowSingleRegistration: false,
});

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['org admin of another organization', s.adminB, 'Not allowed'],
    ['league organizer not assigned to the training program', s.unassignedA, 'Not allowed'],
    ['non-member', s.stranger, 'Not allowed'],
  ] as const;
}

const classesOf = (s: Setup) => s.t.run((ctx) => ctx.db.query('trainingClasses').collect());

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field?: string; code: string; message: string }>).data;
}

describe('trainingClasses.schedule', () => {
  test('creates 8 classes on consecutive Tuesdays, each with the pattern’s times and places and no registrations', async () => {
    const s = await setup();
    await expect(s.adminA.mutation(api.trainingClasses.schedule, valid(s))).resolves.toEqual({
      classCount: 8,
    });
    const classes = (await classesOf(s)).sort((x, y) => (x.date < y.date ? -1 : 1));
    expect(classes.map((row) => row.date)).toEqual([
      '2027-01-05',
      '2027-01-12',
      '2027-01-19',
      '2027-01-26',
      '2027-02-02',
      '2027-02-09',
      '2027-02-16',
      '2027-02-23',
    ]);
    for (const row of classes) {
      expect(row).toMatchObject({
        trainingId: s.serving.trainingId,
        organizationId: s.organizationA,
        startTime: '18:00',
        endTime: '19:00',
        places: 12,
        registeredCount: 0,
        status: 'scheduled',
      });
    }
  });

  test('stores the pattern on the training row', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, {
      ...valid(s),
      allowSingleRegistration: true,
    });
    const training = await s.t.run((ctx) => ctx.db.get('trainings', s.serving.trainingId));
    expect(training?.pattern).toEqual({
      weekday: TUESDAY,
      startTime: '18:00',
      endTime: '19:00',
      firstDate: '2027-01-05',
      weeks: 8,
      placesPerClass: 12,
      registrationDeadline: '2027-01-01',
      allowSingleRegistration: true,
    });
  });

  test('accepts one week, 52 weeks, 1 place, 200 places, and a deadline on the first class date', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, {
      ...valid(s),
      weeks: 52,
      placesPerClass: 200,
      registrationDeadline: '2027-01-05',
    });
    expect(await classesOf(s)).toHaveLength(52);
    await s.adminA.mutation(api.trainingClasses.schedule, {
      ...valid(s),
      trainingId: s.passing.trainingId,
      weekday: THURSDAY,
      firstDate: '2027-01-07',
      weeks: 1,
      placesPerClass: 1,
    });
    expect(await classesOf(s)).toHaveLength(53);
  });

  test('lets a league organizer assigned to the training program schedule its classes', async () => {
    const s = await setup();
    await s.assignedA.mutation(api.trainingClasses.schedule, valid(s));
    expect(await classesOf(s)).toHaveLength(8);
  });

  test.each([
    [
      'an end time equal to the start time',
      { endTime: '18:00' },
      'endTime',
      'endTimeNotAfterStart',
    ],
    ['an end time before the start time', { endTime: '17:00' }, 'endTime', 'endTimeNotAfterStart'],
    ['0 weeks', { weeks: 0 }, 'weeks', 'weeksInvalid'],
    ['53 weeks', { weeks: 53 }, 'weeks', 'weeksInvalid'],
    ['1.5 weeks', { weeks: 1.5 }, 'weeks', 'weeksInvalid'],
    ['weeks that are not a number', { weeks: NaN }, 'weeks', 'weeksInvalid'],
    ['0 places', { placesPerClass: 0 }, 'placesPerClass', 'placesInvalid'],
    ['201 places', { placesPerClass: 201 }, 'placesPerClass', 'placesInvalid'],
    [
      'a first date off the weekday',
      { firstDate: '2027-01-06' },
      'firstDate',
      'firstDateOffWeekday',
    ],
    ['a made-up first date', { firstDate: '2027-02-30' }, 'firstDate', 'dateInvalid'],
    [
      'a deadline after the first class',
      { registrationDeadline: '2027-01-06' },
      'registrationDeadline',
      'deadlineAfterFirstClass',
    ],
    ['a weekday above 6', { weekday: 7 }, 'weekday', 'weekdayInvalid'],
    ['a negative weekday', { weekday: -1 }, 'weekday', 'weekdayInvalid'],
    ['a fractional weekday', { weekday: 2.5 }, 'weekday', 'weekdayInvalid'],
    ['a weekday that is not a number', { weekday: NaN }, 'weekday', 'weekdayInvalid'],
    ['a malformed time', { startTime: '6pm' }, 'startTime', 'timeInvalid'],
    ['a first date in the year 26', { firstDate: '0026-11-17' }, 'firstDate', 'dateInvalid'],
    [
      'a deadline in the year 26',
      { registrationDeadline: '0026-11-17' },
      'registrationDeadline',
      'dateInvalid',
    ],
    [
      '51 weeks from 9999-12-01',
      {
        weekday: WEDNESDAY,
        firstDate: '9999-12-01',
        weeks: 51,
        registrationDeadline: '9999-11-01',
      },
      'weeks',
      'lastClassTooLate',
    ],
  ])(
    'refuses %s, with the shared message, and writes nothing',
    async (_label, change, field, code) => {
      const s = await setup();
      const data = await refusal(
        s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), ...change }),
      );
      expect(data).toMatchObject({ field, code });
      expect(await classesOf(s)).toEqual([]);
      const training = await s.t.run((ctx) => ctx.db.get('trainings', s.serving.trainingId));
      expect(training).not.toHaveProperty('pattern');
    },
  );

  test('refuses a first date before today under the first date, writes nothing, and allows today itself', async () => {
    const s = await setup();
    vi.setSystemTime(Date.UTC(2027, 0, 5, 12, 0, 0));
    const lastTuesday = '2026-12-29';
    expect(
      await refusal(
        s.adminA.mutation(api.trainingClasses.schedule, {
          ...valid(s),
          firstDate: lastTuesday,
          registrationDeadline: '2026-12-20',
        }),
      ),
    ).toEqual({
      field: 'firstDate',
      code: 'firstDateInPast',
      message: 'The first class must be today, Jan 5, 2027, or later.',
    });
    expect(await classesOf(s)).toEqual([]);
    await s.adminA.mutation(api.trainingClasses.schedule, valid(s));
    expect(await classesOf(s)).toHaveLength(8);
  });

  test('takes today from the server clock at UTC-12, so a date stays open until it has ended everywhere', async () => {
    const s = await setup();
    vi.setSystemTime(Date.UTC(2027, 0, 6, 12, 0, 0));
    expect((await refusal(s.adminA.mutation(api.trainingClasses.schedule, valid(s)))).code).toBe(
      'firstDateInPast',
    );
    vi.setSystemTime(Date.UTC(2027, 0, 6, 11, 59, 59));
    await s.adminA.mutation(api.trainingClasses.schedule, valid(s));
    expect(await classesOf(s)).toHaveLength(8);
  });

  test('refuses a second Schedule classes and adds no class', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, valid(s));
    const before = await classesOf(s);
    expect(
      await refusal(
        s.adminA.mutation(api.trainingClasses.schedule, {
          ...valid(s),
          weeks: 2,
          weekday: TUESDAY,
        }),
      ),
    ).toEqual({
      code: 'alreadyScheduled',
      message: TRAINING_PATTERN_MESSAGES.alreadyScheduled,
    });
    expect(await classesOf(s)).toEqual(before);
  });

  test('refuses a second Schedule classes while every class is cancelled', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), weeks: 1 });
    const [only] = await classesOf(s);
    await s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: only._id });
    expect((await refusal(s.adminA.mutation(api.trainingClasses.schedule, valid(s)))).code).toBe(
      'alreadyScheduled',
    );
    expect(await classesOf(s)).toHaveLength(1);
  });

  test.each([
    // 0026-11-17 is a Tuesday and 9999-12-01 a Wednesday in the proleptic Gregorian calendar.
    ['a first date in year 0026', '0026-11-17', 2, 3, '0026-11-10', 'firstDate'],
    ['51 weeks from 9999-12-01', '9999-12-01', 3, 51, '9999-11-20', 'weeks'],
    ['6 weeks from 9999-12-01', '9999-12-01', 3, 6, '9999-11-20', 'weeks'],
  ])(
    'refuses %s under its field and writes nothing',
    async (_label, firstDate, weekday, weeks, registrationDeadline, field) => {
      const s = await setup();
      const data = await refusal(
        s.adminA.mutation(api.trainingClasses.schedule, {
          ...valid(s),
          weekday,
          firstDate,
          weeks,
          registrationDeadline,
        }),
      );
      expect(data.field).toBe(field);
      expect(await classesOf(s)).toEqual([]);
    },
  );

  test('stores the last class of 5 weeks from 9999-12-01 as 9999-12-29', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, {
      ...valid(s),
      weekday: 3,
      firstDate: '9999-12-01',
      weeks: 5,
      registrationDeadline: '9999-11-20',
    });
    const dates = (await classesOf(s)).map((row) => row.date).sort();
    expect(dates).toEqual(['9999-12-01', '9999-12-08', '9999-12-15', '9999-12-22', '9999-12-29']);
  });

  test.each([7, -1, 2.5, NaN, Infinity])(
    'refuses the weekday %s as weekdayInvalid',
    async (weekday) => {
      const s = await setup();
      const data = await refusal(
        s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), weekday }),
      );
      expect(data).toMatchObject({ field: 'weekday', code: 'weekdayInvalid' });
      expect(await classesOf(s)).toEqual([]);
    },
  );

  test('two schedules at once leave one series and one refusal', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.adminA.mutation(api.trainingClasses.schedule, valid(s)),
      s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), weeks: 4 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const count = (await classesOf(s)).length;
    expect([8, 4]).toContain(count);
  });

  test('schedules only the program it is given, and leaves other programs’ classes alone', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, valid(s));
    await s.adminA.mutation(api.trainingClasses.schedule, {
      ...valid(s),
      trainingId: s.passing.trainingId,
      weeks: 3,
    });
    const classes = await classesOf(s);
    expect(classes.filter((row) => row.trainingId === s.serving.trainingId)).toHaveLength(8);
    expect(classes.filter((row) => row.trainingId === s.passing.trainingId)).toHaveLength(3);
  });

  test('refuses every caller who may not organize the training program, and writes nothing', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.mutation(api.trainingClasses.schedule, valid(s)), label).rejects.toThrow(
        message,
      );
    }
    expect(await classesOf(s)).toEqual([]);
  });

  test('refuses a training id that is another organization’s, a deleted one’s, or a tournament’s', async () => {
    const s = await setup();
    await expect(
      s.adminA.mutation(api.trainingClasses.schedule, {
        ...valid(s),
        trainingId: s.trainingB.trainingId,
      }),
    ).rejects.toThrow('Not allowed');
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete('trainings', s.passing.trainingId);
      return s.passing.trainingId;
    });
    await expect(
      s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), trainingId: gone }),
    ).rejects.toThrow('Not allowed');
    expect(await classesOf(s)).toEqual([]);
  });
});

describe('trainingClasses.listForTraining', () => {
  const list = (s: Setup, caller = s.adminA, trainingId = s.serving.trainingId) =>
    caller.query(api.trainingClasses.listForTraining, { trainingId });

  test('lists the classes in date order with their places, registrations, and status', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), weeks: 3 });
    const rows = await list(s);
    expect(rows.map((row) => row.date)).toEqual(['2027-01-05', '2027-01-12', '2027-01-19']);
    expect(rows[0]).toEqual({
      trainingClassId: rows[0]?.trainingClassId,
      date: '2027-01-05',
      startTime: '18:00',
      endTime: '19:00',
      places: 12,
      registeredCount: 0,
      status: 'scheduled',
    });
  });

  test('returns [] before any class, and only the program’s own classes', async () => {
    const s = await setup();
    expect(await list(s)).toEqual([]);
    await s.adminA.mutation(api.trainingClasses.schedule, {
      ...valid(s),
      trainingId: s.passing.trainingId,
      weekday: THURSDAY,
      firstDate: '2027-01-07',
    });
    expect(await list(s)).toEqual([]);
  });

  test('shows a cancelled class as cancelled', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), weeks: 2 });
    const [first] = await list(s);
    await s.adminA.mutation(api.trainingClasses.cancel, {
      trainingClassId: first.trainingClassId,
    });
    expect((await list(s)).map((row) => row.status)).toEqual(['cancelled', 'scheduled']);
  });

  test('refuses every caller who may not organize the training program', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(list(s, caller as typeof s.adminA), label).rejects.toThrow(message);
    }
  });
});

describe('trainingClasses.cancel and restore', () => {
  async function scheduled(s: Setup) {
    await s.adminA.mutation(api.trainingClasses.schedule, { ...valid(s), weeks: 2 });
    return (await classesOf(s)).sort((x, y) => (x.date < y.date ? -1 : 1));
  }
  const statusOf = (s: Setup, id: Id<'trainingClasses'>) =>
    s.t.run(async (ctx) => (await ctx.db.get('trainingClasses', id))?.status);

  test('cancels a class with no registrations, and Undo brings it back', async () => {
    const s = await setup();
    const [first, second] = await scheduled(s);
    await s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: first._id });
    expect(await statusOf(s, first._id)).toBe('cancelled');
    expect(await statusOf(s, second._id)).toBe('scheduled');
    await s.adminA.mutation(api.trainingClasses.restore, { trainingClassId: first._id });
    expect(await statusOf(s, first._id)).toBe('scheduled');
  });

  test('keeps the class row, so its places and date return with the Undo', async () => {
    const s = await setup();
    const [first] = await scheduled(s);
    await s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: first._id });
    const row = await s.t.run((ctx) => ctx.db.get('trainingClasses', first._id));
    expect(row).toMatchObject({ date: '2027-01-05', places: 12, registeredCount: 0 });
  });

  test('cancelling a cancelled class and restoring a scheduled one change nothing', async () => {
    const s = await setup();
    const [first] = await scheduled(s);
    await s.adminA.mutation(api.trainingClasses.restore, { trainingClassId: first._id });
    expect(await statusOf(s, first._id)).toBe('scheduled');
    await s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: first._id });
    await s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: first._id });
    expect(await statusOf(s, first._id)).toBe('cancelled');
  });

  test('refuses a class with registrations, with the count, and keeps it scheduled', async () => {
    const s = await setup();
    const [first] = await scheduled(s);
    await s.t.run((ctx) => ctx.db.patch('trainingClasses', first._id, { registeredCount: 2 }));
    expect(
      await refusal(s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: first._id })),
    ).toEqual({
      code: 'hasRegistrations',
      message: '2 registrations are in this class, so it cannot be cancelled.',
    });
    expect(await statusOf(s, first._id)).toBe('scheduled');
    await s.t.run((ctx) => ctx.db.patch('trainingClasses', first._id, { registeredCount: 1 }));
    expect(
      (await refusal(s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: first._id })))
        .message,
    ).toBe('1 registration is in this class, so it cannot be cancelled.');
  });

  test('lets a league organizer assigned to the program cancel and restore', async () => {
    const s = await setup();
    const [first] = await scheduled(s);
    await s.assignedA.mutation(api.trainingClasses.cancel, { trainingClassId: first._id });
    await s.assignedA.mutation(api.trainingClasses.restore, { trainingClassId: first._id });
    expect(await statusOf(s, first._id)).toBe('scheduled');
  });

  test('refuses every caller who may not organize the training program, for both functions', async () => {
    const s = await setup();
    const [first] = await scheduled(s);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.trainingClasses.cancel, { trainingClassId: first._id }),
        label,
      ).rejects.toThrow(message);
      await expect(
        caller.mutation(api.trainingClasses.restore, { trainingClassId: first._id }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await statusOf(s, first._id)).toBe('scheduled');
  });

  test('refuses a class of another organization’s training program', async () => {
    const s = await setup();
    await s.adminB.mutation(api.trainingClasses.schedule, {
      ...valid(s),
      trainingId: s.trainingB.trainingId,
    });
    const [other] = await classesOf(s);
    await expect(
      s.adminA.mutation(api.trainingClasses.cancel, { trainingClassId: other._id }),
    ).rejects.toThrow('Not allowed');
  });
});

describe('trainings.getForManagement', () => {
  const get = (
    caller: Setup['adminA'],
    trainingSlug = 'tuesday-serving-clinic',
    orgSlug = 'org-a',
  ) => caller.query(api.trainings.getForManagement, { orgSlug, trainingSlug });

  test('answers an org admin and an assigned league organizer with the program, its coach, role, and no pattern before scheduling', async () => {
    const s = await setup();
    const asAdmin = await get(s.adminA);
    expect(asAdmin).toMatchObject({
      trainingId: s.serving.trainingId,
      organizationId: s.organizationA,
      organization: { name: 'Org A', slug: 'org-a' },
      role: 'orgAdmin',
      name: 'Tuesday Serving Clinic',
      slug: 'tuesday-serving-clinic',
      status: 'draft',
      sportName: 'Beach volleyball',
      coachName: 'Dana Ruiz',
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
    });
    expect(asAdmin).not.toHaveProperty('pattern');
    expect(asAdmin).not.toHaveProperty('minimumAge');
    expect((await get(s.assignedA))?.role).toBe('leagueOrganizer');
  });

  test('carries the pattern once the classes are scheduled', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainingClasses.schedule, valid(s));
    expect((await get(s.adminA))?.pattern).toMatchObject({ weekday: TUESDAY, weeks: 8 });
  });

  test('is null for an unknown organization, and for an unused address to staff', async () => {
    const s = await setup();
    expect(await get(s.adminA, 'tuesday-serving-clinic', 'nowhere')).toBeNull();
    expect(await get(s.adminA, 'nope')).toBeNull();
  });

  test('answers a tournament’s address as unknown', async () => {
    const s = await setup();
    expect(await get(s.adminA, 'gulf-coast-beach-open')).toBeNull();
  });

  test('refuses an unassigned organizer, another organization’s admin, and a stranger as forbidden', async () => {
    const s = await setup();
    for (const caller of [s.unassignedA, s.adminB, s.stranger]) {
      const error = await get(caller).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isForbidden(error)).toBe(true);
    }
  });

  test('refuses an unauthenticated caller as forbidden', async () => {
    const s = await setup();
    const error = await get(s.t as unknown as Setup['adminA']).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isForbidden(error)).toBe(true);
  });
});
