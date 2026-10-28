/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { SEARCH_RESULT_LIMIT } from './search';
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
    const words = ['sunday', ...Array.from({ length: 30 }, (_, i) => `zzz${i}`)].join(' ');
    expect((await search(t, words)).rows.map((row) => row.name)).toContain(
      'Sunday Reverse Coed 4s',
    );
    await expect(search(t, 'x'.repeat(5000))).resolves.toEqual({ rows: [], more: false });
  });
});
