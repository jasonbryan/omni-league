/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { StandardLevel } from './lib/divisions';
import type { Sport } from './lib/sports';
import {
  checkTournamentFields,
  firstTournamentError,
  TOURNAMENT_MESSAGES,
} from './lib/tournamentInput';
import { PUBLIC_LIST_MAX_ROWS } from './lib/publicList';
import type { TournamentEditable } from './lib/tournamentEdit';
import { addCalendarDays, dateAtUtcMinus12 } from './lib/registration';
import {
  defaultDivision,
  insertCustomLevel,
  insertDraftTournament,
  insertTenant,
  publishTournament,
} from './lib/tenantWrites';
import schema from './schema';
import { modules, tournamentProgramFields } from './test.setup';
import { isForbidden } from './lib/forbidden';
import { ADMIN_TOURNAMENTS_LIMIT } from './tournaments';

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
      locations: [
        { name: 'bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      leagues: [
        {
          name: 'Coed 7v7',
          sport: 'soccer',
          locations: ['Alpha Field'],
          division: defaultDivision('soccer'),
        },
      ],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [
        {
          name: 'Sand 2s',
          sport: 'beachVolleyball',
          locations: ['B Field'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const locationIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds: [] });
      }
    };
    await member('admin-a', organizationA);
    await member('organizer-a', organizationA, 'leagueOrganizer');
    await member('admin-b', organizationB);
    await member('stranger', null);
    return {
      organizationA,
      organizationB,
      alpha: await locationIn(organizationA, 'Alpha Field'),
      bravo: await locationIn(organizationA, 'bravo Beach'),
      bField: await locationIn(organizationB, 'B Field'),
    };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    adminB: t.withIdentity(identity('admin-b')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const valid = (s: Setup) => ({
  organizationId: s.organizationA,
  name: 'Winter Doubles Classic',
  slug: 'winter-doubles-classic',
  sport: 'beachVolleyball' as const,
  locationIds: [s.bravo],
  gender: 'coed' as const,
  playersPerSide: 2,
  level: 'open' as const,
  ageGroup: 'adult',
  startDate: '2027-01-16',
  endDate: '2027-01-17',
  registrationDeadline: '2027-01-09',
  maximumTeams: 16,
});

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
    ['league organizer of A', s.t.withIdentity(identity('organizer-a')), 'Not allowed'],
    ['org admin of B', s.adminB, 'Not allowed'],
    ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
  ] as const;
}

const snapshot = (t: Setup['t']) =>
  t.run(async (ctx) => ({
    tournaments: await ctx.db.query('tournaments').collect(),
    programs: await ctx.db.query('programs').collect(),
    leagues: await ctx.db.query('leagues').collect(),
    organizations: await ctx.db.query('organizations').collect(),
    sportLocations: await ctx.db.query('sportLocations').collect(),
  }));

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

describe('tournaments.create', () => {
  test('writes a draft tournament and its program of type tournament, in the right organization', async () => {
    const s = await setup();
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      ...valid(s),
      locationIds: [s.bravo, s.alpha],
      gender: 'womens',
      ageGroup: 'over40',
    });
    const { tournament, program } = await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', tournamentId))!;
      return { tournament, program: await ctx.db.get('programs', tournament.programId) };
    });
    expect(tournament).toEqual({
      _id: tournamentId,
      _creationTime: tournament._creationTime,
      programId: program?._id,
      organizationId: s.organizationA,
      status: 'draft',
      sport: 'beachVolleyball',
      startDate: '2027-01-16',
      endDate: '2027-01-17',
      registrationDeadline: '2027-01-09',
      maximumTeams: 16,
      minimumRosterSize: 2,
      structure: 'bracket',
      bracketType: 'single',
    });
    expect(program).toMatchObject({
      organizationId: s.organizationA,
      type: 'tournament',
      name: 'Winter Doubles Classic',
      sortName: 'winter doubles classic',
      slug: 'winter-doubles-classic',
      sport: 'beachVolleyball',
      status: 'draft',
      locationIds: [s.bravo, s.alpha],
      gender: 'womens',
      playersPerSide: 2,
      level: 'open',
      ageGroup: 'over40',
    });
    expect(program).not.toHaveProperty('leagueId');
  });

  test('a blank end date is a one-day tournament, which ends on its start date', async () => {
    const s = await setup();
    const oneDay: Partial<ReturnType<typeof valid>> = valid(s);
    delete oneDay.endDate;
    const { tournamentId } = await s.adminA.mutation(
      api.tournaments.create,
      oneDay as ReturnType<typeof valid>,
    );
    expect(await s.t.run((ctx) => ctx.db.get('tournaments', tournamentId))).toMatchObject({
      startDate: '2027-01-16',
      endDate: '2027-01-16',
    });
  });

  test('an empty end date is a one-day tournament too, never stored as empty', async () => {
    const s = await setup();
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      ...valid(s),
      endDate: '',
    });
    expect(await s.t.run((ctx) => ctx.db.get('tournaments', tournamentId))).toMatchObject({
      startDate: '2027-01-16',
      endDate: '2027-01-16',
    });
  });

  test('the minimum roster size is the division’s players per side', async () => {
    const s = await setup();
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      ...valid(s),
      sport: 'soccer',
      level: 'rec',
      playersPerSide: 7,
    });
    expect(await s.t.run((ctx) => ctx.db.get('tournaments', tournamentId))).toMatchObject({
      minimumRosterSize: 7,
    });
  });

  test('trims the name and keeps each location once', async () => {
    const s = await setup();
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      ...valid(s),
      name: '  Winter Doubles Classic ',
      locationIds: [s.bravo, s.bravo],
    });
    const tournament = await s.t.run((ctx) => ctx.db.get('tournaments', tournamentId));
    const program = await s.t.run((ctx) => ctx.db.get('programs', tournament!.programId));
    expect(program).toMatchObject({ name: 'Winter Doubles Classic', locationIds: [s.bravo] });
  });

  test('changes no league counter and writes no league, season, or sportLocations row', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.tournaments.create, valid(s));
    const after = await snapshot(s.t);
    expect(after.leagues).toEqual(before.leagues);
    expect(after.organizations).toEqual(before.organizations);
    expect(after.sportLocations).toEqual(before.sportLocations);
    expect(after.programs.filter((row) => row.type === 'league')).toEqual(
      before.programs.filter((row) => row.type === 'league'),
    );
  });

  describe('with a custom level', () => {
    const customLevel = (
      s: Setup,
      organizationId: Id<'organizations'>,
      sport: 'beachVolleyball' | 'soccer',
      standardLevel: 'a' | 'rec',
    ) =>
      s.t.run((ctx) =>
        insertCustomLevel(ctx, organizationId, { sport, name: 'Gold', standardLevel }),
      );

    test('stores the id and the level it filters as, whatever level the caller sent', async () => {
      const s = await setup();
      const customLevelId = await customLevel(s, s.organizationA, 'beachVolleyball', 'a');
      const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
        ...valid(s),
        level: 'rec',
        customLevelId,
      });
      const tournament = await s.t.run((ctx) => ctx.db.get('tournaments', tournamentId));
      expect(await s.t.run((ctx) => ctx.db.get('programs', tournament!.programId))).toMatchObject({
        level: 'a',
        customLevelId,
      });
    });

    test('refuses a level of another organization or of another sport, and writes nothing', async () => {
      const s = await setup();
      const before = await snapshot(s.t);
      const other = await customLevel(s, s.organizationB, 'beachVolleyball', 'a');
      const otherSport = await customLevel(s, s.organizationA, 'soccer', 'rec');
      for (const customLevelId of [other, otherSport]) {
        await expect(
          s.adminA.mutation(api.tournaments.create, { ...valid(s), customLevelId }),
        ).rejects.toThrow('Not allowed');
      }
      expect(await snapshot(s.t)).toEqual(before);
    });
  });

  test('refuses an end date before the start, a deadline after it, and a maximum outside 2 to 128, with the shared message under the field', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    const cases = [
      { endDate: '2027-01-15' },
      { registrationDeadline: '2027-01-17' },
      { maximumTeams: 1 },
      { maximumTeams: 129 },
      { maximumTeams: 2.5 },
    ];
    for (const change of cases) {
      const args = { ...valid(s), ...change };
      const shared = firstTournamentError(
        checkTournamentFields({
          name: args.name,
          slug: args.slug,
          sport: args.sport,
          playersPerSide: args.playersPerSide,
          level: args.level,
          ageGroup: args.ageGroup,
          locationCount: 1,
          startDate: args.startDate,
          endDate: args.endDate,
          registrationDeadline: args.registrationDeadline,
          maximumTeams: args.maximumTeams,
        }),
      );
      expect(shared).not.toBeNull();
      expect(await refusal(s.adminA.mutation(api.tournaments.create, args))).toEqual(shared);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('accepts the limits: a deadline on the start date, and 2 and 128 teams', async () => {
    const s = await setup();
    await expect(
      s.adminA.mutation(api.tournaments.create, {
        ...valid(s),
        registrationDeadline: '2027-01-16',
        maximumTeams: 2,
      }),
    ).resolves.toBeDefined();
    await expect(
      s.adminA.mutation(api.tournaments.create, {
        ...valid(s),
        slug: 'second-classic',
        maximumTeams: 128,
      }),
    ).resolves.toBeDefined();
  });

  test('refuses a date that is not a real one, and the empty start date and deadline', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.tournaments.create, { ...valid(s), startDate: '' })),
    ).toMatchObject({ field: 'startDate', code: 'dateEmpty' });
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.create, { ...valid(s), registrationDeadline: '' }),
      ),
    ).toMatchObject({ field: 'registrationDeadline', code: 'dateEmpty' });
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.create, { ...valid(s), endDate: '2027-02-30' }),
      ),
    ).toMatchObject({ field: 'endDate', code: 'dateInvalid' });
  });

  test('refuses an empty name, one over 100 characters, and a malformed or reserved web address', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.tournaments.create, { ...valid(s), name: '   ' })),
    ).toMatchObject({ field: 'name', code: 'nameEmpty' });
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.create, { ...valid(s), name: 'x'.repeat(101) }),
      ),
    ).toMatchObject({ field: 'name', code: 'nameTooLong' });
    for (const slug of ['', 'ab', 'Winter', 'new']) {
      expect(
        (await refusal(s.adminA.mutation(api.tournaments.create, { ...valid(s), slug }))).field,
      ).toBe('slug');
    }
  });

  test('refuses a format outside the sport’s range, a level of another sport, and an unknown age group, with the field’s error', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.tournaments.create, { ...valid(s), playersPerSide: 7 })),
    ).toMatchObject({ field: 'format', code: 'formatInvalid' });
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.create, { ...valid(s), level: 'competitive' }),
      ),
    ).toMatchObject({ field: 'level', code: 'levelInvalid' });
    expect(
      await refusal(s.adminA.mutation(api.tournaments.create, { ...valid(s), ageGroup: 'over99' })),
    ).toMatchObject({ field: 'ageGroup', code: 'ageGroupInvalid' });
  });

  test('refuses no location, and a location of another organization, alone or among its own', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    expect(
      await refusal(s.adminA.mutation(api.tournaments.create, { ...valid(s), locationIds: [] })),
    ).toMatchObject({ field: 'locations', code: 'locationsEmpty' });
    for (const locationIds of [[s.bField], [s.bravo, s.bField]]) {
      await expect(
        s.adminA.mutation(api.tournaments.create, { ...valid(s), locationIds }),
      ).rejects.toThrow('Not allowed');
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses a web address a league of the organization holds, and allows it in another organization', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    expect(
      await refusal(s.adminA.mutation(api.tournaments.create, { ...valid(s), slug: 'coed-7v7' })),
    ).toEqual({
      field: 'slug',
      code: 'slugTaken',
      message: TOURNAMENT_MESSAGES.slugTaken('coed-7v7'),
    });
    expect(await snapshot(s.t)).toEqual(before);
    await expect(
      s.adminB.mutation(api.tournaments.create, {
        ...valid(s),
        organizationId: s.organizationB,
        locationIds: [s.bField],
        slug: 'coed-7v7',
      }),
    ).resolves.toBeDefined();
  });

  test('refuses a web address a tournament of the organization holds, so a second create keeps the first', async () => {
    const s = await setup();
    await s.adminA.mutation(api.tournaments.create, valid(s));
    const before = await snapshot(s.t);
    expect(await refusal(s.adminA.mutation(api.tournaments.create, valid(s)))).toMatchObject({
      field: 'slug',
      code: 'slugTaken',
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses a web address a program with no row in leagues or tournaments holds', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
    });
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.create, { ...valid(s), slug: 'summer-open' }),
      ),
    ).toMatchObject({ field: 'slug', code: 'slugTaken' });
  });

  test('two creates of the same web address at once leave one tournament and one refusal', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.adminA.mutation(api.tournaments.create, valid(s)),
      s.adminA.mutation(api.tournaments.create, { ...valid(s), name: 'Other Name' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rows = await s.t.run((ctx) => ctx.db.query('tournaments').collect());
    expect(rows).toHaveLength(1);
  });

  test('a league cannot then take the web address of a tournament', async () => {
    const s = await setup();
    await s.adminA.mutation(api.tournaments.create, valid(s));
    const available = (slug: string) =>
      s.adminA.query(api.leagues.isSlugAvailable, { organizationId: s.organizationA, slug });
    expect(await available('winter-doubles-classic')).toBe(false);
    expect(
      await refusal(
        s.adminA.mutation(api.leagues.create, {
          organizationId: s.organizationA,
          name: 'Winter',
          slug: 'winter-doubles-classic',
          sport: 'soccer',
          locationIds: [s.alpha],
          gender: 'coed',
          playersPerSide: 7,
          level: 'rec',
          ageGroup: 'adult',
        }),
      ),
    ).toMatchObject({ field: 'slug', code: 'slugTaken' });
  });

  test('refuses every caller who is not an org admin of the organization, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.mutation(api.tournaments.create, valid(s)), label).rejects.toThrow(
        message,
      );
    }
    expect(await snapshot(s.t)).toEqual(before);
  });
});

describe('tournaments.isSlugAvailable', () => {
  const available = (s: Setup, slug: string) =>
    s.adminA.query(api.tournaments.isSlugAvailable, { organizationId: s.organizationA, slug });

  test('is true for a free web address and false for one a league, a tournament, or another program holds', async () => {
    const s = await setup();
    await s.adminA.mutation(api.tournaments.create, valid(s));
    await s.t.run(async (ctx) => {
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
    });
    expect(await available(s, 'spring-doubles-classic')).toBe(true);
    expect(await available(s, 'coed-7v7')).toBe(false);
    expect(await available(s, 'winter-doubles-classic')).toBe(false);
    expect(await available(s, 'summer-open')).toBe(false);
  });

  test('is false for an address no one could choose, and true for the same one in another organization', async () => {
    const s = await setup();
    expect(await available(s, 'new')).toBe(false);
    expect(await available(s, 'ab')).toBe(false);
    expect(
      await s.adminB.query(api.tournaments.isSlugAvailable, {
        organizationId: s.organizationB,
        slug: 'coed-7v7',
      }),
    ).toBe(true);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.tournaments.isSlugAvailable, {
          organizationId: s.organizationA,
          slug: 'spring-open',
        }),
        label,
      ).rejects.toThrow(message);
    }
  });
});

describe('tournaments.listForOrganization', () => {
  test('lists the organization’s tournaments with name, slug, dates, and status, the latest start first', async () => {
    const s = await setup();
    await s.adminA.mutation(api.tournaments.create, valid(s));
    await s.adminA.mutation(api.tournaments.create, {
      ...valid(s),
      name: 'Spring Open',
      slug: 'spring-open',
      startDate: '2027-04-10',
      endDate: '2027-04-10',
      registrationDeadline: '2027-04-03',
    });
    const rows = await s.adminA.query(api.tournaments.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(
      rows.map(({ tournamentId, programId, ...row }) => [
        typeof tournamentId,
        typeof programId,
        row,
      ]),
    ).toEqual([
      [
        'string',
        'string',
        {
          name: 'Spring Open',
          slug: 'spring-open',
          startDate: '2027-04-10',
          endDate: '2027-04-10',
          status: 'draft',
        },
      ],
      [
        'string',
        'string',
        {
          name: 'Winter Doubles Classic',
          slug: 'winter-doubles-classic',
          startDate: '2027-01-16',
          endDate: '2027-01-17',
          status: 'draft',
        },
      ],
    ]);
  });

  test('names each tournament’s program id, the id an invite assigns', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const [row] = await s.adminA.query(api.tournaments.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(row.programId).toBe((await programOf(s, tournamentId))._id);
  });

  test('shows a published tournament as published', async () => {
    const s = await setup();
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, valid(s));
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', tournamentId))!;
      await ctx.db.patch('programs', tournament.programId, { status: 'published' });
    });
    const rows = await s.adminA.query(api.tournaments.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(rows.map((row) => row.status)).toEqual(['published']);
  });

  test('never returns another organization’s tournaments, and returns [] for an organization with none', async () => {
    const s = await setup();
    await s.adminA.mutation(api.tournaments.create, valid(s));
    expect(
      await s.adminB.query(api.tournaments.listForOrganization, {
        organizationId: s.organizationB,
      }),
    ).toEqual([]);
  });

  test('reads at most the limit', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let n = 0; n < ADMIN_TOURNAMENTS_LIMIT + 3; n++) {
        const slug = `open-${String(n).padStart(3, '0')}`;
        const programId = await ctx.db.insert(
          'programs',
          tournamentProgramFields(s.organizationA, slug),
        );
        await ctx.db.insert('tournaments', {
          programId,
          organizationId: s.organizationA,
          status: 'published',
          sport: 'soccer',
          startDate: '2027-01-16',
          endDate: '2027-01-16',
          registrationDeadline: '2027-01-09',
          maximumTeams: 8,
          minimumRosterSize: 4,
          structure: 'bracket',
          bracketType: 'single',
        });
      }
    });
    const rows = await s.adminA.query(api.tournaments.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(rows).toHaveLength(ADMIN_TOURNAMENTS_LIMIT);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    await s.adminA.mutation(api.tournaments.create, valid(s));
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.tournaments.listForOrganization, { organizationId: s.organizationA }),
        label,
      ).rejects.toThrow(message);
    }
  });
});

type Overrides = Partial<Omit<ReturnType<typeof valid>, 'sport' | 'level'>> & {
  sport?: Sport;
  level?: StandardLevel;
  customLevelId?: Id<'customLevels'>;
};

async function draftIn(s: Setup, overrides: Overrides = {}) {
  const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
    ...valid(s),
    ...overrides,
  });
  return tournamentId;
}

const programOf = (s: Setup, tournamentId: Id<'tournaments'>) =>
  s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', tournamentId))!;
    return (await ctx.db.get('programs', tournament.programId))!;
  });

async function assign(s: Setup, authUserId: string, ...tournamentIds: Id<'tournaments'>[]) {
  await s.t.run(async (ctx) => {
    const user = (await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique())!;
    const membership = (await ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', user._id))
      .first())!;
    const programIds = [];
    for (const id of tournamentIds)
      programIds.push((await ctx.db.get('tournaments', id))!.programId);
    await ctx.db.patch('memberships', membership._id, { programIds });
  });
}

async function forbiddenBy(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isForbidden(error)).toBe(true);
}

describe('tournaments.publish', () => {
  test('an org admin publishes a draft: its program and tournament read published and nothing else changes', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    const after = await snapshot(s.t);
    const asDraft = (rows: typeof after.programs) =>
      rows.map((program) =>
        program.type === 'tournament' ? { ...program, status: 'draft' as const } : program,
      );
    expect(after.programs.filter((program) => program.type === 'tournament')).toMatchObject([
      { status: 'published' },
    ]);
    expect(after.tournaments).toMatchObject([{ status: 'published' }]);
    expect({
      ...after,
      programs: asDraft(after.programs),
      tournaments: after.tournaments.map((row) => ({ ...row, status: 'draft' as const })),
    }).toEqual(before);
  });

  test('publishing a published tournament changes nothing', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses every caller who is not an org admin of the organization, and keeps the draft', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.tournaments.publish, { tournamentId }),
        label,
      ).rejects.toThrow(message);
    }
    expect((await programOf(s, tournamentId)).status).toBe('draft');
  });

  test('an organizer assigned to the tournament publishes it', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await assign(s, 'organizer-a', tournamentId);
    await s.t
      .withIdentity(identity('organizer-a'))
      .mutation(api.tournaments.publish, { tournamentId });
    expect((await programOf(s, tournamentId)).status).toBe('published');
  });

  test('refuses an organizer assigned to another tournament, and an assignment that names another organization’s program', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const other = await draftIn(s, { name: 'Other Open', slug: 'other-open' });
    await assign(s, 'organizer-a', other);
    await expect(
      s.t.withIdentity(identity('organizer-a')).mutation(api.tournaments.publish, { tournamentId }),
    ).rejects.toThrow('Not allowed');
    const bProgram = await s.t.run((ctx) =>
      ctx.db.insert('programs', {
        ...tournamentProgramFields(s.organizationB, 'b-open'),
        locationIds: [s.bField],
      }),
    );
    await s.t.run(async (ctx) => {
      const user = (await ctx.db
        .query('users')
        .withIndex('by_authUserId', (q) => q.eq('authUserId', 'organizer-a'))
        .unique())!;
      const membership = (await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', user._id))
        .first())!;
      await ctx.db.patch('memberships', membership._id, { programIds: [bProgram] });
    });
    await expect(
      s.t.withIdentity(identity('organizer-a')).mutation(api.tournaments.publish, { tournamentId }),
    ).rejects.toThrow('Not allowed');
    expect((await programOf(s, tournamentId)).status).toBe('draft');
  });

  test('refuses a tournament that does not exist, as it refuses another organization’s', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await s.t.run((ctx) => ctx.db.delete('tournaments', tournamentId));
    await expect(s.adminA.mutation(api.tournaments.publish, { tournamentId })).rejects.toThrow(
      'Not allowed',
    );
  });
});

describe('tournaments.getForManagement', () => {
  const slugs = { orgSlug: 'org-a', tournamentSlug: 'winter-doubles-classic' };

  test('gives an org admin the draft’s details and its id for Publish', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s, { locationIds: [s.bravo, s.alpha] });
    expect(await s.adminA.query(api.tournaments.getForManagement, slugs)).toEqual({
      tournamentId,
      organizationId: s.organizationA,
      role: 'orgAdmin',
      name: 'Winter Doubles Classic',
      slug: 'winter-doubles-classic',
      status: 'draft',
      organization: { name: 'Org A', slug: 'org-a' },
      sportName: 'Beach volleyball',
      divisionLabel: 'Coed · 2v2 · Open',
      locations: [
        { name: 'bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      startDate: '2027-01-16',
      endDate: '2027-01-17',
      registrationDeadline: '2027-01-09',
      maximumTeams: 16,
      minimumRosterSize: 2,
      sport: 'beachVolleyball',
      teamCount: 0,
      setsPerGame: 1,
    });
  });

  test('gives the sets per game a beach volleyball tournament holds, and the team count', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await s.t.run((ctx) =>
      ctx.db.patch('tournaments', tournamentId, { setsPerGame: 3, teamCount: 5 }),
    );
    expect(await s.adminA.query(api.tournaments.getForManagement, slugs)).toMatchObject({
      setsPerGame: 3,
      teamCount: 5,
    });
  });

  test('gives the assigned organizer the same details, with their role', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await assign(s, 'organizer-a', tournamentId);
    const page = await s.t
      .withIdentity(identity('organizer-a'))
      .query(api.tournaments.getForManagement, slugs);
    expect(page).toMatchObject({
      tournamentId,
      organizationId: s.organizationA,
      role: 'leagueOrganizer',
      name: 'Winter Doubles Classic',
      status: 'draft',
    });
  });

  test('refuses an organizer of the organization who is assigned to another tournament only', async () => {
    const s = await setup();
    await draftIn(s);
    const other = await draftIn(s, { name: 'Other Open', slug: 'other-open' });
    await assign(s, 'organizer-a', other);
    const organizer = s.t.withIdentity(identity('organizer-a'));
    await forbiddenBy(organizer.query(api.tournaments.getForManagement, slugs));
    expect(
      (
        await organizer.query(api.tournaments.getForManagement, {
          ...slugs,
          tournamentSlug: 'other-open',
        })
      )?.name,
    ).toBe('Other Open');
  });

  test('is null for an unknown web address when the caller is an organizer of the organization', async () => {
    const s = await setup();
    await draftIn(s);
    expect(
      await s.t
        .withIdentity(identity('organizer-a'))
        .query(api.tournaments.getForManagement, { ...slugs, tournamentSlug: 'unknown' }),
    ).toBeNull();
  });

  test('reads published after Publish', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    expect((await s.adminA.query(api.tournaments.getForManagement, slugs))?.status).toBe(
      'published',
    );
  });

  test('names a custom level in the division', async () => {
    const s = await setup();
    const customLevelId = await s.t.run((ctx) =>
      insertCustomLevel(ctx, s.organizationA, {
        sport: 'beachVolleyball',
        name: 'Sandy',
        standardLevel: 'rec',
      }),
    );
    await draftIn(s, { customLevelId });
    const page = await s.adminA.query(api.tournaments.getForManagement, slugs);
    expect(page?.divisionLabel).toBe('Coed · 2v2 · Sandy (Rec)');
  });

  test('is null for an unknown organization, an unknown web address, and a league’s web address', async () => {
    const s = await setup();
    await draftIn(s);
    for (const args of [
      { orgSlug: 'nowhere', tournamentSlug: slugs.tournamentSlug },
      { orgSlug: 'org-a', tournamentSlug: 'no-such-tournament' },
      { orgSlug: 'org-a', tournamentSlug: 'coed-7v7' },
    ]) {
      expect(
        await s.adminA.query(api.tournaments.getForManagement, args),
        args.tournamentSlug,
      ).toBe(null);
    }
  });

  test('does not give another organization’s tournament to an org admin of A', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const programId = await ctx.db.insert('programs', {
        ...tournamentProgramFields(s.organizationB, 'b-open'),
        locationIds: [s.bField],
      });
      await ctx.db.insert('tournaments', {
        programId,
        organizationId: s.organizationB,
        status: 'published',
        sport: 'soccer',
        startDate: '2027-01-16',
        endDate: '2027-01-16',
        registrationDeadline: '2027-01-09',
        maximumTeams: 8,
        minimumRosterSize: 4,
        structure: 'bracket',
        bracketType: 'single',
      });
    });
    expect(
      await s.adminA.query(api.tournaments.getForManagement, {
        orgSlug: 'org-a',
        tournamentSlug: 'b-open',
      }),
    ).toBeNull();
    await forbiddenBy(
      s.adminA.query(api.tournaments.getForManagement, {
        orgSlug: 'org-b',
        tournamentSlug: 'b-open',
      }),
    );
    expect(
      (
        await s.adminB.query(api.tournaments.getForManagement, {
          orgSlug: 'org-b',
          tournamentSlug: 'b-open',
        })
      )?.name,
    ).toBe('b-open');
  });

  test('refuses a league organizer, a member of another organization, a non-member, and a signed-out caller as forbidden', async () => {
    const s = await setup();
    await draftIn(s);
    for (const caller of [
      s.t,
      s.t.withIdentity(identity('ghost')),
      s.t.withIdentity(identity('organizer-a')),
      s.adminB,
      s.t.withIdentity(identity('stranger')),
    ]) {
      await forbiddenBy(caller.query(api.tournaments.getForManagement, slugs));
    }
  });

  test('does not say whether a web address exists to a caller who may not manage the organization', async () => {
    const s = await setup();
    await draftIn(s);
    await forbiddenBy(
      s.adminB.query(api.tournaments.getForManagement, { ...slugs, tournamentSlug: 'unknown' }),
    );
  });
});

describe('tournaments.getForCopy', () => {
  const args = { organizationSlug: 'org-a', slug: 'winter-doubles-classic' };

  test('gives an org admin what a copy starts from, with the next free web address and no dates', async () => {
    const s = await setup();
    await draftIn(s, { locationIds: [s.bravo, s.alpha] });
    expect(await s.adminA.query(api.tournaments.getForCopy, args)).toEqual({
      name: 'Winter Doubles Classic',
      slug: 'winter-doubles-classic-2',
      sport: 'beachVolleyball',
      locationIds: [s.bravo, s.alpha],
      gender: 'coed',
      playersPerSide: 2,
      level: 'open',
      ageGroup: 'adult',
      maximumTeams: 16,
      structure: 'bracket',
      bracketType: 'single',
    });
  });

  test('carries a custom level, and copies a published tournament too', async () => {
    const s = await setup();
    const customLevelId = await s.t.run((ctx) =>
      insertCustomLevel(ctx, s.organizationA, {
        sport: 'beachVolleyball',
        name: 'Sandy',
        standardLevel: 'rec',
      }),
    );
    const tournamentId = await draftIn(s, { customLevelId });
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    const copy = await s.adminA.query(api.tournaments.getForCopy, args);
    expect(copy).toMatchObject({ level: 'rec', customLevelId });
  });

  test('offers the next address no league, tournament, or other program of the organization holds', async () => {
    const s = await setup();
    await draftIn(s);
    await draftIn(s, { name: 'Winter Doubles Classic 2', slug: 'winter-doubles-classic-2' });
    await s.t.run((ctx) =>
      ctx.db.insert('programs', {
        ...tournamentProgramFields(s.organizationA, 'winter-doubles-classic-3'),
        type: 'league',
      }),
    );
    expect((await s.adminA.query(api.tournaments.getForCopy, args))?.slug).toBe(
      'winter-doubles-classic-4',
    );
  });

  test('derives the address from the name and keeps it within 60 characters with its suffix', async () => {
    const s = await setup();
    const name = `Gulf ${'Coast '.repeat(12)}Open`;
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      ...valid(s),
      name,
      slug: name.toLowerCase().replaceAll(' ', '-').slice(0, 60).replace(/-+$/, ''),
    });
    const source = await programOf(s, tournamentId);
    const copy = await s.adminA.query(api.tournaments.getForCopy, {
      organizationSlug: 'org-a',
      slug: source.slug,
    });
    expect(copy?.name).toBe(name);
    expect(copy?.slug).toHaveLength(60);
    expect(copy?.slug.endsWith('-2')).toBe(true);
  });

  test('is null for an unknown web address, a league’s, and another organization’s tournament', async () => {
    const s = await setup();
    await draftIn(s);
    await s.t.run(async (ctx) => {
      const programId = await ctx.db.insert('programs', {
        ...tournamentProgramFields(s.organizationB, 'b-open'),
        locationIds: [s.bField],
      });
      await ctx.db.insert('tournaments', {
        programId,
        organizationId: s.organizationB,
        status: 'published',
        sport: 'soccer',
        startDate: '2027-01-16',
        endDate: '2027-01-16',
        registrationDeadline: '2027-01-09',
        maximumTeams: 8,
        minimumRosterSize: 4,
        structure: 'bracket',
        bracketType: 'single',
      });
    });
    for (const slug of ['no-such-tournament', 'coed-7v7', 'b-open']) {
      expect(
        await s.adminA.query(api.tournaments.getForCopy, { organizationSlug: 'org-a', slug }),
        slug,
      ).toBeNull();
    }
  });

  test('refuses a signed-out caller, a league organizer, a non-member, and an org admin of another organization', async () => {
    const s = await setup();
    await draftIn(s);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.query(api.tournaments.getForCopy, args), label).rejects.toThrow(message);
    }
  });

  test('creating from the copy of a published tournament writes a draft row of the source’s sport, on the tournament and on its program', async () => {
    const s = await setup();
    const sourceId = await draftIn(s, {
      sport: 'soccer',
      playersPerSide: 7,
      level: 'rec',
      locationIds: [s.alpha],
    });
    await s.adminA.mutation(api.tournaments.publish, { tournamentId: sourceId });
    const { structure, bracketType, ...fields } = (await s.adminA.query(
      api.tournaments.getForCopy,
      args,
    ))!;
    expect([structure, bracketType]).toEqual(['bracket', 'single']);
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      organizationId: s.organizationA,
      ...fields,
      startDate: '2028-01-15',
      registrationDeadline: '2028-01-08',
    });
    const copy = await s.t.run((ctx) => ctx.db.get('tournaments', tournamentId));
    expect(copy).toMatchObject({ status: 'draft', sport: 'soccer' });
    expect((await programOf(s, tournamentId)).status).toBe('draft');
    expect((await programOf(s, sourceId)).status).toBe('published');
  });

  test('a published copy of a soccer tournament is listed publicly under soccer, and its draft is not', async () => {
    const s = await setup();
    const sourceId = await draftIn(s, {
      sport: 'soccer',
      playersPerSide: 7,
      level: 'rec',
      locationIds: [s.alpha],
    });
    await s.adminA.mutation(api.tournaments.publish, { tournamentId: sourceId });
    const { structure, bracketType, ...fields } = (await s.adminA.query(
      api.tournaments.getForCopy,
      args,
    ))!;
    expect([structure, bracketType]).toEqual(['bracket', 'single']);
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      organizationId: s.organizationA,
      ...fields,
      startDate: inDays(60),
      registrationDeadline: inDays(50),
    });
    expect(slugsOf(await listPublic(s))).not.toContain(fields.slug);
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    for (const sport of [undefined, 'soccer' as const]) {
      const list = await listPublic(s, { ...(sport && { sport }) });
      expect(slugsOf(list), String(sport)).toContain(fields.slug);
      expect(list.rows.find((row) => row.slug === fields.slug)).toMatchObject({
        name: 'Winter Doubles Classic',
        sportName: 'Soccer',
        startDate: inDays(60),
      });
    }
    expect(slugsOf(await listPublic(s, { sport: 'beachVolleyball' }))).not.toContain(fields.slug);
  });

  test('refuses a league organizer assigned to the source tournament, as it refuses an unassigned one', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await assign(s, 'organizer-a', tournamentId);
    await expect(
      s.t.withIdentity(identity('organizer-a')).query(api.tournaments.getForCopy, args),
    ).rejects.toThrow('Not allowed');
  });

  test('refuses an unknown organization as it refuses another organization’s', async () => {
    const s = await setup();
    await expect(
      s.adminA.query(api.tournaments.getForCopy, { ...args, organizationSlug: 'nowhere' }),
    ).rejects.toThrow('Not allowed');
    await expect(
      s.adminA.query(api.tournaments.getForCopy, { ...args, organizationSlug: 'org-b' }),
    ).rejects.toThrow('Not allowed');
  });

  test('creating from the copy adds a draft tournament and its program, and no team, bracket, or result', async () => {
    const s = await setup();
    await draftIn(s);
    const rowCounts = () =>
      s.t.run(async (ctx) =>
        Object.fromEntries(
          await Promise.all(
            Object.keys(schema.tables).map(
              async (table) =>
                [
                  table,
                  (await ctx.db.query(table as keyof typeof schema.tables).collect()).length,
                ] as const,
            ),
          ),
        ),
      );
    const before = await rowCounts();
    const copy = (await s.adminA.query(api.tournaments.getForCopy, args))!;
    const { structure, bracketType, ...fields } = copy;
    expect([structure, bracketType]).toEqual(['bracket', 'single']);
    const { tournamentId } = await s.adminA.mutation(api.tournaments.create, {
      organizationId: s.organizationA,
      ...fields,
      startDate: '2028-01-15',
      registrationDeadline: '2028-01-08',
    });
    expect(await rowCounts()).toEqual({
      ...before,
      programs: before['programs'] + 1,
      tournaments: before['tournaments'] + 1,
    });
    const program = await programOf(s, tournamentId);
    expect(program).toMatchObject({ status: 'draft', slug: 'winter-doubles-classic-2' });
  });
});

describe('tournaments.getPublicPage', () => {
  const slugs = { orgSlug: 'org-a', tournamentSlug: 'winter-doubles-classic' };

  async function published(s: Setup, overrides: Overrides = {}) {
    const tournamentId = await draftIn(s, overrides);
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    return tournamentId;
  }

  test('gives a signed-out caller the published tournament with no id', async () => {
    const s = await setup();
    await published(s, { locationIds: [s.bravo, s.alpha] });
    expect(await s.t.query(api.tournaments.getPublicPage, slugs)).toEqual({
      organization: { name: 'Org A', slug: 'org-a' },
      name: 'Winter Doubles Classic',
      slug: 'winter-doubles-classic',
      sportName: 'Beach volleyball',
      divisionLabel: 'Coed · 2v2 · Open',
      locations: [
        { name: 'bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      startDate: '2027-01-16',
      endDate: '2027-01-17',
      registrationDeadline: '2027-01-09',
      minimumRosterSize: 2,
      maximumTeams: 16,
      isFull: false,
    });
  });

  test('gives every caller the same answer', async () => {
    const s = await setup();
    await published(s);
    const anonymous = await s.t.query(api.tournaments.getPublicPage, slugs);
    for (const caller of [s.adminA, s.adminB, s.t.withIdentity(identity('stranger'))]) {
      expect(await caller.query(api.tournaments.getPublicPage, slugs)).toEqual(anonymous);
    }
  });

  test('is null for a draft, even for its org admin, and answers once it is published', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    expect(await s.t.query(api.tournaments.getPublicPage, slugs)).toBeNull();
    expect(await s.adminA.query(api.tournaments.getPublicPage, slugs)).toBeNull();
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    expect(await s.t.query(api.tournaments.getPublicPage, slugs)).not.toBeNull();
  });

  test('is null for an unknown organization, an unknown web address, a league’s, and another organization’s', async () => {
    const s = await setup();
    await published(s);
    for (const args of [
      { orgSlug: 'nowhere', tournamentSlug: slugs.tournamentSlug },
      { orgSlug: 'org-a', tournamentSlug: 'no-such-tournament' },
      { orgSlug: 'org-a', tournamentSlug: 'coed-7v7' },
      { orgSlug: 'org-b', tournamentSlug: slugs.tournamentSlug },
    ]) {
      expect(await s.t.query(api.tournaments.getPublicPage, args), JSON.stringify(args)).toBeNull();
    }
  });

  test('leaves out a location of another organization', async () => {
    const s = await setup();
    await published(s);
    await s.t.run(async (ctx) => {
      const program = (await ctx.db.query('programs').collect()).find(
        (row) => row.type === 'tournament',
      )!;
      await ctx.db.patch('programs', program._id, { locationIds: [s.bField, s.bravo] });
    });
    const page = await s.t.query(api.tournaments.getPublicPage, slugs);
    expect(page?.locations).toEqual([{ name: 'bravo Beach', address: '2 Bravo St' }]);
  });
});

const inDays = (days: number) => addCalendarDays(dateAtUtcMinus12(Date.now()), days);

interface DatedTournament {
  slug: string;
  name?: string;
  organizationId?: Id<'organizations'>;
  sport?: 'beachVolleyball' | 'soccer';
  division?: Parameters<typeof insertDraftTournament>[2]['division'];
  startInDays: number;
  endInDays?: number;
  deadlineInDays?: number;
  status?: 'draft' | 'published';
}

async function insertDated(s: Setup, tournaments: readonly DatedTournament[]) {
  await s.t.run(async (ctx) => {
    for (const tournament of tournaments) {
      const sport = tournament.sport ?? 'beachVolleyball';
      const organizationId = tournament.organizationId ?? s.organizationA;
      const tournamentId = await insertDraftTournament(ctx, organizationId, {
        name: tournament.name ?? tournament.slug,
        slug: tournament.slug,
        sport,
        locationIds: [],
        division: tournament.division ?? defaultDivision(sport),
        startDate: inDays(tournament.startInDays),
        endDate: inDays(tournament.endInDays ?? tournament.startInDays),
        registrationDeadline: inDays(tournament.deadlineInDays ?? tournament.startInDays - 7),
        maximumTeams: 8,
      });
      if ((tournament.status ?? 'published') === 'published') {
        await publishTournament(ctx, (await ctx.db.get('tournaments', tournamentId))!);
      }
    }
  });
}

const listPublic = (s: Setup, args: { sport?: 'beachVolleyball' | 'soccer'; page?: number } = {}) =>
  s.t.query(api.tournaments.listPublic, {
    organizationSlug: 'org-a',
    page: args.page ?? 1,
    ...(args.sport && { sport: args.sport }),
  });

const slugsOf = (list: { rows: { slug: string }[] }) => list.rows.map((row) => row.slug);

describe('tournaments.listPublic', () => {
  test('gives a signed-out caller a published upcoming tournament with its dates, sport, division, and locations', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const tournamentId = await insertDraftTournament(ctx, s.organizationA, {
        name: 'Gulf Coast Beach Open',
        slug: 'gulf-coast-beach-open',
        sport: 'beachVolleyball',
        locationIds: [s.bravo, s.alpha],
        division: { gender: 'coed', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
        startDate: inDays(30),
        endDate: inDays(31),
        registrationDeadline: inDays(23),
        maximumTeams: 16,
      });
      await publishTournament(ctx, (await ctx.db.get('tournaments', tournamentId))!);
    });
    expect(await listPublic(s)).toEqual({
      rows: [
        {
          name: 'Gulf Coast Beach Open',
          slug: 'gulf-coast-beach-open',
          sportName: 'Beach volleyball',
          divisionLabel: 'Coed · 2v2 · Open',
          locationNames: ['bravo Beach', 'Alpha Field'],
          startDate: inDays(30),
          endDate: inDays(31),
          registrationDeadline: inDays(23),
          isFull: false,
        },
      ],
      page: 1,
      pageCount: 1,
      total: 1,
    });
  });

  test('gives every caller the same answer', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'open', startInDays: 10 }]);
    const anonymous = await listPublic(s);
    for (const caller of [s.adminA, s.adminB, s.t.withIdentity(identity('stranger'))]) {
      expect(
        await caller.query(api.tournaments.listPublic, { organizationSlug: 'org-a', page: 1 }),
      ).toEqual(anonymous);
    }
  });

  test('leaves out a draft and a tournament that has ended, and keeps one that ends today', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'draft', startInDays: 10, status: 'draft' },
      { slug: 'ended', startInDays: -5, endInDays: -1 },
      { slug: 'ends-today', startInDays: -1, endInDays: 0 },
      { slug: 'upcoming', startInDays: 10 },
    ]);
    expect(slugsOf(await listPublic(s))).toEqual(['ends-today', 'upcoming']);
  });

  test('lists the soonest end date first', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'late', startInDays: 40 },
      { slug: 'early', startInDays: 5 },
      { slug: 'middle', startInDays: 20 },
    ]);
    expect(slugsOf(await listPublic(s))).toEqual(['early', 'middle', 'late']);
  });

  test('puts 7 upcoming tournaments on two pages of 5 and 2, and shows page 1 for a page past the last', async () => {
    const s = await setup();
    await insertDated(
      s,
      Array.from({ length: 7 }, (_, i) => ({ slug: `open-${i + 1}`, startInDays: 10 + i })),
    );
    const first = await listPublic(s);
    expect(slugsOf(first)).toEqual(['open-1', 'open-2', 'open-3', 'open-4', 'open-5']);
    expect([first.page, first.pageCount, first.total]).toEqual([1, 2, 7]);
    const second = await listPublic(s, { page: 2 });
    expect(slugsOf(second)).toEqual(['open-6', 'open-7']);
    expect([second.page, second.pageCount, second.total]).toEqual([2, 2, 7]);
    for (const page of [3, 0, -1, 1.5]) {
      expect(await listPublic(s, { page }), String(page)).toEqual(first);
    }
  });

  test('is empty, with no pages, for an organization with no upcoming tournament and for an unknown one', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'ended', startInDays: -9, endInDays: -8 }]);
    const empty = { rows: [], page: 1, pageCount: 0, total: 0 };
    expect(await listPublic(s)).toEqual(empty);
    expect(
      await s.t.query(api.tournaments.listPublic, { organizationSlug: 'nowhere', page: 1 }),
    ).toEqual(empty);
  });

  test('lists only the organization’s own tournaments', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'a-open', startInDays: 10 },
      { slug: 'b-open', startInDays: 10, organizationId: s.organizationB },
    ]);
    expect(slugsOf(await listPublic(s))).toEqual(['a-open']);
  });

  test('narrows to one sport, with the count and pages of that sport', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'sand-1', startInDays: 10 },
      { slug: 'soccer-1', startInDays: 11, sport: 'soccer' },
      { slug: 'sand-2', startInDays: 12 },
    ]);
    const sand = await listPublic(s, { sport: 'beachVolleyball' });
    expect(slugsOf(sand)).toEqual(['sand-1', 'sand-2']);
    expect(sand.total).toBe(2);
    expect(slugsOf(await listPublic(s, { sport: 'soccer' }))).toEqual(['soccer-1']);
  });

  test('hides a tournament whose division a filter does not match, and counts the rest', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'coed', startInDays: 10 },
      {
        slug: 'womens',
        startInDays: 11,
        division: { gender: 'womens', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
      },
      {
        slug: 'mens-fours',
        startInDays: 12,
        division: { gender: 'mens', playersPerSide: 4, level: 'a', ageGroup: 'over30' },
      },
    ]);
    const filtered = (filters: object) =>
      s.t.query(api.tournaments.listPublic, {
        organizationSlug: 'org-a',
        page: 1,
        sport: 'beachVolleyball',
        ...filters,
      });
    expect(slugsOf(await filtered({ gender: ['womens'] }))).toEqual(['womens']);
    expect(slugsOf(await filtered({ gender: ['coed', 'mens'] }))).toEqual(['coed', 'mens-fours']);
    expect(slugsOf(await filtered({ playersPerSide: [4] }))).toEqual(['mens-fours']);
    expect(slugsOf(await filtered({ ageGroup: ['over30'], gender: ['mens'] }))).toEqual([
      'mens-fours',
    ]);
    const none = await filtered({ gender: ['womens'], ageGroup: ['over30'] });
    expect(none).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
    expect((await filtered({ gender: ['coed', 'womens'] })).total).toBe(2);
  });

  test('reads no further than the row limit', async () => {
    const s = await setup();
    await insertDated(
      s,
      Array.from({ length: PUBLIC_LIST_MAX_ROWS + 3 }, (_, i) => ({
        slug: `open-${String(i).padStart(3, '0')}`,
        startInDays: 1,
        endInDays: 1 + i,
      })),
    );
    const last = await listPublic(s, { page: 999 });
    expect(last.page).toBe(1);
    const lastPage = await listPublic(s, { page: PUBLIC_LIST_MAX_ROWS / 5 });
    expect(lastPage.total).toBeLessThanOrEqual(PUBLIC_LIST_MAX_ROWS);
    expect(lastPage.pageCount).toBe(PUBLIC_LIST_MAX_ROWS / 5);
    expect(slugsOf(lastPage)).toEqual(
      Array.from(
        { length: 5 },
        (_, i) => `open-${String(PUBLIC_LIST_MAX_ROWS - 5 + i).padStart(3, '0')}`,
      ),
    );
  });
});

describe('tournaments.listOpenForOrganization', () => {
  const listOpen = (s: Setup, args: object = {}) =>
    s.t.query(api.tournaments.listOpenForOrganization, { organizationSlug: 'org-a', ...args });

  test('gives a signed-out caller a published tournament with its deadline and roster size', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const tournamentId = await insertDraftTournament(ctx, s.organizationA, {
        name: 'Gulf Coast Beach Open',
        slug: 'gulf-coast-beach-open',
        sport: 'beachVolleyball',
        locationIds: [s.bravo],
        division: { gender: 'coed', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
        startDate: inDays(30),
        endDate: inDays(31),
        registrationDeadline: inDays(23),
        maximumTeams: 16,
      });
      await publishTournament(ctx, (await ctx.db.get('tournaments', tournamentId))!);
    });
    expect(await listOpen(s)).toEqual([
      {
        name: 'Gulf Coast Beach Open',
        slug: 'gulf-coast-beach-open',
        sportName: 'Beach volleyball',
        divisionLabel: 'Coed · 2v2 · Open',
        locationNames: ['bravo Beach'],
        startDate: inDays(30),
        endDate: inDays(31),
        registrationDeadline: inDays(23),
        minimumRosterSize: 2,
        isFull: false,
      },
    ]);
  });

  test('marks a tournament that has reached its maximum teams as full, and one with room as not', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'full', startInDays: 10 },
      { slug: 'room', startInDays: 11 },
    ]);
    await s.t.run(async (ctx) => {
      for (const tournament of await ctx.db.query('tournaments').collect()) {
        const program = (await ctx.db.get('programs', tournament.programId))!;
        await ctx.db.patch('tournaments', tournament._id, {
          teamCount:
            program.slug === 'full' ? tournament.maximumTeams : tournament.maximumTeams - 1,
        });
      }
    });
    expect((await listOpen(s)).map(({ slug, isFull }) => [slug, isFull])).toEqual([
      ['full', true],
      ['room', false],
    ]);
    expect((await listPublic(s)).rows.map(({ slug, isFull }) => [slug, isFull])).toEqual([
      ['full', true],
      ['room', false],
    ]);
  });

  test('gives every caller the same answer', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'open', startInDays: 10 }]);
    const anonymous = await listOpen(s);
    for (const caller of [s.adminA, s.adminB, s.t.withIdentity(identity('stranger'))]) {
      expect(
        await caller.query(api.tournaments.listOpenForOrganization, {
          organizationSlug: 'org-a',
        }),
      ).toEqual(anonymous);
    }
  });

  test('leaves out a draft and a tournament whose deadline or end has passed, and keeps one whose deadline is today', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'draft', startInDays: 10, status: 'draft' },
      { slug: 'ended', startInDays: -5, endInDays: -1 },
      { slug: 'closed', startInDays: 5, deadlineInDays: -2 },
      { slug: 'deadline-today', startInDays: 5, deadlineInDays: 0 },
      { slug: 'open', startInDays: 10 },
    ]);
    expect((await listOpen(s)).map((row) => row.slug)).toEqual(['deadline-today', 'open']);
  });

  test('lists the soonest deadline first', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'late', startInDays: 40, deadlineInDays: 30 },
      { slug: 'early', startInDays: 20, deadlineInDays: 3 },
      { slug: 'middle', startInDays: 30, deadlineInDays: 12 },
    ]);
    expect((await listOpen(s)).map((row) => row.slug)).toEqual(['early', 'middle', 'late']);
  });

  test('lists only the organization’s own tournaments, narrowed to a sport and to a division', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'sand', startInDays: 10 },
      { slug: 'soccer', startInDays: 11, sport: 'soccer' },
      {
        slug: 'sand-womens',
        startInDays: 12,
        division: { gender: 'womens', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
      },
      { slug: 'other-org', startInDays: 10, organizationId: s.organizationB },
    ]);
    const slugs = async (args: object) => (await listOpen(s, args)).map((row) => row.slug);
    expect(await slugs({})).toEqual(['sand', 'soccer', 'sand-womens']);
    expect(await slugs({ sport: 'soccer' })).toEqual(['soccer']);
    expect(await slugs({ sport: 'beachVolleyball', gender: ['womens'] })).toEqual(['sand-womens']);
  });

  test('is empty for an unknown organization', async () => {
    const s = await setup();
    expect(
      await s.t.query(api.tournaments.listOpenForOrganization, { organizationSlug: 'nowhere' }),
    ).toEqual([]);
  });
});

describe('tournaments.updateDetails and undoUpdateDetails', () => {
  const slugs = { orgSlug: 'org-a', tournamentSlug: 'winter-doubles-classic' };
  const TODAY = Date.parse('2026-12-20T12:00:00Z');

  afterEach(() => {
    vi.useRealTimers();
  });

  const held: TournamentEditable = {
    startDate: '2027-01-16',
    endDate: '2027-01-17',
    registrationDeadline: '2027-01-09',
    maximumTeams: 16,
    setsPerGame: 1,
  };

  const changed: TournamentEditable = {
    startDate: '2027-02-06',
    endDate: '2027-02-07',
    registrationDeadline: '2027-01-30',
    maximumTeams: 24,
    setsPerGame: 3,
  };

  const edit = (
    tournamentId: Id<'tournaments'>,
    change: Partial<TournamentEditable> = changed,
    expected: TournamentEditable = held,
  ) => ({ tournamentId, ...held, ...change, expected });

  const rowOf = (s: Setup, tournamentId: Id<'tournaments'>) =>
    s.t.run((ctx) => ctx.db.get('tournaments', tournamentId));

  async function captains(s: Setup, count: number) {
    await s.t.run(async (ctx) => {
      for (let i = 1; i <= count; i++) {
        await ctx.db.insert('users', {
          authUserId: `captain-${i}`,
          name: `captain-${i}`,
          adultConfirmedAt: 1,
        });
      }
    });
  }

  const registerTeam = (s: Setup, i: number) =>
    s.t.withIdentity(identity(`captain-${i}`)).mutation(api.teams.registerForTournament, {
      ...slugs,
      name: `Team ${i}`,
    });

  async function publishedWithTeams(s: Setup, teams: number, maximumTeams: number) {
    const tournamentId = await draftIn(s, { maximumTeams });
    await s.adminA.mutation(api.tournaments.publish, { tournamentId });
    await captains(s, teams + 3);
    for (let i = 1; i <= teams; i++) await registerTeam(s, i);
    return tournamentId;
  }

  test('an org admin changes the dates, deadline, maximum, and sets per game, and nothing else changes', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const before = await snapshot(s.t);
    const result = await s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId));
    expect(result).toEqual({ earlier: held, written: changed });
    const after = await snapshot(s.t);
    expect(after.tournaments).toEqual([{ ...before.tournaments[0], ...changed }]);
    expect({ ...after, tournaments: [] }).toEqual({ ...before, tournaments: [] });
  });

  test('a blank end date makes a one-day tournament, and an omitted sets per game keeps the one held', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await s.t.run((ctx) => ctx.db.patch('tournaments', tournamentId, { setsPerGame: 3 }));
    const rest = {
      tournamentId,
      startDate: '2027-02-06',
      registrationDeadline: '2027-02-01',
      maximumTeams: 16,
    };
    const result = await s.adminA.mutation(api.tournaments.updateDetails, {
      ...rest,
      expected: { ...held, setsPerGame: 3 },
    });
    expect(result.written).toEqual({
      ...held,
      startDate: '2027-02-06',
      endDate: '2027-02-06',
      registrationDeadline: '2027-02-01',
      setsPerGame: 3,
    });
  });

  test('a tournament that holds no sets per game reads as 1, and a save that leaves it writes 1', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    expect((await rowOf(s, tournamentId))?.setsPerGame).toBeUndefined();
    const result = await s.adminA.mutation(api.tournaments.updateDetails, {
      ...edit(tournamentId, { maximumTeams: 20 }),
      setsPerGame: undefined,
    });
    expect(result).toEqual({ earlier: held, written: { ...held, maximumTeams: 20 } });
  });

  test('refuses sets per game other than 1 for a sport that is not beach volleyball, and writes nothing', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s, {
      sport: 'soccer',
      playersPerSide: 7,
      level: 'rec',
      locationIds: [s.alpha],
    });
    const before = await snapshot(s.t);
    await expect(
      s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId, { setsPerGame: 3 })),
    ).rejects.toThrow('Not allowed');
    expect(await snapshot(s.t)).toEqual(before);
    const result = await s.adminA.mutation(
      api.tournaments.updateDetails,
      edit(tournamentId, { setsPerGame: 1, maximumTeams: 8 }),
    );
    expect(result.written.maximumTeams).toBe(8);
  });

  test('refuses sets per game that is not 1 or 3', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await expect(
      s.adminA.mutation(api.tournaments.updateDetails, {
        ...edit(tournamentId),
        setsPerGame: 2 as never,
      }),
    ).rejects.toThrow();
  });

  test('refuses what tournaments.create refuses, with the same messages, and writes nothing', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const before = await snapshot(s.t);
    const cases = [
      [{ endDate: '2027-01-15' }, 'endDate', 'endBeforeStart'],
      [{ registrationDeadline: '2027-01-17' }, 'registrationDeadline', 'deadlineAfterStart'],
      [{ startDate: '' }, 'startDate', 'dateEmpty'],
      [{ startDate: '2027-02-30' }, 'startDate', 'dateInvalid'],
      [{ maximumTeams: 129 }, 'maximumTeams', 'maximumTeamsInvalid'],
      [{ maximumTeams: 1 }, 'maximumTeams', 'maximumTeamsInvalid'],
      [{ maximumTeams: 2.5 }, 'maximumTeams', 'maximumTeamsInvalid'],
    ] as const;
    for (const [change, field, code] of cases) {
      const data = await refusal(
        s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId, change)),
      );
      expect(data, JSON.stringify(change)).toMatchObject({ field, code });
      const { startDate, endDate, registrationDeadline, maximumTeams } = { ...held, ...change };
      const shared = firstTournamentError(
        checkTournamentFields({
          ...{
            name: 'Winter Doubles Classic',
            slug: 'winter-doubles-classic',
            sport: 'beachVolleyball' as const,
            playersPerSide: 2,
            level: 'open' as const,
            ageGroup: 'adult',
            locationCount: 1,
          },
          startDate,
          endDate,
          registrationDeadline,
          maximumTeams,
        }),
      );
      expect(data.message).toBe(shared?.message);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses a maximum below the team count with the count in the message, and accepts one equal to it', async () => {
    vi.useFakeTimers({ now: TODAY });
    const s = await setup();
    const tournamentId = await publishedWithTeams(s, 3, 4);
    const before = await snapshot(s.t);
    expect(
      await refusal(
        s.adminA.mutation(
          api.tournaments.updateDetails,
          edit(tournamentId, { maximumTeams: 2 }, { ...held, maximumTeams: 4 }),
        ),
      ),
    ).toEqual({
      field: 'maximumTeams',
      code: 'maximumTeamsBelowTeams',
      message: TOURNAMENT_MESSAGES.maximumTeamsBelowTeams(3),
    });
    expect(await snapshot(s.t)).toEqual(before);
    const result = await s.adminA.mutation(
      api.tournaments.updateDetails,
      edit(tournamentId, { maximumTeams: 3 }, { ...held, maximumTeams: 4 }),
    );
    expect(result.written.maximumTeams).toBe(3);
  });

  test('a maximum raised from 4 to 6 lets two more teams register, and the seventh is refused as full', async () => {
    vi.useFakeTimers({ now: TODAY });
    const s = await setup();
    const tournamentId = await publishedWithTeams(s, 4, 4);
    await expect(registerTeam(s, 5)).rejects.toThrow();
    await s.adminA.mutation(api.tournaments.updateDetails, {
      ...edit(tournamentId, { maximumTeams: 6 }, { ...held, maximumTeams: 4 }),
    });
    expect((await s.t.query(api.tournaments.getPublicPage, slugs))?.isFull).toBe(false);
    await registerTeam(s, 5);
    await registerTeam(s, 6);
    expect((await rowOf(s, tournamentId))?.teamCount).toBe(6);
    expect((await s.t.query(api.tournaments.getPublicPage, slugs))?.isFull).toBe(true);
    await expect(
      registerTeam(s, 7).catch((e: unknown) => (e as ConvexError<{ message: string }>).data),
    ).resolves.toMatchObject({
      message: 'This tournament is full.',
    });
  });

  test('refuses a save made from out-of-date details, with the current values, and writes nothing', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await s.t.run((ctx) => ctx.db.patch('tournaments', tournamentId, { maximumTeams: 20 }));
    const before = await snapshot(s.t);
    expect(
      await refusal(s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId))),
    ).toEqual({
      field: 'startDate',
      code: 'changedSince',
      message: TOURNAMENT_MESSAGES.changedWhileEditing,
      current: { ...held, maximumTeams: 20 },
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('an organizer assigned to the tournament saves, and one assigned to another is refused', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const other = await draftIn(s, { name: 'Other Open', slug: 'other-open' });
    await assign(s, 'organizer-a', tournamentId);
    const organizer = s.t.withIdentity(identity('organizer-a'));
    await organizer.mutation(api.tournaments.updateDetails, edit(tournamentId));
    expect((await rowOf(s, tournamentId))?.maximumTeams).toBe(24);
    await expect(organizer.mutation(api.tournaments.updateDetails, edit(other))).rejects.toThrow(
      'Not allowed',
    );
  });

  test('refuses every caller who may not organize the tournament, and writes nothing', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const before = await snapshot(s.t);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.tournaments.updateDetails, edit(tournamentId)),
        label,
      ).rejects.toThrow(message);
      await expect(
        caller.mutation(api.tournaments.undoUpdateDetails, {
          tournamentId,
          earlier: held,
          written: held,
        }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses a tournament that does not exist, as it refuses another organization’s', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    await s.t.run((ctx) => ctx.db.delete('tournaments', tournamentId));
    await expect(
      s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId)),
    ).rejects.toThrow('Not allowed');
  });

  test('refuses a league’s program', async () => {
    const s = await setup();
    const programId = await s.t.run(
      async (ctx) =>
        (await ctx.db.query('programs').collect()).find((program) => program.type === 'league')!
          ._id,
    );
    expect(programId).toBeDefined();
    const tournamentId = await draftIn(s);
    await s.t.run((ctx) => ctx.db.patch('tournaments', tournamentId, { programId }));
    await expect(
      s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId)),
    ).rejects.toThrow('Not allowed');
  });

  test('Undo after a save brings the previous values back', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const before = await rowOf(s, tournamentId);
    const { earlier, written } = await s.adminA.mutation(
      api.tournaments.updateDetails,
      edit(tournamentId),
    );
    expect(
      await s.adminA.mutation(api.tournaments.undoUpdateDetails, {
        tournamentId,
        earlier,
        written,
      }),
    ).toBeNull();
    expect(await rowOf(s, tournamentId)).toMatchObject({ ...before, ...held });
  });

  test('Undo is refused with the reason when teams registered since the save fill the earlier maximum', async () => {
    vi.useFakeTimers({ now: TODAY });
    const s = await setup();
    const tournamentId = await publishedWithTeams(s, 4, 4);
    const { earlier, written } = await s.adminA.mutation(api.tournaments.updateDetails, {
      ...edit(tournamentId, { maximumTeams: 6 }, { ...held, maximumTeams: 4 }),
    });
    await registerTeam(s, 5);
    await registerTeam(s, 6);
    const before = await snapshot(s.t);
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.undoUpdateDetails, { tournamentId, earlier, written }),
      ),
    ).toEqual({
      field: 'maximumTeams',
      code: 'maximumTeamsBelowTeams',
      message: TOURNAMENT_MESSAGES.maximumTeamsBelowTeams(6),
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('Undo is refused when someone else changed the details since the save, and writes nothing', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const { earlier, written } = await s.adminA.mutation(
      api.tournaments.updateDetails,
      edit(tournamentId),
    );
    await s.t.run((ctx) => ctx.db.patch('tournaments', tournamentId, { maximumTeams: 30 }));
    const before = await snapshot(s.t);
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.undoUpdateDetails, { tournamentId, earlier, written }),
      ),
    ).toEqual({
      field: 'startDate',
      code: 'changedSince',
      message: TOURNAMENT_MESSAGES.changedSince,
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses a maximum that is not a number or not finite, and writes nothing', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s);
    const before = await snapshot(s.t);
    for (const maximumTeams of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        await refusal(
          s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId, { maximumTeams })),
        ),
        String(maximumTeams),
      ).toMatchObject({ field: 'maximumTeams', code: 'maximumTeamsInvalid' });
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('Undo refuses earlier values that are not valid, such as a maximum below the team count', async () => {
    vi.useFakeTimers({ now: TODAY });
    const s = await setup();
    const tournamentId = await publishedWithTeams(s, 3, 16);
    const { written } = await s.adminA.mutation(api.tournaments.updateDetails, edit(tournamentId));
    const before = await snapshot(s.t);
    expect(
      await refusal(
        s.adminA.mutation(api.tournaments.undoUpdateDetails, {
          tournamentId,
          earlier: { ...held, maximumTeams: 2 },
          written,
        }),
      ),
    ).toMatchObject({ field: 'maximumTeams', code: 'maximumTeamsBelowTeams' });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('Undo refuses earlier values a caller made up, such as 3 sets for soccer', async () => {
    const s = await setup();
    const tournamentId = await draftIn(s, {
      sport: 'soccer',
      playersPerSide: 7,
      level: 'rec',
      locationIds: [s.alpha],
    });
    await expect(
      s.adminA.mutation(api.tournaments.undoUpdateDetails, {
        tournamentId,
        earlier: { ...held, setsPerGame: 3 },
        written: held,
      }),
    ).rejects.toThrow('Not allowed');
  });
});
