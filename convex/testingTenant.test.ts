/// <reference types="vite/client" />
// The per-test tenant seeds of `convex/testing.ts` (ADR 0005, #60), against the real schema.
// `testing.test.ts` covers ping and reset with a fixture schema.
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
