/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
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

const COUNTED = {
  leagueCount: 0,
  locationCount: 0,
  sportLeagueCounts: {},
  sportLocationCounts: {},
};

async function insertOldOrganizations(t: T): Promise<void> {
  await t.run(async (ctx) => {
    for (const [name, slug, status] of [
      ['Old Club', 'old-club', 'published'],
      ['Draft Club', 'draft-club', 'draft'],
    ] as const) {
      const organizationId = await ctx.db.insert('organizations', { name, slug, ...COUNTED });
      await ctx.db.insert('leagues', {
        organizationId,
        name: `${name} League`,
        slug: 'league',
        sport: 'soccer',
        locationIds: [],
        sortName: `${slug} league`,
        status,
        publishedSeasonCount: 0,
        searchText: `${name} League`,
      });
    }
    await ctx.db.insert('organizations', { name: 'Empty Club', slug: 'empty-club', ...COUNTED });
  });
}

const stored = (t: T, slug: string) =>
  t.run((ctx) =>
    ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique(),
  );

describe('seed:demo backfill of the organizations list fields', () => {
  test('fills sortName and hasPublishedLeague from a recount, counts each organization, and a second run changes none', async () => {
    const t = setup();
    await insertOldOrganizations(t);

    const first = await t.mutation(internal.seed.insertDemoData, {});
    expect(first.backfilled.organizations).toBe(3);
    expect(await stored(t, 'old-club')).toMatchObject({
      sortName: 'old club',
      hasPublishedLeague: true,
    });
    expect(await stored(t, 'draft-club')).toMatchObject({
      sortName: 'draft club',
      hasPublishedLeague: false,
    });
    expect(await stored(t, 'empty-club')).toMatchObject({
      sortName: 'empty club',
      hasPublishedLeague: false,
    });

    const before = await t.run((ctx) => ctx.db.query('organizations').collect());
    const second = await t.mutation(internal.seed.insertDemoData, {});
    expect(second.backfilled.organizations).toBe(0);
    expect(await t.run((ctx) => ctx.db.query('organizations').collect())).toEqual(before);
  });

  test('fills only the missing field of an organization that has the counters and one of the two', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('organizations', {
        name: 'Half Club',
        slug: 'half-club',
        ...COUNTED,
        hasPublishedLeague: true,
      });
    });
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.backfilled.organizations).toBe(1);
    expect(await stored(t, 'half-club')).toMatchObject({
      sortName: 'half club',
      hasPublishedLeague: true,
    });
  });

  test('a backfilled organization with a published league is listed, and one with only drafts is not', async () => {
    const t = setup();
    await insertOldOrganizations(t);
    await t.mutation(internal.seed.insertDemoData, {});
    const names = (await t.query(api.search.organizations, { page: 1 })).rows.map((r) => r.name);
    expect(names).toContain('Old Club');
    expect(names).not.toContain('Draft Club');
    expect(names).not.toContain('Empty Club');
  });

  test('a wrong guard writes nothing', async () => {
    const t = setup();
    await insertOldOrganizations(t);
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', 'https://example.test');
    const before = await t.run((ctx) => ctx.db.query('organizations').collect());
    await expect(t.mutation(internal.seed.insertDemoData, {})).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query('organizations').collect())).toEqual(before);
  });

  test('the demo organizations with a published league are listed, and the ones with none are not', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const page = await t.query(api.search.organizations, { page: 1 });
    expect(page.pageCount).toBe(2);
    expect(page.rows.map((row) => row.slug)).toEqual([
      'confluence-sport-social',
      'front-range-rec-sports',
      'gulf-coast-sport-social',
      'lakeshore-sand-league',
      'rockport-sand-volleyball',
    ]);
    expect(
      (await t.query(api.search.organizations, { page: 2 })).rows.map((row) => row.slug),
    ).toEqual(['saguaro-valley-softball']);
    expect(page.rows.find((row) => row.slug === 'gulf-coast-sport-social')).toEqual({
      name: 'Gulf Coast Sport & Social',
      slug: 'gulf-coast-sport-social',
      sportNames: ['Beach volleyball', 'Soccer', 'Softball'],
      cityState: 'Corpus Christi, TX',
    });
  });
});
