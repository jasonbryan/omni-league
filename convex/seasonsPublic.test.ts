/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import { PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import schema from './schema';
import { modules } from './test.setup';

// `seasons.listPublic` (#127): the published seasons of a published league, newest start date
// first, 5 per page.

const seasonsSource = readFileSync(new URL('./seasons.ts', import.meta.url), 'utf8');

/** A season starting on day `n` of 2027, so a higher `n` starts later and sorts first. */
function season(n: number, overrides: Partial<NewSeason> = {}): NewSeason {
  const day = String(n).padStart(2, '0');
  return {
    name: `Season ${day}`,
    slug: `season-${day}`,
    startDate: `2027-${String(1 + Math.floor((n - 1) / 28)).padStart(2, '0')}-${String(1 + ((n - 1) % 28)).padStart(2, '0')}`,
    endDate: '2028-12-31',
    registrationDeadline: '2026-12-01',
    playersPerSide: 7,
    minimumRosterSize: 7,
    ...overrides,
  };
}

/**
 * Organization A (`org-a`) with a published soccer league `coed-7v7` (the league under test), a
 * draft league `draft-league`, and a published league `empty-league` with no season; organization
 * B (`org-b`) with its own published `coed-7v7`.
 */
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] },
        { name: 'Draft League', sport: 'soccer', locations: ['Alpha Field'], status: 'draft' },
        { name: 'Empty League', sport: 'soccer', locations: ['Alpha Field'] },
      ],
    });
    await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['B Field'] }],
    });
  });
  return t;
}

type T = Awaited<ReturnType<typeof setup>>;

async function leagueOf(t: T, orgSlug: string, leagueSlug: string): Promise<Doc<'leagues'>> {
  return t.run(async (ctx) => {
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique())!;
    return (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', leagueSlug),
      )
      .unique())!;
  });
}

/** Inserts seasons `from` to `to` (inclusive) of the league, published unless `status` says not. */
async function addSeasons(
  t: T,
  orgSlug: string,
  leagueSlug: string,
  from: number,
  to: number,
  status: 'draft' | 'published' = 'published',
  overrides: Partial<NewSeason> = {},
): Promise<void> {
  const league = await leagueOf(t, orgSlug, leagueSlug);
  await t.run(async (ctx) => {
    for (let n = from; n <= to; n++) {
      // Re-read: the writer moves the league's counter on each published insert.
      const current = (await ctx.db.get('leagues', league._id))!;
      await insertSeason(ctx, current, season(n, overrides), status);
    }
  });
}

const list = (t: T, page: number, orgSlug = 'org-a', leagueSlug = 'coed-7v7') =>
  t.query(api.seasons.listPublic, { orgSlug, leagueSlug, page });

const EMPTY = { rows: [], page: 1, pageCount: 0, total: 0 };

describe('seasons.listPublic', () => {
  test('lists the published seasons newest start date first, 5 per page, with the total and page count, and no draft', async () => {
    const t = await setup();
    await addSeasons(t, 'org-a', 'coed-7v7', 1, 7);
    // A draft that starts later than every published season, and one that starts earlier.
    await addSeasons(t, 'org-a', 'coed-7v7', 30, 30, 'draft');
    await addSeasons(t, 'org-a', 'coed-7v7', 0, 0, 'draft', {
      slug: 'early-draft',
      name: 'Early draft',
      startDate: '2026-01-01',
    });

    const first = await list(t, 1);
    expect(first.rows.map((row) => row.name)).toEqual([
      'Season 07',
      'Season 06',
      'Season 05',
      'Season 04',
      'Season 03',
    ]);
    expect(first).toMatchObject({ page: 1, pageCount: 2, total: 7 });

    const second = await list(t, 2);
    expect(second.rows.map((row) => row.name)).toEqual(['Season 02', 'Season 01']);
    expect(second).toMatchObject({ page: 2, pageCount: 2, total: 7 });
  });

  test('a row holds the name, slug, dates, and format display name, and no id or other field', async () => {
    const t = await setup();
    await addSeasons(t, 'org-a', 'coed-7v7', 1, 1, 'published', {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-02',
      endDate: '2027-08-25',
    });
    const result = await list(t, 1);
    expect(result.rows).toEqual([
      {
        name: 'Summer 2027',
        slug: 'summer-2027',
        startDate: '2027-06-02',
        endDate: '2027-08-25',
        formatName: '7v7',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/_id|_creationTime|organizationId|leagueId|status/);
  });

  test('page 1 serves a page that is 0, negative, fractional, NaN, infinite, or past the last page', async () => {
    const t = await setup();
    await addSeasons(t, 'org-a', 'coed-7v7', 1, 7);
    for (const page of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 3, 9, 1e9]) {
      const result = await list(t, page);
      expect(result.page, String(page)).toBe(1);
      expect(result.rows.map((row) => row.name)[0], String(page)).toBe('Season 07');
      expect(result.total, String(page)).toBe(7);
    }
  });

  test('reaches 40 pages and no more: page 40 serves the 196th to 200th, and page 41 serves page 1', async () => {
    const t = await setup();
    // Spread over 2 leagues' worth of days is not needed: the start dates only have to be unique.
    await addSeasons(t, 'org-a', 'coed-7v7', 1, 205);
    const last = await list(t, PUBLIC_LIST_MAX_PAGE);
    expect(last).toMatchObject({ page: 40, pageCount: 40, total: 205 });
    expect(last.rows.map((row) => row.name)).toEqual([
      'Season 10',
      'Season 09',
      'Season 08',
      'Season 07',
      'Season 06',
    ]);
    const beyond = await list(t, PUBLIC_LIST_MAX_PAGE + 1);
    expect(beyond).toMatchObject({ page: 1, pageCount: 40, total: 205 });
    expect(beyond.rows[0].name).toBe('Season 205');
  });

  test('a draft league, an unknown league, and an unknown organization give an empty page and no error', async () => {
    const t = await setup();
    await addSeasons(t, 'org-a', 'draft-league', 1, 3);
    expect(await list(t, 1, 'org-a', 'draft-league')).toEqual(EMPTY);
    expect(await list(t, 1, 'org-a', 'no-such-league')).toEqual(EMPTY);
    expect(await list(t, 1, 'no-such-org', 'coed-7v7')).toEqual(EMPTY);
    expect(await list(t, 1, 'Not A Slug', 'x')).toEqual(EMPTY);
  });

  test("a league slug of another organization gives that organization's seasons or none, never the first one's", async () => {
    const t = await setup();
    await addSeasons(t, 'org-a', 'coed-7v7', 1, 3);
    // org-b has a league with the same slug and no season.
    expect(await list(t, 1, 'org-b', 'coed-7v7')).toEqual(EMPTY);
    // org-a's league slug under org-b's slug that org-b does not have.
    expect(await list(t, 1, 'org-b', 'empty-league')).toEqual(EMPTY);
    expect((await list(t, 1, 'org-a', 'coed-7v7')).total).toBe(3);
  });

  test('a published league with no published season gives an empty page 1 of 0', async () => {
    const t = await setup();
    await addSeasons(t, 'org-a', 'empty-league', 1, 2, 'draft');
    expect(await list(t, 1, 'org-a', 'empty-league')).toEqual(EMPTY);
  });

  test('a league with no counter reports a total of 0; once a published season is inserted the counter is 1', async () => {
    const t = await setup();
    const league = await leagueOf(t, 'org-a', 'coed-7v7');
    await t.run(async (ctx) => {
      await ctx.db.replace('leagues', league._id, {
        organizationId: league.organizationId,
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        locationIds: league.locationIds,
        sortName: league.sortName,
        status: league.status,
      });
    });
    expect((await leagueOf(t, 'org-a', 'coed-7v7')).publishedSeasonCount).toBeUndefined();
    expect(await list(t, 1)).toEqual(EMPTY);

    await addSeasons(t, 'org-a', 'coed-7v7', 1, 1);
    expect((await leagueOf(t, 'org-a', 'coed-7v7')).publishedSeasonCount).toBe(1);
    expect(await list(t, 1)).toMatchObject({ total: 1, pageCount: 1 });
  });

  test('is public: an anonymous caller reads it, and no argument names an id', async () => {
    const t = await setup();
    await addSeasons(t, 'org-a', 'coed-7v7', 1, 1);
    // No identity is set on `t`.
    expect((await list(t, 1)).total).toBe(1);
  });

  test('reads through the published-seasons index with take(page * PUBLIC_LIST_PAGE_SIZE) and no filter', () => {
    expect(PUBLIC_LIST_PAGE_SIZE).toBe(5);
    expect(seasonsSource).toMatch(/\.take\(page \* PUBLIC_LIST_PAGE_SIZE\)/);
    expect(seasonsSource).toContain('by_leagueId_and_status_and_startDate');
    expect(seasonsSource).not.toMatch(/\.filter\(/);
  });
});
