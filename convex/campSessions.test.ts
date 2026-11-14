/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CAMP_SESSION_MESSAGES } from './lib/campSessionInput';
import { insertCampSession, insertDraftCamp, insertTenant } from './lib/tenantWrites';
import { isForbidden } from './lib/forbidden';
import schema from './schema';
import { insertTournamentProgram, modules } from './test.setup';

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
    const camp = async (
      organizationId: Id<'organizations'>,
      locationId: Id<'locations'>,
      name: string,
      slug: string,
    ) => {
      const campId = await insertDraftCamp(ctx, organizationId, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [locationId],
        minimumAge: 9,
        maximumAge: 14,
      });
      return { campId, programId: (await ctx.db.get('camps', campId))!.programId };
    };
    const junior = await camp(
      organizationA,
      alpha,
      'Junior Beach Volleyball Camp',
      'junior-beach-volleyball-camp',
    );
    const fall = await camp(organizationA, alpha, 'Fall Break Camp', 'fall-break-camp');
    const campB = await camp(organizationB, bField, 'B Camp', 'b-camp');
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
      programIds: [junior.programId],
    });
    await member('unassigned-a', {
      organizationId: organizationA,
      role: 'leagueOrganizer',
      programIds: [fall.programId],
    });
    await member('admin-b', { organizationId: organizationB, role: 'orgAdmin' });
    await member('stranger', null);
    const tournamentProgramId = await insertTournamentProgram(
      ctx,
      organizationA,
      'Gulf Coast Beach Open',
      'gulf-coast-beach-open',
    );
    return { organizationA, organizationB, junior, fall, campB, tournamentProgramId };
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

const valid = (s: Setup) => ({
  campId: s.junior.campId,
  name: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  places: 20,
  registrationDeadline: '2027-07-01',
});

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['org admin of another organization', s.adminB, 'Not allowed'],
    ['league organizer not assigned to the camp', s.unassignedA, 'Not allowed'],
    ['non-member', s.stranger, 'Not allowed'],
  ] as const;
}

const sessionsOf = (s: Setup) => s.t.run((ctx) => ctx.db.query('campSessions').collect());

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field?: string; code: string; message: string }>).data;
}

describe('campSessions.add', () => {
  test('writes a session with no registrations, in the camp’s organization, and trims the name', async () => {
    const s = await setup();
    const { campSessionId } = await s.adminA.mutation(api.campSessions.add, {
      ...valid(s),
      name: '  Week 1  ',
    });
    const [stored] = await sessionsOf(s);
    expect([stored]).toEqual([
      {
        _id: campSessionId,
        _creationTime: stored._creationTime,
        campId: s.junior.campId,
        organizationId: s.organizationA,
        name: 'Week 1',
        startDate: '2027-07-05',
        endDate: '2027-07-09',
        dailyStartTime: '09:00',
        dailyEndTime: '12:00',
        places: 20,
        registrationDeadline: '2027-07-01',
        registeredCount: 0,
      },
    ]);
  });

  test('stores no daily times when none are given', async () => {
    const s = await setup();
    await s.adminA.mutation(api.campSessions.add, {
      ...valid(s),
      dailyStartTime: undefined,
      dailyEndTime: undefined,
    });
    const [session] = await sessionsOf(s);
    expect(session).not.toHaveProperty('dailyStartTime');
    expect(session).not.toHaveProperty('dailyEndTime');
  });

  test('lets a league organizer assigned to the camp add a session', async () => {
    const s = await setup();
    await s.assignedA.mutation(api.campSessions.add, valid(s));
    expect(await sessionsOf(s)).toHaveLength(1);
  });

  test('accepts a one-day session, a deadline on the start date, and the limits of the places', async () => {
    const s = await setup();
    await s.adminA.mutation(api.campSessions.add, {
      ...valid(s),
      endDate: '2027-07-05',
      registrationDeadline: '2027-07-05',
      places: 1,
    });
    await s.adminA.mutation(api.campSessions.add, { ...valid(s), places: 500 });
    expect((await sessionsOf(s)).map((row) => row.places)).toEqual([1, 500]);
  });

  test('refuses an end before the start, under the end date, and writes nothing', async () => {
    const s = await setup();
    expect(
      await refusal(
        s.adminA.mutation(api.campSessions.add, { ...valid(s), endDate: '2027-07-04' }),
      ),
    ).toEqual({
      field: 'endDate',
      code: 'endBeforeStart',
      message: CAMP_SESSION_MESSAGES.endBeforeStart,
    });
    expect(await sessionsOf(s)).toEqual([]);
  });

  test('refuses a deadline after the start, under the deadline, and writes nothing', async () => {
    const s = await setup();
    expect(
      await refusal(
        s.adminA.mutation(api.campSessions.add, {
          ...valid(s),
          registrationDeadline: '2027-07-06',
        }),
      ),
    ).toEqual({
      field: 'registrationDeadline',
      code: 'deadlineAfterStart',
      message: CAMP_SESSION_MESSAGES.deadlineAfterStart('2027-07-05'),
    });
    expect(await sessionsOf(s)).toEqual([]);
  });

  test.each([
    ['an empty name', { name: '   ' }, 'name', 'nameEmpty'],
    ['a name over 100 characters', { name: 'x'.repeat(101) }, 'name', 'nameTooLong'],
    ['a date that is not real', { startDate: '2027-02-30' }, 'startDate', 'dateInvalid'],
    ['no places', { places: 0 }, 'places', 'placesInvalid'],
    ['501 places', { places: 501 }, 'places', 'placesInvalid'],
    ['a fraction of a place', { places: 2.5 }, 'places', 'placesInvalid'],
    ['places that are not a number', { places: NaN }, 'places', 'placesInvalid'],
    ['a time that is not HH:MM', { dailyStartTime: '9am' }, 'dailyStartTime', 'timeInvalid'],
    ['only a start time', { dailyEndTime: undefined }, 'dailyEndTime', 'timeMissing'],
    [
      'an end time before the start',
      { dailyEndTime: '08:00' },
      'dailyEndTime',
      'endTimeNotAfterStart',
    ],
  ])('refuses %s with the field’s error', async (_label, change, field, code) => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.campSessions.add, { ...valid(s), ...change })),
    ).toMatchObject({ field, code });
    expect(await sessionsOf(s)).toEqual([]);
  });

  test('refuses every caller who may not organize the camp, and writes nothing', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.mutation(api.campSessions.add, valid(s)), label).rejects.toThrow(message);
    }
    expect(await sessionsOf(s)).toEqual([]);
  });

  test('refuses another organization’s camp to an org admin, even with valid input', async () => {
    const s = await setup();
    await expect(
      s.adminA.mutation(api.campSessions.add, { ...valid(s), campId: s.campB.campId }),
    ).rejects.toThrow('Not allowed');
  });
});

describe('campSessions.listForCamp', () => {
  test('lists a camp’s sessions in date order, with the places and registrations', async () => {
    const s = await setup();
    for (const [name, startDate] of [
      ['Week 3', '2027-07-19'],
      ['Week 1', '2027-07-05'],
      ['Week 2', '2027-07-12'],
    ] as const) {
      await s.adminA.mutation(api.campSessions.add, {
        ...valid(s),
        name,
        startDate,
        endDate: startDate,
        registrationDeadline: startDate,
      });
    }
    await s.adminA.mutation(api.campSessions.add, { ...valid(s), campId: s.fall.campId });
    const rows = await s.adminA.query(api.campSessions.listForCamp, { campId: s.junior.campId });
    expect(rows.map((row) => row.name)).toEqual(['Week 1', 'Week 2', 'Week 3']);
    expect(rows[0]).toEqual({
      campSessionId: rows[0].campSessionId,
      name: 'Week 1',
      startDate: '2027-07-05',
      endDate: '2027-07-05',
      dailyStartTime: '09:00',
      dailyEndTime: '12:00',
      places: 20,
      registrationDeadline: '2027-07-05',
      registeredCount: 0,
    });
  });

  test('answers an assigned league organizer, and an empty list for a camp with no sessions', async () => {
    const s = await setup();
    expect(
      await s.assignedA.query(api.campSessions.listForCamp, { campId: s.junior.campId }),
    ).toEqual([]);
  });

  test('refuses every caller who may not organize the camp', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.campSessions.listForCamp, { campId: s.junior.campId }),
        label,
      ).rejects.toThrow(message);
    }
  });
});

describe('campSessions.remove', () => {
  test('deletes a session with no registrations, and Undo adds it back with the same values', async () => {
    const s = await setup();
    const { campSessionId } = await s.adminA.mutation(api.campSessions.add, valid(s));
    const [before] = await s.adminA.query(api.campSessions.listForCamp, {
      campId: s.junior.campId,
    });
    await s.adminA.mutation(api.campSessions.remove, { campSessionId });
    expect(await sessionsOf(s)).toEqual([]);

    await s.adminA.mutation(api.campSessions.add, valid(s));
    const [after] = await s.adminA.query(api.campSessions.listForCamp, { campId: s.junior.campId });
    expect({ ...after, campSessionId: null }).toEqual({ ...before, campSessionId: null });
  });

  test('refuses a session with registrations, says how many, and keeps it', async () => {
    const s = await setup();
    const { campSessionId } = await s.adminA.mutation(api.campSessions.add, valid(s));
    await s.t.run((ctx) => ctx.db.patch('campSessions', campSessionId, { registeredCount: 3 }));
    expect(await refusal(s.adminA.mutation(api.campSessions.remove, { campSessionId }))).toEqual({
      code: 'hasRegistrations',
      message: CAMP_SESSION_MESSAGES.hasRegistrations(3),
    });
    expect(await sessionsOf(s)).toHaveLength(1);
  });

  test('lets a league organizer assigned to the camp delete a session', async () => {
    const s = await setup();
    const { campSessionId } = await s.adminA.mutation(api.campSessions.add, valid(s));
    await s.assignedA.mutation(api.campSessions.remove, { campSessionId });
    expect(await sessionsOf(s)).toEqual([]);
  });

  test('refuses every caller who may not organize the camp, and keeps the session', async () => {
    const s = await setup();
    const { campSessionId } = await s.adminA.mutation(api.campSessions.add, valid(s));
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.campSessions.remove, { campSessionId }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await sessionsOf(s)).toHaveLength(1);
  });

  test('refuses a session that no longer exists', async () => {
    const s = await setup();
    const { campSessionId } = await s.adminA.mutation(api.campSessions.add, valid(s));
    await s.adminA.mutation(api.campSessions.remove, { campSessionId });
    await expect(s.adminA.mutation(api.campSessions.remove, { campSessionId })).rejects.toThrow(
      'Not allowed',
    );
  });
});

describe('camps.getForManagement', () => {
  const slugs = { orgSlug: 'org-a', campSlug: 'junior-beach-volleyball-camp' };

  test('answers an org admin with the camp, its organization, and the role', async () => {
    const s = await setup();
    expect(await s.adminA.query(api.camps.getForManagement, slugs)).toEqual({
      campId: s.junior.campId,
      organizationId: s.organizationA,
      organization: { name: 'Org A', slug: 'org-a' },
      role: 'orgAdmin',
      name: 'Junior Beach Volleyball Camp',
      slug: 'junior-beach-volleyball-camp',
      status: 'draft',
      sportName: 'Beach volleyball',
      minimumAge: 9,
      maximumAge: 14,
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
    });
  });

  test('answers a league organizer assigned to the camp, with their role', async () => {
    const s = await setup();
    expect(await s.assignedA.query(api.camps.getForManagement, slugs)).toMatchObject({
      campId: s.junior.campId,
      role: 'leagueOrganizer',
    });
  });

  test('is forbidden to a league organizer not assigned to it, a non-member, and a signed-out caller', async () => {
    const s = await setup();
    for (const caller of [s.unassignedA, s.stranger, s.adminB, s.t]) {
      const error = await caller.query(api.camps.getForManagement, slugs).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isForbidden(error)).toBe(true);
    }
  });

  test('is null for a camp slug that is another organization’s, a tournament, or unused, and for an unknown organization', async () => {
    const s = await setup();
    for (const campSlug of ['b-camp', 'gulf-coast-beach-open', 'no-such-camp']) {
      expect(
        await s.adminA.query(api.camps.getForManagement, { orgSlug: 'org-a', campSlug }),
        campSlug,
      ).toBeNull();
    }
    expect(
      await s.adminA.query(api.camps.getForManagement, { ...slugs, orgSlug: 'no-such-org' }),
    ).toBeNull();
    expect(
      await s.t.query(api.camps.getForManagement, { ...slugs, orgSlug: 'no-such-org' }),
    ).toBeNull();
  });

  test('tells only staff that a web address is unused', async () => {
    const s = await setup();
    const error = await s.stranger
      .query(api.camps.getForManagement, { orgSlug: 'org-a', campSlug: 'no-such-camp' })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(isForbidden(error)).toBe(true);
  });
});

describe('camps.listForOrganization session counts', () => {
  test('counts each camp’s sessions', async () => {
    const s = await setup();
    await s.adminA.mutation(api.campSessions.add, valid(s));
    await s.adminA.mutation(api.campSessions.add, { ...valid(s), name: 'Week 2' });
    await s.adminA.mutation(api.campSessions.add, { ...valid(s), campId: s.fall.campId });
    const rows = await s.adminA.query(api.camps.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(Object.fromEntries(rows.map((row) => [row.slug, row.sessionCount]))).toEqual({
      'junior-beach-volleyball-camp': 2,
      'fall-break-camp': 1,
    });
  });

  test('is 0 for a camp with no sessions', async () => {
    const s = await setup();
    const rows = await s.adminA.query(api.camps.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(rows.map((row) => row.sessionCount)).toEqual([0, 0]);
  });
});

describe('insertCampSession', () => {
  test('writes a session of the camp with no registrations', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const camp = (await ctx.db.get('camps', s.junior.campId))!;
      await insertCampSession(ctx, camp, {
        name: 'Week 1',
        startDate: '2027-07-05',
        endDate: '2027-07-09',
        places: 20,
        registrationDeadline: '2027-07-01',
      });
    });
    expect(await sessionsOf(s)).toMatchObject([
      { campId: s.junior.campId, organizationId: s.organizationA, registeredCount: 0 },
    ]);
  });
});
