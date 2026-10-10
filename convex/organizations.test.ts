/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertLeague, insertLocation, insertTenant, type Tenant } from './lib/tenantWrites';
import { PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_PAGE_SIZE } from './organizations';
import schema from './schema';
import { modules } from './test.setup';
import organizationsSource from './organizations.ts?raw';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

/** Inserts a tenant through the shared writers, so `sortName` and the counters are set. */
function seed(t: T, tenant: Tenant): Promise<Id<'organizations'>> {
  return t.run((ctx) => insertTenant(ctx, tenant));
}

/** Organization A: two locations and three leagues of three sports, inserted out of name order. */
function seedA(t: T): Promise<Id<'organizations'>> {
  return seed(t, {
    organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
    locations: [
      { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
      { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
    ],
    leagues: [
      {
        name: 'Wednesday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['North Beach Sand Courts', 'Bayside Athletic Complex'],
      },
      { name: 'coed 7v7 Rec', sport: 'soccer', locations: ['Bayside Athletic Complex'] },
      { name: 'Thursday Night Coed 2s', sport: 'beachVolleyball', locations: [] },
    ],
  });
}

/** Organization B: one location and one league, which A's page must never show. */
function seedB(t: T): Promise<Id<'organizations'>> {
  return seed(t, {
    organization: { name: 'Other Org', slug: 'other-org' },
    locations: [{ name: 'B Field', address: '1 B Street' }],
    leagues: [{ name: 'B League', sport: 'soccer', locations: ['B Field'] }],
  });
}

/**
 * 13 names in shuffled insertion order. Sorted ignoring case: "adult league" comes before
 * "Zebra League" (the code-point order of the old `by_organizationId_and_name` index would put it
 * after).
 */
const THIRTEEN = [
  'Zebra League',
  'adult league',
  'Kappa',
  'beta',
  'Mu',
  'Delta',
  'iota',
  'Gamma',
  'epsilon',
  'Lambda',
  'Theta',
  'eta',
  'Zeta',
];
const SORTED = [...THIRTEEN].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));

/** `count` names "Row 001", "Row 002", ... whose order is their number. */
const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => `Row ${String(i + 1).padStart(3, '0')}`);

function seedLocations(t: T, slug: string, names: string[]) {
  return seed(t, {
    organization: { name: `Org ${slug}`, slug },
    locations: names.map((name) => ({ name, address: `${name} address` })),
    leagues: [],
  });
}

function seedLeagues(t: T, slug: string, names: string[]) {
  return seed(t, {
    organization: { name: `Org ${slug}`, slug },
    locations: [{ name: 'Home Field', address: '1 Home Road' }],
    leagues: names.map((name) => ({ name, sport: 'soccer' as const, locations: ['Home Field'] })),
  });
}

/** Both list queries, with the fixture that fills each and the row name in its result. */
const LISTS = [
  {
    kind: 'locations',
    seedNames: seedLocations,
    list: (t: T, slug: string, page: number) =>
      t.query(api.organizations.listPublicLocations, { slug, page }),
  },
  {
    kind: 'leagues',
    seedNames: seedLeagues,
    list: (t: T, slug: string, page: number) =>
      t.query(api.organizations.listPublicLeagues, { slug, page }),
  },
] as const;

const names = (result: { rows: { name: string }[] }) => result.rows.map((row) => row.name);

describe('organizations:getPublicPage', () => {
  test('returns the name, slug, and the league, location, and sport totals', async () => {
    const t = setup();
    await seedA(t);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' })).toEqual({
      name: 'Gulf Coast Sport & Social',
      slug: 'gulf-coast',
      leagueCount: 3,
      locationCount: 2,
      sportCount: 3,
    });
  });

  test('returns zero totals for an organization with no locations and no leagues', async () => {
    const t = setup();
    await seed(t, {
      organization: { name: 'Empty Club', slug: 'empty' },
      locations: [],
      leagues: [],
    });
    expect(await t.query(api.organizations.getPublicPage, { slug: 'empty' })).toEqual({
      name: 'Empty Club',
      slug: 'empty',
      leagueCount: 0,
      locationCount: 0,
      sportCount: 0,
    });
  });

  test('reads a missing counter as 0 (an organization the backfill has not reached yet)', async () => {
    const t = setup();
    await t.run((ctx) => ctx.db.insert('organizations', { name: 'Old Club', slug: 'old' }));
    expect(await t.query(api.organizations.getPublicPage, { slug: 'old' })).toEqual({
      name: 'Old Club',
      slug: 'old',
      leagueCount: 0,
      locationCount: 0,
      sportCount: 0,
    });
  });

  test('236 leagues of two sports and 12 locations: the totals, with none of another organization', async () => {
    const t = setup();
    const locations = numbered(12).map((name) => ({ name, address: `${name} address` }));
    await seed(t, {
      organization: { name: 'Big Club', slug: 'big' },
      locations,
      leagues: numbered(236).map((name, i) => ({
        name: `League ${name}`,
        sport: i % 2 ? ('soccer' as const) : ('softball' as const),
        locations: [locations[i % 12].name],
      })),
    });
    await seedB(t);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'big' })).toEqual({
      name: 'Big Club',
      slug: 'big',
      leagueCount: 236,
      locationCount: 12,
      sportCount: 2,
    });
    const leagues = await t.query(api.organizations.listPublicLeagues, { slug: 'big', page: 1 });
    expect(leagues).toMatchObject({ page: 1, pageCount: 40, total: 236 });
    expect(names(leagues)).toEqual(numbered(5).map((name) => `League ${name}`));
    expect(await t.query(api.organizations.getPublicPage, { slug: 'other-org' })).toEqual({
      name: 'Other Org',
      slug: 'other-org',
      leagueCount: 1,
      locationCount: 1,
      sportCount: 1,
    });
  });

  test.each(['does-not-exist', '', 'Gulf-Coast', 'gulf-coast ', '../gulf-coast', 'x'.repeat(5000)])(
    'returns null for the unknown slug %j',
    async (slug) => {
      const t = setup();
      await seedA(t);
      expect(await t.query(api.organizations.getPublicPage, { slug })).toBeNull();
    },
  );

  test('rejects arguments outside the validator', async () => {
    const t = setup();
    await expect(
      t.query(api.organizations.getPublicPage, { slug: 1 } as unknown as { slug: string }),
    ).rejects.toThrow(/Validator|validator|slug/);
    await expect(
      t.query(api.organizations.getPublicPage, {
        slug: 'gulf-coast',
        organizationId: 'x',
      } as unknown as { slug: string }),
    ).rejects.toThrow();
  });

  test('anonymous and signed-in callers get the same result', async () => {
    const t = setup();
    await seedA(t);
    await seedB(t);
    const anonymous = await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' });
    const signedIn = await t
      .withIdentity({ subject: 'user-b', tokenIdentifier: 'test|user-b', name: 'B Admin' })
      .query(api.organizations.getPublicPage, { slug: 'gulf-coast' });
    expect(signedIn).toEqual(anonymous);
  });

  test('returns only the fields of the returns validator: no ids or creation times', async () => {
    const t = setup();
    await seedA(t);
    const page = await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' });
    expect(Object.keys(page ?? {}).sort()).toEqual([
      'leagueCount',
      'locationCount',
      'name',
      'slug',
      'sportCount',
    ]);
    expect(JSON.stringify(page)).not.toMatch(/_id|_creationTime|organizationId/);
  });
});

describe.each(LISTS)('organizations:listPublic $kind', ({ kind, seedNames, list }) => {
  test('13 rows: three pages of 5, 5, and 3, sorted by name ignoring case', async () => {
    const t = setup();
    await seedNames(t, 'thirteen', THIRTEEN);
    const pages = [await list(t, 'thirteen', 1), await list(t, 'thirteen', 2)];
    pages.push(await list(t, 'thirteen', 3));
    expect(pages.map(({ page, pageCount, total }) => ({ page, pageCount, total }))).toEqual([
      { page: 1, pageCount: 3, total: 13 },
      { page: 2, pageCount: 3, total: 13 },
      { page: 3, pageCount: 3, total: 13 },
    ]);
    expect(pages.map(names)).toEqual([SORTED.slice(0, 5), SORTED.slice(5, 10), SORTED.slice(10)]);
    expect(names(pages[0])[0]).toBe('adult league');
    expect(names(pages[2]).at(-1)).toBe('Zeta');
    expect(SORTED.indexOf('adult league')).toBeLessThan(SORTED.indexOf('Zebra League'));
  });

  test.each([
    [5, 1],
    [6, 2],
  ])('%i rows: pageCount %i', async (count, pageCount) => {
    const t = setup();
    await seedNames(t, 'boundary', numbered(count));
    const first = await list(t, 'boundary', 1);
    expect(first).toMatchObject({ page: 1, pageCount, total: count });
    expect(names(first)).toEqual(numbered(count).slice(0, 5));
    if (pageCount === 2) expect(names(await list(t, 'boundary', 2))).toEqual(['Row 006']);
  });

  test('names that differ only in case keep their creation order', async () => {
    const t = setup();
    await seedNames(t, 'ties', ['beta', 'Alpha', 'alpha', 'ALPHA']);
    expect(names(await list(t, 'ties', 1))).toEqual(['Alpha', 'alpha', 'ALPHA', 'beta']);
  });

  test.each([0, -1, 2.5, Number.NaN, 4, 41, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'page %d of 13 rows returns page 1',
    async (page) => {
      const t = setup();
      await seedNames(t, 'thirteen', THIRTEEN);
      const result = await list(t, 'thirteen', page);
      expect(result).toMatchObject({ page: 1, pageCount: 3, total: 13 });
      expect(names(result)).toEqual(SORTED.slice(0, 5));
    },
  );

  test('250 rows: page 40 is rows 196 to 200 and the last page; page 41 returns page 1', async () => {
    const t = setup();
    await seedNames(t, 'many', numbered(250));
    const fortieth = await list(t, 'many', PUBLIC_LIST_MAX_PAGE);
    expect(fortieth).toMatchObject({ page: 40, pageCount: 40, total: 250 });
    expect(names(fortieth)).toEqual(numbered(200).slice(195));
    const past = await list(t, 'many', 41);
    expect(past).toMatchObject({ page: 1, pageCount: 40, total: 250 });
    expect(names(past)).toEqual(numbered(5));
  });

  test('a row inserted between page reads moves the others along: every row once', async () => {
    const t = setup();
    const organizationId = await seedNames(t, 'moving', THIRTEEN);
    const before = [await list(t, 'moving', 1), await list(t, 'moving', 2)];
    expect(names(before[0])).toEqual(SORTED.slice(0, 5));
    await t.run(async (ctx) => {
      if (kind === 'locations') {
        await insertLocation(ctx, organizationId, { name: 'Aardvark', address: '1 Aardvark Way' });
      } else {
        await insertLeague(ctx, organizationId, {
          name: 'Aardvark',
          sport: 'soccer',
          locations: [],
        });
      }
    });
    const after = [
      await list(t, 'moving', 1),
      await list(t, 'moving', 2),
      await list(t, 'moving', 3),
    ];
    expect(names(after[0])).toEqual(['Aardvark', ...SORTED.slice(0, 4)]);
    expect(names(after[1])[0]).toBe(SORTED[4]);
    expect(after.map((result) => result.total)).toEqual([14, 14, 14]);
    expect(after.flatMap(names).sort()).toEqual(['Aardvark', ...THIRTEEN].sort());
  });

  test.each(['does-not-exist', '', 'Gulf-Coast', 'x'.repeat(5000)])(
    'returns no rows for the unknown slug %j',
    async (slug) => {
      const t = setup();
      await seedNames(t, 'thirteen', THIRTEEN);
      expect(await list(t, slug, 1)).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
    },
  );

  test('an organization with no rows returns page 1 of 0', async () => {
    const t = setup();
    await seed(t, { organization: { name: 'Empty', slug: 'empty' }, locations: [], leagues: [] });
    expect(await list(t, 'empty', 1)).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test("never returns another organization's rows, and both callers get the same result", async () => {
    const t = setup();
    await seedA(t);
    await seedB(t);
    const anonymous = await list(t, 'gulf-coast', 1);
    const signedIn = await t
      .withIdentity({ subject: 'user-b', tokenIdentifier: 'test|user-b' })
      .query(
        kind === 'locations'
          ? api.organizations.listPublicLocations
          : api.organizations.listPublicLeagues,
        { slug: 'gulf-coast', page: 1 },
      );
    expect(signedIn).toEqual(anonymous);
    expect(JSON.stringify(anonymous)).not.toMatch(/B Field|B League|1 B Street/);
    expect(names(await list(t, 'other-org', 1))).toEqual([
      kind === 'locations' ? 'B Field' : 'B League',
    ]);
  });

  test('rejects arguments outside the validator, so no argument sets the page size or the cap', async () => {
    const t = setup();
    await seedNames(t, 'thirteen', THIRTEEN);
    const fn =
      kind === 'locations'
        ? api.organizations.listPublicLocations
        : api.organizations.listPublicLeagues;
    for (const args of [
      { slug: 'thirteen', page: 1, pageSize: 50 },
      { slug: 'thirteen', page: 1, maxPage: 100 },
      { slug: 'thirteen', page: '2' },
      { slug: 'thirteen' },
    ]) {
      await expect(
        t.query(fn, args as unknown as { slug: string; page: number }),
        JSON.stringify(args),
      ).rejects.toThrow();
    }
  });
});

describe('organizations:listPublicLocations rows', () => {
  test('each row holds the name and address only', async () => {
    const t = setup();
    await seedA(t);
    expect(
      await t.query(api.organizations.listPublicLocations, { slug: 'gulf-coast', page: 1 }),
    ).toEqual({
      rows: [
        { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
        {
          name: 'North Beach Sand Courts',
          address: '3500 Surfside Blvd, Corpus Christi, TX 78402',
        },
      ],
      page: 1,
      pageCount: 1,
      total: 2,
    });
  });
});

describe('organizations:listPublicLeagues rows', () => {
  test('each row holds the name, sport display name, and location names in the league order', async () => {
    const t = setup();
    await seedA(t);
    expect(
      await t.query(api.organizations.listPublicLeagues, { slug: 'gulf-coast', page: 1 }),
    ).toEqual({
      rows: [
        { name: 'coed 7v7 Rec', sportName: 'Soccer', locationNames: ['Bayside Athletic Complex'] },
        { name: 'Thursday Night Coed 2s', sportName: 'Beach volleyball', locationNames: [] },
        {
          name: 'Wednesday Coed Slow-Pitch',
          sportName: 'Softball',
          locationNames: ['North Beach Sand Courts', 'Bayside Athletic Complex'],
        },
      ],
      page: 1,
      pageCount: 1,
      total: 3,
    });
  });

  test('a league at a location outside the first 5 locations still shows its name', async () => {
    const t = setup();
    const locations = numbered(13).map((name) => ({ name, address: `${name} address` }));
    await seed(t, {
      organization: { name: 'Far Club', slug: 'far' },
      locations,
      leagues: [{ name: 'Far League', sport: 'softball', locations: ['Row 013', 'Row 001'] }],
    });
    const shownLocations = await t.query(api.organizations.listPublicLocations, {
      slug: 'far',
      page: 1,
    });
    expect(names(shownLocations)).not.toContain('Row 013');
    const leagues = await t.query(api.organizations.listPublicLeagues, { slug: 'far', page: 1 });
    expect(leagues.rows).toEqual([
      { name: 'Far League', sportName: 'Softball', locationNames: ['Row 013', 'Row 001'] },
    ]);
  });

  test("a league never names another organization's location, even if its document points at one", async () => {
    const t = setup();
    const orgA = await seedA(t);
    await seedB(t);
    await t.run(async (ctx) => {
      const locations = await ctx.db.query('locations').collect();
      const bField = locations.find((location) => location.name === 'B Field');
      const bayside = locations.find((location) => location.name === 'Bayside Athletic Complex');
      if (!bField || !bayside) throw new Error('fixture: a location is missing');
      const { leagueId } = await insertLeague(ctx, orgA, {
        name: 'Crossed League',
        sport: 'soccer',
        locations: [],
      });
      await ctx.db.patch('leagues', leagueId, { locationIds: [bField._id, bayside._id] });
    });
    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'gulf-coast',
      page: 1,
    });
    expect(leagues.rows.find((league) => league.name === 'Crossed League')).toEqual({
      name: 'Crossed League',
      sportName: 'Soccer',
      locationNames: ['Bayside Athletic Complex'],
    });
    expect(JSON.stringify(leagues)).not.toContain('B Field');
  });

  test('returns only the fields of the returns validator: no ids, creation times, or slugs', async () => {
    const t = setup();
    await seedA(t);
    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'gulf-coast',
      page: 1,
    });
    const locations = await t.query(api.organizations.listPublicLocations, {
      slug: 'gulf-coast',
      page: 1,
    });
    for (const result of [leagues, locations]) {
      expect(Object.keys(result).sort()).toEqual(['page', 'pageCount', 'rows', 'total']);
    }
    for (const league of leagues.rows) {
      expect(Object.keys(league).sort()).toEqual(['locationNames', 'name', 'sportName']);
    }
    for (const location of locations.rows) {
      expect(Object.keys(location).sort()).toEqual(['address', 'name']);
    }
    expect(JSON.stringify([leagues, locations])).not.toMatch(
      /_id|_creationTime|organizationId|locationIds|sortName|slug/,
    );
  });
});

describe('organizations module source', () => {
  test('every database read goes through an index (no table scan, no .filter())', () => {
    const reads = [...organizationsSource.matchAll(/ctx\.db\s*\.query\([^)]*\)\s*\.(\w+)/g)];
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.map(([, next]) => next)).toEqual(reads.map(() => 'withIndex'));
    expect(organizationsSource).not.toMatch(/\.filter\(\s*\(?q\b/);
  });

  test('lists read take(page * PUBLIC_LIST_PAGE_SIZE) with no old 200-row read or cursor', () => {
    expect(PUBLIC_LIST_PAGE_SIZE).toBe(5);
    expect(PUBLIC_LIST_MAX_PAGE).toBe(40);
    expect(organizationsSource.match(/\.take\(page \* PUBLIC_LIST_PAGE_SIZE\)/g)).toHaveLength(2);
    expect(organizationsSource).not.toMatch(/take\(200\)|PUBLIC_PAGE_LIMIT|paginate|cursor/i);
  });
});

describe('organizations: totals and page bounds against a recount (#100, tester)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The organization's rows recounted, keyed by slug: leagues, locations, and distinct sports. */
  async function recount(t: T) {
    return t.run(async (ctx) => {
      const organizations = await ctx.db.query('organizations').collect();
      const locations = await ctx.db.query('locations').collect();
      const leagues = await ctx.db.query('leagues').collect();
      return Object.fromEntries(
        organizations.map((organization) => {
          const own = leagues.filter((league) => league.organizationId === organization._id);
          return [
            organization.slug,
            {
              leagueCount: own.length,
              locationCount: locations.filter((l) => l.organizationId === organization._id).length,
              sportCount: new Set(own.map((league) => league.sport)).size,
            },
          ];
        }),
      );
    });
  }

  test('getPublicPage and both list totals equal a recount after every writer, in two organizations', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    const orgA = await seedA(t);
    await seedB(t);
    await t.run(async (ctx) => {
      await insertLocation(ctx, orgA, { name: 'aaa Courts', address: '9 Shore Rd' });
      await insertLeague(ctx, orgA, { name: 'zz League', sport: 'soccer', locations: [] });
    });
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'other-org',
      name: 'Second B League',
      sport: 'beachVolleyball',
      locations: ['B Field'],
    });
    const expected = await recount(t);
    for (const slug of ['gulf-coast', 'other-org']) {
      const page = await t.query(api.organizations.getPublicPage, { slug });
      expect({ slug, ...page }).toMatchObject({ slug, ...expected[slug] });
      const leagues = await t.query(api.organizations.listPublicLeagues, { slug, page: 1 });
      const locations = await t.query(api.organizations.listPublicLocations, { slug, page: 1 });
      expect([leagues.total, locations.total]).toEqual([
        expected[slug].leagueCount,
        expected[slug].locationCount,
      ]);
    }
  });

  test('counters equal a recount after concurrent writes to one organization', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    const orgA = await seedA(t);
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) =>
        t.mutation(internal.testing.addLeague, {
          organizationSlug: 'gulf-coast',
          name: `Concurrent League ${i}`,
          sport: 'softball',
          locations: ['Bayside Athletic Complex'],
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        t.run((ctx) =>
          insertLocation(ctx, orgA, { name: `Concurrent Field ${i}`, address: `${i} Road` }),
        ),
      ),
    ]);
    const expected = (await recount(t))['gulf-coast'];
    expect(expected).toEqual({ leagueCount: 23, locationCount: 12, sportCount: 3 });
    expect(await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' })).toMatchObject(
      expected,
    );
  });

  test.each([-0, Number.NEGATIVE_INFINITY, 1e300, 2 ** 53, 1 + Number.EPSILON, 3 - 1e-9])(
    'page %d of 13 locations returns page 1',
    async (page) => {
      const t = setup();
      await seedLocations(t, 'thirteen', THIRTEEN);
      const result = await t.query(api.organizations.listPublicLocations, {
        slug: 'thirteen',
        page,
      });
      expect(result).toMatchObject({ page: 1, pageCount: 3, total: 13 });
      expect(names(result)).toEqual(SORTED.slice(0, 5));
    },
  );

  test('a counter far above the rows still caps the page at 40, and no page throws', async () => {
    const t = setup();
    const organizationId = await seedLocations(t, 'drift', THIRTEEN);
    await t.run((ctx) =>
      ctx.db.patch('organizations', organizationId, { locationCount: 1e9, leagueCount: 1e9 }),
    );
    for (const fn of [api.organizations.listPublicLocations, api.organizations.listPublicLeagues]) {
      const huge = await t.query(fn, { slug: 'drift', page: 1e6 });
      expect(huge).toMatchObject({ page: 1, pageCount: PUBLIC_LIST_MAX_PAGE });
      const last = await t.query(fn, { slug: 'drift', page: PUBLIC_LIST_MAX_PAGE });
      expect(last).toMatchObject({ page: 40, pageCount: 40, rows: [] });
    }
  });
});
