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
import { defaultDivision, insertCustomLevel, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules, tournamentProgramFields } from './test.setup';
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
    expect(await available('spring-doubles-classic')).toBe(true);
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
    expect(rows.map(({ tournamentId, ...row }) => [typeof tournamentId, row])).toEqual([
      [
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
