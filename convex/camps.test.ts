/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CAMP_MESSAGES } from './lib/campInput';
import { defaultDivision, insertDraftTournament, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules, tournamentProgramFields } from './test.setup';
import { ADMIN_CAMPS_LIMIT } from './camps';

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
      leagues: [],
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
  name: 'Junior Beach Volleyball Camp',
  slug: 'junior-beach-volleyball-camp',
  sport: 'beachVolleyball' as const,
  locationIds: [s.bravo],
  minimumAge: 9,
  maximumAge: 14,
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
    camps: await ctx.db.query('camps').collect(),
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

describe('camps.create', () => {
  test('writes a draft camp and its program of type camp, in the right organization', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, {
      ...valid(s),
      locationIds: [s.bravo, s.alpha],
    });
    const { camp, program } = await s.t.run(async (ctx) => {
      const camp = (await ctx.db.get('camps', campId))!;
      return { camp, program: await ctx.db.get('programs', camp.programId) };
    });
    expect(camp).toEqual({
      _id: campId,
      _creationTime: camp._creationTime,
      programId: program?._id,
      organizationId: s.organizationA,
      minimumAge: 9,
      maximumAge: 14,
    });
    expect(program).toMatchObject({
      organizationId: s.organizationA,
      type: 'camp',
      name: 'Junior Beach Volleyball Camp',
      sortName: 'junior beach volleyball camp',
      slug: 'junior-beach-volleyball-camp',
      sport: 'beachVolleyball',
      status: 'draft',
      locationIds: [s.bravo, s.alpha],
    });
    expect(program).not.toHaveProperty('leagueId');
  });

  test('gives the program the sport’s default division, which the camp does not use', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, {
      ...valid(s),
      sport: 'soccer',
    });
    const program = await s.t.run(async (ctx) => {
      const camp = (await ctx.db.get('camps', campId))!;
      return (await ctx.db.get('programs', camp.programId))!;
    });
    expect(program).toMatchObject(defaultDivision('soccer'));
  });

  test('trims the name, keeps each location once, and accepts equal ages and the limits', async () => {
    const s = await setup();
    await s.adminA.mutation(api.camps.create, {
      ...valid(s),
      name: '  Junior Beach Volleyball Camp  ',
      locationIds: [s.bravo, s.bravo],
      minimumAge: 12,
      maximumAge: 12,
    });
    await s.adminA.mutation(api.camps.create, {
      ...valid(s),
      slug: 'all-ages-camp',
      minimumAge: 4,
      maximumAge: 99,
    });
    const programs = await s.t.run((ctx) => ctx.db.query('programs').collect());
    const camp = programs.find((p) => p.slug === 'junior-beach-volleyball-camp');
    expect(camp?.name).toBe('Junior Beach Volleyball Camp');
    expect(camp?.locationIds).toEqual([s.bravo]);
    expect(await s.t.run((ctx) => ctx.db.query('camps').collect())).toHaveLength(2);
  });

  test('changes no league counter and writes no league, season, tournament, or sportLocations row', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.camps.create, valid(s));
    const after = await snapshot(s.t);
    expect(after.leagues).toEqual(before.leagues);
    expect(after.organizations).toEqual(before.organizations);
    expect(after.sportLocations).toEqual(before.sportLocations);
    expect(await s.t.run((ctx) => ctx.db.query('tournaments').collect())).toEqual([]);
  });

  test('refuses ages from 12 to 9 under the age to, with the shared message, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    expect(
      await refusal(
        s.adminA.mutation(api.camps.create, { ...valid(s), minimumAge: 12, maximumAge: 9 }),
      ),
    ).toEqual({
      field: 'maximumAge',
      code: 'agesReversed',
      message: CAMP_MESSAGES.agesReversed(12),
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test.each([
    ['an age from of 3', { minimumAge: 3 }, 'minimumAge'],
    ['an age to of 100', { maximumAge: 100 }, 'maximumAge'],
    ['an age from of 9.5', { minimumAge: 9.5 }, 'minimumAge'],
    ['an age to of 3', { minimumAge: 4, maximumAge: 3 }, 'maximumAge'],
    ['an age from that is not a number', { minimumAge: NaN }, 'minimumAge'],
    ['an infinite age to', { maximumAge: Infinity }, 'maximumAge'],
    ['a negative age from', { minimumAge: -5 }, 'minimumAge'],
  ])('refuses %s with the field’s error', async (_label, change, field) => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.camps.create, { ...valid(s), ...change })),
    ).toMatchObject({ field, code: 'ageInvalid', message: CAMP_MESSAGES.ageInvalid });
  });

  test('refuses an empty name, one over 100 characters, and a malformed or reserved web address', async () => {
    const s = await setup();
    const code = async (change: object) =>
      (await refusal(s.adminA.mutation(api.camps.create, { ...valid(s), ...change }))).code;
    expect(await code({ name: '   ' })).toBe('nameEmpty');
    expect(await code({ name: 'x'.repeat(101) })).toBe('nameTooLong');
    expect(await code({ slug: 'Not A Slug' })).toBe('slugInvalid');
    expect(await code({ slug: 'new' })).toBe('slugInvalid');
    expect(await code({ slug: '' })).toBe('slugEmpty');
  });

  test('refuses no location, and a location of another organization, alone or among its own', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.camps.create, { ...valid(s), locationIds: [] })),
    ).toMatchObject({ field: 'locations', code: 'locationsEmpty' });
    for (const locationIds of [[s.bField], [s.bravo, s.bField]]) {
      await expect(
        s.adminA.mutation(api.camps.create, { ...valid(s), locationIds }),
      ).rejects.toThrow('Not allowed');
    }
    expect(await s.t.run((ctx) => ctx.db.query('camps').collect())).toEqual([]);
  });

  test('refuses a web address a league of the organization holds, and allows it in another organization', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.camps.create, { ...valid(s), slug: 'coed-7v7' })),
    ).toMatchObject({
      field: 'slug',
      code: 'slugTaken',
      message: 'coed-7v7 is already taken. Choose another web address.',
    });
    await s.adminB.mutation(api.camps.create, {
      ...valid(s),
      organizationId: s.organizationB,
      locationIds: [s.bField],
      slug: 'coed-7v7',
    });
  });

  test('refuses a web address a tournament, another camp, or any other program of the organization holds', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await insertDraftTournament(ctx, s.organizationA, {
        name: 'Winter Open',
        slug: 'winter-open',
        sport: 'soccer',
        locationIds: [s.alpha],
        division: defaultDivision('soccer'),
        startDate: '2027-01-16',
        endDate: '2027-01-16',
        registrationDeadline: '2027-01-09',
        maximumTeams: 8,
      });
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
    });
    await s.adminA.mutation(api.camps.create, valid(s));
    const before = await snapshot(s.t);
    for (const slug of ['winter-open', 'summer-open', 'junior-beach-volleyball-camp']) {
      expect(
        await refusal(s.adminA.mutation(api.camps.create, { ...valid(s), slug })),
        slug,
      ).toMatchObject({ field: 'slug', code: 'slugTaken' });
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('a camp’s web address is then refused to a tournament and to a league', async () => {
    const s = await setup();
    await s.adminA.mutation(api.camps.create, valid(s));
    expect(
      await s.adminA.query(api.tournaments.isSlugAvailable, {
        organizationId: s.organizationA,
        slug: 'junior-beach-volleyball-camp',
      }),
    ).toBe(false);
    expect(
      await s.adminA.query(api.leagues.isSlugAvailable, {
        organizationId: s.organizationA,
        slug: 'junior-beach-volleyball-camp',
      }),
    ).toBe(false);
  });

  test('two creates of the same web address at once leave one camp and one refusal', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.adminA.mutation(api.camps.create, valid(s)),
      s.adminA.mutation(api.camps.create, { ...valid(s), name: 'Other Name' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await s.t.run((ctx) => ctx.db.query('camps').collect())).toHaveLength(1);
  });

  test('a camp is not a tournament: the tournament page and list do not see it', async () => {
    const s = await setup();
    await s.adminA.mutation(api.camps.create, valid(s));
    expect(
      await s.adminA.query(api.tournaments.getForManagement, {
        orgSlug: 'org-a',
        tournamentSlug: 'junior-beach-volleyball-camp',
      }),
    ).toBeNull();
    expect(
      await s.adminA.query(api.tournaments.listForOrganization, {
        organizationId: s.organizationA,
      }),
    ).toEqual([]);
  });

  test('refuses every caller who is not an org admin of the organization, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.mutation(api.camps.create, valid(s)), label).rejects.toThrow(message);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });
});

describe('camps.isSlugAvailable', () => {
  const available = (s: Setup, slug: string) =>
    s.adminA.query(api.camps.isSlugAvailable, { organizationId: s.organizationA, slug });

  test('is true for a free web address and false for one a league, a camp, or another program holds', async () => {
    const s = await setup();
    await s.adminA.mutation(api.camps.create, valid(s));
    await s.t.run(async (ctx) => {
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
    });
    expect(await available(s, 'spring-camp')).toBe(true);
    expect(await available(s, 'coed-7v7')).toBe(false);
    expect(await available(s, 'junior-beach-volleyball-camp')).toBe(false);
    expect(await available(s, 'summer-open')).toBe(false);
  });

  test('is false for an address no one could choose, and true for the same one in another organization', async () => {
    const s = await setup();
    expect(await available(s, 'new')).toBe(false);
    expect(await available(s, 'ab')).toBe(false);
    expect(
      await s.adminB.query(api.camps.isSlugAvailable, {
        organizationId: s.organizationB,
        slug: 'coed-7v7',
      }),
    ).toBe(true);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.camps.isSlugAvailable, {
          organizationId: s.organizationA,
          slug: 'spring-camp',
        }),
        label,
      ).rejects.toThrow(message);
    }
  });
});

describe('camps.listForOrganization', () => {
  const list = (s: Setup) =>
    s.adminA.query(api.camps.listForOrganization, { organizationId: s.organizationA });

  test('lists name, slug, ages, status, and the program id an invite assigns, newest first', async () => {
    const s = await setup();
    const first = await s.adminA.mutation(api.camps.create, valid(s));
    await s.adminA.mutation(api.camps.create, {
      ...valid(s),
      name: 'Fall Break Camp',
      slug: 'fall-break-camp',
      minimumAge: 10,
      maximumAge: 16,
    });
    const programId = await s.t.run(
      async (ctx) => (await ctx.db.get('camps', first.campId))!.programId,
    );
    const rows = await list(s);
    expect(rows.map((row) => row.name)).toEqual([
      'Fall Break Camp',
      'Junior Beach Volleyball Camp',
    ]);
    expect(rows[0]).toEqual({
      campId: rows[0].campId,
      programId: rows[0].programId,
      name: 'Fall Break Camp',
      slug: 'fall-break-camp',
      minimumAge: 10,
      maximumAge: 16,
      status: 'draft',
    });
    expect(rows[1]).toMatchObject({ campId: first.campId, programId, status: 'draft' });
  });

  test('shows a published camp as published', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, valid(s));
    await s.t.run(async (ctx) => {
      const camp = (await ctx.db.get('camps', campId))!;
      await ctx.db.patch('programs', camp.programId, { status: 'published' });
    });
    expect((await list(s)).map((row) => row.status)).toEqual(['published']);
  });

  test('never returns another organization’s camps, a tournament, or a league, and returns [] for none', async () => {
    const s = await setup();
    await s.adminA.mutation(api.camps.create, valid(s));
    expect(
      await s.adminB.query(api.camps.listForOrganization, { organizationId: s.organizationB }),
    ).toEqual([]);
    await s.t.run(async (ctx) => {
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
    });
    expect(await list(s)).toHaveLength(1);
  });

  test('reads at most the limit', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let n = 0; n < ADMIN_CAMPS_LIMIT + 3; n++) {
        const programId = await ctx.db.insert('programs', {
          ...tournamentProgramFields(s.organizationA, `camp-${String(n).padStart(3, '0')}`),
          type: 'camp',
        });
        await ctx.db.insert('camps', {
          programId,
          organizationId: s.organizationA,
          minimumAge: 8,
          maximumAge: 12,
        });
      }
    });
    expect(await list(s)).toHaveLength(ADMIN_CAMPS_LIMIT);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    await s.adminA.mutation(api.camps.create, valid(s));
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.camps.listForOrganization, { organizationId: s.organizationA }),
        label,
      ).rejects.toThrow(message);
    }
  });
});
