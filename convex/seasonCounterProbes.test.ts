/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// Tester probes (#127): `leagues.publishedSeasonCount` under concurrent writers, the recount
// fallback next to seasons that were published before the counter existed, and that a draft never
// reaches `leagues.getPublicPage` or `seasons.listPublic`, nor takes a place on a page.

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

const season = (n: number): NewSeason => ({
  name: `Season ${n}`,
  slug: `season-${n}`,
  startDate: `2027-${String(n).padStart(2, '0')}-01`,
  endDate: '2027-12-31',
  registrationDeadline: '2026-12-01',
  format: '7v7',
  minimumRosterSize: 7,
});

async function league(t: T): Promise<Doc<'leagues'>> {
  return t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'org-a'))
      .unique())!;
    return (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', 'coed-7v7'),
      )
      .unique())!;
  });
}

async function admin(t: T, organizationId: Id<'organizations'>) {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      authUserId: 'admin-a',
      name: 'admin-a',
      adultConfirmedAt: 1,
    });
    await ctx.db.insert('memberships', { userId, organizationId, role: 'orgAdmin', leagueIds: [] });
  });
  return t.withIdentity({
    subject: 'admin-a',
    issuer: 'http://127.0.0.1:3211',
    email: 'admin-a@example.test',
    emailVerified: false,
    name: 'admin-a',
    sessionId: 's1',
  });
}

const recount = (t: T, leagueId: Id<'leagues'>) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('seasons')
          .withIndex('by_leagueId_and_status_and_startDate', (q) =>
            q.eq('leagueId', leagueId).eq('status', 'published'),
          )
          .collect()
      ).length,
  );

const counter = async (t: T, leagueId: Id<'leagues'>) =>
  (await t.run(async (ctx) => (await ctx.db.get('leagues', leagueId))?.publishedSeasonCount)) ??
  undefined;

/** Removes the counter, as a league written before #127 has none. */
async function dropCounter(t: T, row: Doc<'leagues'>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.replace('leagues', row._id, {
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      sport: row.sport,
      locationIds: row.locationIds,
      sortName: row.sortName,
      status: row.status,
    });
  });
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
  vi.stubEnv('IS_TEST', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publishedSeasonCount under concurrency', () => {
  test('many concurrent publishes of one draft move the counter by exactly 1', async () => {
    const t = setup();
    const row = await league(t);
    const seasonId = await t.run((ctx) => insertSeason(ctx, row, season(1)));
    const a = await admin(t, row.organizationId);
    await Promise.all(
      Array.from({ length: 8 }, () => a.mutation(api.seasons.publish, { seasonId })),
    );
    expect(await counter(t, row._id)).toBe(1);
    expect(await recount(t, row._id)).toBe(1);
  });

  test('concurrent publishes of different drafts count each once', async () => {
    const t = setup();
    const row = await league(t);
    const ids = await t.run(async (ctx) => {
      const out: Id<'seasons'>[] = [];
      for (let n = 1; n <= 6; n++) out.push(await insertSeason(ctx, row, season(n)));
      return out;
    });
    const a = await admin(t, row.organizationId);
    // Each draft is published twice, all at once.
    await Promise.all(
      [...ids, ...ids].map((seasonId) => a.mutation(api.seasons.publish, { seasonId })),
    );
    expect(await counter(t, row._id)).toBe(6);
    expect(await recount(t, row._id)).toBe(6);
    const page = await t.query(api.seasons.listPublic, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-7v7',
      page: 2,
    });
    expect(page.total).toBe(6);
    expect(page.pageCount).toBe(2);
    expect(page.rows.map((r) => r.name)).toEqual(['Season 1']);
  });

  test('publishes mixed with inserts of published seasons through testing:seedSeason', async () => {
    const t = setup();
    const row = await league(t);
    const ids = await t.run(async (ctx) => {
      const out: Id<'seasons'>[] = [];
      for (let n = 1; n <= 3; n++) out.push(await insertSeason(ctx, row, season(n)));
      return out;
    });
    const a = await admin(t, row.organizationId);
    const base = {
      organizationSlug: 'org-a',
      leagueSlug: 'coed-7v7',
      endDate: '2027-12-31',
      registrationDeadline: '2026-12-01',
      format: '7v7' as const,
      minimumRosterSize: 7,
    };
    await Promise.all([
      ...ids.map((seasonId) => a.mutation(api.seasons.publish, { seasonId })),
      ...[4, 5, 6].map((n) =>
        t.mutation(internal.testing.seedSeason, {
          ...base,
          name: `Season ${n}`,
          slug: `season-${n}`,
          startDate: `2027-0${n}-01`,
          status: 'published',
        }),
      ),
      ...[7, 8].map((n) =>
        t.mutation(internal.testing.seedSeason, {
          ...base,
          name: `Season ${n}`,
          slug: `season-${n}`,
          startDate: `2027-0${n}-01`,
          status: 'draft',
        }),
      ),
    ]);
    expect(await recount(t, row._id)).toBe(6);
    expect(await counter(t, row._id)).toBe(6);
  });

  test('concurrent writers on a league without a counter recount, and count the earlier published seasons', async () => {
    const t = setup();
    const row = await league(t);
    // Two published and one draft before the counter existed, then the counter is gone.
    const draftIds = await t.run(async (ctx) => {
      await insertSeason(ctx, row, season(1), 'published');
      await insertSeason(ctx, row, season(2), 'published');
      return [await insertSeason(ctx, row, season(3)), await insertSeason(ctx, row, season(4))];
    });
    await dropCounter(t, row);
    expect(await counter(t, row._id)).toBeUndefined();
    const before = await t.query(api.seasons.listPublic, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-7v7',
      page: 1,
    });
    // Reads as 0 until a writer runs.
    expect(before).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });

    const a = await admin(t, row.organizationId);
    await Promise.all(draftIds.map((seasonId) => a.mutation(api.seasons.publish, { seasonId })));
    expect(await recount(t, row._id)).toBe(4);
    expect(await counter(t, row._id)).toBe(4);
  });

  test('a single publish on a league without a counter gives the recount, not 1', async () => {
    const t = setup();
    const row = await league(t);
    const draftId = await t.run(async (ctx) => {
      await insertSeason(ctx, row, season(1), 'published');
      await insertSeason(ctx, row, season(2), 'published');
      await insertSeason(ctx, row, season(3), 'published');
      return insertSeason(ctx, row, season(4));
    });
    await dropCounter(t, row);
    const a = await admin(t, row.organizationId);
    await a.mutation(api.seasons.publish, { seasonId: draftId });
    expect(await counter(t, row._id)).toBe(4);
    await a.mutation(api.seasons.publish, { seasonId: draftId });
    expect(await counter(t, row._id)).toBe(4);
  });
});

describe('drafts never reach the public queries', () => {
  test('a draft with the newest start date takes no place on a page, and no query result names it', async () => {
    const t = setup();
    const row = await league(t);
    await t.run(async (ctx) => {
      for (let n = 1; n <= 7; n++) await insertSeason(ctx, row, season(n), 'published');
      // Newer than every published season, 6 of them: if drafts took places, page 1 would be all draft.
      for (let n = 1; n <= 6; n++) {
        await insertSeason(
          ctx,
          row,
          {
            ...season(n),
            name: `SECRET DRAFT ${n}`,
            slug: `secret-${n}`,
            startDate: `2030-0${n}-01`,
          },
          'draft',
        );
      }
    });
    const pages = [1, 2, 3].map((page) =>
      t.query(api.seasons.listPublic, { orgSlug: 'org-a', leagueSlug: 'coed-7v7', page }),
    );
    const results = await Promise.all(pages);
    expect(results[0].rows.map((r) => r.name)).toEqual([
      'Season 7',
      'Season 6',
      'Season 5',
      'Season 4',
      'Season 3',
    ]);
    expect(results[1].rows.map((r) => r.name)).toEqual(['Season 2', 'Season 1']);
    expect(results[2].page).toBe(1);
    for (const r of results) {
      expect(r.total).toBe(7);
      expect(JSON.stringify(r)).not.toMatch(/SECRET|secret-|draft/i);
    }
    const header = await t.query(api.leagues.getPublicPage, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-7v7',
    });
    expect(JSON.stringify(header)).not.toMatch(/SECRET|secret-|draft/i);
  });

  test('a draft league with published seasons gives null and an empty page, and no season name', async () => {
    const t = setup();
    const row = await league(t);
    await t.run(async (ctx) => {
      await insertSeason(ctx, row, season(1), 'published');
      await ctx.db.patch('leagues', row._id, { status: 'draft' });
    });
    expect(
      await t.query(api.leagues.getPublicPage, { orgSlug: 'org-a', leagueSlug: 'coed-7v7' }),
    ).toBeNull();
    const list = await t.query(api.seasons.listPublic, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-7v7',
      page: 1,
    });
    expect(list).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test('hostile arguments: huge, negative, NaN, and non-integer pages serve page 1, and oversized slugs find nothing', async () => {
    const t = setup();
    const row = await league(t);
    await t.run(async (ctx) => {
      for (let n = 1; n <= 7; n++) await insertSeason(ctx, row, season(n), 'published');
    });
    for (const page of [Number.MAX_SAFE_INTEGER, 1e308, -5, 0.5, Number.NaN, Infinity, -Infinity]) {
      const r = await t.query(api.seasons.listPublic, {
        orgSlug: 'org-a',
        leagueSlug: 'coed-7v7',
        page,
      });
      expect(r.page, String(page)).toBe(1);
      expect(r.rows).toHaveLength(5);
    }
    const huge = 'x'.repeat(5000);
    expect(
      await t.query(api.leagues.getPublicPage, { orgSlug: huge, leagueSlug: huge }),
    ).toBeNull();
    expect(
      await t.query(api.seasons.listPublic, { orgSlug: huge, leagueSlug: huge, page: 1 }),
    ).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });
});
