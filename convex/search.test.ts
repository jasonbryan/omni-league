/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { SEARCH_RESULT_LIMIT, SEARCH_SCAN_LIMIT } from './search';
import { modules } from './test.setup';

const season = (name: string, slug: string, startDate: string): NewSeason => ({
  name,
  slug,
  startDate,
  endDate: '2027-12-01',
  registrationDeadline: '2027-01-01',
  playersPerSide: 4,
  minimumRosterSize: 4,
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: {
        name: 'Gulf Coast Sport & Social',
        slug: 'gulf',
        cityState: 'Corpus Christi, TX',
      },
      locations: [{ name: 'North Beach Sand Courts', address: '1 Beach Rd' }],
      leagues: [
        {
          name: 'Sunday Reverse Coed 4s',
          sport: 'beachVolleyball',
          locations: ['North Beach Sand Courts'],
          division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
        },
        {
          name: 'Coed Draft',
          sport: 'soccer',
          locations: ['North Beach Sand Courts'],
          status: 'draft',
        },
      ],
    });
    await insertTenant(ctx, {
      organization: { name: 'Lakeshore Sand League', slug: 'lakeshore' },
      locations: [{ name: 'Driftwood Beach Courts', address: '2 Lake Rd' }],
      leagues: [
        {
          name: 'Saturday Coed 6s',
          sport: 'beachVolleyball',
          locations: ['Driftwood Beach Courts'],
        },
      ],
    });
  });
  return t;
}

async function insertBulk(t: Awaited<ReturnType<typeof setup>>, count: number, words: string) {
  await t.run(async (ctx) => {
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'lakeshore'))
      .unique())!;
    const start = (await ctx.db.query('leagues').collect()).length;
    for (let i = start; i < start + count; i++) {
      await ctx.db.insert('leagues', {
        organizationId: organization._id,
        name: `Bulk ${i} ${words}`,
        slug: `bulk-${i}`,
        sport: 'softball',
        locationIds: [],
        status: 'published',
        searchText: `Bulk ${i} ${words}`,
      });
    }
  });
}

const search = (t: Awaited<ReturnType<typeof setup>>, q: string) =>
  t.query(api.search.leagues, { q });

describe('search.leagues', () => {
  test('returns a published league with its organization, sport, locations, division, and seasons', async () => {
    const t = await setup();
    const result = await search(t, 'sunday');
    expect(result).toEqual({
      more: false,
      rows: [
        {
          organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
          name: 'Sunday Reverse Coed 4s',
          slug: 'sunday-reverse-coed-4s',
          sportName: 'Beach volleyball',
          locationNames: ['North Beach Sand Courts'],
          divisionLabel: 'Coed · 4v4 · BB',
          seasons: [],
        },
      ],
    });
  });

  test('finds a league by its organization or its City, state', async () => {
    const t = await setup();
    expect((await search(t, 'gulf')).rows.map((row) => row.name)).toEqual([
      'Sunday Reverse Coed 4s',
    ]);
    expect((await search(t, 'corpus')).rows.map((row) => row.name)).toEqual([
      'Sunday Reverse Coed 4s',
    ]);
  });

  test('never returns a draft league, even when its name matches', async () => {
    const t = await setup();
    const names = (await search(t, 'coed')).rows.map((row) => row.name).sort();
    expect(names).toEqual(['Saturday Coed 6s', 'Sunday Reverse Coed 4s']);
    expect((await search(t, 'draft')).rows).toEqual([]);
  });

  test('returns nothing for a blank query without reading the index', async () => {
    const t = await setup();
    expect(await search(t, '')).toEqual({ rows: [], more: false });
    expect(await search(t, '   ')).toEqual({ rows: [], more: false });
  });

  test('returns nothing when no league matches', async () => {
    const t = await setup();
    expect(await search(t, 'pickleball')).toEqual({ rows: [], more: false });
  });

  test('each row’s seasons hold at most the three newest published seasons of that league, never a draft', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').collect()).find(
        (entry) => entry.slug === 'sunday-reverse-coed-4s',
      )!;
      await insertSeason(
        ctx,
        league,
        season('Spring 2027', 'spring-2027', '2027-03-01'),
        'published',
      );
      await insertSeason(
        ctx,
        league,
        season('Summer 2027', 'summer-2027', '2027-06-01'),
        'published',
      );
      await insertSeason(ctx, league, season('Fall 2027', 'fall-2027', '2027-09-01'), 'published');
      await insertSeason(
        ctx,
        league,
        season('Winter 2027', 'winter-2027', '2027-12-01'),
        'published',
      );
      await insertSeason(ctx, league, season('Draft 2028', 'draft-2028', '2028-03-01'), 'draft');
    });
    const [row] = (await search(t, 'sunday')).rows;
    expect(row.seasons.map((entry) => entry.slug)).toEqual([
      'winter-2027',
      'fall-2027',
      'summer-2027',
    ]);
    expect(Object.keys(row.seasons[0]).sort()).toEqual([
      'endDate',
      'name',
      'registrationDeadline',
      'slug',
      'startDate',
    ]);
  });

  test('returns at most 50 rows and says there are more', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = (await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'lakeshore'))
        .unique())!;
      for (let i = 0; i < SEARCH_RESULT_LIMIT + 1; i++) {
        await ctx.db.insert('leagues', {
          organizationId: organization._id,
          name: `Bulk ${i}`,
          slug: `bulk-${i}`,
          sport: 'softball',
          locationIds: [],
          status: 'published',
          searchText: `Bulk ${i} zebra`,
        });
      }
    });
    const result = await search(t, 'zebra');
    expect(result.rows).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(result.more).toBe(true);
  });

  test('says there are no more when exactly 50 match', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = (await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'lakeshore'))
        .unique())!;
      for (let i = 0; i < SEARCH_RESULT_LIMIT; i++) {
        await ctx.db.insert('leagues', {
          organizationId: organization._id,
          name: `Bulk ${i}`,
          slug: `bulk-${i}`,
          sport: 'softball',
          locationIds: [],
          status: 'published',
          searchText: `Bulk ${i} zebra`,
        });
      }
    });
    const result = await search(t, 'zebra');
    expect(result.rows).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(result.more).toBe(false);
  });

  test('is open to a caller who is not signed in and returns no id or status', async () => {
    const t = await setup();
    const result = await search(t, 'coed');
    expect(JSON.stringify(result)).not.toMatch(/_id|_creationTime|Id"|status|searchText/);
  });

  test('holds a query to the same word and length limits as the page', async () => {
    const t = await setup();
    const held = Array.from({ length: 16 }, (_, i) => `held${i}`);
    await insertBulk(t, 1, held.join(' '));
    const words = [...held, ...Array.from({ length: 10 }, (_, i) => `cut${i}`)].join(' ');
    expect((await search(t, words)).rows).toHaveLength(1);
    await expect(search(t, 'x'.repeat(5000))).resolves.toEqual({ rows: [], more: false });
  });
});

describe('search.leagues with several words', () => {
  test('lists only the leagues that hold every word, and counts only those', async () => {
    const t = await setup();
    expect((await search(t, 'coed 4s corpus')).rows.map((row) => row.name)).toEqual([
      'Sunday Reverse Coed 4s',
    ]);
    expect((await search(t, 'coed corp')).rows.map((row) => row.name)).toEqual([
      'Sunday Reverse Coed 4s',
    ]);
    expect((await search(t, 'coed 4s austin')).rows).toEqual([]);
  });

  test('returns 50 rows holding both words, with more, from 120 that hold both among 140 that hold one', async () => {
    const t = await setup();
    await insertBulk(t, 140, 'alpha');
    await insertBulk(t, 120, 'alpha beta');
    const result = await search(t, 'alpha beta');
    expect(result.rows).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(result.more).toBe(true);
    expect(result.rows.every((row) => row.name.endsWith('alpha beta'))).toBe(true);
  });

  test('returns every league holding both words, with no more, from 30 that hold both among 10 that hold one', async () => {
    const t = await setup();
    await insertBulk(t, 10, 'alpha');
    await insertBulk(t, 30, 'alpha beta');
    const result = await search(t, 'alpha beta');
    expect(result.rows).toHaveLength(30);
    expect(result.more).toBe(false);
  });

  test('never returns a draft league that holds every word', async () => {
    const t = await setup();
    const names = (await search(t, 'coed draft')).rows.map((row) => row.name);
    expect(names).toEqual([]);
  });

  test('reads no further than the scan limit', async () => {
    const t = await setup();
    await insertBulk(t, SEARCH_SCAN_LIMIT, 'alpha');
    await insertBulk(t, 5, 'alpha beta');
    const result = await search(t, 'alpha beta');
    expect(result.rows).toEqual([]);
    expect(result.more).toBe(false);
  });
});

describe('search.leagues suggestions', () => {
  test('are left out when there are rows, for one word, and when no shorter search matches', async () => {
    const t = await setup();
    expect(await search(t, 'coed')).not.toHaveProperty('suggestions');
    expect(await search(t, 'pickleball')).not.toHaveProperty('suggestions');
    expect(await search(t, 'pickleball austin')).not.toHaveProperty('suggestions');
    expect(await search(t, 'coed 4s corpus')).not.toHaveProperty('suggestions');
  });

  test('offer the search that drops the word no league holds, as typed', async () => {
    const t = await setup();
    const result = await search(t, 'Coed 4s Austin');
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toEqual(['Coed 4s']);
  });

  test('are at most 3, most leagues first, the later dropped word first on a tie', async () => {
    const t = await setup();
    await insertBulk(t, 3, 'alpha beta gamma');
    await insertBulk(t, 2, 'alpha beta delta');
    await insertBulk(t, 1, 'alpha gamma delta');
    await insertBulk(t, 1, 'beta gamma delta');
    const result = await search(t, 'alpha beta gamma delta zeta');
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toBeUndefined();
    const four = await search(t, 'alpha beta gamma delta');
    expect(four.rows).toEqual([]);
    expect(four.suggestions).toEqual(['alpha beta gamma', 'alpha beta delta', 'alpha gamma delta']);
  });
});
