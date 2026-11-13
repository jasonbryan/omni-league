/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import {
  DEMO_FULL_TOURNAMENT,
  DEMO_FULL_TOURNAMENT_TEAMS,
  DEMO_TOURNAMENT_WAITLIST_ENTRY,
} from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const EMAILS = [
  ...DEMO_FULL_TOURNAMENT_TEAMS.map((team) => team.captainEmail),
  DEMO_TOURNAMENT_WAITLIST_ENTRY.captainEmail,
];

const PEOPLE = EMAILS.map((email, index) => ({ email, authUserId: `auth-person-${index}` }));

async function seedDemo(t: T): Promise<number> {
  await t.run(async (ctx) => {
    for (const { authUserId } of PEOPLE) {
      await ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    }
  });
  await t.mutation(internal.seed.insertDemoData, {});
  return t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE });
}

async function fullTournament(t: T) {
  return t.run(async (ctx) => {
    const program = (await ctx.db.query('programs').collect()).find(
      (row) => row.slug === DEMO_FULL_TOURNAMENT.tournamentSlug,
    );
    const tournament = program
      ? await ctx.db
          .query('tournaments')
          .withIndex('by_programId', (q) => q.eq('programId', program._id))
          .unique()
      : null;
    const teams = await ctx.db.query('teams').collect();
    const entries = (await ctx.db.query('waitlistEntries').collect()).filter(
      (entry) => entry.tournamentId === tournament?._id,
    );
    const own = teams.filter((team) => team.tournamentId === tournament?._id);
    return {
      status: tournament?.status,
      maximumTeams: tournament?.maximumTeams,
      teamCount: tournament?.teamCount,
      recount: own.length,
      teams: own.map((team) => [team.name, team.rosterCount]).sort(),
      waitlistCount: tournament?.waitlistCount,
      entries: entries.map((entry) => ({
        seasonId: entry.seasonId,
        teamName: entry.teamName,
        status: entry.status,
      })),
    };
  });
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo: a published tournament at its maximum teams, with a waiting team', () => {
  const expected = {
    status: 'published',
    maximumTeams: 4,
    teamCount: 4,
    recount: 4,
    teams: DEMO_FULL_TOURNAMENT_TEAMS.map((team) => [team.name, 1]).sort(),
    waitlistCount: 1,
    entries: [
      {
        seasonId: undefined,
        teamName: DEMO_TOURNAMENT_WAITLIST_ENTRY.teamName,
        status: 'waiting',
      },
    ],
  };

  test('is four teams of one player and one waiting entry, with counters equal to a recount', async () => {
    const t = setup();
    await seedDemo(t);
    const tournaments = await fullTournament(t);
    expect(tournaments).toEqual(expected);
    expect(await t.query(api.tournaments.getPublicPage, DEMO_FULL_TOURNAMENT)).toMatchObject({
      isFull: true,
      maximumTeams: 4,
    });
  });

  test('is inserted once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t);
    expect((await t.mutation(internal.seed.insertDemoData, {})).tournaments).toBe(0);
    expect(await t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE })).toBe(0);
    expect(await fullTournament(t)).toEqual(expected);
  });

  test('a wrong PREVIEW_ORIGIN_PATTERN writes no team and no waiting entry', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', `${PREVIEW_ORIGIN_PATTERN} `);
    await expect(t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE })).rejects.toThrow(
      /PREVIEW_ORIGIN_PATTERN/,
    );
    expect(await t.run((ctx) => ctx.db.query('waitlistEntries').collect())).toEqual([]);
  });
});
