/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { registrationIsOpen } from './lib/registration';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import {
  DEMO_ACCOUNTS,
  DEMO_HARVEST_TEAMS,
  DEMO_HARVEST_TOURNAMENT,
  DEMO_POOL_TEAMS,
  DEMO_POOL_TOURNAMENT,
} from './seed';
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

describe('seed:demo: the Fall Pool Play Open has a pool game for player@ to report and a report for admin@ to confirm', () => {
  const PLAYER = { email: DEMO_ACCOUNTS.player.email, authUserId: 'auth-player' };

  /** The people of the pool teams, with player@ in the place of Sandbar Six's earlier captain. */
  const people = () => [...PEOPLE.filter((person) => person.email !== PLAYER.email), PLAYER, ADMIN];

  async function reportsOf(t: T) {
    const { games, teams } = await fallPoolPlay(t);
    return t.run(async (ctx) => {
      const nameOf = (id: string) => teams.find((team) => team._id === id)?.name;
      const rows = await ctx.db.query('scoreReports').collect();
      return rows
        .filter((row) => games.some((game) => game._id === row.gameId))
        .map((row) => {
          const game = games.find((candidate) => candidate._id === row.gameId)!;
          return {
            row,
            game,
            reporter: nameOf(row.teamId),
            between: game.teamIds.map((id) => nameOf(id!)),
          };
        });
    });
  }

  test('makes player@ the captain of Sandbar Six, which has two pool games without a result', async () => {
    const t = setup();
    await seedDemo(t, people());
    const { teams, games } = await fallPoolPlay(t);
    const sandbarSix = teams.find((team) => team.name === 'Sandbar Six')!;
    const player = await t.run(async (ctx) =>
      (await ctx.db.query('users').collect()).find((user) => user.authUserId === PLAYER.authUserId),
    );
    expect(sandbarSix.captainUserId).toBe(player?._id);
    const open = games
      .filter((game) => game.teamIds.includes(sandbarSix._id) && game.score === undefined)
      .sort((a, b) => a.round - b.round);
    expect(open.map((game) => game.round)).toEqual([2, 3]);
  });

  test('has one captain’s report on another pool game, from Reef Breakers, that has no result', async () => {
    const t = setup();
    await seedDemo(t, people());
    const reports = await reportsOf(t);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reporter: 'Reef Breakers' });
    expect(reports[0].between).toEqual(['Reef Breakers', 'Shell Shock']);
    expect(reports[0].game.score).toBeUndefined();
    expect(reports[0].row.score).toEqual({ kind: 'sets', sets: [{ a: 21, b: 17 }] });
  });

  test('shows admin@ the report as waiting, and the standings do not count it', async () => {
    const t = setup();
    await seedDemo(t, people());
    await t.run(async (ctx) => {
      const user = (await ctx.db.query('users').collect()).find(
        (row) => row.authUserId === ADMIN.authUserId,
      )!;
      const organization = (await ctx.db.query('organizations').collect()).find(
        (row) => row.slug === DEMO_POOL_TOURNAMENT.orgSlug,
      )!;
      await ctx.db.insert('memberships', {
        userId: user._id,
        organizationId: organization._id,
        role: 'orgAdmin',
        leagueIds: [],
      });
    });
    const admin = t.withIdentity({
      subject: ADMIN.authUserId,
      issuer: 'http://127.0.0.1:3211',
      name: 'admin',
      sessionId: 's1',
    });
    const pools = await admin.query(api.tournamentGames.getPools, {
      orgSlug: DEMO_POOL_TOURNAMENT.orgSlug,
      tournamentSlug: DEMO_POOL_TOURNAMENT.tournamentSlug,
    });
    const waiting = pools?.pools.flatMap((pool) => pool.games).filter((g) => g.reports.length > 0);
    expect(waiting).toHaveLength(1);
    expect(waiting?.[0].reports[0].teamName).toBe('Reef Breakers');
    const page = await t.query(api.tournaments.getPublicPage, {
      orgSlug: DEMO_POOL_TOURNAMENT.orgSlug,
      tournamentSlug: DEMO_POOL_TOURNAMENT.tournamentSlug,
    });
    const reefBreakers = page?.pools?.[0].standings.find((row) => row.name === 'Reef Breakers');
    expect(reefBreakers?.cells[0]).toBe('2');
  });

  test('is inserted once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t, people());
    const first = await reportsOf(t);
    await t.mutation(internal.seed.insertDemoTeams, { captains: people() });
    expect(await reportsOf(t)).toEqual(first);
  });

  test('adds no report to a reported game once an organizer has entered its result', async () => {
    const t = setup();
    await seedDemo(t, people());
    const reefBreakers = (await fallPoolPlay(t)).teams.find(
      (team) => team.name === 'Reef Breakers',
    )!;
    const game = (await fallPoolPlay(t)).games.find(
      (row) => row.round === 3 && row.teamIds.includes(reefBreakers._id),
    )!;
    const reported = await reportsOf(t);
    await t.run(async (ctx) => {
      for (const { row } of reported) await ctx.db.delete('scoreReports', row._id);
      await ctx.db.patch('tournamentGames', game._id, {
        winnerTeamId: game.teamIds[0]!,
        score: { kind: 'sets', sets: [{ a: 21, b: 5 }] },
      });
    });
    await t.mutation(internal.seed.insertDemoTeams, { captains: people() });
    expect(await reportsOf(t)).toEqual([]);
  });
});

describe('seed:demo: the Harvest Pools Classic has every pool game confirmed and its bracket from the pools', () => {
  async function harvest(t: T) {
    return t.run(async (ctx) => {
      const program = (await ctx.db.query('programs').collect()).find(
        (row) => row.slug === DEMO_HARVEST_TOURNAMENT.tournamentSlug,
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

  const admin = (t: T) =>
    t.withIdentity({
      subject: ADMIN.authUserId,
      issuer: 'http://127.0.0.1:3211',
      name: 'admin',
      sessionId: 's1',
    });

  test('is a published Pools, then bracket tournament with registration closed and 6 confirmed teams', async () => {
    const t = setup();
    await seedDemo(t);
    const { program, tournament, teams } = await harvest(t);
    expect(program).toMatchObject({ name: 'Harvest Pools Classic', status: 'published' });
    expect(tournament.structure).toBe('pools');
    expect(registrationIsOpen(tournament, Date.now())).toBe(false);
    expect(teams.map((team) => [team.name, team.rosterCount]).sort()).toEqual(
      DEMO_HARVEST_TEAMS.map((team) => [team.name, tournament.minimumRosterSize]).sort(),
    );
    expect(tournament.teamCount).toBe(6);
  });

  test('has 2 pools of 3 teams and a confirmed result for each of the 6 pool games, entered by the demo admin', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const { games, teams } = await harvest(t);
    const user = await t.run(async (ctx) =>
      (await ctx.db.query('users').collect()).find((row) => row.authUserId === ADMIN.authUserId),
    );
    const poolGames = games.filter((game) => game.stage === 'pool');
    expect(poolGames).toHaveLength(6);
    expect(poolGames.every((game) => game.score !== undefined)).toBe(true);
    expect(poolGames.every((game) => game.resultEnteredBy === user?._id)).toBe(true);
    expect(teams.filter((team) => team.pool === 'A')).toHaveLength(3);
    expect(teams.filter((team) => team.pool === 'B')).toHaveLength(3);
  });

  test('has a 4-team bracket from the pool finish: A1, B1, A2, B2, with A1 against B2', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const { games, teams } = await harvest(t);
    const nameOf = (id: string | null) => teams.find((team) => team._id === id)?.name;
    const bracket = games.filter((game) => game.stage === 'bracket');
    expect(bracket).toHaveLength(3);
    expect(
      bracket
        .filter((game) => game.round === 1)
        .map((game) => game.teamIds.map(nameOf))
        .sort(),
    ).toEqual([
      ['Pelican Point', 'Sunset Sets'],
      ['Sea Oats', 'Low Tide'],
    ]);
  });

  test('shows admin@ the bracket with the pools frozen, and the public page holds both sections', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    await t.run(async (ctx) => {
      const user = (await ctx.db.query('users').collect()).find(
        (row) => row.authUserId === ADMIN.authUserId,
      )!;
      const organization = (await ctx.db.query('organizations').collect()).find(
        (row) => row.slug === DEMO_HARVEST_TOURNAMENT.orgSlug,
      )!;
      await ctx.db.insert('memberships', {
        userId: user._id,
        organizationId: organization._id,
        role: 'orgAdmin',
        leagueIds: [],
      });
    });
    const view = await admin(t).query(api.tournamentGames.getPoolBracket, DEMO_HARVEST_TOURNAMENT);
    expect(view).toMatchObject({ gamesWithoutResult: 0, poolCount: 2, smallestPool: 3 });
    expect(view?.bracket?.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);
    const page = await t.query(api.tournaments.getPublicPage, DEMO_HARVEST_TOURNAMENT);
    expect(page?.pools).toHaveLength(2);
    expect(page?.bracket?.rounds).toHaveLength(2);
  });

  test('makes no bracket while no admin account exists to confirm the pool games', async () => {
    const t = setup();
    await seedDemo(t);
    const { games } = await harvest(t);
    expect(games.filter((game) => game.stage === 'pool')).toHaveLength(6);
    expect(games.filter((game) => game.stage === 'bracket')).toHaveLength(0);
    expect(games.every((game) => game.score === undefined)).toBe(true);
  });

  test('is made once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const first = await harvest(t);
    await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN });
    expect(await harvest(t)).toEqual(first);
  });

  test('leaves the Fall Pool Play Open with half its pool games played and no bracket', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const { games } = await fallPoolPlay(t);
    expect(games.filter((game) => game.score !== undefined)).toHaveLength(6);
    expect(games.filter((game) => game.stage === 'bracket')).toHaveLength(0);
  });
});
