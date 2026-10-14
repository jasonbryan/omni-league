/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { formatLabel } from './lib/divisions';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import type { Sport } from './lib/sports';
import { backfillDivisionFields } from './lib/tenantWrites';
import schema from './schema';
import { DEMO } from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const ZERO_BACKFILL = {
  organizations: 0,
  locations: 0,
  leagues: 0,
  seasons: 0,
  leagueDivisions: 0,
};

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const legacySeasonFields = (
  overrides: { format?: '4v4' | '7v7'; playersPerSide?: number } & Record<string, unknown>,
) => ({
  name: 'Season',
  slug: 'season',
  startDate: '2026-06-01',
  endDate: '2026-08-01',
  registrationDeadline: '2026-05-01',
  minimumRosterSize: 4,
  status: 'published' as const,
  ...overrides,
});

async function insertLegacy(t: T, slug: string, leagues: [string, Sport][]) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert('organizations', {
      name: slug,
      slug,
      leagueCount: 0,
      locationCount: 0,
      sportLeagueCounts: {},
      sportLocationCounts: {},
    });
    const ids: Record<string, Id<'leagues'>> = {};
    for (const [name, sport] of leagues) {
      ids[name] = await ctx.db.insert('leagues', {
        organizationId,
        name,
        slug: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
        sport,
        locationIds: [],
        sortName: name.toLowerCase(),
        status: 'published',
        publishedSeasonCount: 0,
      });
    }
    return { organizationId, ids };
  });
}

const leagueRow = (t: T, id: Id<'leagues'>) => t.run((ctx) => ctx.db.get('leagues', id));

function addSeason(
  t: T,
  organizationId: Id<'organizations'>,
  leagueId: Id<'leagues'>,
  overrides: Parameters<typeof legacySeasonFields>[0],
) {
  return t.run((ctx) =>
    ctx.db.insert('seasons', { ...legacySeasonFields(overrides), organizationId, leagueId }),
  );
}

describe('seed:demo division backfill', () => {
  test('gives a season written with a format its players per side and drops the format, then changes nothing on a second run', async () => {
    const t = setup();
    const { organizationId, ids } = await insertLegacy(t, 'old-club', [
      ['Beta League', 'softball'],
    ]);
    const seasonId = await addSeason(t, organizationId, ids['Beta League'], { format: '4v4' });

    const first = await t.mutation(internal.seed.demo, {});
    const row = await t.run((ctx) => ctx.db.get('seasons', seasonId));
    expect(row?.playersPerSide).toBe(4);
    expect(row).not.toHaveProperty('format');
    expect(first.backfilled.seasons).toBe(1);

    const second = await t.mutation(internal.seed.demo, {});
    expect(second.backfilled).toEqual(ZERO_BACKFILL);
  });

  test('gives a demo league without a division its row in the demo table', async () => {
    const t = setup();
    const { ids } = await insertLegacy(t, 'front-range-rec-sports', [
      ['Coed 6v6 Indoor', 'soccer'],
      ["Men's Modified Fast-Pitch", 'softball'],
    ]);

    const result = await t.mutation(internal.seed.demo, {});

    expect(result.backfilled.leagueDivisions).toBe(2);
    expect(await leagueRow(t, ids['Coed 6v6 Indoor'])).toMatchObject({
      gender: 'coed',
      playersPerSide: 6,
      level: 'rec',
      ageGroup: 'adult',
      minimumRosterSize: 8,
    });
    expect(await leagueRow(t, ids["Men's Modified Fast-Pitch"])).toMatchObject({
      gender: 'mens',
      playersPerSide: 9,
      level: 'competitive',
    });
  });

  test('links the demo league that uses a custom level to it, inserting the level first', async () => {
    const t = setup();
    const { ids } = await insertLegacy(t, 'saguaro-valley-softball', [
      ["Men's D Division Slow-Pitch", 'softball'],
    ]);

    const result = await t.mutation(internal.seed.demo, {});

    const levels = await t.run((ctx) => ctx.db.query('customLevels').collect());
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({
      name: 'D',
      nameKey: 'd',
      sport: 'softball',
      standardLevel: 'rec',
    });
    expect(result.customLevels).toBe(1);
    expect(await leagueRow(t, ids["Men's D Division Slow-Pitch"])).toMatchObject({
      gender: 'mens',
      playersPerSide: 10,
      level: 'rec',
      customLevelId: levels[0]._id,
    });
  });

  test('gives a league that is not a demo league the division of its newest season, its name, or the form defaults', async () => {
    const t = setup();
    const { organizationId, ids } = await insertLegacy(t, 'other-club', [
      ['Tuesday 5s', 'beachVolleyball'],
      ['Tuesday League', 'soccer'],
      ['Newest Six', 'soccer'],
      ["Women's Thursday Open 6v6", 'beachVolleyball'],
    ]);
    await addSeason(t, organizationId, ids['Newest Six'], {
      slug: 'old',
      startDate: '2025-01-01',
      playersPerSide: 11,
    });
    await addSeason(t, organizationId, ids['Newest Six'], {
      slug: 'new',
      startDate: '2026-01-01',
      playersPerSide: 6,
      minimumRosterSize: 8,
    });

    await t.mutation(internal.seed.demo, {});

    expect(await leagueRow(t, ids['Tuesday 5s'])).toMatchObject({
      gender: 'coed',
      playersPerSide: 5,
      level: 'rec',
      ageGroup: 'adult',
    });
    expect(await leagueRow(t, ids['Tuesday League'])).toMatchObject({ playersPerSide: 4 });
    expect(await leagueRow(t, ids['Tuesday League'])).not.toHaveProperty('minimumRosterSize');
    expect(await leagueRow(t, ids['Newest Six'])).toMatchObject({
      playersPerSide: 6,
      minimumRosterSize: 8,
    });
    expect(await leagueRow(t, ids["Women's Thursday Open 6v6"])).toMatchObject({
      gender: 'womens',
      playersPerSide: 6,
      level: 'open',
    });
  });

  test('does not set a minimum roster size equal to the players per side', async () => {
    const t = setup();
    const { organizationId, ids } = await insertLegacy(t, 'other-club', [['Plain', 'soccer']]);
    await addSeason(t, organizationId, ids['Plain'], { playersPerSide: 7, minimumRosterSize: 7 });

    await t.mutation(internal.seed.demo, {});

    expect(await leagueRow(t, ids['Plain'])).toMatchObject({ playersPerSide: 7 });
    expect(await leagueRow(t, ids['Plain'])).not.toHaveProperty('minimumRosterSize');
  });

  test('reads the newest season’s players per side from its format when the season has not been migrated yet', async () => {
    const t = setup();
    const { organizationId, ids } = await insertLegacy(t, 'other-club', [
      ['Left Behind', 'soccer'],
    ]);
    const seasonId = await addSeason(t, organizationId, ids['Left Behind'], {
      format: '7v7',
      minimumRosterSize: 9,
    });

    const result = await t.run((ctx) => backfillDivisionFields(ctx, []));

    expect(result).toEqual({ seasons: 1, leagueDivisions: 1 });
    expect(await leagueRow(t, ids['Left Behind'])).toMatchObject({
      playersPerSide: 7,
      minimumRosterSize: 9,
    });
    expect((await t.run((ctx) => ctx.db.get('seasons', seasonId)))?.playersPerSide).toBe(7);
  });

  test('leaves a league that already has its whole division alone', async () => {
    const t = setup();
    const { ids } = await insertLegacy(t, 'other-club', [['Tuesday 5s', 'beachVolleyball']]);
    await t.run((ctx) =>
      ctx.db.patch('leagues', ids['Tuesday 5s'], {
        gender: 'womens',
        playersPerSide: 2,
        level: 'a',
        ageGroup: 'u12',
      }),
    );

    await t.mutation(internal.seed.demo, {});

    expect(await leagueRow(t, ids['Tuesday 5s'])).toMatchObject({
      gender: 'womens',
      playersPerSide: 2,
      level: 'a',
      ageGroup: 'u12',
    });
  });

  test('fills only the fields a league lacks', async () => {
    const t = setup();
    const { ids } = await insertLegacy(t, 'other-club', [['Tuesday 5s', 'beachVolleyball']]);
    await t.run((ctx) => ctx.db.patch('leagues', ids['Tuesday 5s'], { gender: 'mens' }));

    await t.mutation(internal.seed.demo, {});

    expect(await leagueRow(t, ids['Tuesday 5s'])).toMatchObject({
      gender: 'mens',
      playersPerSide: 5,
      level: 'rec',
      ageGroup: 'adult',
    });
  });
});

describe('seed:demo divisions on an empty deployment', () => {
  test('gives every demo league its division, and the custom level to the league that uses it', async () => {
    const t = setup();
    const result = await t.mutation(internal.seed.demo, {});
    expect(result.backfilled).toEqual(ZERO_BACKFILL);

    const stored = await t.run(async (ctx) => {
      const organizations = await ctx.db.query('organizations').collect();
      const leagues = await ctx.db.query('leagues').collect();
      return leagues.map((league) => ({
        organization: organizations.find((o) => o._id === league.organizationId)!.slug,
        league,
      }));
    });
    const demoLeagues = DEMO.flatMap((tenant) =>
      tenant.leagues.map((league) => ({ organization: tenant.organization.slug, league })),
    );
    expect(stored).toHaveLength(demoLeagues.length);
    for (const { organization, league } of demoLeagues) {
      const row = stored.find(
        (entry) => entry.organization === organization && entry.league.name === league.name,
      )?.league;
      expect(row, league.name).toMatchObject({
        gender: league.division?.gender,
        playersPerSide: league.division?.playersPerSide,
        level: league.division?.level,
        ageGroup: league.division?.ageGroup,
      });
    }

    const levels = await t.run((ctx) => ctx.db.query('customLevels').collect());
    expect(levels).toEqual([
      expect.objectContaining({ name: 'D', standardLevel: 'rec', sport: 'softball' }),
    ]);
    const used = stored.filter((entry) => entry.league.customLevelId !== undefined);
    expect(used.map((entry) => [entry.organization, entry.league.name])).toEqual([
      ['saguaro-valley-softball', "Men's D Division Slow-Pitch"],
    ]);
    expect(used[0].league.customLevelId).toBe(levels[0]._id);
    expect(levels[0].organizationId).toBe(used[0].league.organizationId);
  });

  test('raises the minimum roster size of Coed 6v6 Indoor to 8 and adds the youth league U10 Girls Fall Rec', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const leagues = await t.run((ctx) => ctx.db.query('leagues').collect());
    expect(leagues.find((league) => league.name === 'Coed 6v6 Indoor')).toMatchObject({
      playersPerSide: 6,
      minimumRosterSize: 8,
    });
    const youth = leagues.find((league) => league.name === 'U10 Girls Fall Rec');
    expect(youth).toMatchObject({
      gender: 'womens',
      playersPerSide: 7,
      level: 'rec',
      ageGroup: 'u10',
      sport: 'soccer',
    });
    const location = await t.run((ctx) => ctx.db.get('locations', youth!.locationIds[0]));
    expect(location?.name).toBe('Cottonwood Creek Fields');
    expect(leagues.filter((league) => league.minimumRosterSize !== undefined)).toHaveLength(1);
  });

  test('a second run inserts nothing and changes nothing', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const read = () =>
      t.run(async (ctx) => ({
        leagues: await ctx.db.query('leagues').collect(),
        customLevels: await ctx.db.query('customLevels').collect(),
        seasons: await ctx.db.query('seasons').collect(),
      }));
    const before = await read();

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      organizations: 0,
      locations: 0,
      customLevels: 0,
      leagues: 0,
      seasons: 0,
      backfilled: ZERO_BACKFILL,
    });

    expect(await read()).toEqual(before);
  });

  test('the demo seasons store players per side and no format', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const seasons = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(seasons.map((row) => formatLabel(row.playersPerSide!)).sort()).toEqual([
      '4v4',
      '4v4',
      '7v7',
      '7v7',
    ]);
    for (const row of seasons) expect(row).not.toHaveProperty('format');
  });

  test.each([
    ['unset', undefined],
    ['wrong', '^https://.*\\.netlify\\.app$'],
  ])('with PREVIEW_ORIGIN_PATTERN %s, reads and writes nothing', async (_, value) => {
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', value);
    const t = setup();
    const { organizationId, ids } = await insertLegacy(t, 'old-club', [
      ['Tuesday 5s', 'beachVolleyball'],
    ]);
    await addSeason(t, organizationId, ids['Tuesday 5s'], { format: '4v4' });
    const snapshot = () =>
      t.run(async (ctx) => ({
        leagues: await ctx.db.query('leagues').collect(),
        seasons: await ctx.db.query('seasons').collect(),
        customLevels: await ctx.db.query('customLevels').collect(),
        organizations: await ctx.db.query('organizations').collect(),
      }));
    const before = await snapshot();

    await expect(t.mutation(internal.seed.demo, {})).rejects.toThrow(/PREVIEW_ORIGIN_PATTERN/);

    expect(await snapshot()).toEqual(before);
  });
});
