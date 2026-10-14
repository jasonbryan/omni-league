/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertSeason, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

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
      leagues: [
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] },
        { name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Alpha Field'] },
        { name: 'Draft Softball', sport: 'softball', locations: ['Alpha Field'], status: 'draft' },
      ],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['B Field'] }],
    });
    const league = async (organizationId: Id<'organizations'>, slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!._id;
    const leagueL = await league(organizationA, 'coed-7v7');
    const leagueM = await league(organizationA, 'sand-2s');
    const leagueD = await league(organizationA, 'draft-softball');
    const leagueB = await league(organizationB, 'coed-7v7');
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
      leagueIds: Id<'leagues'>[] = [],
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
      }
    };
    await member('admin-a', organizationA);
    await member('organizer-l', organizationA, 'leagueOrganizer', [leagueL]);
    await member('organizer-m', organizationA, 'leagueOrganizer', [leagueM]);
    await member('admin-b', organizationB);
    await member('stranger', null);
    return { organizationA, organizationB, leagueL, leagueM, leagueD, leagueB };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    organizerL: t.withIdentity(identity('organizer-l')),
    organizerM: t.withIdentity(identity('organizer-m')),
    adminB: t.withIdentity(identity('admin-b')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const fall2026 = (s: Setup) => ({
  leagueId: s.leagueL,
  name: 'Fall 2026',
  slug: 'fall-2026',
  startDate: '2026-09-01',
  endDate: '2026-11-15',
  registrationDeadline: '2026-08-25',
  format: '7v7' as const,
  minimumRosterSize: 7,
});

const seasons = (t: Setup['t']) => t.run((ctx) => ctx.db.query('seasons').collect());

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
    ['league organizer of M, not L', s.organizerM, 'Not allowed'],
    ['org admin of B', s.adminB, 'Not allowed'],
    ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
  ] as const;
}

describe('seasons.create', () => {
  test('inserts a draft season of the league, in the league’s organization', async () => {
    const s = await setup();
    const { seasonId } = await s.adminA.mutation(api.seasons.create, fall2026(s));
    const season = await s.t.run((ctx) => ctx.db.get('seasons', seasonId));
    expect(season).toMatchObject({
      organizationId: s.organizationA,
      leagueId: s.leagueL,
      name: 'Fall 2026',
      slug: 'fall-2026',
      startDate: '2026-09-01',
      endDate: '2026-11-15',
      registrationDeadline: '2026-08-25',
      format: '7v7',
      minimumRosterSize: 7,
      status: 'draft',
    });
  });

  test('trims the name', async () => {
    const s = await setup();
    const { seasonId } = await s.adminA.mutation(api.seasons.create, {
      ...fall2026(s),
      name: '  Fall 2026  ',
    });
    expect((await s.t.run((ctx) => ctx.db.get('seasons', seasonId)))?.name).toBe('Fall 2026');
  });

  test('writes no organization, league, or counter row', async () => {
    const s = await setup();
    const snapshot = () =>
      s.t.run(async (ctx) => ({
        organizations: await ctx.db.query('organizations').collect(),
        leagues: await ctx.db.query('leagues').collect(),
        sportLocations: await ctx.db.query('sportLocations').collect(),
      }));
    const before = await snapshot();
    await s.adminA.mutation(api.seasons.create, fall2026(s));
    expect(await snapshot()).toEqual(before);
  });

  test('a league organizer assigned to L creates a season of L', async () => {
    const s = await setup();
    await expect(s.organizerL.mutation(api.seasons.create, fall2026(s))).resolves.toBeDefined();
    expect(await seasons(s.t)).toHaveLength(1);
  });

  test('a league organizer of L is refused for M, a league of the same organization', async () => {
    const s = await setup();
    await expect(
      s.organizerL.mutation(api.seasons.create, {
        ...fall2026(s),
        leagueId: s.leagueM,
        format: '4v4',
        minimumRosterSize: 4,
      }),
    ).rejects.toThrow('Not allowed');
    expect(await seasons(s.t)).toEqual([]);
  });

  test.each([0, 1, 2, 3, 4])('refuses caller %#, and nothing is written', async (index) => {
    const s = await setup();
    const [, caller, message] = refusedCallers(s)[index];
    await expect(caller.mutation(api.seasons.create, fall2026(s))).rejects.toThrow(message);
    expect(await seasons(s.t)).toEqual([]);
  });

  test('refuses an org admin of the organization for a league of another organization', async () => {
    const s = await setup();
    await expect(
      s.adminA.mutation(api.seasons.create, { ...fall2026(s), leagueId: s.leagueB }),
    ).rejects.toThrow('Not allowed');
    expect(await seasons(s.t)).toEqual([]);
  });

  test('refuses a league that no longer exists', async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.delete('leagues', s.leagueD));
    await expect(
      s.adminA.mutation(api.seasons.create, { ...fall2026(s), leagueId: s.leagueD }),
    ).rejects.toThrow('Not allowed');
  });

  test('creates a draft season in a draft league', async () => {
    const s = await setup();
    const { seasonId } = await s.adminA.mutation(api.seasons.create, {
      ...fall2026(s),
      leagueId: s.leagueD,
      format: '10v10',
      minimumRosterSize: 10,
    });
    expect(await s.t.run((ctx) => ctx.db.get('seasons', seasonId))).toMatchObject({
      leagueId: s.leagueD,
      status: 'draft',
    });
  });

  describe('refused values', () => {
    test('a format of another sport, and a format outside formatValidator', async () => {
      const s = await setup();
      expect(
        await refusal(s.adminA.mutation(api.seasons.create, { ...fall2026(s), format: '4v4' })),
      ).toEqual({ field: 'format', code: 'formatInvalid', message: 'Choose a format.' });
      await expect(
        s.adminA.mutation(api.seasons.create, {
          ...fall2026(s),
          format: '3v3' as unknown as '7v7',
        }),
      ).rejects.toThrow();
      expect(await seasons(s.t)).toEqual([]);
    });

    test('a start after the end', async () => {
      const s = await setup();
      expect(
        await refusal(
          s.adminA.mutation(api.seasons.create, {
            ...fall2026(s),
            startDate: '2026-11-16',
            endDate: '2026-11-15',
            registrationDeadline: '2026-08-25',
          }),
        ),
      ).toMatchObject({ field: 'endDate', code: 'endBeforeStart' });
      expect(await seasons(s.t)).toEqual([]);
    });

    test.each(['startDate', 'endDate', 'registrationDeadline'] as const)(
      'a date that does not exist in %s',
      async (field) => {
        const s = await setup();
        expect(
          await refusal(
            s.adminA.mutation(api.seasons.create, { ...fall2026(s), [field]: '2026-02-30' }),
          ),
        ).toEqual({ field, code: 'dateInvalid', message: 'Enter a real date.' });
        expect(await seasons(s.t)).toEqual([]);
      },
    );

    test('a registration deadline on the start date, and after it', async () => {
      const s = await setup();
      for (const registrationDeadline of ['2026-09-01', '2026-09-02']) {
        expect(
          await refusal(
            s.adminA.mutation(api.seasons.create, { ...fall2026(s), registrationDeadline }),
          ),
        ).toEqual({
          field: 'registrationDeadline',
          code: 'deadlineNotBeforeStart',
          message: 'The registration deadline must be before the start date, Sep 1, 2026.',
        });
      }
      expect(await seasons(s.t)).toEqual([]);
    });

    test('accepts a deadline the day before the start and a one-day season', async () => {
      const s = await setup();
      await expect(
        s.adminA.mutation(api.seasons.create, {
          ...fall2026(s),
          registrationDeadline: '2026-08-31',
          endDate: '2026-09-01',
        }),
      ).resolves.toBeDefined();
    });

    test('an invalid and a reserved slug', async () => {
      const s = await setup();
      for (const slug of ['', 'Fall 2026', 'ab', 'a'.repeat(61), 'fall--2026', 'new']) {
        expect(
          await refusal(s.adminA.mutation(api.seasons.create, { ...fall2026(s), slug })),
        ).toMatchObject({ field: 'slug' });
      }
      expect(await seasons(s.t)).toEqual([]);
    });

    test('a duplicate slug in the league, a draft included; the same slug in another league is allowed', async () => {
      const s = await setup();
      await s.adminA.mutation(api.seasons.create, fall2026(s));
      expect(
        await refusal(s.adminA.mutation(api.seasons.create, { ...fall2026(s), name: 'Other' })),
      ).toEqual({
        field: 'slug',
        code: 'slugTaken',
        message: 'fall-2026 is already used by another season of Coed 7v7. Choose another slug.',
      });
      expect(await seasons(s.t)).toHaveLength(1);

      await expect(
        s.adminA.mutation(api.seasons.create, {
          ...fall2026(s),
          leagueId: s.leagueM,
          format: '4v4',
          minimumRosterSize: 4,
        }),
      ).resolves.toBeDefined();
      await expect(
        s.adminB.mutation(api.seasons.create, { ...fall2026(s), leagueId: s.leagueB }),
      ).resolves.toBeDefined();
      expect(await seasons(s.t)).toHaveLength(3);
    });

    test('a 101-character name and a whitespace-only name; 100 characters are allowed', async () => {
      const s = await setup();
      expect(
        await refusal(
          s.adminA.mutation(api.seasons.create, { ...fall2026(s), name: 'x'.repeat(101) }),
        ),
      ).toMatchObject({ field: 'name', code: 'nameTooLong' });
      expect(
        await refusal(s.adminA.mutation(api.seasons.create, { ...fall2026(s), name: '   ' })),
      ).toMatchObject({ field: 'name', code: 'nameEmpty' });
      expect(await seasons(s.t)).toEqual([]);
      await expect(
        s.adminA.mutation(api.seasons.create, { ...fall2026(s), name: 'x'.repeat(100) }),
      ).resolves.toBeDefined();
    });

    test('a minimum of 100, and a non-integer minimum', async () => {
      const s = await setup();
      for (const minimumRosterSize of [100, 7.5, Number.NaN]) {
        expect(
          await refusal(
            s.adminA.mutation(api.seasons.create, { ...fall2026(s), minimumRosterSize }),
          ),
        ).toEqual({
          field: 'minimumRosterSize',
          code: 'minimumOutOfRange',
          message: 'Enter a whole number from 7 to 99.',
        });
      }
      expect(await seasons(s.t)).toEqual([]);
    });

    test('a minimum below the format’s names the format’s minimum; raising it is allowed', async () => {
      const s = await setup();
      expect(
        await refusal(
          s.adminA.mutation(api.seasons.create, { ...fall2026(s), minimumRosterSize: 6 }),
        ),
      ).toEqual({
        field: 'minimumRosterSize',
        code: 'minimumBelowFormat',
        message: '7 v 7 needs at least 7 players. Enter 7 or more.',
      });
      expect(await seasons(s.t)).toEqual([]);

      const { seasonId } = await s.adminA.mutation(api.seasons.create, {
        ...fall2026(s),
        minimumRosterSize: 9,
      });
      expect((await s.t.run((ctx) => ctx.db.get('seasons', seasonId)))?.minimumRosterSize).toBe(9);
      await expect(
        s.adminA.mutation(api.seasons.create, {
          ...fall2026(s),
          slug: 'max',
          minimumRosterSize: 99,
        }),
      ).resolves.toBeDefined();
    });
  });
});

describe('seasons.listForOrganizer', () => {
  const insert = (
    s: Setup,
    leagueId: Id<'leagues'>,
    slug: string,
    startDate: string,
    status: 'draft' | 'published',
  ) =>
    s.t.run(async (ctx) => {
      const league = (await ctx.db.get('leagues', leagueId))!;
      await insertSeason(
        ctx,
        league,
        {
          name: slug,
          slug,
          startDate,
          endDate: '2030-01-01',
          registrationDeadline: '2000-01-01',
          format: league.sport === 'soccer' ? '7v7' : '4v4',
          minimumRosterSize: league.sport === 'soccer' ? 7 : 4,
        },
        status,
      );
    });

  test('lists both statuses, newest start date first', async () => {
    const s = await setup();
    await insert(s, s.leagueL, 'spring-2027', '2027-03-03', 'published');
    await insert(s, s.leagueL, 'fall-2027', '2027-09-08', 'draft');
    await insert(s, s.leagueL, 'summer-2027', '2027-06-02', 'published');
    await insert(s, s.leagueL, 'fall-2026', '2026-09-09', 'draft');
    await insert(s, s.leagueL, 'winter-2027', '2027-01-10', 'draft');
    const rows = await s.adminA.query(api.seasons.listForOrganizer, { leagueId: s.leagueL });
    expect(rows.map((row) => [row.slug, row.status])).toEqual([
      ['fall-2027', 'draft'],
      ['summer-2027', 'published'],
      ['spring-2027', 'published'],
      ['winter-2027', 'draft'],
      ['fall-2026', 'draft'],
    ]);
  });

  test('returns each season’s fields with the format’s display name', async () => {
    const s = await setup();
    await s.adminA.mutation(api.seasons.create, { ...fall2026(s), minimumRosterSize: 9 });
    const rows = await s.adminA.query(api.seasons.listForOrganizer, { leagueId: s.leagueL });
    expect(rows).toEqual([
      {
        seasonId: expect.any(String) as string,
        name: 'Fall 2026',
        slug: 'fall-2026',
        startDate: '2026-09-01',
        endDate: '2026-11-15',
        registrationDeadline: '2026-08-25',
        formatName: '7 v 7',
        minimumRosterSize: 9,
        status: 'draft',
      },
    ]);
  });

  test('lists only the seasons of the league asked for', async () => {
    const s = await setup();
    await insert(s, s.leagueL, 'in-l', '2027-03-03', 'draft');
    await insert(s, s.leagueM, 'in-m', '2027-03-03', 'draft');
    await insert(s, s.leagueB, 'in-b', '2027-03-03', 'draft');
    const rows = await s.adminA.query(api.seasons.listForOrganizer, { leagueId: s.leagueL });
    expect(rows.map((row) => row.slug)).toEqual(['in-l']);
  });

  test('is empty for a league with no season', async () => {
    const s = await setup();
    expect(await s.adminA.query(api.seasons.listForOrganizer, { leagueId: s.leagueL })).toEqual([]);
  });

  test('returns at most 200 seasons', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const league = (await ctx.db.get('leagues', s.leagueL))!;
      for (let i = 0; i < 201; i++) {
        const day = String(i).padStart(3, '0');
        await insertSeason(ctx, league, {
          name: `S${day}`,
          slug: `s-${day}`,
          startDate: `2030-01-01`,
          endDate: '2031-01-01',
          registrationDeadline: '2029-01-01',
          format: '7v7',
          minimumRosterSize: 7,
        });
      }
    });
    const rows = await s.adminA.query(api.seasons.listForOrganizer, { leagueId: s.leagueL });
    expect(rows).toHaveLength(200);
  });

  test('a league organizer sees the seasons of the league assigned to them', async () => {
    const s = await setup();
    await insert(s, s.leagueL, 'in-l', '2027-03-03', 'draft');
    const rows = await s.organizerL.query(api.seasons.listForOrganizer, { leagueId: s.leagueL });
    expect(rows.map((row) => row.slug)).toEqual(['in-l']);
  });

  test.each([0, 1, 2, 3, 4])('refuses caller %#', async (index) => {
    const s = await setup();
    await insert(s, s.leagueL, 'in-l', '2027-03-03', 'draft');
    const [, caller, message] = refusedCallers(s)[index];
    await expect(
      caller.query(api.seasons.listForOrganizer, { leagueId: s.leagueL }),
    ).rejects.toThrow(message);
  });
});
