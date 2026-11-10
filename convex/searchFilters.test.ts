/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Gender, StandardLevel, AgeGroup } from './lib/divisions';
import { insertTenant, sortName, type Tenant } from './lib/tenantWrites';
import type { Sport } from './lib/sports';
import schema from './schema';
import { SEARCH_RESULT_LIMIT, SEARCH_SCAN_LIMIT } from './search';
import { modules } from './test.setup';

const LOCATION = 'Cottonwood Creek Fields';

const FILL = { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' } as const;

type League = Tenant['leagues'][number];

const league = (
  name: string,
  sport: Sport,
  division: Partial<NonNullable<League['division']>> = {},
  status?: 'draft',
): League => ({
  name,
  sport,
  locations: [LOCATION],
  division: { ...FILL, ...division },
  ...(status && { status }),
});

const GIRLS_ROOKIES = league('Girls Rookies', 'soccer', {
  gender: 'womens',
  ageGroup: 'u10',
});
const GIRLS_SELECT = league('Girls Select', 'soccer', {
  gender: 'womens',
  level: 'competitive',
  ageGroup: 'u10',
});
const BOYS_ROOKIES = league('Boys Rookies', 'soccer', { gender: 'mens', ageGroup: 'u10' });
const WOMEN_ELEVEN = league('Women Eleven', 'soccer', {
  gender: 'womens',
  playersPerSide: 11,
  level: 'intermediate',
});
const COED_SANDS = league('Coed Sands', 'beachVolleyball', { playersPerSide: 4, level: 'bb' });
const COED_SLOW = league('Coed Slow', 'softball', { playersPerSide: 10 });

async function setup(leagues: League[]) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Front Range', slug: 'front-range', cityState: 'Denver, CO' },
      locations: [{ name: LOCATION, address: '1 Creek Rd' }],
      leagues,
    });
  });
  return t;
}

const ALL = [
  GIRLS_ROOKIES,
  GIRLS_SELECT,
  BOYS_ROOKIES,
  WOMEN_ELEVEN,
  COED_SANDS,
  COED_SLOW,
  league('Girls Draft', 'soccer', { gender: 'womens', ageGroup: 'u10' }, 'draft'),
];

type Tester = Awaited<ReturnType<typeof setup>>;

interface Bulk {
  name: string;
  sport?: Sport;
  gender?: Gender;
  level?: StandardLevel;
  ageGroup?: AgeGroup;
  status?: 'draft' | 'published';
  searchText?: string;
}

/** Writes rows directly, past the writers that keep an organization's counters, to reach the bounds. */
async function insertBulk(t: Tester, rows: Bulk[]) {
  await t.run(async (ctx) => {
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'front-range'))
      .unique())!;
    for (const row of rows) {
      await ctx.db.insert('leagues', {
        organizationId: organization._id,
        name: row.name,
        slug: row.name.toLowerCase().replace(/\s+/g, '-'),
        sortName: sortName(row.name),
        sport: row.sport ?? 'soccer',
        locationIds: [],
        status: row.status ?? 'published',
        ...(row.gender && { gender: row.gender }),
        ...(row.level && { level: row.level }),
        ...(row.ageGroup && { ageGroup: row.ageGroup }),
        searchText: row.searchText ?? row.name,
      });
    }
  });
}

const names = (result: { rows: { name: string }[] }) => result.rows.map((row) => row.name);

describe('search.leaguesBySport', () => {
  test('lists the published leagues of the sport by name, with the page and the total', async () => {
    const t = await setup(ALL);
    const result = await t.query(api.search.leaguesBySport, { sport: 'soccer', page: 1 });
    expect(names(result)).toEqual([
      'Boys Rookies',
      'Girls Rookies',
      'Girls Select',
      'Women Eleven',
    ]);
    expect(result).toMatchObject({ page: 1, pageCount: 1, total: 4 });
    expect(result.rows[0]).toEqual({
      organization: { name: 'Front Range', slug: 'front-range' },
      name: 'Boys Rookies',
      slug: 'boys-rookies',
      sportName: 'Soccer',
      locationNames: [LOCATION],
      divisionLabel: 'Boys · 7v7 · Rec · U10',
      seasons: [],
    });
  });

  test('lists only published leagues, never a draft', async () => {
    const t = await setup(ALL);
    const result = await t.query(api.search.leaguesBySport, { sport: 'soccer', page: 1 });
    expect(names(result)).not.toContain('Girls Draft');
    expect(result.facets).toHaveLength(4);
  });

  test('applies the division filters to the rows, the total, and the pages', async () => {
    const t = await setup(ALL);
    const result = await t.query(api.search.leaguesBySport, {
      sport: 'soccer',
      page: 1,
      gender: ['womens'],
      ageGroup: ['u10'],
    });
    expect(names(result)).toEqual(['Girls Rookies', 'Girls Select']);
    expect(result.total).toBe(2);
    const byLevel = await t.query(api.search.leaguesBySport, {
      sport: 'soccer',
      page: 1,
      level: ['competitive'],
      playersPerSide: [7],
    });
    expect(names(byLevel)).toEqual(['Girls Select']);
  });

  test('ignores a level that is not one of the sport, and a format that is not', async () => {
    const t = await setup(ALL);
    const unfiltered = await t.query(api.search.leaguesBySport, { sport: 'softball', page: 1 });
    const result = await t.query(api.search.leaguesBySport, {
      sport: 'softball',
      page: 1,
      level: ['bb'],
      playersPerSide: [4],
    });
    expect(result).toEqual(unfiltered);
  });

  test('returns facets from every published league of the sport before the division filters', async () => {
    const t = await setup(ALL);
    const result = await t.query(api.search.leaguesBySport, {
      sport: 'soccer',
      page: 1,
      gender: ['womens'],
    });
    expect(result.rows).toHaveLength(3);
    expect(result.facets.map((facet) => facet.gender).sort()).toEqual([
      'mens',
      'womens',
      'womens',
      'womens',
    ]);
  });

  test('gives a league with no division values an empty facet, so the facets count the leagues', async () => {
    const t = await setup([]);
    await insertBulk(t, [{ name: 'Girls', gender: 'womens' }, { name: 'Plain' }]);
    const result = await t.query(api.search.leaguesBySport, { sport: 'soccer', page: 1 });
    expect(result.facets).toEqual([{ gender: 'womens' }, {}]);
  });

  test('returns pages of 5, and page 1 for a page out of range', async () => {
    const t = await setup([]);
    await insertBulk(
      t,
      Array.from({ length: 12 }, (_, i) => ({ name: `League ${String(i).padStart(2, '0')}` })),
    );
    const second = await t.query(api.search.leaguesBySport, { sport: 'soccer', page: 2 });
    expect(names(second)).toEqual([
      'League 05',
      'League 06',
      'League 07',
      'League 08',
      'League 09',
    ]);
    expect(second).toMatchObject({ page: 2, pageCount: 3, total: 12 });
    const out = await t.query(api.search.leaguesBySport, { sport: 'soccer', page: 9 });
    expect(out.page).toBe(1);
  });

  test('reads only the first 200 leagues of the sport by name, and filters and pages those', async () => {
    const t = await setup([]);
    const name = (i: number) => `Soccer ${String(i).padStart(3, '0')}`;
    await insertBulk(
      t,
      Array.from({ length: 250 }, (_, i) => ({
        name: name(i),
        ...(i >= 200 && { ageGroup: 'u10' as const }),
      })),
    );
    const all = await t.query(api.search.leaguesBySport, { sport: 'soccer', page: 40 });
    expect(all).toMatchObject({ page: 40, pageCount: 40, total: 200 });
    expect(names(all)).toEqual([195, 196, 197, 198, 199].map(name));
    expect(all.facets).toHaveLength(200);
    const beyond = await t.query(api.search.leaguesBySport, {
      sport: 'soccer',
      page: 1,
      ageGroup: ['u10'],
    });
    expect(beyond).toMatchObject({ rows: [], pageCount: 0, total: 0 });
    expect(beyond.facets).toHaveLength(200);
  });

  test('is open to a caller who is not signed in and returns no id or status', async () => {
    const t = await setup(ALL);
    const result = await t.query(api.search.leaguesBySport, { sport: 'soccer', page: 1 });
    expect(JSON.stringify(result)).not.toMatch(/"_id"|"status"|organizationId/);
  });
});

describe('search.leagues with a sport and division filters', () => {
  interface Filters {
    sport?: Sport;
    gender?: Gender[];
    playersPerSide?: number[];
    level?: StandardLevel[];
    ageGroup?: AgeGroup[];
  }
  const search = (t: Tester, args: Filters) =>
    t.query(api.search.leagues, { q: 'rookies', ...args });

  test('reads only the sport named', async () => {
    const t = await setup([
      ...ALL,
      league('Coed Rookies', 'beachVolleyball', { playersPerSide: 4, level: 'bb' }),
    ]);
    expect(names(await search(t, {}))).toHaveLength(3);
    expect(names(await search(t, { sport: 'beachVolleyball' }))).toEqual(['Coed Rookies']);
  });

  test('applies the division filters to the rows that hold every word', async () => {
    const t = await setup(ALL);
    const result = await search(t, { sport: 'soccer', gender: ['womens'] });
    expect(names(result)).toEqual(['Girls Rookies']);
    expect(result.more).toBe(false);
  });

  test('ignores format and level when no sport is named', async () => {
    const t = await setup(ALL);
    const result = await search(t, { level: ['competitive'], playersPerSide: [11] });
    expect(names(result).sort()).toEqual(['Boys Rookies', 'Girls Rookies']);
  });

  test('returns facets over the leagues holding every word, before the division filters', async () => {
    const t = await setup(ALL);
    const result = await search(t, { sport: 'soccer', gender: ['womens'] });
    expect(result.facets?.map((facet) => facet.gender).sort()).toEqual(['mens', 'womens']);
  });

  test('every row and every facet comes from a league that holds both words', async () => {
    const t = await setup(ALL);
    const result = await t.query(api.search.leagues, {
      q: 'girls select',
      sport: 'soccer',
    });
    expect(names(result)).toEqual(['Girls Select']);
    expect(result.facets).toEqual([
      { gender: 'womens', playersPerSide: 7, level: 'competitive', ageGroup: 'u10' },
    ]);
  });

  test('filters the first 200 matches and returns at most 50 of them, with more', async () => {
    const t = await setup([]);
    await insertBulk(
      t,
      Array.from({ length: 250 }, (_, i) => ({
        name: `Bulk ${i}`,
        searchText: `Bulk ${i} alpha`,
        ...(i % 2 === 0 && { gender: 'womens' as const }),
      })),
    );
    const result = await t.query(api.search.leagues, { q: 'alpha', gender: ['womens'] });
    expect(result.rows).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(result.more).toBe(true);
    expect(result.facets).toHaveLength(SEARCH_SCAN_LIMIT);
  });

  test('returns every match as a facet, also a league with no division values', async () => {
    const t = await setup([]);
    await insertBulk(t, [{ name: 'Alpha one' }, { name: 'Alpha two', gender: 'mens' }]);
    const result = await t.query(api.search.leagues, { q: 'alpha' });
    expect(result.facets).toEqual([{}, { gender: 'mens' }]);
  });

  test('says no more when the division filters leave fewer than the limit', async () => {
    const t = await setup(ALL);
    const result = await search(t, { gender: ['womens'] });
    expect(result.more).toBe(false);
  });
});

describe('search.leagues suggestions with a sport and division filters', () => {
  const TEXT = (words: string) => ({ searchText: words });

  test('are empty when no league of the sport holds the other word, though another sport does', async () => {
    const t = await setup([]);
    await insertBulk(t, [
      { name: 'Sands', sport: 'beachVolleyball', ...TEXT('coed sands') },
      { name: 'Turf', sport: 'soccer', ...TEXT('turf') },
    ]);
    const result = await t.query(api.search.leagues, { q: 'coed zebra', sport: 'soccer' });
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toBeUndefined();
  });

  test('count only the leagues of the sport', async () => {
    const t = await setup([]);
    await insertBulk(t, [
      { name: 'Sands', sport: 'beachVolleyball', ...TEXT('coed sands') },
      { name: 'More sands', sport: 'beachVolleyball', ...TEXT('coed sands') },
      { name: 'Turf', sport: 'soccer', ...TEXT('coed turf') },
      { name: 'Pitch', sport: 'soccer', ...TEXT('turf pitch') },
      { name: 'Pitch two', sport: 'soccer', ...TEXT('turf pitch') },
    ]);
    const result = await t.query(api.search.leagues, { q: 'coed pitch', sport: 'soccer' });
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toEqual(['pitch', 'coed']);
    const everySport = await t.query(api.search.leagues, { q: 'coed pitch' });
    expect(everySport.suggestions).toEqual(['coed', 'pitch']);
  });

  test('count only the leagues that pass the division filters, so a link never opens an empty page', async () => {
    const t = await setup([]);
    await insertBulk(t, [
      { name: 'Girls', gender: 'womens', ageGroup: 'u10', ...TEXT('coed girls') },
      { name: 'Boys', gender: 'mens', ageGroup: 'u10', ...TEXT('coed boys') },
      { name: 'Adults', gender: 'womens', ageGroup: 'adult', ...TEXT('coed adults') },
    ]);
    const args = {
      sport: 'soccer' as const,
      gender: ['womens' as const],
      ageGroup: ['u10' as const],
    };
    const result = await t.query(api.search.leagues, { q: 'coed zebra', ...args });
    expect(result.suggestions).toEqual(['coed']);
    const followed = await t.query(api.search.leagues, { q: 'coed', ...args });
    expect(names(followed)).toEqual(['Girls']);
    const none = await t.query(api.search.leagues, { q: 'boys zebra', ...args });
    expect(none.suggestions).toBeUndefined();
  });

  test('are empty when leagues hold every word but the division filters exclude them all', async () => {
    const t = await setup([]);
    await insertBulk(t, [{ name: 'Boys', gender: 'mens', ...TEXT('coed boys') }]);
    const result = await t.query(api.search.leagues, {
      q: 'coed boys',
      sport: 'soccer',
      gender: ['womens'],
    });
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toBeUndefined();
    expect(result.facets).toEqual([{ gender: 'mens' }]);
  });
});

describe('search by sport with input a caller should not send', () => {
  test('leaguesBySport reads a page that is zero, negative, fractional, or not a number as page 1', async () => {
    const t = await setup([]);
    await insertBulk(
      t,
      Array.from({ length: 12 }, (_, i) => ({ name: `League ${String(i).padStart(2, '0')}` })),
    );
    for (const page of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await t.query(api.search.leaguesBySport, { sport: 'soccer', page });
      expect(result, String(page)).toMatchObject({ page: 1, pageCount: 3, total: 12 });
      expect(names(result), String(page)).toHaveLength(5);
    }
  });

  test('both queries refuse a sport or a division value that is not one of the lists', async () => {
    const t = await setup(ALL);
    await expect(
      t.query(api.search.leaguesBySport, { sport: 'curling' as never, page: 1 }),
    ).rejects.toThrow();
    await expect(
      t.query(api.search.leaguesBySport, { sport: 'soccer', page: 1, gender: ['robots' as never] }),
    ).rejects.toThrow();
    await expect(
      t.query(api.search.leagues, { q: 'rookies', sport: 'curling' as never }),
    ).rejects.toThrow();
    await expect(
      t.query(api.search.leagues, { q: 'rookies', ageGroup: ['u99' as never] }),
    ).rejects.toThrow();
  });

  test('a search with a sport and division filters never returns a draft', async () => {
    const t = await setup([
      ...ALL,
      league('Girls Rookies Draft', 'soccer', { gender: 'womens', ageGroup: 'u10' }, 'draft'),
    ]);
    const result = await t.query(api.search.leagues, {
      q: 'girls rookies',
      sport: 'soccer',
      gender: ['womens'],
      ageGroup: ['u10'],
    });
    expect(names(result)).toEqual(['Girls Rookies']);
    expect(result.facets).toHaveLength(1);
  });

  test('a sport with no published league returns an empty page and no facets', async () => {
    const t = await setup([league('Only Draft', 'softball', { playersPerSide: 10 }, 'draft')]);
    const result = await t.query(api.search.leaguesBySport, { sport: 'softball', page: 1 });
    expect(result).toEqual({ rows: [], page: 1, pageCount: 0, total: 0, facets: [] });
  });
});
