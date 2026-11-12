/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  insertCustomLevel,
  insertLeague,
  insertLocation,
  insertTenant,
  type Tenant,
  defaultDivision,
} from './lib/tenantWrites';
import { insertPendingInvite } from './lib/inviteWrites';
import { PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_PAGE_SIZE } from './organizations';
import schema from './schema';
import { modules, leagueRequiredFields, organizationListFields } from './test.setup';
import organizationsSource from './organizations.ts?raw';

const BEACH = {
  key: 'beachVolleyball',
  segment: 'beach-volleyball',
  name: 'Beach volleyball',
} as const;
const SOCCER = { key: 'soccer', segment: 'soccer', name: 'Soccer' } as const;
const SOFTBALL = { key: 'softball', segment: 'softball', name: 'Softball' } as const;

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

function seed(t: T, tenant: Tenant): Promise<Id<'organizations'>> {
  return t.run((ctx) => insertTenant(ctx, tenant));
}

function seedA(t: T): Promise<Id<'organizations'>> {
  return seed(t, {
    organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
    locations: [
      { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
      {
        name: 'Bayside Athletic Complex',
        address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
      },
    ],
    leagues: [
      {
        name: 'Wednesday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['North Beach Sand Courts', 'Bayside Athletic Complex'],
        division: defaultDivision('softball'),
      },
      {
        name: 'coed 7v7 Rec',
        sport: 'soccer',
        locations: ['Bayside Athletic Complex'],
        division: defaultDivision('soccer'),
      },
      {
        name: 'Thursday Night Coed 2s',
        sport: 'beachVolleyball',
        locations: [],
        division: defaultDivision('beachVolleyball'),
      },
    ],
  });
}

function seedB(t: T): Promise<Id<'organizations'>> {
  return seed(t, {
    organization: { name: 'Other Org', slug: 'other-org' },
    locations: [{ name: 'B Field', address: '1 B Street' }],
    leagues: [
      {
        name: 'B League',
        sport: 'soccer',
        locations: ['B Field'],
        division: defaultDivision('soccer'),
      },
    ],
  });
}

// "adult league" sorts before "Zebra League" ignoring case; code-point order would put it after.
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
    leagues: names.map((name) => ({
      name,
      sport: 'soccer' as const,
      locations: ['Home Field'],
      division: defaultDivision('soccer' as const),
    })),
  });
}

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
      sports: [
        { ...BEACH, leagueCount: 1, locationCount: 0 },
        { ...SOCCER, leagueCount: 1, locationCount: 1 },
        { ...SOFTBALL, leagueCount: 1, locationCount: 2 },
      ],
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
      sports: [],
    });
  });

  test('reads a missing counter as 0 (an organization the backfill has not reached yet)', async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert('organizations', {
        ...organizationListFields('Old Club'),
        name: 'Old Club',
        slug: 'old',
      }),
    );
    expect(await t.query(api.organizations.getPublicPage, { slug: 'old' })).toEqual({
      name: 'Old Club',
      slug: 'old',
      leagueCount: 0,
      locationCount: 0,
      sportCount: 0,
      sports: [],
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
        division: defaultDivision(i % 2 ? ('soccer' as const) : ('softball' as const)),
      })),
    });
    await seedB(t);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'big' })).toEqual({
      name: 'Big Club',
      slug: 'big',
      leagueCount: 236,
      locationCount: 12,
      sportCount: 2,
      sports: [
        { ...SOCCER, leagueCount: 118, locationCount: 6 },
        { ...SOFTBALL, leagueCount: 118, locationCount: 6 },
      ],
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
      sports: [{ ...SOCCER, leagueCount: 1, locationCount: 1 }],
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
      'sports',
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
          division: defaultDivision('soccer'),
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
  test('each row holds the name, the address, and the sports played there', async () => {
    const t = setup();
    await seedA(t);
    expect(
      await t.query(api.organizations.listPublicLocations, { slug: 'gulf-coast', page: 1 }),
    ).toEqual({
      rows: [
        {
          name: 'Bayside Athletic Complex',
          address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
          sportNames: ['Soccer', 'Softball'],
        },
        {
          name: 'North Beach Sand Courts',
          address: '3500 Sandcourt Ln, Corpus Christi, TX 78402',
          sportNames: ['Softball'],
        },
      ],
      page: 1,
      pageCount: 1,
      total: 2,
    });
  });

  test('lists the sports in sport order whatever order the leagues were added in', async () => {
    const t = setup();
    await seed(t, {
      organization: { name: 'Order Club', slug: 'order-club' },
      locations: [{ name: 'Shared Field', address: '1 Shared Road' }],
      leagues: [
        {
          name: 'Softball One',
          sport: 'softball',
          locations: ['Shared Field'],
          division: defaultDivision('softball'),
        },
        {
          name: 'Soccer One',
          sport: 'soccer',
          locations: ['Shared Field'],
          division: defaultDivision('soccer'),
        },
        {
          name: 'Beach One',
          sport: 'beachVolleyball',
          locations: ['Shared Field'],
          division: defaultDivision('beachVolleyball'),
        },
        {
          name: 'Soccer Two',
          sport: 'soccer',
          locations: ['Shared Field'],
          division: defaultDivision('soccer'),
        },
      ],
    });
    const locations = await t.query(api.organizations.listPublicLocations, {
      slug: 'order-club',
      page: 1,
    });
    expect(locations.rows[0]?.sportNames).toEqual(['Beach volleyball', 'Soccer', 'Softball']);
  });

  test('a location with no league has no sports, and a draft league adds none', async () => {
    const t = setup();
    await seed(t, {
      organization: { name: 'Quiet Club', slug: 'quiet-club' },
      locations: [
        { name: 'Empty Field', address: '1 Empty Road' },
        { name: 'Draft Field', address: '2 Draft Road' },
      ],
      leagues: [
        {
          name: 'Draft League',
          sport: 'soccer',
          locations: ['Draft Field'],
          status: 'draft',
          division: defaultDivision('soccer'),
        },
      ],
    });
    const locations = await t.query(api.organizations.listPublicLocations, {
      slug: 'quiet-club',
      page: 1,
    });
    expect(locations.rows.map((row) => [row.name, row.sportNames])).toEqual([
      ['Draft Field', []],
      ['Empty Field', []],
    ]);
  });

  test("never names another organization's sports", async () => {
    const t = setup();
    await seedA(t);
    await seedB(t);
    const locations = await t.query(api.organizations.listPublicLocations, {
      slug: 'other-org',
      page: 1,
    });
    expect(locations.rows).toEqual([
      { name: 'B Field', address: '1 B Street', sportNames: ['Soccer'] },
    ]);
  });
});

describe('organizations:listPublicLocations with a sport', () => {
  test('returns only the locations with a league of the sport, by name, with the sport total', async () => {
    const t = setup();
    await seedA(t);
    const softball = await t.query(api.organizations.listPublicLocations, {
      slug: 'gulf-coast',
      page: 1,
      sport: 'softball',
    });
    expect(softball.rows.map((row) => row.name)).toEqual([
      'Bayside Athletic Complex',
      'North Beach Sand Courts',
    ]);
    expect([softball.page, softball.pageCount, softball.total]).toEqual([1, 1, 2]);
    const soccer = await t.query(api.organizations.listPublicLocations, {
      slug: 'gulf-coast',
      page: 1,
      sport: 'soccer',
    });
    expect(soccer).toEqual({
      rows: [
        {
          name: 'Bayside Athletic Complex',
          address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
          sportNames: ['Soccer', 'Softball'],
        },
      ],
      page: 1,
      pageCount: 1,
      total: 1,
    });
  });

  test('is empty for a sport with no league at a location, and for an unknown organization', async () => {
    const t = setup();
    await seedA(t);
    const empty = { rows: [], page: 1, pageCount: 0, total: 0 };
    expect(
      await t.query(api.organizations.listPublicLocations, {
        slug: 'gulf-coast',
        page: 1,
        sport: 'beachVolleyball',
      }),
    ).toEqual(empty);
    expect(
      await t.query(api.organizations.listPublicLocations, {
        slug: 'nobody',
        page: 1,
        sport: 'soccer',
      }),
    ).toEqual(empty);
  });

  test("never lists another organization's locations or a draft league's", async () => {
    const t = setup();
    await seedA(t);
    await seedB(t);
    await seed(t, {
      organization: { name: 'Draft Club', slug: 'draft-club' },
      locations: [{ name: 'Draft Field', address: '2 Draft Road' }],
      leagues: [
        {
          name: 'Draft League',
          sport: 'soccer',
          locations: ['Draft Field'],
          status: 'draft',
          division: defaultDivision('soccer'),
        },
      ],
    });
    const names = async (slug: string) =>
      (
        await t.query(api.organizations.listPublicLocations, { slug, page: 1, sport: 'soccer' })
      ).rows.map((row) => row.name);
    expect(await names('gulf-coast')).toEqual(['Bayside Athletic Complex']);
    expect(await names('other-org')).toEqual(['B Field']);
    expect(await names('draft-club')).toEqual([]);
  });

  test("never lists another organization's location, even through a sport row that points to it", async () => {
    const t = setup();
    const organizationId = await seedA(t);
    await seedB(t);
    await t.run(async (ctx) => {
      const foreign = (await ctx.db.query('locations').collect()).find(
        (location) => location.name === 'B Field',
      );
      if (!foreign) throw new Error('No B Field');
      await ctx.db.insert('sportLocations', {
        organizationId,
        sport: 'soccer',
        locationId: foreign._id,
        leagueCount: 1,
      });
    });
    const soccer = await t.query(api.organizations.listPublicLocations, {
      slug: 'gulf-coast',
      page: 1,
      sport: 'soccer',
    });
    expect(soccer.rows.map((row) => row.name)).toEqual(['Bayside Athletic Complex']);
    expect(soccer.total).toBe(1);
  });

  test('pages the sport locations by name, 5 per page, and falls back to page 1 for a page out of range', async () => {
    const t = setup();
    await seed(t, {
      organization: { name: 'Many Fields', slug: 'many-fields' },
      locations: THIRTEEN.map((name) => ({ name, address: `${name} address` })),
      leagues: [
        {
          name: 'All Fields',
          sport: 'soccer',
          locations: THIRTEEN,
          division: defaultDivision('soccer'),
        },
      ],
    });
    const page = (n: number) =>
      t.query(api.organizations.listPublicLocations, {
        slug: 'many-fields',
        page: n,
        sport: 'soccer',
      });
    expect((await page(3)).rows.map((row) => row.name)).toEqual(SORTED.slice(10));
    const first = await page(1);
    expect(first.rows.map((row) => row.name)).toEqual(SORTED.slice(0, 5));
    expect([first.pageCount, first.total]).toEqual([3, 13]);
    expect((await page(9)).rows.map((row) => row.name)).toEqual(SORTED.slice(0, 5));
  });

  test('rejects a sport outside the validator', async () => {
    const t = setup();
    await seedA(t);
    await expect(
      t.query(api.organizations.listPublicLocations, {
        slug: 'gulf-coast',
        page: 1,
        sport: 'curling' as unknown as 'soccer',
      }),
    ).rejects.toThrow();
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
        {
          name: 'coed 7v7 Rec',
          slug: 'coed-7v7-rec',
          sportName: 'Soccer',
          locationNames: ['Bayside Athletic Complex'],
          divisionLabel: 'Coed · 4v4 · Rec',
          seasons: [],
        },
        {
          name: 'Thursday Night Coed 2s',
          slug: 'thursday-night-coed-2s',
          sportName: 'Beach volleyball',
          locationNames: [],
          divisionLabel: 'Coed · 2v2 · Rec',
          seasons: [],
        },
        {
          name: 'Wednesday Coed Slow-Pitch',
          slug: 'wednesday-coed-slow-pitch',
          sportName: 'Softball',
          locationNames: ['North Beach Sand Courts', 'Bayside Athletic Complex'],
          divisionLabel: 'Coed · 9v9 · Rec',
          seasons: [],
        },
      ],
      page: 1,
      pageCount: 1,
      total: 3,
    });
  });

  test('a league carries its division label', async () => {
    const t = setup();
    await seed(t, {
      organization: { name: 'Divided Club', slug: 'divided-club' },
      locations: [{ name: 'Home Field', address: '1 Home Road' }],
      leagues: [
        {
          name: 'Men Over-30 11v11',
          sport: 'soccer',
          locations: ['Home Field'],
          division: {
            gender: 'mens',
            playersPerSide: 11,
            level: 'rec',
            ageGroup: 'over30',
          },
        },
        {
          name: 'Coed 4s',
          sport: 'beachVolleyball',
          locations: ['Home Field'],
          division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
        },
      ],
    });
    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'divided-club',
      page: 1,
    });
    expect(leagues.rows.map((row) => [row.name, row.divisionLabel])).toEqual([
      ['Coed 4s', 'Coed · 4v4 · BB'],
      ['Men Over-30 11v11', 'Men · 11v11 · Rec · 30+'],
    ]);
  });

  test("a league with a custom level shows the organization's name for it beside the standard level", async () => {
    const t = setup();
    const organizationId = await seed(t, {
      organization: { name: 'Custom Club', slug: 'custom-club' },
      locations: [{ name: 'Home Field', address: '1 Home Road' }],
      leagues: [],
    });
    await t.run(async (ctx) => {
      await insertCustomLevel(ctx, organizationId, {
        sport: 'softball',
        name: 'D',
        standardLevel: 'rec',
      });
      await insertLeague(ctx, organizationId, {
        name: 'Men D Slow-Pitch',
        sport: 'softball',
        locations: ['Home Field'],
        division: {
          gender: 'mens',
          playersPerSide: 10,
          level: 'rec',
          customLevel: 'D',
          ageGroup: 'adult',
        },
      });
    });
    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'custom-club',
      page: 1,
    });
    expect(leagues.rows[0]?.divisionLabel).toBe('Men · 10v10 · D (Rec)');
  });

  test('a league whose custom level belongs to another organization or sport shows the standard level and the page still loads', async () => {
    const t = setup();
    const organizationId = await seed(t, {
      organization: { name: 'Bad Data Club', slug: 'bad-data-club' },
      locations: [{ name: 'Home Field', address: '1 Home Road' }],
      leagues: [],
    });
    const otherId = await seedB(t);
    await t.run(async (ctx) => {
      const otherLevel = await insertCustomLevel(ctx, otherId, {
        sport: 'soccer',
        name: 'Z',
        standardLevel: 'rec',
      });
      const beachLevel = await insertCustomLevel(ctx, organizationId, {
        sport: 'beachVolleyball',
        name: 'Y',
        standardLevel: 'bb',
      });
      for (const [name, customLevelId] of [
        ['Other Org Level', otherLevel],
        ['Other Sport Level', beachLevel],
      ] as const) {
        const { leagueId } = await insertLeague(ctx, organizationId, {
          name,
          sport: 'soccer',
          locations: ['Home Field'],
          division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
        });
        await ctx.db.patch('leagues', leagueId, { customLevelId });
      }
    });
    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'bad-data-club',
      page: 1,
    });
    expect(leagues.rows.map((row) => [row.name, row.divisionLabel])).toEqual([
      ['Other Org Level', 'Coed · 7v7 · Rec'],
      ['Other Sport Level', 'Coed · 7v7 · Rec'],
    ]);
  });

  test('a league at a location outside the first 5 locations still shows its name', async () => {
    const t = setup();
    const locations = numbered(13).map((name) => ({ name, address: `${name} address` }));
    await seed(t, {
      organization: { name: 'Far Club', slug: 'far' },
      locations,
      leagues: [
        {
          name: 'Far League',
          sport: 'softball',
          locations: ['Row 013', 'Row 001'],
          division: defaultDivision('softball'),
        },
      ],
    });
    const shownLocations = await t.query(api.organizations.listPublicLocations, {
      slug: 'far',
      page: 1,
    });
    expect(names(shownLocations)).not.toContain('Row 013');
    const leagues = await t.query(api.organizations.listPublicLeagues, { slug: 'far', page: 1 });
    expect(leagues.rows).toEqual([
      {
        name: 'Far League',
        slug: 'far-league',
        sportName: 'Softball',
        locationNames: ['Row 013', 'Row 001'],
        divisionLabel: 'Coed · 9v9 · Rec',
        seasons: [],
      },
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
        division: defaultDivision('soccer'),
      });
      await ctx.db.patch('leagues', leagueId, { locationIds: [bField._id, bayside._id] });
    });
    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'gulf-coast',
      page: 1,
    });
    expect(leagues.rows.find((league) => league.name === 'Crossed League')).toEqual({
      name: 'Crossed League',
      slug: 'crossed-league',
      sportName: 'Soccer',
      locationNames: ['Bayside Athletic Complex'],
      divisionLabel: 'Coed · 4v4 · Rec',
      seasons: [],
    });
    expect(JSON.stringify(leagues)).not.toContain('B Field');
  });

  test('returns only the fields of the returns validator: no ids or creation times, and only a league’s own slug', async () => {
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
      expect(Object.keys(league).sort()).toEqual([
        'divisionLabel',
        'locationNames',
        'name',
        'seasons',
        'slug',
        'sportName',
      ]);
    }
    expect(JSON.stringify(leagues)).not.toMatch(/customLevelId|standardLevel/);
    for (const location of locations.rows) {
      expect(Object.keys(location).sort()).toEqual(['address', 'name', 'sportNames']);
    }
    expect(JSON.stringify([leagues, locations])).not.toMatch(
      /_id|_creationTime|organizationId|locationIds|sortName|publishedSeasonCount/,
    );
    expect(JSON.stringify(locations)).not.toContain('slug');
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

describe('organizations: totals and page bounds against a recount', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
      await insertLeague(ctx, orgA, {
        name: 'zz League',
        sport: 'soccer',
        locations: [],
        division: defaultDivision('soccer'),
      });
    });
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'other-org',
      name: 'Second B League',
      sport: 'beachVolleyball',
      locations: ['B Field'],
      division: defaultDivision('beachVolleyball'),
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
          division: defaultDivision('softball'),
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

function seedSports(t: T, slug: string) {
  const fields = ['Court A', 'Court B', 'Court C', 'Turf'];
  return seed(t, {
    organization: { name: `Org ${slug}`, slug },
    locations: fields.map((name) => ({ name, address: `${name} address` })),
    leagues: [
      ...numbered(12).map((name, i) => ({
        name: `Sand ${name}`,
        sport: 'beachVolleyball' as const,
        locations: i === 0 ? ['Court A', 'Court A'] : [fields[i % 3]],
        division: defaultDivision('beachVolleyball' as const),
      })),
      ...numbered(3).map((name) => ({
        name: `Kick ${name}`,
        sport: 'soccer' as const,
        locations: ['Turf'],
        division: defaultDivision('soccer' as const),
      })),
    ],
  });
}

describe('organizations:getPublicPage sports', () => {
  test('lists each sport with a league: key, segment, name, and league and location counts', async () => {
    const t = setup();
    await seedSports(t, 'sandy');
    expect(await t.query(api.organizations.getPublicPage, { slug: 'sandy' })).toEqual({
      name: 'Org sandy',
      slug: 'sandy',
      leagueCount: 15,
      locationCount: 4,
      sportCount: 2,
      sports: [
        { ...BEACH, leagueCount: 12, locationCount: 3 },
        { ...SOCCER, leagueCount: 3, locationCount: 1 },
      ],
    });
  });

  test("excludes another organization's leagues and locations", async () => {
    const t = setup();
    await seedSports(t, 'sandy');
    await seed(t, {
      organization: { name: 'Other', slug: 'other' },
      locations: [
        { name: 'Turf', address: 'Elsewhere' },
        { name: 'Diamond', address: '1 Diamond Rd' },
      ],
      leagues: [
        {
          name: 'Other Soccer',
          sport: 'soccer',
          locations: ['Turf', 'Diamond'],
          division: defaultDivision('soccer'),
        },
        {
          name: 'Other Softball',
          sport: 'softball',
          locations: ['Diamond'],
          division: defaultDivision('softball'),
        },
      ],
    });
    expect((await t.query(api.organizations.getPublicPage, { slug: 'sandy' }))?.sports).toEqual([
      { ...BEACH, leagueCount: 12, locationCount: 3 },
      { ...SOCCER, leagueCount: 3, locationCount: 1 },
    ]);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'other' })).toMatchObject({
      sportCount: 2,
      sports: [
        { ...SOCCER, leagueCount: 1, locationCount: 2 },
        { ...SOFTBALL, leagueCount: 1, locationCount: 1 },
      ],
    });
  });

  test('lists sports in SPORT_NAMES order whatever order the leagues were inserted in', async () => {
    const t = setup();
    await seed(t, {
      organization: { name: 'Order', slug: 'order' },
      locations: [],
      leagues: [
        { name: 'S', sport: 'softball', locations: [], division: defaultDivision('softball') },
        {
          name: 'B',
          sport: 'beachVolleyball',
          locations: [],
          division: defaultDivision('beachVolleyball'),
        },
        { name: 'F', sport: 'soccer', locations: [], division: defaultDivision('soccer') },
      ],
    });
    const page = await t.query(api.organizations.getPublicPage, { slug: 'order' });
    expect(page?.sports.map((sport) => sport.key)).toEqual([
      'beachVolleyball',
      'soccer',
      'softball',
    ]);
    expect(page?.sports.map((sport) => sport.locationCount)).toEqual([0, 0, 0]);
  });

  test('an organization with no league has no sports, and sportCount is the length of sports', async () => {
    const t = setup();
    await seed(t, { organization: { name: 'Empty', slug: 'empty' }, locations: [], leagues: [] });
    expect(await t.query(api.organizations.getPublicPage, { slug: 'empty' })).toMatchObject({
      sportCount: 0,
      sports: [],
    });
  });

  test('reads missing sport counters as no sports (an organization the backfill has not reached)', async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert('organizations', {
        ...organizationListFields('Old Club'),
        name: 'Old Club',
        slug: 'old',
      }),
    );
    expect(await t.query(api.organizations.getPublicPage, { slug: 'old' })).toMatchObject({
      sportCount: 0,
      sports: [],
    });
  });

  test('a league written to an organization without sport counters leaves them unset and writes no sportLocations row', async () => {
    const t = setup();
    const organizationId = await t.run((ctx) =>
      ctx.db.insert('organizations', {
        ...organizationListFields('Old Club'),
        name: 'Old Club',
        slug: 'old',
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert('locations', { organizationId, name: 'F', address: 'A' });
      await insertLeague(ctx, organizationId, {
        name: 'L',
        sport: 'soccer',
        locations: ['F'],
        division: defaultDivision('soccer'),
      });
    });
    const state = await t.run(async (ctx) => ({
      organization: await ctx.db.get('organizations', organizationId),
      rows: await ctx.db.query('sportLocations').collect(),
    }));
    expect(state.rows).toEqual([]);
    expect(state.organization?.sportLeagueCounts).toBeUndefined();
    expect(state.organization?.sportLocationCounts).toBeUndefined();
  });

  test('the counters follow every insertLeague, and a throwing insert rolls them back with the league', async () => {
    const t = setup();
    const organizationId = await seed(t, {
      organization: { name: 'Grow', slug: 'grow' },
      locations: [
        { name: 'One', address: '1' },
        { name: 'Two', address: '2' },
      ],
      leagues: [],
    });
    const sportsOf = async () =>
      (await t.query(api.organizations.getPublicPage, { slug: 'grow' }))?.sports.map(
        ({ key, leagueCount, locationCount }) => [key, leagueCount, locationCount],
      );
    expect(await sportsOf()).toEqual([]);
    await t.run((ctx) =>
      insertLeague(ctx, organizationId, {
        name: 'A',
        sport: 'soccer',
        locations: ['One'],
        division: defaultDivision('soccer'),
      }),
    );
    expect(await sportsOf()).toEqual([['soccer', 1, 1]]);
    await t.run((ctx) =>
      insertLeague(ctx, organizationId, {
        name: 'B',
        sport: 'soccer',
        locations: ['One', 'Two'],
        division: defaultDivision('soccer'),
      }),
    );
    expect(await sportsOf()).toEqual([['soccer', 2, 2]]);
    await expect(
      t.run((ctx) =>
        insertLeague(ctx, organizationId, {
          name: 'C',
          sport: 'soccer',
          locations: ['One', 'Nope'],
          division: defaultDivision('soccer'),
        }),
      ),
    ).rejects.toThrow(/Nope/);
    expect(await sportsOf()).toEqual([['soccer', 2, 2]]);
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query('sportLocations').collect()).map(({ sport, leagueCount }) => [
        sport,
        leagueCount,
      ]),
    );
    expect(rows.sort()).toEqual([
      ['soccer', 1],
      ['soccer', 2],
    ]);
  });

  test('returns only the documented fields of each sport: no ids', async () => {
    const t = setup();
    await seedSports(t, 'sandy');
    const page = await t.query(api.organizations.getPublicPage, { slug: 'sandy' });
    for (const sport of page?.sports ?? []) {
      expect(Object.keys(sport).sort()).toEqual([
        'key',
        'leagueCount',
        'locationCount',
        'name',
        'segment',
      ]);
    }
    expect(JSON.stringify(page)).not.toMatch(/_id|_creationTime|organizationId|locationId/);
  });
});

describe('organizations:listPublicLeagues with a sport', () => {
  const SOCCER_NAMES = THIRTEEN.slice(0, 12);
  const SOCCER_SORTED = [...SOCCER_NAMES].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : 1,
  );

  function seedMixed(t: T, slug = 'mixed') {
    return seed(t, {
      organization: { name: `Org ${slug}`, slug },
      locations: [{ name: 'Home Field', address: '1 Home Road' }],
      leagues: [
        {
          name: 'Aaa Sand',
          sport: 'beachVolleyball',
          locations: ['Home Field'],
          division: defaultDivision('beachVolleyball'),
        },
        ...SOCCER_NAMES.map((name) => ({
          name,
          sport: 'soccer' as const,
          locations: ['Home Field'],
          division: defaultDivision('soccer' as const),
        })),
        {
          name: 'Bbb Sand',
          sport: 'beachVolleyball',
          locations: [],
          division: defaultDivision('beachVolleyball'),
        },
        {
          name: 'Aaa Softball',
          sport: 'softball',
          locations: ['Home Field'],
          division: defaultDivision('softball'),
        },
        {
          name: 'Zzz Sand',
          sport: 'beachVolleyball',
          locations: [],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
  }

  const soccer = (t: T, slug: string, page: number) =>
    t.query(api.organizations.listPublicLeagues, { slug, page, sport: 'soccer' });

  test('pages 1 to 3 of 12 soccer leagues: 5, 5, and 2 by name ignoring case', async () => {
    const t = setup();
    await seedMixed(t);
    const pages = [await soccer(t, 'mixed', 1), await soccer(t, 'mixed', 2)];
    pages.push(await soccer(t, 'mixed', 3));
    expect(pages.map(({ page, pageCount, total }) => ({ page, pageCount, total }))).toEqual([
      { page: 1, pageCount: 3, total: 12 },
      { page: 2, pageCount: 3, total: 12 },
      { page: 3, pageCount: 3, total: 12 },
    ]);
    expect(pages.map(names)).toEqual([
      SOCCER_SORTED.slice(0, 5),
      SOCCER_SORTED.slice(5, 10),
      SOCCER_SORTED.slice(10),
    ]);
    expect(pages.flatMap((result) => result.rows.map((row) => row.sportName))).toEqual(
      SOCCER_NAMES.map(() => 'Soccer'),
    );
    expect(pages[0].rows[0].locationNames).toEqual(['Home Field']);
  });

  test.each([0, 4, 41, -1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'page %d returns page 1',
    async (page) => {
      const t = setup();
      await seedMixed(t);
      const result = await soccer(t, 'mixed', page);
      expect(result).toMatchObject({ page: 1, pageCount: 3, total: 12 });
      expect(names(result)).toEqual(SOCCER_SORTED.slice(0, 5));
    },
  );

  test("returns only that organization's leagues of the sport", async () => {
    const t = setup();
    await seedMixed(t);
    await seedMixed(t, 'twin');
    await seedB(t);
    const result = await soccer(t, 'mixed', 1);
    expect(result.total).toBe(12);
    expect(JSON.stringify(result)).not.toMatch(/B League|Sand|Softball/);
    const other = await soccer(t, 'other-org', 1);
    expect(other).toMatchObject({ total: 1 });
    expect(names(other)).toEqual(['B League']);
  });

  test('a sport with no league returns an empty page 1 with total 0', async () => {
    const t = setup();
    await seedB(t);
    const softball = await t.query(api.organizations.listPublicLeagues, {
      slug: 'other-org',
      page: 1,
      sport: 'softball',
    });
    expect(softball).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
    const farPage = await t.query(api.organizations.listPublicLeagues, {
      slug: 'other-org',
      page: 3,
      sport: 'beachVolleyball',
    });
    expect(farPage).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test('an unknown slug returns no rows with a sport', async () => {
    const t = setup();
    await seedMixed(t);
    expect(await soccer(t, 'nope', 1)).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test.each(['hockey', 'Soccer', 'beach-volleyball', '', 'constructor'])(
    'refuses the sport %j in argument validation',
    async (sport) => {
      const t = setup();
      await seedMixed(t);
      await expect(
        t.query(api.organizations.listPublicLeagues, {
          slug: 'mixed',
          page: 1,
          sport,
        } as unknown as { slug: string; page: number }),
      ).rejects.toThrow();
    },
  );

  test('without a sport the list is unchanged: every sport, total the league count', async () => {
    const t = setup();
    await seedMixed(t);
    const all = await t.query(api.organizations.listPublicLeagues, { slug: 'mixed', page: 1 });
    expect(all).toMatchObject({ page: 1, pageCount: 4, total: 16 });
    expect(names(all)).toEqual(['Aaa Sand', 'Aaa Softball', 'adult league', 'Bbb Sand', 'beta']);
  });

  test('a sport counter far above the rows still caps the pages at 40, and no page throws', async () => {
    const t = setup();
    const organizationId = await seedMixed(t);
    await t.run((ctx) =>
      ctx.db.patch('organizations', organizationId, { sportLeagueCounts: { soccer: 1e9 } }),
    );
    expect(await soccer(t, 'mixed', 1e6)).toMatchObject({
      page: 1,
      pageCount: PUBLIC_LIST_MAX_PAGE,
    });
    expect(await soccer(t, 'mixed', PUBLIC_LIST_MAX_PAGE)).toMatchObject({ page: 40, rows: [] });
  });

  test('a missing sport counter reads as 0 leagues', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', {
        ...organizationListFields('Old'),
        name: 'Old',
        slug: 'old',
      });
      await ctx.db.insert('leagues', {
        ...leagueRequiredFields('soccer', 'L'),
        organizationId,
        name: 'L',
        slug: 'l',
        sport: 'soccer',
        locationIds: [],
        sortName: 'l',
      });
    });
    expect(await soccer(t, 'old', 1)).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });
});

describe('organizations module source', () => {
  test('the sport list reads through the sport index with the same offset read', () => {
    expect(organizationsSource).toMatch(/by_organizationId_and_sport_and_status_and_sortName/);
    expect(organizationsSource.match(/\.take\(page \* PUBLIC_LIST_PAGE_SIZE\)/g)).toHaveLength(2);
  });
});

describe('organizations.getAttention', () => {
  const identity = (authUserId: string) => ({
    subject: authUserId,
    issuer: 'http://127.0.0.1:3211',
    email: `${authUserId}@example.test`,
    emailVerified: false,
    name: authUserId,
    sessionId: 's1',
  });

  async function setupAttention() {
    const t = setup();
    const ids = await t.run(async (ctx) => {
      const a = await insertTenant(ctx, {
        organization: { name: 'Org A', slug: 'org-a' },
        locations: [],
        leagues: [],
      });
      const b = await insertTenant(ctx, {
        organization: { name: 'Org B', slug: 'org-b' },
        locations: [],
        leagues: [],
      });
      const member = async (
        authUserId: string,
        organizationId: Id<'organizations'> | null,
        role: 'orgAdmin' | 'leagueOrganizer',
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
      await member('admin-a', a, 'orgAdmin');
      await member('organizer-a', a, 'leagueOrganizer');
      await member('admin-b', b, 'orgAdmin');
      await member('stranger', null, 'orgAdmin');
      return { a, b };
    });
    return { t, ...ids };
  }

  type Setup = Awaited<ReturnType<typeof setupAttention>>;

  const attention = ({ t, a }: Setup) =>
    t
      .withIdentity(identity('admin-a'))
      .query(api.organizations.getAttention, { organizationId: a });

  function addLeagues(
    { t }: Setup,
    organizationId: Id<'organizations'>,
    names: string[],
    status: 'published' | 'draft' = 'published',
  ): Promise<Id<'leagues'>[]> {
    return t.run(async (ctx) => {
      const ids: Id<'leagues'>[] = [];
      for (const name of names) {
        ids.push(
          await ctx.db.insert('leagues', {
            ...leagueRequiredFields('soccer', name),
            organizationId,
            name,
            slug: name.toLowerCase().replaceAll(' ', '-'),
            sport: 'soccer',
            locationIds: [],
            sortName: name.toLowerCase(),
            status,
          }),
        );
      }
      return ids;
    });
  }

  function addSeasons(
    { t }: Setup,
    organizationId: Id<'organizations'>,
    leagueId: Id<'leagues'>,
    seasons: { name: string; registrationDeadline: string; status?: 'draft' | 'published' }[],
  ): Promise<void> {
    return t.run(async (ctx) => {
      for (const season of seasons) {
        await ctx.db.insert('seasons', {
          organizationId,
          leagueId,
          name: season.name,
          slug: season.name.toLowerCase().replaceAll(' ', '-'),
          startDate: '2031-06-01',
          endDate: '2031-08-30',
          registrationDeadline: season.registrationDeadline,
          playersPerSide: 4,
          minimumRosterSize: 4,
          status: season.status ?? 'draft',
        });
      }
    });
  }

  function addInvites(
    { t }: Setup,
    organizationId: Id<'organizations'>,
    invites: { email: string; expiresAt: number }[],
  ): Promise<void> {
    return t.run(async (ctx) => {
      for (const invite of invites) {
        await insertPendingInvite(ctx, {
          organizationId,
          email: invite.email,
          role: 'orgAdmin',
          leagueIds: [],
          tokenHash: `hash-${invite.email}`,
          expiresAt: invite.expiresAt,
        });
      }
    });
  }

  const dayOf = (n: number) => `2031-05-${String(n).padStart(2, '0')}`;
  const numbered = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${prefix} ${String(i + 1).padStart(3, '0')}`);

  test('returns an empty answer for an organization with nothing to do', async () => {
    const s = await setupAttention();
    expect(await attention(s)).toEqual({
      draftSeasons: { items: [], total: 0, capped: false },
      leaguesWithoutSeason: { items: [], total: 0, capped: false },
      pendingInvites: { total: 0, capped: false, soonest: [] },
    });
  });

  test('lists draft seasons by soonest registration deadline with their league', async () => {
    const s = await setupAttention();
    const [sunday, coed] = await addLeagues(s, s.a, ['Sunday Reverse Coed 4s', 'Coed 7v7 Rec']);
    await addSeasons(s, s.a, sunday, [
      { name: 'Fall 2031', registrationDeadline: dayOf(20) },
      { name: 'Winter 2031', registrationDeadline: dayOf(5) },
    ]);
    await addSeasons(s, s.a, coed, [{ name: 'Spring 2031', registrationDeadline: dayOf(12) }]);
    const { draftSeasons } = await attention(s);
    expect(draftSeasons.items.map((item) => [item.name, item.leagueName, item.leagueSlug])).toEqual(
      [
        ['Winter 2031', 'Sunday Reverse Coed 4s', 'sunday-reverse-coed-4s'],
        ['Spring 2031', 'Coed 7v7 Rec', 'coed-7v7-rec'],
        ['Fall 2031', 'Sunday Reverse Coed 4s', 'sunday-reverse-coed-4s'],
      ],
    );
    expect(draftSeasons).toMatchObject({ total: 3, capped: false });
  });

  test('leaves out a published season', async () => {
    const s = await setupAttention();
    const [league] = await addLeagues(s, s.a, ['Sunday']);
    await addSeasons(s, s.a, league, [
      { name: 'Live', registrationDeadline: dayOf(5), status: 'published' },
      { name: 'Draft', registrationDeadline: dayOf(6) },
    ]);
    const { draftSeasons } = await attention(s);
    expect(draftSeasons.items.map((item) => item.name)).toEqual(['Draft']);
    expect(draftSeasons.total).toBe(1);
  });

  test('lists published leagues with no season by name, ignoring case', async () => {
    const s = await setupAttention();
    const leagues = await addLeagues(s, s.a, ['Zebra', 'adult', 'Mu', 'Has Season', 'Only Draft']);
    await addLeagues(s, s.a, ['Draft League'], 'draft');
    await addSeasons(s, s.a, leagues[3], [
      { name: 'Live', registrationDeadline: dayOf(5), status: 'published' },
    ]);
    await addSeasons(s, s.a, leagues[4], [{ name: 'Draft', registrationDeadline: dayOf(5) }]);
    const { leaguesWithoutSeason } = await attention(s);
    expect(leaguesWithoutSeason.items.map((item) => [item.name, item.slug])).toEqual([
      ['adult', 'adult'],
      ['Mu', 'mu'],
      ['Zebra', 'zebra'],
    ]);
    expect(leaguesWithoutSeason).toMatchObject({ total: 3, capped: false });
  });

  test('lists pending invites as a total and the three that expire first', async () => {
    const s = await setupAttention();
    await addInvites(s, s.a, [
      { email: 'd@example.test', expiresAt: 4000 },
      { email: 'a@example.test', expiresAt: 1000 },
      { email: 'c@example.test', expiresAt: 3000 },
      { email: 'b@example.test', expiresAt: 2000 },
    ]);
    await s.t.run(async (ctx) => {
      await ctx.db.insert('invites', {
        organizationId: s.a,
        email: 'gone@example.test',
        role: 'orgAdmin',
        leagueIds: [],
        tokenHash: 'hash-gone',
        expiresAt: 500,
        status: 'revoked',
      });
    });
    const { pendingInvites } = await attention(s);
    expect(pendingInvites).toEqual({
      total: 4,
      capped: false,
      soonest: [
        { email: 'a@example.test', expiresAt: 1000 },
        { email: 'b@example.test', expiresAt: 2000 },
        { email: 'c@example.test', expiresAt: 3000 },
      ],
    });
  });

  test('returns 20 draft seasons and the total of 25', async () => {
    const s = await setupAttention();
    const [league] = await addLeagues(s, s.a, ['Sunday']);
    await addSeasons(
      s,
      s.a,
      league,
      numbered('Season', 25).map((name, i) => ({
        name,
        registrationDeadline: `2031-06-${String(25 - i).padStart(2, '0')}`,
      })),
    );
    const { draftSeasons } = await attention(s);
    expect(draftSeasons.items).toHaveLength(20);
    expect(draftSeasons).toMatchObject({ total: 25, capped: false });
    expect(draftSeasons.items[0].name).toBe('Season 025');
  });

  test('stops counting draft seasons at 100 and says there are more', async () => {
    const s = await setupAttention();
    const [league] = await addLeagues(s, s.a, ['Sunday']);
    await addSeasons(
      s,
      s.a,
      league,
      numbered('Season', 120).map((name) => ({ name, registrationDeadline: dayOf(9) })),
    );
    const { draftSeasons } = await attention(s);
    expect(draftSeasons.items).toHaveLength(20);
    expect(draftSeasons).toMatchObject({ total: 100, capped: true });
  });

  test('exactly 100 draft seasons are not capped', async () => {
    const s = await setupAttention();
    const [league] = await addLeagues(s, s.a, ['Sunday']);
    await addSeasons(
      s,
      s.a,
      league,
      numbered('Season', 100).map((name) => ({ name, registrationDeadline: dayOf(9) })),
    );
    expect((await attention(s)).draftSeasons).toMatchObject({ total: 100, capped: false });
  });

  test('checks only the first 100 published leagues by name for a season', async () => {
    const s = await setupAttention();
    const names = numbered('League', 120);
    const ids = await addLeagues(s, s.a, names);
    await addSeasons(s, s.a, ids[0], [
      { name: 'Live', registrationDeadline: dayOf(5), status: 'published' },
    ]);
    const { leaguesWithoutSeason } = await attention(s);
    expect(leaguesWithoutSeason.capped).toBe(true);
    expect(leaguesWithoutSeason.total).toBe(99);
    expect(leaguesWithoutSeason.items).toHaveLength(20);
    expect(leaguesWithoutSeason.items[0].name).toBe('League 002');
  });

  test('120 published leagues with no season give 20 items and a capped total of 100', async () => {
    const s = await setupAttention();
    await addLeagues(s, s.a, numbered('League', 120));
    const { leaguesWithoutSeason } = await attention(s);
    expect(leaguesWithoutSeason.items).toHaveLength(20);
    expect(leaguesWithoutSeason).toMatchObject({ total: 100, capped: true });
  });

  test('counts pending invites up to 100 and says there are more', async () => {
    const s = await setupAttention();
    await addInvites(
      s,
      s.a,
      numbered('invite', 120).map((name, i) => ({
        email: `${name.replace(' ', '-')}@example.test`,
        expiresAt: 1000 + i,
      })),
    );
    const { pendingInvites } = await attention(s);
    expect(pendingInvites).toMatchObject({ total: 100, capped: true });
    expect(pendingInvites.soonest).toHaveLength(3);
  });

  test("never returns another organization's drafts, leagues, or invites", async () => {
    const s = await setupAttention();
    const [other] = await addLeagues(s, s.b, ['Other League']);
    await addLeagues(s, s.b, ['Other Empty']);
    await addSeasons(s, s.b, other, [{ name: 'Other Draft', registrationDeadline: dayOf(5) }]);
    await addInvites(s, s.b, [{ email: 'other@example.test', expiresAt: 1000 }]);
    expect(await attention(s)).toEqual({
      draftSeasons: { items: [], total: 0, capped: false },
      leaguesWithoutSeason: { items: [], total: 0, capped: false },
      pendingInvites: { total: 0, capped: false, soonest: [] },
    });
  });

  test('refuses a league organizer, an org admin of another organization, a non-member, and an unauthenticated caller', async () => {
    const { t, a } = await setupAttention();
    for (const caller of ['organizer-a', 'admin-b', 'stranger', 'ghost', null]) {
      const run = caller ? t.withIdentity(identity(caller)) : t;
      await expect(
        run.query(api.organizations.getAttention, { organizationId: a }),
        String(caller),
      ).rejects.toThrow();
    }
  });
});
