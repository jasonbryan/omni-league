/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import type { Sport } from './lib/sports';
import { BACKFILL_SCAN_LIMIT, backfillDivisionFields } from './lib/tenantWrites';
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

const seasonFields = {
  name: 'Season',
  slug: 'season',
  startDate: '2026-06-01',
  endDate: '2026-08-01',
  registrationDeadline: '2026-05-01',
  minimumRosterSize: 4,
  status: 'published' as const,
};

async function insertOrganization(t: T, slug: string) {
  return t.run((ctx) =>
    ctx.db.insert('organizations', {
      name: slug,
      slug,
      leagueCount: 0,
      locationCount: 0,
      sportLeagueCounts: {},
      sportLocationCounts: {},
    }),
  );
}

function insertLegacyLeague(
  t: T,
  organizationId: Id<'organizations'>,
  name: string,
  sport: Sport,
  status: 'draft' | 'published' = 'published',
) {
  return t.run((ctx) =>
    ctx.db.insert('leagues', {
      organizationId,
      name,
      slug: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
      sport,
      locationIds: [],
      sortName: name.toLowerCase(),
      status,
      publishedSeasonCount: 0,
    }),
  );
}

const leagueRow = (t: T, id: Id<'leagues'>) => t.run((ctx) => ctx.db.get('leagues', id));

describe('division backfill probes', () => {
  test('seasons past the row cap are migrated by later runs, and a league whose newest season waits still gets its players per side and minimum', async () => {
    const t = setup();
    const organizationId = await insertOrganization(t, 'big-club');
    const filler = await insertLegacyLeague(t, organizationId, 'Filler', 'beachVolleyball');
    const target = await insertLegacyLeague(t, organizationId, 'Target', 'soccer');
    await t.run(async (ctx) => {
      for (let index = 0; index < BACKFILL_SCAN_LIMIT; index++) {
        await ctx.db.insert('seasons', {
          ...seasonFields,
          organizationId,
          leagueId: filler,
          slug: `filler-${index}`,
          format: '4v4',
        });
      }
    });
    const lateSeason = await t.run((ctx) =>
      ctx.db.insert('seasons', {
        ...seasonFields,
        organizationId,
        leagueId: target,
        slug: 'late',
        format: '5v5',
        minimumRosterSize: 8,
      }),
    );
    const unmigrated = () =>
      t.run(async (ctx) =>
        (await ctx.db.query('seasons').collect()).filter((season) => season.format !== undefined),
      );

    const first = await t.run((ctx) => backfillDivisionFields(ctx, []));
    expect(first.seasons).toBe(BACKFILL_SCAN_LIMIT);
    expect((await unmigrated()).map((season) => season._id)).toEqual([lateSeason]);
    expect(await leagueRow(t, target)).toMatchObject({ playersPerSide: 5, minimumRosterSize: 8 });

    const second = await t.run((ctx) => backfillDivisionFields(ctx, []));
    expect(second).toEqual({ seasons: 1, leagueDivisions: 0 });
    expect(await unmigrated()).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get('seasons', lateSeason))).toMatchObject({
      playersPerSide: 5,
    });

    expect(await t.run((ctx) => backfillDivisionFields(ctx, []))).toEqual({
      seasons: 0,
      leagueDivisions: 0,
    });
  }, 30_000);

  test('the newest season by start date decides, whatever its status', async () => {
    const t = setup();
    const organizationId = await insertOrganization(t, 'other-club');
    const leagueId = await insertLegacyLeague(t, organizationId, 'Plain', 'soccer');
    const add = (slug: string, startDate: string, status: 'draft' | 'published', pps: number) =>
      t.run((ctx) =>
        ctx.db.insert('seasons', {
          ...seasonFields,
          organizationId,
          leagueId,
          slug,
          startDate,
          status,
          playersPerSide: pps,
        }),
      );
    await add('mid', '2026-01-01', 'published', 5);
    await add('draft-newest', '2027-01-01', 'draft', 7);
    await add('published-oldest', '2025-01-01', 'published', 11);

    await t.mutation(internal.seed.demo, {});

    expect(await leagueRow(t, leagueId)).toMatchObject({ playersPerSide: 7 });
  });

  test('a draft league gets a division like a published one', async () => {
    const t = setup();
    const organizationId = await insertOrganization(t, 'other-club');
    const leagueId = await insertLegacyLeague(
      t,
      organizationId,
      'Draft 2s',
      'beachVolleyball',
      'draft',
    );

    const result = await t.mutation(internal.seed.demo, {});

    expect(result.backfilled.leagueDivisions).toBe(1);
    expect(await leagueRow(t, leagueId)).toMatchObject({
      gender: 'coed',
      playersPerSide: 2,
      level: 'rec',
      ageGroup: 'adult',
      status: 'draft',
    });
  });

  test('a league of another organization that shares a demo league’s name does not take the demo division', async () => {
    const t = setup();
    const organizationId = await insertOrganization(t, 'other-club');
    const leagueId = await insertLegacyLeague(t, organizationId, 'Coed 6v6 Indoor', 'soccer');

    await t.mutation(internal.seed.demo, {});

    const row = await leagueRow(t, leagueId);
    expect(row).toMatchObject({ gender: 'coed', playersPerSide: 6, level: 'rec' });
    expect(row).not.toHaveProperty('minimumRosterSize');
    expect(row).not.toHaveProperty('customLevelId');
  });

  test('a demo league of an organization that already has its custom level is linked to that level, not to a second one', async () => {
    const t = setup();
    const organizationId = await insertOrganization(t, 'saguaro-valley-softball');
    const leagueId = await insertLegacyLeague(
      t,
      organizationId,
      "Men's D Division Slow-Pitch",
      'softball',
    );
    const levelId = await t.run((ctx) =>
      ctx.db.insert('customLevels', {
        organizationId,
        sport: 'softball',
        name: 'D',
        nameKey: 'd',
        standardLevel: 'rec',
        createdAt: 1,
      }),
    );

    const result = await t.mutation(internal.seed.demo, {});

    expect(result.customLevels).toBe(0);
    expect(await t.run((ctx) => ctx.db.query('customLevels').collect())).toHaveLength(1);
    expect(await leagueRow(t, leagueId)).toMatchObject({ customLevelId: levelId, level: 'rec' });
  });

  test('a season written with the largest format key gets its number', async () => {
    const t = setup();
    const organizationId = await insertOrganization(t, 'other-club');
    const leagueId = await insertLegacyLeague(t, organizationId, 'Plain', 'soccer');
    const seasonId = await t.run((ctx) =>
      ctx.db.insert('seasons', { ...seasonFields, organizationId, leagueId, format: '11v11' }),
    );

    await t.mutation(internal.seed.demo, {});

    expect(await t.run((ctx) => ctx.db.get('seasons', seasonId))).toMatchObject({
      playersPerSide: 11,
    });
    expect(await leagueRow(t, leagueId)).toMatchObject({ playersPerSide: 11 });
  });

  test('a season that holds both fields keeps its players per side and is not counted', async () => {
    const t = setup();
    const organizationId = await insertOrganization(t, 'other-club');
    const leagueId = await insertLegacyLeague(t, organizationId, 'Plain', 'soccer');
    const seasonId = await t.run((ctx) =>
      ctx.db.insert('seasons', {
        ...seasonFields,
        organizationId,
        leagueId,
        playersPerSide: 7,
        format: '5v5',
      }),
    );

    const result = await t.mutation(internal.seed.demo, {});

    expect(result.backfilled.seasons).toBe(0);
    expect(await t.run((ctx) => ctx.db.get('seasons', seasonId))).toMatchObject({
      playersPerSide: 7,
    });
    expect(await leagueRow(t, leagueId)).toMatchObject({ playersPerSide: 7 });
  });
});
