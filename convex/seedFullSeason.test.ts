/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { DEMO_CAPTAINS, DEMO_FULL_SEASON, DEMO_TEAM_SEASON, DEMO_WAITLIST_ENTRY } from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const CAPTAINS = DEMO_CAPTAINS.map(({ email }, index) => ({
  email,
  authUserId: `auth-captain-${index}`,
}));

async function insertCaptainUsers(t: T): Promise<void> {
  await t.run(async (ctx) => {
    for (const { authUserId } of CAPTAINS) {
      await ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    }
  });
}

async function fullSeason(t: T) {
  return t.run(async (ctx) => {
    const seasons = (await ctx.db.query('seasons').collect()).filter(
      (season) => season.slug === DEMO_FULL_SEASON.seasonSlug && season.maxTeams !== undefined,
    );
    const teams = await ctx.db.query('teams').collect();
    return seasons.map((season) => ({
      maxTeams: season.maxTeams,
      status: season.status,
      teamCount: season.teamCount,
      recount: teams.filter((team) => team.seasonId === season._id).length,
      teams: teams
        .filter((team) => team.seasonId === season._id)
        .map((team) => [team.name, team.rosterCount])
        .sort(),
    }));
  });
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo: a published season at its team limit', () => {
  test('inserts the season and its two teams once, with counters equal to a recount', async () => {
    const t = setup();
    await insertCaptainUsers(t);
    await t.mutation(internal.seed.insertDemoData, {});
    await t.mutation(internal.seed.insertDemoTeams, { captains: CAPTAINS });
    const expected = [
      {
        maxTeams: 2,
        status: 'published',
        teamCount: 2,
        recount: 2,
        teams: [
          ['Pair of Aces', 1],
          ['Two Tall', 1],
        ],
      },
    ];
    expect(await fullSeason(t)).toEqual(expected);
    expect(await t.query(api.seasons.getPublicPage, DEMO_FULL_SEASON)).toMatchObject({
      isFull: true,
      maxTeams: 2,
    });

    expect((await t.mutation(internal.seed.insertDemoData, {})).seasons).toBe(0);
    expect(await t.mutation(internal.seed.insertDemoTeams, { captains: CAPTAINS })).toBe(0);
    expect(await fullSeason(t)).toEqual(expected);
  });

  test('a wrong PREVIEW_ORIGIN_PATTERN writes nothing', async () => {
    const t = setup();
    await insertCaptainUsers(t);
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', `${PREVIEW_ORIGIN_PATTERN} `);
    await expect(t.mutation(internal.seed.insertDemoData, {})).rejects.toThrow(
      /PREVIEW_ORIGIN_PATTERN/,
    );
    await expect(t.mutation(internal.seed.insertDemoTeams, { captains: CAPTAINS })).rejects.toThrow(
      /PREVIEW_ORIGIN_PATTERN/,
    );
    expect(await fullSeason(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('teams').collect())).toEqual([]);
  });
});

describe('seed:demo: a maximum roster size', () => {
  test('the demo team season has a maximum of 6, which its demo teams are within', async () => {
    const t = setup();
    await insertCaptainUsers(t);
    await t.mutation(internal.seed.insertDemoData, {});
    await t.mutation(internal.seed.insertDemoTeams, { captains: CAPTAINS });
    const { maxRosterSize, rosterCounts } = await t.run(async (ctx) => {
      const season = (await ctx.db.query('seasons').collect()).find(
        (row) => row.slug === DEMO_TEAM_SEASON.seasonSlug && row.maxRosterSize !== undefined,
      );
      const teams = await ctx.db.query('teams').collect();
      return {
        maxRosterSize: season?.maxRosterSize,
        rosterCounts: teams
          .filter((team) => team.seasonId === season?._id)
          .map((team) => team.rosterCount),
      };
    });
    expect(maxRosterSize).toBe(6);
    expect(rosterCounts.length).toBeGreaterThan(0);
    expect(rosterCounts.every((count) => count <= 6)).toBe(true);
  });
});

describe('seed:demo: a waiting team on the full season', () => {
  async function waitlist(t: T) {
    return t.run(async (ctx) => {
      const season = (await ctx.db.query('seasons').collect()).find(
        (row) => row.slug === DEMO_FULL_SEASON.seasonSlug && row.maxTeams !== undefined,
      );
      const entries = await ctx.db.query('waitlistEntries').collect();
      return {
        waitlistCount: season?.waitlistCount,
        entries: entries.map((entry) => ({
          seasonId: entry.seasonId === season?._id,
          teamName: entry.teamName,
          status: entry.status,
        })),
      };
    });
  }

  const expected = {
    waitlistCount: 1,
    entries: [{ seasonId: true, teamName: DEMO_WAITLIST_ENTRY.teamName, status: 'waiting' }],
  };

  test('inserts one waiting entry once, with the counter equal to a recount', async () => {
    const t = setup();
    await insertCaptainUsers(t);
    await t.mutation(internal.seed.insertDemoData, {});
    await t.mutation(internal.seed.insertDemoTeams, { captains: CAPTAINS });
    expect(await waitlist(t)).toEqual(expected);
    expect(await t.query(api.seasons.getPublicPage, DEMO_FULL_SEASON)).toMatchObject({
      isFull: true,
    });

    await t.mutation(internal.seed.insertDemoData, {});
    await t.mutation(internal.seed.insertDemoTeams, { captains: CAPTAINS });
    expect(await waitlist(t)).toEqual(expected);
    expect((await fullSeason(t)).map(({ teams }) => teams.map(([name]) => name))).toEqual([
      ['Pair of Aces', 'Two Tall'],
    ]);
  });

  test('a wrong PREVIEW_ORIGIN_PATTERN writes no waiting entry', async () => {
    const t = setup();
    await insertCaptainUsers(t);
    await t.mutation(internal.seed.insertDemoData, {});
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', `${PREVIEW_ORIGIN_PATTERN} `);
    await expect(t.mutation(internal.seed.insertDemoTeams, { captains: CAPTAINS })).rejects.toThrow(
      /PREVIEW_ORIGIN_PATTERN/,
    );
    expect((await waitlist(t)).entries).toEqual([]);
  });
});
