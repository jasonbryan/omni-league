/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { POOL_MESSAGES, poolCountsFor, poolNameAt, snakeSplit, type Pool } from './lib/pools';
import {
  OPEN_NOW,
  TOURNAMENT_SLUGS,
  tournamentWorld,
  type Person,
  type TournamentWorld,
} from './tournamentWorld.setup';

afterEach(() => {
  vi.useRealTimers();
});

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

const POOL_GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

let registeredAt = 1_000;

function addTeam(
  s: TournamentWorld,
  name: string,
  {
    rosterCount = 2,
    tournamentId = s.gulf,
  }: { rosterCount?: number; tournamentId?: Id<'tournaments'> } = {},
) {
  registeredAt += 1;
  return s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', tournamentId))!;
    return ctx.db.insert('teams', {
      organizationId: tournament.organizationId,
      tournamentId,
      name,
      sortName: name.toLowerCase(),
      captainUserId: s.captain.userId,
      rosterCount,
      createdAt: registeredAt,
    });
  });
}

/** Teams named "Team 01" and up, registered in that order, in a Pools tournament whose registration has closed. */
async function world(teamCount: number, now = AFTER_DEADLINE) {
  vi.useFakeTimers({ now });
  const s = await tournamentWorld();
  await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { structure: 'pools' }));
  const teamIds: Id<'teams'>[] = [];
  for (let number = 1; number <= teamCount; number++) {
    teamIds.push(await addTeam(s, `Team ${String(number).padStart(2, '0')}`));
  }
  return { s, teamIds };
}

const split = (s: TournamentWorld, poolCount: number, who: Person = s.admin) =>
  s.as(who).mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount });

const undoSplit = (
  s: TournamentWorld,
  undo: Awaited<ReturnType<typeof split>>['undo'],
  who: Person = s.admin,
) => s.as(who).mutation(api.tournamentGames.undoSplitPools, { tournamentId: s.gulf, ...undo });

const moveSeed = (
  s: TournamentWorld,
  teamId: Id<'teams'>,
  direction: 'up' | 'down',
  who: Person = s.admin,
) => s.as(who).mutation(api.tournamentGames.moveSeed, { tournamentId: s.gulf, teamId, direction });

const move = (s: TournamentWorld, teamId: Id<'teams'>, pool: Pool, who: Person = s.admin) =>
  s.as(who).mutation(api.tournamentGames.movePoolTeam, { tournamentId: s.gulf, teamId, pool });

const createGames = (s: TournamentWorld, replace?: boolean, who: Person = s.admin) =>
  s.as(who).mutation(api.tournamentGames.createPoolGames, {
    tournamentId: s.gulf,
    ...(replace !== undefined && { replace }),
  });

const view = (s: TournamentWorld, who: Person = s.admin, slugs = TOURNAMENT_SLUGS) =>
  s.as(who).query(api.tournamentGames.getPools, slugs);

const poolGames = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(POOL_GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'pool'))
      .collect(),
  );

const teamRows = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('teams')
      .collect()
      .then((rows) => rows.toSorted((a, b) => a.createdAt - b.createdAt)),
  );

const poolOf = async (s: TournamentWorld) =>
  Object.fromEntries((await teamRows(s)).map((team) => [team.name, team.pool]));

const namesIn = async (s: TournamentWorld, pool: Pool) =>
  (await teamRows(s)).filter((team) => team.pool === pool).map((team) => team.name);

async function enterPoolResult(s: TournamentWorld) {
  const game = (await poolGames(s))[0];
  await s.t.run((ctx) =>
    ctx.db.patch('tournamentGames', game._id, {
      winnerTeamId: game.teamIds[0]!,
      score: { kind: 'sets', sets: [{ a: 21, b: 15 }] },
    }),
  );
  return game;
}

describe('tournamentGames.splitPools', () => {
  test('12 teams in 3 pools: each pool holds 4 teams in snake order, pool A seeds 1, 6, 7, and 12', async () => {
    const { s } = await world(12);
    expect(await split(s, 3)).toMatchObject({ poolCount: 3, teamCount: 12 });
    expect(await namesIn(s, 'A')).toEqual(['Team 01', 'Team 06', 'Team 07', 'Team 12']);
    expect(await namesIn(s, 'B')).toEqual(['Team 02', 'Team 05', 'Team 08', 'Team 11']);
    expect(await namesIn(s, 'C')).toEqual(['Team 03', 'Team 04', 'Team 09', 'Team 10']);
  });

  test('follows the seeds when an organizer has set them', async () => {
    const { s, teamIds } = await world(6);
    await s.t.run(async (ctx) => {
      await ctx.db.patch('teams', teamIds[5], { seed: 1 });
      for (const [index, id] of teamIds.slice(0, 5).entries()) {
        await ctx.db.patch('teams', id, { seed: index + 2 });
      }
    });
    await split(s, 2);
    expect(await namesIn(s, 'A')).toEqual(['Team 03', 'Team 04', 'Team 06']);
    expect(await namesIn(s, 'B')).toEqual(['Team 01', 'Team 02', 'Team 05']);
  });

  test('leaves a team below the minimum roster size out of every pool', async () => {
    const { s } = await world(6);
    await addTeam(s, 'Short Handed', { rosterCount: 1 });
    await split(s, 2);
    expect((await poolOf(s))['Short Handed']).toBeUndefined();
  });

  test('replaces an earlier split, so a team never keeps a pool the new split has no place for', async () => {
    const { s } = await world(12);
    await split(s, 4);
    await split(s, 2);
    expect((await teamRows(s)).every((team) => team.pool === 'A' || team.pool === 'B')).toBe(true);
    expect(await namesIn(s, 'A')).toEqual([
      'Team 01',
      'Team 04',
      'Team 05',
      'Team 08',
      'Team 09',
      'Team 12',
    ]);
  });

  test('leaves the teams of another tournament alone', async () => {
    const { s } = await world(6);
    const other = await addTeam(s, 'Elsewhere', { tournamentId: s.second });
    await split(s, 2);
    expect((await s.t.run((ctx) => ctx.db.get('teams', other)))!.pool).toBeUndefined();
  });

  test.each([5, 65])('refuses %s confirmed teams with the team limits', async (count) => {
    const { s } = await world(count);
    expect(await split(s, 2).catch(refusalOf)).toEqual({
      code: 'teamLimits',
      message: 'Pools need 6 to 64 confirmed teams.',
    });
    expect((await teamRows(s)).every((team) => team.pool === undefined)).toBe(true);
  });

  test('refuses a count that leaves a pool of 2, and one that leaves a pool of 9', async () => {
    const twelve = await world(12);
    expect(await split(twelve.s, 5).catch(refusalOf)).toEqual({
      code: 'poolSize',
      message: 'Pool C would have 2 teams. Each pool needs 3 to 8 teams.',
    });
    const eighteen = await world(18);
    expect(await split(eighteen.s, 2).catch(refusalOf)).toEqual({
      code: 'poolSize',
      message: 'Pool A would have 9 teams. Each pool needs 3 to 8 teams.',
    });
  });

  test.each([1, 9, 2.5])('refuses %s pools', async (count) => {
    const { s } = await world(12);
    expect(await split(s, count).catch(refusalOf)).toMatchObject({ code: 'poolCount' });
  });

  test('refuses while registration is open', async () => {
    const { s } = await world(6, OPEN_NOW);
    expect(await split(s, 2).catch(refusalOf)).toEqual({
      code: 'poolRegistrationOpen',
      message: POOL_MESSAGES.poolRegistrationOpen('2030-05-20'),
    });
  });

  test('refuses a Bracket only tournament', async () => {
    const { s } = await world(6);
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { structure: 'bracket' }));
    expect(await split(s, 2).catch(refusalOf)).toEqual({
      code: 'notPools',
      message: POOL_MESSAGES.notPools,
    });
  });

  test('refuses once a pool result is entered, and keeps the pools', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await createGames(s);
    await enterPoolResult(s);
    expect(await split(s, 2).catch(refusalOf)).toEqual({
      code: 'poolResultEntered',
      message: POOL_MESSAGES.poolResultEntered,
    });
    expect(await namesIn(s, 'A')).toHaveLength(3);
  });

  test('leaves the pool games as they are, so the page can say they are out of date', async () => {
    const { s } = await world(12);
    await split(s, 3);
    await createGames(s);
    const before = await poolGames(s);
    await split(s, 2);
    expect(await poolGames(s)).toEqual(before);
  });
});

describe('tournamentGames.movePoolTeam', () => {
  test('moves a team to another pool and says where it went', async () => {
    const { s, teamIds } = await world(12);
    await split(s, 3);
    expect(await move(s, teamIds[0], 'B')).toEqual({ pool: 'B', poolTeamCount: 5 });
    expect((await poolOf(s))['Team 01']).toBe('B');
    expect(await namesIn(s, 'A')).toHaveLength(3);
  });

  test('checks the 3 to 8 limit again: a pool of 3 cannot give a team away', async () => {
    const { s, teamIds } = await world(6);
    await split(s, 2);
    expect(await move(s, teamIds[0], 'B').catch(refusalOf)).toEqual({
      code: 'poolSize',
      message: 'Pool A would have 2 teams. Each pool needs 3 to 8 teams.',
    });
    expect((await poolOf(s))['Team 01']).toBe('A');
  });

  test('refuses a move that would make a pool of 9', async () => {
    const { s, teamIds } = await world(16);
    await split(s, 2);
    expect(await move(s, teamIds[1], 'A').catch(refusalOf)).toEqual({
      code: 'poolSize',
      message: 'Pool A would have 9 teams. Each pool needs 3 to 8 teams.',
    });
  });

  test('refuses a team already in the pool', async () => {
    const { s, teamIds } = await world(6);
    await split(s, 2);
    expect(await move(s, teamIds[0], 'A').catch(refusalOf)).toEqual({
      code: 'samePool',
      message: POOL_MESSAGES.samePool('Team 01', 'A'),
    });
  });

  test('refuses a pool the split does not have', async () => {
    const { s, teamIds } = await world(6);
    await split(s, 2);
    expect(await move(s, teamIds[0], 'C').catch(refusalOf)).toEqual({
      code: 'noSuchPool',
      message: POOL_MESSAGES.noSuchPool('C'),
    });
  });

  test('refuses a team that is in no pool', async () => {
    const { s } = await world(6);
    await split(s, 2);
    const short = await addTeam(s, 'Short Handed', { rosterCount: 1 });
    expect(await move(s, short, 'B').catch(refusalOf)).toEqual({
      code: 'notInPools',
      message: POOL_MESSAGES.notInPools('Short Handed'),
    });
  });

  test('refuses a team of another tournament', async () => {
    const { s } = await world(6);
    await split(s, 2);
    const elsewhere = await addTeam(s, 'Elsewhere', { tournamentId: s.second });
    await expect(move(s, elsewhere, 'B')).rejects.toThrow(/Not allowed/);
  });

  test('refuses once a pool result is entered', async () => {
    const { s, teamIds } = await world(8);
    await split(s, 2);
    await createGames(s);
    await enterPoolResult(s);
    expect(await move(s, teamIds[0], 'B').catch(refusalOf)).toEqual({
      code: 'poolResultEntered',
      message: POOL_MESSAGES.poolResultEntered,
    });
  });

  test('refuses before the teams are split', async () => {
    const { s, teamIds } = await world(6);
    expect(await move(s, teamIds[0], 'B').catch(refusalOf)).toMatchObject({ code: 'notInPools' });
  });
});

describe('tournamentGames.createPoolGames', () => {
  test('12 teams in 3 pools: 6 games in each pool, between the pool’s own teams', async () => {
    const { s } = await world(12);
    await split(s, 3);
    expect(await createGames(s)).toEqual({ gameCount: 18, replaced: false });
    const rows = await poolGames(s);
    expect(rows).toHaveLength(18);
    expect(rows.every((game) => game.stage === 'pool')).toBe(true);
    const teams = new Map((await teamRows(s)).map((team) => [team._id, team]));
    for (const pool of ['A', 'B', 'C'] as const) {
      const inPool = rows.filter((game) => game.pool === pool);
      expect(inPool).toHaveLength(6);
      for (const game of inPool) {
        expect(game.teamIds).toHaveLength(2);
        for (const id of game.teamIds) expect(teams.get(id!)!.pool).toBe(pool);
        expect(game.nextGameId).toBeUndefined();
        expect(game.winnerTeamId).toBeUndefined();
      }
    }
  });

  test('pairs every two teams of a pool once', async () => {
    const { s } = await world(8);
    await split(s, 2);
    await createGames(s);
    const pairs = (await poolGames(s)).map(
      (game) => `${game.pool}:${[...game.teamIds].sort().join('|')}`,
    );
    expect(new Set(pairs).size).toBe(12);
  });

  test('refuses before the teams are split', async () => {
    const { s } = await world(6);
    expect(await createGames(s).catch(refusalOf)).toEqual({
      code: 'notSplit',
      message: POOL_MESSAGES.notSplit,
    });
  });

  test('refuses a split that leaves a team out, such as one that reached the minimum roster since', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await addTeam(s, 'Late Arrival');
    expect(await createGames(s).catch(refusalOf)).toEqual({
      code: 'notSplit',
      message: POOL_MESSAGES.notSplit,
    });
  });

  test('refuses while registration is open', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await s.t.run((ctx) =>
      ctx.db.patch('tournaments', s.gulf, { registrationDeadline: '2030-05-31' }),
    );
    expect(await createGames(s).catch(refusalOf)).toMatchObject({ code: 'poolRegistrationOpen' });
  });

  test('refuses a Bracket only tournament', async () => {
    const { s } = await world(6);
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { structure: 'bracket' }));
    expect(await createGames(s).catch(refusalOf)).toMatchObject({ code: 'notPools' });
  });

  test('recreate: refuses without the flag or with it false, and replaces the games with it', async () => {
    const { s, teamIds } = await world(8);
    await split(s, 2);
    await createGames(s);
    const first = await poolGames(s);
    expect(await createGames(s).catch(refusalOf)).toEqual({
      code: 'poolGamesExist',
      message: POOL_MESSAGES.poolGamesExist,
    });
    expect(await createGames(s, false).catch(refusalOf)).toMatchObject({ code: 'poolGamesExist' });
    expect(await poolGames(s)).toEqual(first);

    await move(s, teamIds[0], 'B');
    expect(await createGames(s, true)).toEqual({ gameCount: 13, replaced: true });
    const second = await poolGames(s);
    expect(second).toHaveLength(13);
    const earlier = new Set(first.map((game) => game._id));
    expect(second.some((game) => earlier.has(game._id))).toBe(false);
  });

  test('recreate uses the pools as they stand after a move', async () => {
    const { s, teamIds } = await world(14);
    await split(s, 2);
    await createGames(s);
    await move(s, teamIds[0], 'B');
    await createGames(s, true);
    const rows = await poolGames(s);
    expect(rows.filter((game) => game.pool === 'A')).toHaveLength(15);
    expect(rows.filter((game) => game.pool === 'B')).toHaveLength(28);
    expect(rows.some((game) => game.pool === 'A' && game.teamIds.includes(teamIds[0]))).toBe(false);
  });

  test('recreate is refused once a pool result is entered, and the games stay', async () => {
    const { s } = await world(8);
    await split(s, 2);
    await createGames(s);
    await enterPoolResult(s);
    const before = await poolGames(s);
    expect(await createGames(s, true).catch(refusalOf)).toEqual({
      code: 'poolResultEntered',
      message: POOL_MESSAGES.poolResultEntered,
    });
    expect(await poolGames(s)).toEqual(before);
  });

  test('leaves the bracket games of the tournament alone', async () => {
    const { s } = await world(6);
    await split(s, 2);
    const bracketGame = await s.t.run((ctx) =>
      ctx.db.insert('tournamentGames', {
        tournamentId: s.gulf,
        stage: 'bracket',
        round: 1,
        slot: 1,
        teamIds: [null, null],
      }),
    );
    await createGames(s);
    expect(await s.t.run((ctx) => ctx.db.get('tournamentGames', bracketGame))).not.toBeNull();
  });
});

describe('tournamentGames.getPools', () => {
  test('lists the confirmed teams before a split, with no pools', async () => {
    const { s } = await world(7);
    await addTeam(s, 'Short Handed', { rosterCount: 1 });
    const pools = (await view(s))!;
    expect(pools).toMatchObject({
      confirmedCount: 7,
      unconfirmedCount: 1,
      pools: [],
      gamesCreated: false,
      gamesCurrent: false,
      hasResult: false,
    });
    expect(pools.unassigned.map((team) => team.name)).toHaveLength(7);
  });

  test('lists each pool’s teams in seed order with their seeds, and the games of each pool', async () => {
    const { s } = await world(12);
    await split(s, 3);
    await createGames(s);
    const pools = (await view(s))!;
    expect(pools.pools.map((pool) => pool.pool)).toEqual(['A', 'B', 'C']);
    expect(pools.pools[0].teams.map((team) => [team.name, team.seed])).toEqual([
      ['Team 01', 1],
      ['Team 06', 6],
      ['Team 07', 7],
      ['Team 12', 12],
    ]);
    expect(pools.pools[0].games).toHaveLength(6);
    expect(pools.pools[0].games[0]).toMatchObject({
      round: 1,
      slot: 1,
      teams: [{ name: 'Team 01' }, { name: 'Team 12' }],
    });
    expect(pools.unassigned).toEqual([]);
    expect(pools).toMatchObject({ gamesCreated: true, gamesCurrent: true, hasResult: false });
  });

  test('says the games are out of date after a team moves', async () => {
    const { s, teamIds } = await world(12);
    await split(s, 3);
    await createGames(s);
    await move(s, teamIds[0], 'B');
    expect(await view(s)).toMatchObject({ gamesCreated: true, gamesCurrent: false });
    await createGames(s, true);
    expect(await view(s)).toMatchObject({ gamesCreated: true, gamesCurrent: true });
  });

  test('lists a team that reached the minimum roster after the split as unassigned', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await addTeam(s, 'Late Arrival');
    expect((await view(s))!.unassigned.map((team) => team.name)).toEqual(['Late Arrival']);
  });

  test('says when a pool result is entered', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await createGames(s);
    await enterPoolResult(s);
    expect((await view(s))!.hasResult).toBe(true);
  });

  test('is null for a web address that is not a tournament, for staff', async () => {
    const { s } = await world(6);
    expect(await view(s, s.admin, { ...TOURNAMENT_SLUGS, tournamentSlug: 'unknown' })).toBeNull();
    expect(
      await view(s, s.stranger, { ...TOURNAMENT_SLUGS, tournamentSlug: 'unknown' }).catch(
        refusalOf,
      ),
    ).toEqual({ code: FORBIDDEN_CODE });
  });
});

describe('tournamentGames.undoSplitPools', () => {
  test('a first split returns every team’s earlier pool as none, and Undo takes the pools away', async () => {
    const { s } = await world(6);
    const { undo } = await split(s, 2);
    expect(undo.earlier).toHaveLength(6);
    expect(undo.earlier.every((change) => change.pool === null)).toBe(true);
    expect(undo.written.map((change) => change.pool).sort()).toEqual([
      'A',
      'A',
      'A',
      'B',
      'B',
      'B',
    ]);
    await undoSplit(s, undo);
    expect((await teamRows(s)).every((team) => team.pool === undefined)).toBe(true);
  });

  test('a split again returns the pools it replaced, with the moves, and Undo brings them back', async () => {
    const { s, teamIds } = await world(12);
    await split(s, 3);
    await move(s, teamIds[0], 'B');
    const before = await poolOf(s);
    const { undo } = await split(s, 2);
    expect(await poolOf(s)).not.toEqual(before);
    expect(
      undo.earlier.every(
        (change) =>
          before[`Team ${String(teamIds.indexOf(change.teamId) + 1).padStart(2, '0')}`] ===
          change.pool,
      ),
    ).toBe(true);
    await undoSplit(s, undo);
    expect(await poolOf(s)).toEqual(before);
  });

  test('lists only the teams whose pool changed', async () => {
    const { s } = await world(6);
    await split(s, 2);
    const { undo } = await split(s, 2);
    expect(undo.earlier).toEqual([]);
    expect(undo.written).toEqual([]);
  });

  test('leaves a team below the minimum roster size out of every pool, as the split did', async () => {
    const { s } = await world(6);
    const short = await addTeam(s, 'Short Handed');
    await split(s, 2);
    await s.t.run((ctx) => ctx.db.patch('teams', short, { rosterCount: 1 }));
    const { undo } = await split(s, 2);
    await undoSplit(s, undo);
    expect((await s.t.run((ctx) => ctx.db.get('teams', short)))!.pool).toBeUndefined();
    expect(await namesIn(s, 'A')).toHaveLength(3);
  });

  test('is refused once a team moved since, and the pools stay', async () => {
    const { s, teamIds } = await world(8);
    const { undo } = await split(s, 2);
    await move(s, teamIds[0], 'B');
    expect(await undoSplit(s, undo).catch(refusalOf)).toEqual({
      code: 'poolsChanged',
      message: POOL_MESSAGES.poolsChanged,
    });
    expect((await poolOf(s))['Team 01']).toBe('B');
  });

  test('is refused once the pool games were created or recreated since', async () => {
    const { s } = await world(8);
    const { undo } = await split(s, 2);
    await createGames(s);
    expect(await undoSplit(s, undo).catch(refusalOf)).toMatchObject({ code: 'poolsChanged' });
    const second = await split(s, 2);
    await createGames(s, true);
    expect(await undoSplit(s, second.undo).catch(refusalOf)).toMatchObject({
      code: 'poolsChanged',
    });
  });

  test('is refused once a pool result is entered', async () => {
    const { s } = await world(8);
    await split(s, 2);
    await createGames(s);
    const { undo } = await split(s, 2);
    await enterPoolResult(s);
    expect(await undoSplit(s, undo).catch(refusalOf)).toEqual({
      code: 'poolResultEntered',
      message: POOL_MESSAGES.poolResultEntered,
    });
  });

  describe('a forged payload', () => {
    async function splitWorld(teamCount = 6) {
      const { s, teamIds } = await world(teamCount);
      const { undo } = await split(s, 2);
      const elsewhere = await addTeam(s, 'Elsewhere', { tournamentId: s.second });
      return { s, teamIds, undo, elsewhere };
    }

    const poolOfTeam = (s: TournamentWorld, teamId: Id<'teams'>) =>
      s.t.run(async (ctx) => (await ctx.db.get('teams', teamId))!.pool ?? null);

    const currentPools = async (s: TournamentWorld, teamIds: readonly Id<'teams'>[]) =>
      Promise.all(teamIds.map(async (teamId) => ({ teamId, pool: await poolOfTeam(s, teamId) })));

    test('is refused for a team of another tournament in both lists', async () => {
      const { s, undo, elsewhere } = await splitWorld();
      const forged = {
        ...undo,
        earlier: [{ teamId: elsewhere, pool: null }],
        written: [{ teamId: elsewhere, pool: null }],
      };
      await expect(undoSplit(s, forged)).rejects.toThrow(/Not allowed/);
    });

    test('is refused when a team of another tournament hides behind a repeated id of the caller’s own', async () => {
      const { s, teamIds, elsewhere } = await splitWorld();
      const own = { teamId: teamIds[0], pool: 'A' as const };
      const forged = {
        earlier: [own, { teamId: elsewhere, pool: 'H' as const }],
        written: [own, own],
        gameIds: [],
      };
      await expect(undoSplit(s, forged)).rejects.toThrow(/Not allowed/);
      expect(await poolOfTeam(s, elsewhere)).toBeNull();
    });

    test('is refused when the earlier list repeats an id', async () => {
      const { s, teamIds } = await splitWorld();
      const [first, second] = await currentPools(s, teamIds);
      const forged = {
        earlier: [first, first],
        written: [first, second],
        gameIds: [],
      };
      await expect(undoSplit(s, forged)).rejects.toThrow(/Not allowed/);
    });

    test('is refused when the lists hold different teams of this tournament', async () => {
      const { s, teamIds } = await splitWorld();
      const [first, second, third] = await currentPools(s, teamIds);
      const forged = {
        earlier: [
          { ...first, pool: null },
          { ...third, pool: null },
        ],
        written: [first, second],
        gameIds: [],
      };
      await expect(undoSplit(s, forged)).rejects.toThrow(/Not allowed/);
      expect(await poolOfTeam(s, teamIds[2])).not.toBeNull();
    });

    test('is refused when the lists differ in length', async () => {
      const { s, teamIds } = await splitWorld();
      const [first, second] = await currentPools(s, teamIds);
      const forged = {
        earlier: [{ ...first, pool: null }],
        written: [first, second],
        gameIds: [],
      };
      await expect(undoSplit(s, forged)).rejects.toThrow(/Not allowed/);
    });

    test('is refused when the pools it would restore leave a pool of 1', async () => {
      const { s, teamIds } = await splitWorld();
      const written = await currentPools(s, teamIds);
      const earlier = written.map((change, index) => ({
        ...change,
        pool: index === 0 ? ('B' as const) : ('A' as const),
      }));
      expect(await undoSplit(s, { earlier, written, gameIds: [] }).catch(refusalOf)).toEqual({
        code: 'poolSize',
        message: 'Pool B would have 1 team. Each pool needs 3 to 8 teams.',
      });
      expect(await currentPools(s, teamIds)).toEqual(written);
    });

    test('is refused when the pools it would restore hold 9 teams', async () => {
      const { s, teamIds } = await splitWorld(12);
      const written = await currentPools(s, teamIds);
      const earlier = written.map((change, index) => ({
        ...change,
        pool: index < 9 ? ('A' as const) : ('B' as const),
      }));
      expect(await undoSplit(s, { earlier, written, gameIds: [] }).catch(refusalOf)).toMatchObject({
        code: 'poolSize',
        message: 'Pool A would have 9 teams. Each pool needs 3 to 8 teams.',
      });
      expect(await currentPools(s, teamIds)).toEqual(written);
    });

    test('is refused when the pools it would restore skip a letter', async () => {
      const { s, teamIds } = await splitWorld();
      const written = await currentPools(s, teamIds);
      const earlier = written.map((change) => ({
        ...change,
        pool: change.pool === 'B' ? ('H' as const) : change.pool,
      }));
      expect(await undoSplit(s, { earlier, written, gameIds: [] }).catch(refusalOf)).toMatchObject({
        code: 'poolsChanged',
      });
      expect(await currentPools(s, teamIds)).toEqual(written);
    });

    test('still restores a state with no pools at all', async () => {
      const { s, teamIds } = await splitWorld();
      const written = await currentPools(s, teamIds);
      const earlier = written.map((change) => ({ ...change, pool: null }));
      await undoSplit(s, { earlier, written, gameIds: [] });
      expect(await currentPools(s, teamIds)).toEqual(earlier);
    });
  });

  test.each(['stranger', 'foreignAdmin', 'otherOrganizer', 'leagueOrganizer'] as const)(
    '%s is refused',
    async (who) => {
      const { s } = await world(6);
      const { undo } = await split(s, 2);
      await expect(undoSplit(s, undo, s[who])).rejects.toThrow(/Not allowed/);
    },
  );

  test('a signed-out caller is refused', async () => {
    const { s } = await world(6);
    const { undo } = await split(s, 2);
    await expect(
      s.t.mutation(api.tournamentGames.undoSplitPools, { tournamentId: s.gulf, ...undo }),
    ).rejects.toThrow(/Sign in required/);
  });

  test('an organizer assigned to the tournament may undo', async () => {
    const { s } = await world(6);
    const { undo } = await split(s, 2, s.assignedOrganizer);
    await undoSplit(s, undo, s.assignedOrganizer);
    expect((await teamRows(s)).every((team) => team.pool === undefined)).toBe(true);
  });
});

describe('the seeds of a Pools tournament', () => {
  test('getPools lists the confirmed teams in seed order', async () => {
    const { s } = await world(6);
    await addTeam(s, 'Short Handed', { rosterCount: 1 });
    expect((await view(s))!.seeds.map((team) => [team.name, team.seed])).toEqual(
      [1, 2, 3, 4, 5, 6].map((seed) => [`Team 0${seed}`, seed]),
    );
  });

  test('a moved seed changes the order, and the split that follows', async () => {
    const { s, teamIds } = await world(12);
    expect(await moveSeed(s, teamIds[1], 'up')).toEqual({ seed: 1, seedCount: 12 });
    expect((await view(s))!.seeds.slice(0, 2).map((team) => team.name)).toEqual([
      'Team 02',
      'Team 01',
    ]);
    await split(s, 3);
    expect(await namesIn(s, 'A')).toEqual(['Team 02', 'Team 06', 'Team 07', 'Team 12']);
  });

  test('is refused once a pool result is entered', async () => {
    const { s, teamIds } = await world(6);
    await split(s, 2);
    await createGames(s);
    await enterPoolResult(s);
    expect(await moveSeed(s, teamIds[1], 'up').catch(refusalOf)).toMatchObject({
      code: 'seedsLocked',
    });
  });
});

describe('access to the pool functions', () => {
  const NOT_ALLOWED = ['stranger', 'foreignAdmin', 'otherOrganizer', 'leagueOrganizer'] as const;

  test.each(NOT_ALLOWED)('%s is refused by every function', async (who) => {
    const { s, teamIds } = await world(6);
    await split(s, 2);
    await createGames(s);
    expect(await view(s, s[who]).catch(refusalOf)).toEqual({ code: FORBIDDEN_CODE });
    await expect(split(s, 2, s[who])).rejects.toThrow(/Not allowed/);
    await expect(move(s, teamIds[0], 'B', s[who])).rejects.toThrow(/Not allowed/);
    await expect(createGames(s, true, s[who])).rejects.toThrow(/Not allowed/);
  });

  test('a signed-out caller is refused by every function', async () => {
    const { s, teamIds } = await world(6);
    expect(
      await s.t.query(api.tournamentGames.getPools, TOURNAMENT_SLUGS).catch(refusalOf),
    ).toEqual({ code: FORBIDDEN_CODE });
    await expect(
      s.t.mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 }),
    ).rejects.toThrow(/Sign in required/);
    await expect(
      s.t.mutation(api.tournamentGames.movePoolTeam, {
        tournamentId: s.gulf,
        teamId: teamIds[0],
        pool: 'B',
      }),
    ).rejects.toThrow(/Sign in required/);
    await expect(
      s.t.mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf }),
    ).rejects.toThrow(/Sign in required/);
  });

  test.each(['admin', 'assignedOrganizer'] as const)(
    '%s may split, move, and create',
    async (who) => {
      const { s, teamIds } = await world(8);
      await split(s, 2, s[who]);
      await move(s, teamIds[0], 'B', s[who]);
      await createGames(s, undefined, s[who]);
      expect((await view(s, s[who]))!.gamesCreated).toBe(true);
    },
  );
});

describe('the structure', () => {
  const HELD = {
    startDate: '2030-06-01',
    endDate: '2030-06-02',
    registrationDeadline: '2030-05-20',
    maximumTeams: 4,
    setsPerGame: 1,
  } as const;

  const save = (
    s: TournamentWorld,
    structure: 'bracket' | 'pools' | undefined,
    expectedStructure: 'bracket' | 'pools' | undefined = 'bracket',
  ) =>
    s.as(s.admin).mutation(api.tournaments.updateDetails, {
      tournamentId: s.gulf,
      startDate: HELD.startDate,
      endDate: HELD.endDate,
      registrationDeadline: HELD.registrationDeadline,
      maximumTeams: HELD.maximumTeams,
      ...(structure !== undefined && { structure }),
      expected: {
        ...HELD,
        ...(expectedStructure !== undefined && { structure: expectedStructure }),
      },
    });

  const stored = (s: TournamentWorld) =>
    s.t.run(async (ctx) => (await ctx.db.get('tournaments', s.gulf))!.structure);

  async function bracketWorld() {
    vi.useFakeTimers({ now: AFTER_DEADLINE });
    const s = await tournamentWorld();
    return s;
  }

  test('changes to Pools, then bracket, and the save returns both structures for Undo', async () => {
    const s = await bracketWorld();
    const saved = await save(s, 'pools');
    expect(saved.earlier.structure).toBe('bracket');
    expect(saved.written.structure).toBe('pools');
    expect(await stored(s)).toBe('pools');
  });

  test('keeps the structure when the save sends none, as the previous release’s form does', async () => {
    const s = await bracketWorld();
    await save(s, 'pools');
    await s.as(s.admin).mutation(api.tournaments.updateDetails, {
      tournamentId: s.gulf,
      startDate: HELD.startDate,
      endDate: HELD.endDate,
      registrationDeadline: HELD.registrationDeadline,
      maximumTeams: 3,
      expected: HELD,
    });
    expect(await stored(s)).toBe('pools');
  });

  test('undoes a structure change', async () => {
    const s = await bracketWorld();
    const { earlier, written } = await save(s, 'pools');
    await s
      .as(s.admin)
      .mutation(api.tournaments.undoUpdateDetails, { tournamentId: s.gulf, earlier, written });
    expect(await stored(s)).toBe('bracket');
  });

  test('is refused once pool games exist, with the reason under the field', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await createGames(s);
    expect(await save(s, 'bracket', 'pools').catch(refusalOf)).toEqual({
      code: 'structureLocked',
      message: POOL_MESSAGES.structureLocked,
      field: 'structure',
    });
    expect(await stored(s)).toBe('pools');
  });

  test('is refused once a bracket exists', async () => {
    const s = await bracketWorld();
    await s.t.run((ctx) =>
      ctx.db.insert('tournamentGames', {
        tournamentId: s.gulf,
        stage: 'bracket',
        round: 1,
        slot: 1,
        teamIds: [null, null],
      }),
    );
    expect(await save(s, 'pools').catch(refusalOf)).toMatchObject({
      code: 'structureLocked',
      field: 'structure',
    });
    expect(await stored(s)).toBe('bracket');
  });

  test('saves the other details while games exist, when the structure is the same', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await createGames(s);
    const saved = await save(s, 'pools', 'pools');
    expect(saved.written.structure).toBe('pools');
  });

  test('refuses an Undo that would change the structure once games exist', async () => {
    const s = await bracketWorld();
    const { earlier, written } = await save(s, 'pools');
    await s.t.run((ctx) =>
      ctx.db.insert('tournamentGames', {
        tournamentId: s.gulf,
        stage: 'pool',
        pool: 'A',
        round: 1,
        slot: 1,
        teamIds: [null, null],
      }),
    );
    expect(
      await s
        .as(s.admin)
        .mutation(api.tournaments.undoUpdateDetails, { tournamentId: s.gulf, earlier, written })
        .catch(refusalOf),
    ).toMatchObject({ code: 'structureLocked' });
    expect(await stored(s)).toBe('pools');
  });

  test('a form loaded with a different structure is refused as out of date', async () => {
    const s = await bracketWorld();
    await save(s, 'pools');
    expect(await save(s, 'bracket', 'bracket').catch(refusalOf)).toMatchObject({
      code: 'changedSince',
    });
  });

  test('locks Sets per game once pool games exist, with the pool wording', async () => {
    const { s } = await world(6);
    await split(s, 2);
    await createGames(s);
    expect(
      await s
        .as(s.admin)
        .mutation(api.tournaments.updateDetails, {
          tournamentId: s.gulf,
          startDate: HELD.startDate,
          endDate: HELD.endDate,
          registrationDeadline: HELD.registrationDeadline,
          maximumTeams: HELD.maximumTeams,
          setsPerGame: 3,
          structure: 'pools',
          expected: { ...HELD, structure: 'pools' },
        })
        .catch(refusalOf),
    ).toEqual({
      code: 'setsPerGameLocked',
      message: POOL_MESSAGES.setsPerGameLocked,
      field: 'setsPerGame',
    });
  });

  test('getForManagement returns the structure and whether pool games exist', async () => {
    const { s } = await world(6);
    const read = () => s.as(s.admin).query(api.tournaments.getForManagement, TOURNAMENT_SLUGS);
    expect(await read()).toMatchObject({
      structure: 'pools',
      poolGamesCreated: false,
      bracketCreated: false,
    });
    await split(s, 2);
    await createGames(s);
    expect(await read()).toMatchObject({
      structure: 'pools',
      poolGamesCreated: true,
      bracketCreated: false,
    });
  });

  test('getForCopy answers for a Pools, then bracket tournament', async () => {
    const { s } = await world(6);
    expect(
      await s.as(s.admin).query(api.tournaments.getForCopy, {
        organizationSlug: TOURNAMENT_SLUGS.orgSlug,
        slug: TOURNAMENT_SLUGS.tournamentSlug,
      }),
    ).toMatchObject({ structure: 'pools', bracketType: 'single' });
  });

  test('the bracket is not created for a tournament that plays pools first', async () => {
    const { s } = await world(6);
    expect(
      await s
        .as(s.admin)
        .mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf })
        .catch(refusalOf),
    ).toEqual({ code: 'poolsFirst', message: POOL_MESSAGES.poolsFirst });
    expect(await s.t.run((ctx) => ctx.db.query('tournamentGames').collect())).toEqual([]);
  });
});

describe('pool games and the readers of bracket games', () => {
  async function withPoolGame() {
    const { s, teamIds } = await world(6);
    await split(s, 2);
    await createGames(s);
    const game = (await poolGames(s))[0];
    return { s, teamIds, game };
  }

  test('the public page shows no bracket for a tournament that has only pool games', async () => {
    const { s } = await withPoolGame();
    const page = await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS);
    expect(page).not.toBeNull();
    expect(page!.bracket).toBeUndefined();
  });

  test('the bracket setup shows no bracket for a tournament that has only pool games', async () => {
    const { s } = await withPoolGame();
    expect(
      (await s.as(s.admin).query(api.tournamentGames.getSetup, TOURNAMENT_SLUGS))!.bracket,
    ).toBeNull();
  });
});

describe('every team count and pool count', () => {
  test.each([4, 5])('%s confirmed teams offer no split and no games', async (count) => {
    const { s } = await world(count);
    for (const poolCount of [2, 3, 4]) {
      expect(await split(s, poolCount).catch(refusalOf)).toMatchObject({ code: 'teamLimits' });
    }
    expect(await createGames(s).catch(refusalOf)).toMatchObject({ code: 'notSplit' });
    expect(await poolGames(s)).toEqual([]);
  });

  test.each(Array.from({ length: 11 }, (_, index) => index + 6))(
    '%s teams split in snake order and play a full round robin in each pool',
    async (count) => {
      const { s } = await world(count);
      const offered = poolCountsFor(count);
      expect(offered.length).toBeGreaterThan(0);
      for (const poolCount of offered) {
        await split(s, poolCount);
        const expected = snakeSplit(count, poolCount);
        for (const [index, seeds] of expected.entries()) {
          expect(await namesIn(s, poolNameAt(index))).toEqual(
            seeds.map((seed) => `Team ${String(seed).padStart(2, '0')}`),
          );
          expect(seeds.length).toBeGreaterThanOrEqual(3);
          expect(seeds.length).toBeLessThanOrEqual(8);
        }
        const gameCount = expected.reduce(
          (total, seeds) => total + (seeds.length * (seeds.length - 1)) / 2,
          0,
        );
        expect(await createGames(s, true)).toMatchObject({ gameCount });
        const rows = await poolGames(s);
        expect(rows).toHaveLength(gameCount);
        for (const [index, seeds] of expected.entries()) {
          const inPool = rows.filter((game) => game.pool === poolNameAt(index));
          expect(inPool).toHaveLength((seeds.length * (seeds.length - 1)) / 2);
          expect(new Set(inPool.map((game) => [...game.teamIds].sort().join('|'))).size).toBe(
            inPool.length,
          );
        }
      }
    },
  );

  test('a pool count that leaves a pool outside 3 to 8 teams is refused for every team count', async () => {
    for (let count = 6; count <= 16; count++) {
      const { s } = await world(count);
      const offered = poolCountsFor(count);
      for (let poolCount = 2; poolCount <= 8; poolCount++) {
        if (offered.includes(poolCount)) continue;
        expect(await split(s, poolCount).catch(refusalOf)).toMatchObject({ code: 'poolSize' });
      }
      expect((await teamRows(s)).every((team) => team.pool === undefined)).toBe(true);
    }
  });
});

describe('Undo with lists the page never sent', () => {
  async function splitState(teamCount = 8) {
    const { s, teamIds } = await world(teamCount);
    const { undo } = await split(s, 2);
    const before = await poolOf(s);
    const elsewhere = await addTeam(s, 'Elsewhere', { tournamentId: s.second });
    return { s, teamIds, undo, before, elsewhere };
  }

  const changeOf = (
    undo: { written: { teamId: Id<'teams'>; pool: Pool | null }[] },
    index: number,
  ) => undo.written[index];

  test('an id repeated in the written list is refused and moves nothing', async () => {
    const { s, undo, before } = await splitState();
    const own = changeOf(undo, 0);
    const forged = {
      earlier: [
        { ...own, pool: null },
        { ...own, pool: null },
      ],
      written: [own, own],
      gameIds: undo.gameIds,
    };
    await expect(undoSplit(s, forged)).rejects.toThrow(/Not allowed/);
    expect(await poolOf(s)).toEqual(before);
  });

  test('a team of another tournament next to the caller’s own teams is refused and moves nothing', async () => {
    const { s, undo, before, elsewhere } = await splitState();
    const forged = {
      earlier: [...undo.earlier, { teamId: elsewhere, pool: 'B' as const }],
      written: [...undo.written, { teamId: elsewhere, pool: null }],
      gameIds: undo.gameIds,
    };
    await expect(undoSplit(s, forged)).rejects.toThrow(/Not allowed/);
    expect(await poolOf(s)).toEqual(before);
    expect(await s.t.run((ctx) => ctx.db.get('teams', elsewhere))).toMatchObject({
      name: 'Elsewhere',
    });
    expect((await s.t.run((ctx) => ctx.db.get('teams', elsewhere)))!.pool).toBeUndefined();
  });

  test('an oversized pool is refused with the limits and moves nothing', async () => {
    const { s, undo, before } = await splitState(12);
    const forged = {
      earlier: undo.written.map((change, index) => ({
        ...change,
        pool: index < 9 ? ('A' as const) : ('B' as const),
      })),
      written: undo.written,
      gameIds: undo.gameIds,
    };
    expect(await undoSplit(s, forged).catch(refusalOf)).toMatchObject({ code: 'poolSize' });
    expect(await poolOf(s)).toEqual(before);
  });

  test('a pool of 2 is refused with the limits and moves nothing', async () => {
    const { s, undo, before } = await splitState(8);
    const forged = {
      earlier: undo.written.map((change, index) => ({
        ...change,
        pool: index < 2 ? ('B' as const) : ('A' as const),
      })),
      written: undo.written,
      gameIds: undo.gameIds,
    };
    expect(await undoSplit(s, forged).catch(refusalOf)).toMatchObject({ code: 'poolSize' });
    expect(await poolOf(s)).toEqual(before);
  });

  test('a list of game ids that is not the tournament’s pool games is refused', async () => {
    const { s, undo, before } = await splitState();
    await createGames(s);
    expect(await undoSplit(s, { ...undo, gameIds: [] }).catch(refusalOf)).toMatchObject({
      code: 'poolsChanged',
    });
    expect(await poolOf(s)).toEqual(before);
  });

  test('a team below the minimum roster size cannot be put in a pool', async () => {
    const { s, undo } = await splitState();
    const short = await addTeam(s, 'Short Handed', { rosterCount: 1 });
    const forged = {
      earlier: [...undo.earlier, { teamId: short, pool: 'A' as const }],
      written: [...undo.written, { teamId: short, pool: null }],
      gameIds: undo.gameIds,
    };
    await undoSplit(s, forged).catch(() => undefined);
    expect((await s.t.run((ctx) => ctx.db.get('teams', short)))!.pool).toBeUndefined();
  });
});
