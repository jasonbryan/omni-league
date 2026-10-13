/// <reference types="vite/client" />
// Tester probes for #101 (PR #155): the sport counters under the cases the criteria imply and the
// implementer's tests do not combine: the cap with real rows behind the sport filter, a league
// written to an organization before its backfill and then recounted, and writes in one batch.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertLeague, insertTenant } from './lib/tenantWrites';
import { PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_PAGE_SIZE } from './organizations';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A recount of one organization's leagues: per sport, the leagues and the distinct locations. */
async function recount(t: T, organizationId: Id<'organizations'>) {
  return t.run(async (ctx) => {
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
      .collect();
    const leagueCounts: Record<string, number> = {};
    const rows = new Map<string, number>();
    for (const league of leagues) {
      leagueCounts[league.sport] = (leagueCounts[league.sport] ?? 0) + 1;
      for (const id of new Set(league.locationIds)) {
        const key = `${league.sport}/${id}`;
        rows.set(key, (rows.get(key) ?? 0) + 1);
      }
    }
    const locationCounts: Record<string, number> = {};
    for (const key of rows.keys()) {
      const sport = key.split('/')[0];
      locationCounts[sport] = (locationCounts[sport] ?? 0) + 1;
    }
    return { leagueCounts, locationCounts, rows: [...rows].sort() };
  });
}

/** What the organization stores: its two sport objects and its `sportLocations` rows. */
async function stored(t: T, organizationId: Id<'organizations'>) {
  return t.run(async (ctx) => {
    const organization = await ctx.db.get('organizations', organizationId);
    const rows = await ctx.db
      .query('sportLocations')
      .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
        q.eq('organizationId', organizationId),
      )
      .collect();
    return {
      leagueCounts: organization?.sportLeagueCounts,
      locationCounts: organization?.sportLocationCounts,
      rows: rows.map((row) => [`${row.sport}/${row.locationId}`, row.leagueCount] as const).sort(),
    };
  });
}

describe('tester probes: the sport filter at the page cap with real rows (#101)', () => {
  /** 236 soccer leagues (past the cap of 40 pages of 5) and 12 softball leagues. */
  async function seedBig(t: T) {
    const names = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix} ${String(i).padStart(3, '0')}`);
    await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Big', slug: 'big' },
        locations: [{ name: 'Only Field', address: '1 Field Rd' }],
        leagues: [
          ...names('Soccer', 236).map((name) => ({
            name,
            sport: 'soccer' as const,
            locations: ['Only Field'],
          })),
          ...names('Soft', 12).map((name) => ({
            name,
            sport: 'softball' as const,
            locations: ['Only Field'],
          })),
        ],
      }),
    );
    return names('Soccer', 236).map((name) => name.toLowerCase());
  }

  test('total is the sport count, pageCount is capped at 40, and page 40 holds rows 196 to 200', async () => {
    const t = setup();
    const sorted = await seedBig(t);
    const last = await t.query(api.organizations.listPublicLeagues, {
      slug: 'big',
      page: PUBLIC_LIST_MAX_PAGE,
      sport: 'soccer',
    });
    expect(last).toMatchObject({
      page: PUBLIC_LIST_MAX_PAGE,
      pageCount: PUBLIC_LIST_MAX_PAGE,
      total: 236,
    });
    expect(last.rows.map((row) => row.name.toLowerCase())).toEqual(
      sorted.slice((PUBLIC_LIST_MAX_PAGE - 1) * PUBLIC_LIST_PAGE_SIZE, 200),
    );
    expect(last.rows).toHaveLength(PUBLIC_LIST_PAGE_SIZE);
    expect(last.rows.every((row) => row.sportName === 'Soccer')).toBe(true);
  });

  test.each([41, 42, 1e6, Number.MAX_SAFE_INTEGER])(
    'page %d is past the cap and returns page 1 with the first 5',
    async (page) => {
      const t = setup();
      const sorted = await seedBig(t);
      const result = await t.query(api.organizations.listPublicLeagues, {
        slug: 'big',
        page,
        sport: 'soccer',
      });
      expect(result).toMatchObject({ page: 1, pageCount: PUBLIC_LIST_MAX_PAGE, total: 236 });
      expect(result.rows.map((row) => row.name.toLowerCase())).toEqual(sorted.slice(0, 5));
    },
  );

  test('the softball list of the same organization is its own 12 leagues on 3 pages', async () => {
    const t = setup();
    await seedBig(t);
    const page3 = await t.query(api.organizations.listPublicLeagues, {
      slug: 'big',
      page: 3,
      sport: 'softball',
    });
    expect(page3).toMatchObject({ page: 3, pageCount: 3, total: 12 });
    expect(page3.rows.map((row) => row.name)).toEqual(['Soft 010', 'Soft 011']);
  });

  test('a zero sport counter returns the empty page 1 whatever the page, even with rows present', async () => {
    const t = setup();
    await seedBig(t);
    const organizationId = await t.run(async (ctx) => {
      const organization = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'big'))
        .unique();
      return organization!._id;
    });
    await t.run((ctx) =>
      ctx.db.patch('organizations', organizationId, { sportLeagueCounts: { soccer: 0 } }),
    );
    for (const page of [1, 2, 40, 41, 0]) {
      expect(
        await t.query(api.organizations.listPublicLeagues, { slug: 'big', page, sport: 'soccer' }),
      ).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
    }
  });
});

describe('tester probes: a league written before the backfill, then the backfill (#101)', () => {
  /** An organization with the #100 fields only (as on staging after #100's backfill). */
  async function oldOrganization(t: T) {
    return t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', {
        name: 'Old Club',
        slug: 'old-club',
        leagueCount: 0,
        locationCount: 0,
      });
      for (const name of ['Field A', 'Field B']) {
        await ctx.db.insert('locations', {
          organizationId,
          name,
          address: `${name} address`,
          sortName: name.toLowerCase(),
        });
      }
      await ctx.db.patch('organizations', organizationId, { locationCount: 2 });
      return organizationId;
    });
  }

  test('insertLeague on the unbackfilled organization leaves counters unset; the backfill then counts each league and location once', async () => {
    const t = setup();
    const organizationId = await oldOrganization(t);
    // Written by the current release before the backfill ran.
    for (const league of [
      { name: 'One', sport: 'soccer' as const, locations: ['Field A', 'Field A'] },
      { name: 'Two', sport: 'soccer' as const, locations: ['Field A', 'Field B'] },
      { name: 'Three', sport: 'softball' as const, locations: ['Field B'] },
    ]) {
      await t.run((ctx) => insertLeague(ctx, organizationId, league));
    }
    expect(await stored(t, organizationId)).toEqual({
      leagueCounts: undefined,
      locationCounts: undefined,
      rows: [],
    });

    const first = await t.mutation(internal.seed.insertDemoData, {});
    expect(first.backfilled.organizations).toBe(1);
    const after = await stored(t, organizationId);
    const expected = await recount(t, organizationId);
    expect(after.leagueCounts).toEqual({ soccer: 2, softball: 1 });
    expect(after.locationCounts).toEqual({ soccer: 2, softball: 1 });
    expect(after.leagueCounts).toEqual(expected.leagueCounts);
    expect(after.locationCounts).toEqual(expected.locationCounts);
    expect(after.rows.map(([key, count]) => [key, count])).toEqual(expected.rows);
    expect(after.rows.map(([, count]) => count).sort()).toEqual([1, 1, 2]);
    // The organization's total counters were counted from the rows, not from the earlier +1s.
    expect(await t.run((ctx) => ctx.db.get('organizations', organizationId))).toMatchObject({
      leagueCount: 3,
      locationCount: 2,
    });
  });

  test('the second seed:demo run backfills nothing and changes no counter or row', async () => {
    const t = setup();
    const organizationId = await oldOrganization(t);
    await t.run((ctx) =>
      insertLeague(ctx, organizationId, { name: 'One', sport: 'soccer', locations: ['Field A'] }),
    );
    await t.mutation(internal.seed.insertDemoData, {});
    const before = await stored(t, organizationId);
    const second = await t.mutation(internal.seed.insertDemoData, {});
    expect(second).toEqual({
      organizations: 0,
      locations: 0,
      leagues: 0,
      seasons: 0,
      backfilled: { organizations: 0, locations: 0, leagues: 0 },
    });
    expect(await stored(t, organizationId)).toEqual(before);
  });

  test('after the backfill a new insertLeague counts normally (+1 league, +1 row only when new)', async () => {
    const t = setup();
    const organizationId = await oldOrganization(t);
    await t.run((ctx) =>
      insertLeague(ctx, organizationId, { name: 'One', sport: 'soccer', locations: ['Field A'] }),
    );
    await t.mutation(internal.seed.insertDemoData, {});
    await t.run((ctx) =>
      insertLeague(ctx, organizationId, {
        name: 'Two',
        sport: 'soccer',
        locations: ['Field A', 'Field B'],
      }),
    );
    const after = await stored(t, organizationId);
    const expected = await recount(t, organizationId);
    expect(after.leagueCounts).toEqual({ soccer: 2 });
    expect(after.locationCounts).toEqual({ soccer: 2 });
    expect(after.rows.map(([key, count]) => [key, count])).toEqual(expected.rows);
  });

  test('stale sportLocations rows left by an earlier partial run are not counted twice', async () => {
    const t = setup();
    const organizationId = await oldOrganization(t);
    await t.run(async (ctx) => {
      await insertLeague(ctx, organizationId, {
        name: 'One',
        sport: 'soccer',
        locations: ['Field A'],
      });
      const field = await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', 'Field A'),
        )
        .unique();
      await ctx.db.insert('sportLocations', {
        organizationId,
        sport: 'soccer',
        locationId: field!._id,
        leagueCount: 7,
      });
    });
    await t.mutation(internal.seed.insertDemoData, {});
    const after = await stored(t, organizationId);
    expect(after.rows.map(([, count]) => count)).toEqual([1]);
    expect(after.locationCounts).toEqual({ soccer: 1 });
  });

  test('an organization with a partial counter set (sport leagues set, sport locations not) is recounted whole', async () => {
    const t = setup();
    const organizationId = await oldOrganization(t);
    await t.run(async (ctx) => {
      await insertLeague(ctx, organizationId, {
        name: 'One',
        sport: 'soccer',
        locations: ['Field A', 'Field B'],
      });
      await ctx.db.patch('organizations', organizationId, { sportLeagueCounts: { soccer: 99 } });
    });
    const run = await t.mutation(internal.seed.insertDemoData, {});
    expect(run.backfilled.organizations).toBe(1);
    const after = await stored(t, organizationId);
    expect(after.leagueCounts).toEqual({ soccer: 1 });
    expect(after.locationCounts).toEqual({ soccer: 2 });
  });
});

describe('tester probes: several writes at once (#101)', () => {
  test('five concurrent insertLeague calls at one shared location count 5 leagues, 1 location, and one row of 5', async () => {
    const t = setup();
    const organizationId = await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Busy', slug: 'busy' },
        locations: [{ name: 'Shared', address: '1 Shared Rd' }],
        leagues: [],
      }),
    );
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        t.run((ctx) =>
          insertLeague(ctx, organizationId, { name, sport: 'soccer', locations: ['Shared'] }),
        ),
      ),
    );
    const after = await stored(t, organizationId);
    expect(after.leagueCounts).toEqual({ soccer: 5 });
    expect(after.locationCounts).toEqual({ soccer: 1 });
    expect(after.rows.map(([, count]) => count)).toEqual([5]);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'busy' })).toMatchObject({
      sportCount: 1,
      sports: [{ key: 'soccer', leagueCount: 5, locationCount: 1 }],
    });
  });
});
