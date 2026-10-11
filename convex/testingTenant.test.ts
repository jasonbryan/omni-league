/// <reference types="vite/client" />
// The per-test tenant seeds of `convex/testing.ts` (ADR 0005, #60), against the real schema.
// `testing.test.ts` covers ping and reset with a fixture schema.
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const TENANT = {
  organization: { name: 'E2E Org a1b2', slug: 'e2e-org-a1b2' },
  locations: [
    { name: 'Field Two', address: '2 Test Road' },
    { name: 'Field One', address: '1 Test Road' },
  ],
  leagues: [
    { name: 'League B', sport: 'softball' as const, locations: ['Field Two', 'Field One'] },
    { name: 'League A', sport: 'soccer' as const, locations: ['Field One'] },
  ],
};

async function counts(t: T) {
  return t.run(async (ctx) => ({
    organizations: (await ctx.db.query('organizations').collect()).length,
    locations: (await ctx.db.query('locations').collect()).length,
    leagues: (await ctx.db.query('leagues').collect()).length,
  }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('IS_TEST guard on the tenant seeds', () => {
  const refused: [string, string | undefined][] = [
    ['unset', undefined],
    ['"false"', 'false'],
    ['"TRUE"', 'TRUE'],
    ['empty', ''],
  ];

  test.each(refused)(
    'testing:seedLeague throws with IS_TEST %s and writes nothing',
    async (_, value) => {
      vi.stubEnv('IS_TEST', value);
      const t = setup();
      await expect(t.action(internal.testing.seedLeague, TENANT)).rejects.toThrow(/IS_TEST/);
      expect(await counts(t)).toEqual({ organizations: 0, locations: 0, leagues: 0 });
    },
  );

  test.each(refused)(
    'testing:addLeague throws with IS_TEST %s and writes nothing',
    async (_, value) => {
      vi.stubEnv('IS_TEST', 'true');
      const t = setup();
      await t.action(internal.testing.seedLeague, TENANT);
      vi.stubEnv('IS_TEST', value);
      await expect(
        t.mutation(internal.testing.addLeague, {
          organizationSlug: TENANT.organization.slug,
          name: 'League C',
          sport: 'soccer',
          locations: [],
        }),
      ).rejects.toThrow(/IS_TEST/);
      expect(await counts(t)).toEqual({ organizations: 1, locations: 2, leagues: 2 });
    },
  );
});

describe('testing:seedLeague', () => {
  test("creates the test's own organization, locations, and leagues", async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await expect(t.action(internal.testing.seedLeague, TENANT)).resolves.toEqual({
      slug: 'e2e-org-a1b2',
    });
    expect(await t.query(api.organizations.getPublicPage, { slug: 'e2e-org-a1b2' })).toEqual({
      name: 'E2E Org a1b2',
      slug: 'e2e-org-a1b2',
      leagueCount: 2,
      locationCount: 2,
      sportCount: 2,
      sports: [
        { key: 'soccer', segment: 'soccer', name: 'Soccer', leagueCount: 1, locationCount: 1 },
        {
          key: 'softball',
          segment: 'softball',
          name: 'Softball',
          leagueCount: 1,
          locationCount: 2,
        },
      ],
    });
    const page = { slug: 'e2e-org-a1b2', page: 1 };
    expect((await t.query(api.organizations.listPublicLocations, page)).rows).toEqual([
      { name: 'Field One', address: '1 Test Road' },
      { name: 'Field Two', address: '2 Test Road' },
    ]);
    expect((await t.query(api.organizations.listPublicLeagues, page)).rows).toEqual([
      { name: 'League A', sportName: 'Soccer', locationNames: ['Field One'] },
      { name: 'League B', sportName: 'Softball', locationNames: ['Field Two', 'Field One'] },
    ]);
  });

  test("sets each row's sortName and the organization's counters (#100)", async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, {
      ...TENANT,
      locations: [...TENANT.locations, { name: 'UPPER Field', address: '3 Test Road' }],
    });
    const { organizations, locations, leagues } = await t.run(async (ctx) => ({
      organizations: await ctx.db.query('organizations').collect(),
      locations: await ctx.db.query('locations').collect(),
      leagues: await ctx.db.query('leagues').collect(),
    }));
    expect(organizations).toEqual([expect.objectContaining({ leagueCount: 2, locationCount: 3 })]);
    expect([...locations, ...leagues].map((row) => [row.name, row.sortName])).toEqual([
      ['Field Two', 'field two'],
      ['Field One', 'field one'],
      ['UPPER Field', 'upper field'],
      ['League B', 'league b'],
      ['League A', 'league a'],
    ]);
  });

  test('refuses a slug that is taken, and writes nothing', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, TENANT);
    await expect(
      t.action(internal.testing.seedLeague, {
        ...TENANT,
        organization: { name: 'Another', slug: 'e2e-org-a1b2' },
      }),
    ).rejects.toThrow(/slug/);
    expect(await counts(t)).toEqual({ organizations: 1, locations: 2, leagues: 2 });
  });

  test.each(['', 'Upper', 'two words', '-lead', 'trail-', 'a--b', 'x'.repeat(65)])(
    'refuses the malformed slug %j',
    async (slug) => {
      vi.stubEnv('IS_TEST', 'true');
      const t = setup();
      await expect(
        t.action(internal.testing.seedLeague, {
          ...TENANT,
          organization: { name: 'Bad', slug },
        }),
      ).rejects.toThrow(/slug/);
      expect(await counts(t)).toEqual({ organizations: 0, locations: 0, leagues: 0 });
    },
  );

  test('refuses a league at a location the tenant does not have, and writes nothing', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await expect(
      t.action(internal.testing.seedLeague, {
        ...TENANT,
        leagues: [{ name: 'League X', sport: 'soccer', locations: ['Nowhere'] }],
      }),
    ).rejects.toThrow(/Nowhere/);
    expect(await counts(t)).toEqual({ organizations: 0, locations: 0, leagues: 0 });
  });
});

describe('testing:addLeague', () => {
  test('adds a league to the named organization only', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, TENANT);
    await t.action(internal.testing.seedLeague, {
      organization: { name: 'Other', slug: 'other' },
      locations: [{ name: 'Field One', address: 'Elsewhere' }],
      leagues: [],
    });
    await expect(
      t.mutation(internal.testing.addLeague, {
        organizationSlug: 'e2e-org-a1b2',
        name: 'League C',
        sport: 'beachVolleyball',
        locations: ['Field One'],
      }),
    ).resolves.toEqual({ slug: 'league-c' });

    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'e2e-org-a1b2',
      page: 1,
    });
    expect(leagues.rows.map((league) => league.name)).toEqual(['League A', 'League B', 'League C']);
    expect(leagues.rows[2]).toEqual({
      name: 'League C',
      sportName: 'Beach volleyball',
      locationNames: ['Field One'],
    });
    expect(leagues.total).toBe(3);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'e2e-org-a1b2' })).toMatchObject({
      leagueCount: 3,
      sportCount: 3,
    });
    const other = await t.query(api.organizations.listPublicLeagues, { slug: 'other', page: 1 });
    expect(other).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
    expect(await t.query(api.organizations.getPublicPage, { slug: 'other' })).toMatchObject({
      leagueCount: 0,
      locationCount: 1,
    });
  });

  test('refuses an unknown organization or location', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, TENANT);
    await expect(
      t.mutation(internal.testing.addLeague, {
        organizationSlug: 'missing',
        name: 'League C',
        sport: 'soccer',
        locations: [],
      }),
    ).rejects.toThrow(/missing/);
    await expect(
      t.mutation(internal.testing.addLeague, {
        organizationSlug: 'e2e-org-a1b2',
        name: 'League C',
        sport: 'soccer',
        locations: ['Nowhere'],
      }),
    ).rejects.toThrow(/Nowhere/);
    expect(await counts(t)).toEqual({ organizations: 1, locations: 2, leagues: 2 });
  });

  test('gives a league with a taken name its own slug', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, TENANT);
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.testing.addLeague, {
        organizationSlug: 'e2e-org-a1b2',
        name: 'League A',
        sport: 'soccer',
        locations: [],
      });
    }
    const slugs = await t.run(async (ctx) =>
      (await ctx.db.query('leagues').collect()).map((league) => league.slug).sort(),
    );
    expect(slugs).toEqual(['league-a', 'league-a-2', 'league-a-3', 'league-b']);
  });
});

describe('sport counters and sportLocations (#101)', () => {
  /** What a recount of the leagues gives for the organization with this slug. */
  async function stored(t: T, slug: string) {
    return t.run(async (ctx) => {
      const organization = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .unique();
      if (!organization) throw new Error('fixture: no organization');
      const locations = await ctx.db.query('locations').collect();
      const rows = await ctx.db
        .query('sportLocations')
        .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
          q.eq('organizationId', organization._id),
        )
        .collect();
      const leagues = await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organization._id))
        .collect();
      const recount = new Map<string, number>();
      for (const league of leagues) {
        for (const id of new Set(league.locationIds)) {
          const key = `${league.sport}:${locations.find((l) => l._id === id)?.name}`;
          recount.set(key, (recount.get(key) ?? 0) + 1);
        }
      }
      return {
        sportLeagueCounts: organization.sportLeagueCounts,
        sportLocationCounts: organization.sportLocationCounts,
        rows: rows
          .map((row) => [
            `${row.sport}:${locations.find((l) => l._id === row.locationId)?.name}`,
            row.leagueCount,
          ])
          .sort(),
        recount: [...recount].sort(),
      };
    });
  }

  test('insertTenant sets both counters and the rows to a recount of its leagues', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, TENANT);
    const result = await stored(t, 'e2e-org-a1b2');
    expect(result.sportLeagueCounts).toEqual({ softball: 1, soccer: 1 });
    expect(result.sportLocationCounts).toEqual({ softball: 2, soccer: 1 });
    expect(result.rows).toEqual(result.recount);
    expect(result.rows).toEqual([
      ['soccer:Field One', 1],
      ['softball:Field One', 1],
      ['softball:Field Two', 1],
    ]);
  });

  test('an organization with no league starts with both counters empty, not unset', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, { ...TENANT, leagues: [] });
    const result = await stored(t, 'e2e-org-a1b2');
    expect(result.sportLeagueCounts).toEqual({});
    expect(result.sportLocationCounts).toEqual({});
    expect(result.rows).toEqual([]);
  });

  test('testing:addLeague updates both counters and the rows of its organization only', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, TENANT);
    await t.action(internal.testing.seedLeague, {
      organization: { name: 'Other', slug: 'other' },
      locations: [{ name: 'Field One', address: 'Elsewhere' }],
      leagues: [],
    });
    for (const [name, sport, locations] of [
      ['League C', 'soccer', ['Field One', 'Field Two']],
      ['League D', 'soccer', ['Field Two', 'Field Two']],
      ['League E', 'beachVolleyball', []],
    ] as const) {
      await t.mutation(internal.testing.addLeague, {
        organizationSlug: 'e2e-org-a1b2',
        name,
        sport,
        locations: [...locations],
      });
    }
    const result = await stored(t, 'e2e-org-a1b2');
    expect(result.sportLeagueCounts).toEqual({ beachVolleyball: 1, softball: 1, soccer: 3 });
    expect(result.sportLocationCounts).toEqual({ softball: 2, soccer: 2 });
    expect(result.rows).toEqual(result.recount);
    expect(result.rows).toContainEqual(['soccer:Field Two', 2]);
    const other = await stored(t, 'other');
    expect(other).toMatchObject({ sportLeagueCounts: {}, sportLocationCounts: {}, rows: [] });
  });

  test('testing:reset leaves no sportLocations row', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = convexTest(schema, modules);
    betterAuthTest.register(t, 'betterAuth');
    await t.action(internal.testing.seedLeague, TENANT);
    expect(await t.run((ctx) => ctx.db.query('sportLocations').collect())).toHaveLength(3);
    await t.mutation(internal.testing.reset, {});
    expect(await t.run((ctx) => ctx.db.query('sportLocations').collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('organizations').collect())).toEqual([]);
  }, 30_000);
});

describe('the optional seed status (#66, tester probes)', () => {
  test('a seeded draft is neither counted nor listed publicly, and a seed without status is published', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, {
      ...TENANT,
      leagues: [
        ...TENANT.leagues,
        {
          name: 'League Draft',
          sport: 'beachVolleyball' as const,
          locations: ['Field One'],
          status: 'draft' as const,
        },
      ],
    });
    const list = await t.query(api.organizations.listPublicLeagues, {
      slug: 'e2e-org-a1b2',
      page: 1,
    });
    expect(list.rows.map((league) => league.name)).toEqual(['League A', 'League B']);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'e2e-org-a1b2' })).toMatchObject({
      leagueCount: 2,
      sportCount: 2,
    });
    const statuses = await t.run(async (ctx) =>
      (await ctx.db.query('leagues').collect()).map((l) => [l.name, l.status]).sort(),
    );
    expect(statuses).toEqual([
      ['League A', 'published'],
      ['League B', 'published'],
      ['League Draft', 'draft'],
    ]);
  });

  test('the status field is refused unless IS_TEST is true, like the rest of the seed', async () => {
    vi.stubEnv('IS_TEST', undefined);
    const t = setup();
    await expect(
      t.mutation(internal.testing.addLeague, {
        organizationSlug: 'nowhere',
        name: 'X',
        sport: 'soccer',
        locations: [],
        status: 'draft',
      }),
    ).rejects.toThrow(/IS_TEST/);
  });
});
