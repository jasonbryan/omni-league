/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { registrationIsOpen } from './lib/registration';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { DEMO_ACCOUNTS, DEMO_POOL_TEAMS, DEMO_POOL_TOURNAMENT } from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const EMAILS = DEMO_POOL_TEAMS.flatMap((team) => [team.captainEmail, team.partnerEmail]);

const PEOPLE = EMAILS.map((email, index) => ({ email, authUserId: `auth-person-${index}` }));

const ADMIN = { email: DEMO_ACCOUNTS.admin.email, authUserId: 'auth-admin' };

const WITH_ADMIN = [...PEOPLE, ADMIN];

async function seedDemo(t: T, people = PEOPLE): Promise<number> {
  await t.run(async (ctx) => {
    for (const { authUserId } of people) {
      await ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    }
  });
  await t.mutation(internal.seed.insertDemoData, {});
  return t.mutation(internal.seed.insertDemoTeams, { captains: people });
}

async function fallPoolPlay(t: T) {
  return t.run(async (ctx) => {
    const program = (await ctx.db.query('programs').collect()).find(
      (row) => row.slug === DEMO_POOL_TOURNAMENT.tournamentSlug,
    )!;
    const tournament = (await ctx.db
      .query('tournaments')
      .withIndex('by_programId', (q) => q.eq('programId', program._id))
      .unique())!;
    const teams = (await ctx.db.query('teams').collect()).filter(
      (team) => team.tournamentId === tournament._id,
    );
    const games = (await ctx.db.query('tournamentGames').collect()).filter(
      (game) => game.tournamentId === tournament._id,
    );
    return { program, tournament, teams, games };
  });
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo: the Fall Pool Play Open, a published tournament with its pools', () => {
  test('is published as Pools, then bracket, with registration closed and play still ahead', async () => {
    const t = setup();
    await seedDemo(t);
    const { program, tournament } = await fallPoolPlay(t);
    expect(program).toMatchObject({ name: 'Fall Pool Play Open', status: 'published' });
    expect(tournament.structure).toBe('pools');
    expect(registrationIsOpen(tournament, Date.now())).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    expect(tournament.startDate > today).toBe(true);
  });

  test('has 8 confirmed teams, each with the minimum roster, and counters equal to a recount', async () => {
    const t = setup();
    await seedDemo(t);
    const { tournament, teams } = await fallPoolPlay(t);
    expect(teams.map((team) => [team.name, team.rosterCount]).sort()).toEqual(
      DEMO_POOL_TEAMS.map((team) => [team.name, tournament.minimumRosterSize]).sort(),
    );
    expect(tournament.teamCount).toBe(8);
  });

  test('has 2 pools of 4 teams in snake order of the seeds, and 6 games in each pool', async () => {
    const t = setup();
    await seedDemo(t);
    const { teams, games } = await fallPoolPlay(t);
    const inPool = (pool: 'A' | 'B') =>
      teams
        .filter((team) => team.pool === pool)
        .map((team) => team.name)
        .sort();
    const names = DEMO_POOL_TEAMS.map((team) => team.name);
    expect(inPool('A')).toEqual([names[0], names[3], names[4], names[7]].sort());
    expect(inPool('B')).toEqual([names[1], names[2], names[5], names[6]].sort());
    expect(games).toHaveLength(12);
    expect(games.every((game) => game.stage === 'pool')).toBe(true);
    expect(games.filter((game) => game.pool === 'A')).toHaveLength(6);
    expect(games.filter((game) => game.pool === 'B')).toHaveLength(6);
  });

  test('is inserted once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t);
    const first = await fallPoolPlay(t);
    expect((await t.mutation(internal.seed.insertDemoData, {})).tournaments).toBe(0);
    expect(await t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE })).toBe(0);
    expect(await fallPoolPlay(t)).toEqual(first);
  });

  test('makes no pools while a team lacks its partner, and makes them once the partner exists', async () => {
    const t = setup();
    await seedDemo(t, PEOPLE.slice(0, -1));
    expect((await fallPoolPlay(t)).games).toEqual([]);
    expect((await fallPoolPlay(t)).teams.every((team) => team.pool === undefined)).toBe(true);
    await t.run((ctx) =>
      ctx.db.insert('users', {
        authUserId: PEOPLE.at(-1)!.authUserId,
        name: 'late partner',
        adultConfirmedAt: 1,
      }),
    );
    await t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE });
    expect((await fallPoolPlay(t)).games).toHaveLength(12);
  });
});

describe('seed:demo: the Fall Pool Play Open has results for half of its pool games', () => {
  const played = (games: Awaited<ReturnType<typeof fallPoolPlay>>['games']) =>
    games.filter((game) => game.score !== undefined);

  test('has 3 played games in each pool, entered by the demo admin, with standings to show', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const { games } = await fallPoolPlay(t);
    const admin = await t.run(async (ctx) =>
      (await ctx.db.query('users').collect()).find((user) => user.authUserId === ADMIN.authUserId)!,
    );
    expect(played(games)).toHaveLength(6);
    expect(played(games).filter((game) => game.pool === 'A')).toHaveLength(3);
    expect(played(games).filter((game) => game.pool === 'B')).toHaveLength(3);
    for (const game of played(games)) {
      expect(game.winnerTeamId).toBeDefined();
      expect(game.resultEnteredBy).toBe(admin._id);
      expect(game.stage).toBe('pool');
    }
  });

  test('shows standings on the public page, with every team placed', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const page = await t.query(api.tournaments.getPublicPage, {
      orgSlug: DEMO_POOL_TOURNAMENT.orgSlug,
      tournamentSlug: DEMO_POOL_TOURNAMENT.tournamentSlug,
    });
    expect(page?.pools?.map((pool) => pool.pool)).toEqual(['A', 'B']);
    for (const pool of page!.pools!) {
      expect(pool.standings).toHaveLength(4);
      expect(pool.standings.some((row) => row.cells[0] !== '0')).toBe(true);
    }
  });

  test('is entered once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const first = await fallPoolPlay(t);
    await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN });
    expect(await fallPoolPlay(t)).toEqual(first);
  });

  test('enters no result while no admin account exists', async () => {
    const t = setup();
    await seedDemo(t);
    expect(played((await fallPoolPlay(t)).games)).toHaveLength(0);
  });

  test('keeps a result an organizer entered', async () => {
    const t = setup();
    await seedDemo(t);
    const { games } = await fallPoolPlay(t);
    const entered = games[0];
    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        authUserId: ADMIN.authUserId,
        name: 'a',
        adultConfirmedAt: 1,
      });
      await ctx.db.patch('tournamentGames', entered._id, {
        winnerTeamId: entered.teamIds[0]!,
        score: { kind: 'sets', sets: [{ a: 21, b: 5 }] },
      });
    });
    await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN });
    expect(played((await fallPoolPlay(t)).games)).toHaveLength(1);
  });
});
