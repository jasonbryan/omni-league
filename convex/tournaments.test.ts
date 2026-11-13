/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  checkTournamentFields,
  firstTournamentError,
  TOURNAMENT_MESSAGES,
} from './lib/tournamentInput';
import { PUBLIC_LIST_MAX_ROWS } from './lib/publicList';
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

type Overrides = Partial<ReturnType<typeof valid>> & { customLevelId?: Id<'customLevels'> };

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
      },
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
