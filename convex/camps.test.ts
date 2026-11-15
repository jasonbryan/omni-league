/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CAMP_MESSAGES } from './lib/campInput';
import { PUBLIC_LIST_MAX_ROWS } from './lib/publicList';
import { addCalendarDays, dateAtUtcMinus12 } from './lib/registration';
import {
  defaultDivision,
  deleteCampSession,
  insertCampSession,
  insertDraftCamp,
  insertDraftTournament,
  insertTenant,
  publishCamp,
} from './lib/tenantWrites';
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
      status: 'draft',
      sport: 'beachVolleyball',
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
      sessionCount: 0,
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

const inDays = (days: number) => addCalendarDays(dateAtUtcMinus12(Date.now()), days);

interface DatedSession {
  name?: string;
  startInDays: number;
  endInDays?: number;
  deadlineInDays?: number;
  places?: number;
  registeredCount?: number;
}

interface DatedCamp {
  slug: string;
  name?: string;
  organizationId?: Id<'organizations'>;
  sport?: 'beachVolleyball' | 'soccer';
  status?: 'draft' | 'published';
  sessions?: readonly DatedSession[];
}

async function insertDated(s: Setup, camps: readonly DatedCamp[]) {
  await s.t.run(async (ctx) => {
    for (const camp of camps) {
      const organizationId = camp.organizationId ?? s.organizationA;
      const campId = await insertDraftCamp(ctx, organizationId, {
        name: camp.name ?? camp.slug,
        slug: camp.slug,
        sport: camp.sport ?? 'beachVolleyball',
        locationIds: organizationId === s.organizationA ? [s.bravo, s.alpha] : [s.bField],
        minimumAge: 9,
        maximumAge: 14,
      });
      for (const [i, session] of (camp.sessions ?? [{ startInDays: 10 }]).entries()) {
        await insertCampSession(ctx, (await ctx.db.get('camps', campId))!, {
          name: session.name ?? `Week ${i + 1}`,
          startDate: inDays(session.startInDays),
          endDate: inDays(session.endInDays ?? session.startInDays + 4),
          places: session.places ?? 20,
          registrationDeadline: inDays(session.deadlineInDays ?? session.startInDays - 3),
        });
      }
      if ((camp.status ?? 'published') === 'published') {
        await publishCamp(ctx, (await ctx.db.get('camps', campId))!);
      }
    }
  });
}

const campSlugs = (list: { rows: readonly { slug: string }[] }) => list.rows.map((row) => row.slug);

describe('camps.listPublic', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const listPublic = (s: Setup, args: object = {}) =>
    s.t.query(api.camps.listPublic, { organizationSlug: 'org-a', page: 1, ...args });

  test('gives a signed-out caller a published upcoming camp with its ages, sport, locations, and next session', async () => {
    const s = await setup();
    await insertDated(s, [
      {
        slug: 'junior-beach-volleyball-camp',
        name: 'Junior Beach Volleyball Camp',
        sessions: [{ name: 'Week 1', startInDays: 14, endInDays: 18, deadlineInDays: 10 }],
      },
    ]);
    expect(await listPublic(s)).toEqual({
      rows: [
        {
          name: 'Junior Beach Volleyball Camp',
          slug: 'junior-beach-volleyball-camp',
          sportName: 'Beach volleyball',
          minimumAge: 9,
          maximumAge: 14,
          locationNames: ['bravo Beach', 'Alpha Field'],
          lastSessionEndDate: inDays(18),
          nextSession: {
            name: 'Week 1',
            startDate: inDays(14),
            endDate: inDays(18),
            registrationDeadline: inDays(10),
            placesLeft: 20,
          },
        },
      ],
      page: 1,
      pageCount: 1,
      total: 1,
    });
  });

  test('gives every caller the same answer', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'open' }]);
    const anonymous = await listPublic(s);
    for (const caller of [s.adminA, s.adminB, s.t.withIdentity(identity('stranger'))]) {
      expect(
        await caller.query(api.camps.listPublic, { organizationSlug: 'org-a', page: 1 }),
      ).toEqual(anonymous);
    }
  });

  test('leaves out a draft, a camp whose sessions have all ended, and one with no session, and keeps one whose last session ends today', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'draft', status: 'draft' },
      { slug: 'ended', sessions: [{ startInDays: -9, endInDays: -5 }] },
      { slug: 'no-session', status: 'draft', sessions: [] },
      { slug: 'ends-today', sessions: [{ startInDays: -4, endInDays: 0 }] },
      { slug: 'upcoming' },
    ]);
    expect(campSlugs(await listPublic(s))).toEqual(['ends-today', 'upcoming']);
  });

  test('lists the camp whose last session ends soonest first', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'late', sessions: [{ startInDays: 40 }] },
      { slug: 'early', sessions: [{ startInDays: 5 }] },
      {
        slug: 'long',
        sessions: [{ startInDays: 6 }, { name: 'Week 2', startInDays: 20 }],
      },
    ]);
    expect(campSlugs(await listPublic(s))).toEqual(['early', 'long', 'late']);
  });

  test('puts 7 upcoming camps on two pages of 5 and 2, and shows page 1 for a page past the last', async () => {
    const s = await setup();
    await insertDated(
      s,
      Array.from({ length: 7 }, (_, i) => ({
        slug: `camp-${i + 1}`,
        sessions: [{ startInDays: 10 + i }],
      })),
    );
    const first = await listPublic(s);
    expect(campSlugs(first)).toEqual(['camp-1', 'camp-2', 'camp-3', 'camp-4', 'camp-5']);
    expect([first.page, first.pageCount, first.total]).toEqual([1, 2, 7]);
    const second = await listPublic(s, { page: 2 });
    expect(campSlugs(second)).toEqual(['camp-6', 'camp-7']);
    expect([second.page, second.pageCount, second.total]).toEqual([2, 2, 7]);
    for (const page of [3, 0, -1, 1.5]) {
      expect(await listPublic(s, { page }), String(page)).toEqual(first);
    }
  });

  test('is empty, with no pages, for an organization with no upcoming camp and for an unknown one', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'ended', sessions: [{ startInDays: -9, endInDays: -8 }] }]);
    const empty = { rows: [], page: 1, pageCount: 0, total: 0 };
    expect(await listPublic(s)).toEqual(empty);
    expect(await s.t.query(api.camps.listPublic, { organizationSlug: 'nowhere', page: 1 })).toEqual(
      empty,
    );
  });

  test('lists only the organization’s own camps', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'a-camp' }, { slug: 'b-camp', organizationId: s.organizationB }]);
    expect(campSlugs(await listPublic(s))).toEqual(['a-camp']);
  });

  test('narrows to one sport, with the count and pages of that sport', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'sand-1', sessions: [{ startInDays: 10 }] },
      { slug: 'soccer-1', sport: 'soccer', sessions: [{ startInDays: 11 }] },
      { slug: 'sand-2', sessions: [{ startInDays: 12 }] },
    ]);
    const sand = await listPublic(s, { sport: 'beachVolleyball' });
    expect(campSlugs(sand)).toEqual(['sand-1', 'sand-2']);
    expect(sand.total).toBe(2);
    expect(campSlugs(await listPublic(s, { sport: 'soccer' }))).toEqual(['soccer-1']);
  });

  test('shows the earliest session that has not ended as the next one, and moves to Week 2 when Week 1 ends with no write in between', async () => {
    const s = await setup();
    await insertDated(s, [
      {
        slug: 'two-weeks',
        sessions: [
          { name: 'Week 2', startInDays: 12, endInDays: 16, deadlineInDays: 8 },
          { name: 'Week 1', startInDays: 5, endInDays: 9, deadlineInDays: 1 },
        ],
      },
    ]);
    const before = await s.t.run((ctx) => ctx.db.query('camps').collect());
    const nextName = async () => (await listPublic(s)).rows[0]?.nextSession.name;
    expect(await nextName()).toBe('Week 1');

    vi.useFakeTimers({ now: Date.now() + 9 * 24 * 60 * 60 * 1000 });
    expect(await nextName()).toBe('Week 1');
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    const week2 = (await listPublic(s)).rows[0];
    expect(week2?.nextSession).toMatchObject({
      name: 'Week 2',
      startDate: inDays(2),
      endDate: inDays(6),
    });
    expect(week2?.lastSessionEndDate).toBe(inDays(6));
    expect(await s.t.run((ctx) => ctx.db.query('camps').collect())).toEqual(before);

    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(campSlugs(await listPublic(s))).toEqual([]);
  });

  test('reads no further than the row limit', async () => {
    const s = await setup();
    await insertDated(
      s,
      Array.from({ length: PUBLIC_LIST_MAX_ROWS + 3 }, (_, i) => ({
        slug: `camp-${String(i).padStart(3, '0')}`,
        sessions: [{ startInDays: 1, endInDays: 1 + i }],
      })),
    );
    const lastPage = await listPublic(s, { page: PUBLIC_LIST_MAX_ROWS / 5 });
    expect(lastPage.total).toBeLessThanOrEqual(PUBLIC_LIST_MAX_ROWS);
    expect(lastPage.pageCount).toBe(PUBLIC_LIST_MAX_ROWS / 5);
    expect(campSlugs(lastPage)).toEqual(
      Array.from(
        { length: 5 },
        (_, i) => `camp-${String(PUBLIC_LIST_MAX_ROWS - 5 + i).padStart(3, '0')}`,
      ),
    );
  });

  test('does not list a camp written before the status, sport, and last session end were kept, until it is brought up to date', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'legacy' }]);
    await s.t.run(async (ctx) => {
      const [camp] = await ctx.db.query('camps').collect();
      await ctx.db.patch('camps', camp._id, {
        status: undefined,
        sport: undefined,
        lastSessionEndDate: undefined,
      });
    });
    expect(campSlugs(await listPublic(s))).toEqual([]);
    expect(
      await s.t.query(api.camps.getPublicPage, { orgSlug: 'org-a', campSlug: 'legacy' }),
    ).not.toBeNull();
  });
});

describe('camps.listOpenForOrganization', () => {
  const listOpen = (s: Setup, args: object = {}) =>
    s.t.query(api.camps.listOpenForOrganization, { organizationSlug: 'org-a', ...args });
  const cards = async (s: Setup, args: object = {}) =>
    (await listOpen(s, args)).map((card) => `${card.slug}/${card.sessionName}`);

  test('gives a signed-out caller each open session of a published camp with its deadline and places left', async () => {
    const s = await setup();
    await insertDated(s, [
      {
        slug: 'junior-beach-volleyball-camp',
        name: 'Junior Beach Volleyball Camp',
        sessions: [{ name: 'Week 1', startInDays: 14, endInDays: 18, deadlineInDays: 10 }],
      },
    ]);
    expect(await listOpen(s)).toEqual([
      {
        name: 'Junior Beach Volleyball Camp',
        slug: 'junior-beach-volleyball-camp',
        sportName: 'Beach volleyball',
        minimumAge: 9,
        maximumAge: 14,
        locationNames: ['bravo Beach', 'Alpha Field'],
        sessionName: 'Week 1',
        startDate: inDays(14),
        endDate: inDays(18),
        registrationDeadline: inDays(10),
        placesLeft: 20,
      },
    ]);
  });

  test('gives every caller the same answer', async () => {
    const s = await setup();
    await insertDated(s, [{ slug: 'open' }]);
    const anonymous = await listOpen(s);
    for (const caller of [s.adminA, s.adminB, s.t.withIdentity(identity('stranger'))]) {
      expect(
        await caller.query(api.camps.listOpenForOrganization, { organizationSlug: 'org-a' }),
      ).toEqual(anonymous);
    }
  });

  test('leaves out a draft, a session whose deadline has passed, one that has started, and one with no place left, and keeps one whose deadline is today', async () => {
    const s = await setup();
    await insertDated(s, [
      { slug: 'draft', status: 'draft' },
      {
        slug: 'mixed',
        sessions: [
          { name: 'Started', startInDays: -2, endInDays: 2, deadlineInDays: -5 },
          { name: 'Closed', startInDays: 5, deadlineInDays: -1 },
          { name: 'Full', startInDays: 6, places: 5 },
          { name: 'Deadline today', startInDays: 7, deadlineInDays: 0 },
          { name: 'Open', startInDays: 20 },
        ],
      },
    ]);
    await s.t.run(async (ctx) => {
      const full = (await ctx.db.query('campSessions').collect()).find(
        (row) => row.name === 'Full',
      );
      await ctx.db.patch('campSessions', full!._id, { registeredCount: 5 });
    });
    expect(await cards(s)).toEqual(['mixed/Deadline today', 'mixed/Open']);
  });

  test('lists a camp’s sessions in date order after the camp whose last session ends sooner, and only the organization’s own camps, narrowed to a sport', async () => {
    const s = await setup();
    await insertDated(s, [
      {
        slug: 'sand',
        sessions: [
          { name: 'Week 2', startInDays: 20 },
          { name: 'Week 1', startInDays: 10 },
        ],
      },
      { slug: 'soccer', sport: 'soccer', sessions: [{ startInDays: 11 }] },
      { slug: 'other-org', organizationId: s.organizationB },
    ]);
    expect(await cards(s)).toEqual(['soccer/Week 1', 'sand/Week 1', 'sand/Week 2']);
    expect(await cards(s, { sport: 'soccer' })).toEqual(['soccer/Week 1']);
    expect(await cards(s, { sport: 'beachVolleyball' })).toEqual(['sand/Week 1', 'sand/Week 2']);
  });

  test('is empty for an unknown organization', async () => {
    const s = await setup();
    expect(
      await s.t.query(api.camps.listOpenForOrganization, { organizationSlug: 'nowhere' }),
    ).toEqual([]);
  });
});

describe('the camp’s status, sport, and last session end', () => {
  const camp = (s: Setup, campId: Id<'camps'>) => s.t.run((ctx) => ctx.db.get('camps', campId));
  const fields = async (s: Setup, campId: Id<'camps'>) => {
    const row = await camp(s, campId);
    return [row?.status, row?.sport, row?.lastSessionEndDate];
  };
  const session = (name: string, startDate: string, endDate: string) => ({
    name,
    startDate,
    endDate,
    places: 10,
    registrationDeadline: startDate,
  });

  test('are set by create: a draft of the camp’s sport with no session end', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, valid(s));
    expect(await fields(s, campId)).toEqual(['draft', 'beachVolleyball', undefined]);
  });

  test('follow the sessions added and deleted: the latest end date of any session, and none after the last is deleted', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, valid(s));
    const add = (name: string, start: string, end: string) =>
      s.adminA.mutation(api.campSessions.add, { campId, ...session(name, start, end) });
    const long = await add('Long', '2027-07-05', '2027-07-30');
    expect((await fields(s, campId))[2]).toBe('2027-07-30');
    const short = await add('Short', '2027-07-12', '2027-07-16');
    expect((await fields(s, campId))[2]).toBe('2027-07-30');
    await s.adminA.mutation(api.campSessions.remove, { campSessionId: long.campSessionId });
    expect((await fields(s, campId))[2]).toBe('2027-07-16');
    await s.adminA.mutation(api.campSessions.remove, { campSessionId: short.campSessionId });
    expect((await fields(s, campId))[2]).toBeUndefined();
  });

  test('match again after Undo of a deleted session adds it back', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, valid(s));
    await s.adminA.mutation(api.campSessions.add, {
      campId,
      ...session('Week 1', '2027-07-05', '2027-07-09'),
    });
    const week2 = await s.adminA.mutation(api.campSessions.add, {
      campId,
      ...session('Week 2', '2027-07-12', '2027-07-16'),
    });
    await s.adminA.mutation(api.campSessions.remove, { campSessionId: week2.campSessionId });
    expect((await fields(s, campId))[2]).toBe('2027-07-09');
    await s.adminA.mutation(api.campSessions.add, {
      campId,
      ...session('Week 2', '2027-07-12', '2027-07-16'),
    });
    expect((await fields(s, campId))[2]).toBe('2027-07-16');
  });

  test('turn to published with the camp, and a session added after that keeps them', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, valid(s));
    await s.adminA.mutation(api.campSessions.add, {
      campId,
      ...session('Week 1', '2027-07-05', '2027-07-09'),
    });
    await s.adminA.mutation(api.camps.publish, { campId });
    expect(await fields(s, campId)).toEqual(['published', 'beachVolleyball', '2027-07-09']);
    await s.adminA.mutation(api.campSessions.add, {
      campId,
      ...session('Week 2', '2027-07-12', '2027-07-16'),
    });
    expect(await fields(s, campId)).toEqual(['published', 'beachVolleyball', '2027-07-16']);
  });

  test('are set on a camp written before they were kept by the next session write or publish', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, valid(s));
    await s.adminA.mutation(api.campSessions.add, {
      campId,
      ...session('Week 1', '2027-07-05', '2027-07-09'),
    });
    await s.t.run((ctx) =>
      ctx.db.patch('camps', campId, {
        status: undefined,
        sport: undefined,
        lastSessionEndDate: undefined,
      }),
    );
    await s.adminA.mutation(api.camps.publish, { campId });
    expect(await fields(s, campId)).toEqual(['published', 'beachVolleyball', '2027-07-09']);
  });

  test('stay equal to the program’s status and sport through deleteCampSession', async () => {
    const s = await setup();
    const { campId } = await s.adminA.mutation(api.camps.create, valid(s));
    await s.t.run(async (ctx) => {
      const row = (await ctx.db.get('camps', campId))!;
      const id = await insertCampSession(ctx, row, session('Week 1', '2027-07-05', '2027-07-09'));
      await deleteCampSession(ctx, (await ctx.db.get('campSessions', id))!);
    });
    expect(await fields(s, campId)).toEqual(['draft', 'beachVolleyball', undefined]);
  });
});
