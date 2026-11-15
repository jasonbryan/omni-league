/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { POOL_MESSAGES } from './lib/pools';
import { SCORE_MESSAGES, type Score, type Sport } from './lib/sports';
import {
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

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

const ONE_SET: Score = { kind: 'sets', sets: [{ a: 21, b: 15 }] };
const goals = (a: number, b: number): Score => ({ kind: 'goals', a, b });
const runs = (a: number, b: number): Score => ({ kind: 'runs', a, b });

let registeredAt = 1_000;

/** Six teams in 2 pools of 3, with their games: Pool A holds Team 01, Team 04, and Team 05. */
async function world(sport: Sport = 'beachVolleyball', setsPerGame?: 1 | 3) {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  await s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', s.gulf))!;
    await ctx.db.patch('tournaments', s.gulf, { structure: 'pools', sport, setsPerGame });
    await ctx.db.patch('programs', tournament.programId, { sport });
  });
  const teamIds: Id<'teams'>[] = [];
  for (let number = 1; number <= 6; number++) {
    registeredAt += 1;
    teamIds.push(
      await s.t.run(async (ctx) => {
        const tournament = (await ctx.db.get('tournaments', s.gulf))!;
        return ctx.db.insert('teams', {
          organizationId: tournament.organizationId,
          tournamentId: s.gulf,
          name: `Team ${String(number).padStart(2, '0')}`,
          sortName: `team ${number}`,
          captainUserId: s.captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        });
      }),
    );
  }
  await s
    .as(s.admin)
    .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 });
  await s.as(s.admin).mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf });
  return { s, teamIds };
}

const poolGames = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'pool'))
      .collect(),
  );

async function gameOf(
  s: TournamentWorld,
  teamIds: readonly Id<'teams'>[],
  first: number,
  second: number,
): Promise<Doc<'tournamentGames'>> {
  const wanted = [teamIds[first - 1], teamIds[second - 1]];
  const found = (await poolGames(s)).find((game) =>
    wanted.every((teamId) => game.teamIds.includes(teamId)),
  )!;
  return found;
}

const enter = (
  s: TournamentWorld,
  game: Doc<'tournamentGames'>,
  result: { score?: Score; forfeitTeamId?: Id<'teams'> },
  who: Pick<Person, 'authUserId' | 'name'> = s.admin,
) => s.as(who).mutation(api.tournamentGames.enterResult, { gameId: game._id, ...result });

const correct = (
  s: TournamentWorld,
  game: Doc<'tournamentGames'>,
  result: { score?: Score; forfeitTeamId?: Id<'teams'> },
) => s.as(s.admin).mutation(api.tournamentGames.correctResult, { gameId: game._id, ...result });

const undo = (
  s: TournamentWorld,
  game: Doc<'tournamentGames'>,
  options: { restore?: { score: Score; forfeitTeamId?: Id<'teams'> }; expected?: number } = {},
) => s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId: game._id, ...options });

const stored = async (s: TournamentWorld, game: Doc<'tournamentGames'>) =>
  (await s.t.run((ctx) => ctx.db.get('tournamentGames', game._id)))!;

const view = (s: TournamentWorld) =>
  s.as(s.admin).query(api.tournamentGames.getPools, TOURNAMENT_SLUGS);

describe('tournamentGames.enterResult for a pool game', () => {
  test('saves the score and the winner, and the answer names no round the winner joins', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    const saved = await enter(s, game, { score: ONE_SET });
    expect(saved).toMatchObject({
      winnerTeamId: game.teamIds[0],
      advancesTo: null,
      previous: null,
    });
    expect(await stored(s, game)).toMatchObject({
      winnerTeamId: game.teamIds[0],
      score: ONE_SET,
      resultEnteredBy: s.admin.userId,
      resultEnteredAt: saved.resultEnteredAt,
    });
  });

  test('shows the result with the game, and the pools can no longer change', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    const saved = await enter(s, game, { score: ONE_SET });
    const pools = (await view(s))!;
    expect(pools.hasResult).toBe(true);
    const shown = pools.pools.flatMap((pool) => pool.games).find((row) => row.gameId === game._id);
    expect(shown?.result).toEqual({
      score: ONE_SET,
      forfeitTeamId: null,
      resultEnteredAt: saved.resultEnteredAt,
    });
    const others = pools.pools
      .flatMap((pool) => pool.games)
      .filter((row) => row.gameId !== game._id);
    expect(others.every((row) => row.result === null)).toBe(true);
    await expect(
      s
        .as(s.admin)
        .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 }),
    ).rejects.toMatchObject({
      data: { code: 'poolResultEntered', message: POOL_MESSAGES.poolResultEntered },
    });
  });

  test('refuses a second entry for a game that has a result, and a correction for one that has none', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    expect(await correct(s, game, { score: ONE_SET }).catch(refusalOf)).toMatchObject({
      code: 'noResult',
    });
    await enter(s, game, { score: ONE_SET });
    expect(await enter(s, game, { score: ONE_SET }).catch(refusalOf)).toMatchObject({
      code: 'resultExists',
    });
  });

  test('a forfeit gives the other team the sport’s forfeit score and keeps who forfeited', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    const saved = await enter(s, game, { forfeitTeamId: game.teamIds[0]! });
    expect(saved.winnerTeamId).toBe(game.teamIds[1]);
    expect(await stored(s, game)).toMatchObject({
      winnerTeamId: game.teamIds[1],
      forfeitTeamId: game.teamIds[0],
      score: { kind: 'sets', sets: [{ a: 0, b: 21 }] },
    });
  });

  test('refuses a forfeit by a team that is not in the game', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    await expect(enter(s, game, { forfeitTeamId: teamIds[1] })).rejects.toThrow(/Not allowed/);
    expect((await stored(s, game)).winnerTeamId).toBeUndefined();
  });
});

describe('a tied pool game', () => {
  test.each([
    ['soccer', goals(2, 2)],
    ['softball', runs(5, 5)],
  ] as const)('is accepted in %s, with no winner and the pools locked', async (sport, score) => {
    const { s, teamIds } = await world(sport);
    const game = await gameOf(s, teamIds, 1, 4);
    const saved = await enter(s, game, { score });
    expect(saved).toMatchObject({ winnerTeamId: null, winnerName: null, advancesTo: null });
    const row = await stored(s, game);
    expect(row.winnerTeamId).toBeUndefined();
    expect(row.score).toEqual(score);
    const pools = (await view(s))!;
    expect(pools.hasResult).toBe(true);
    const shown = pools.pools
      .flatMap((pool) => pool.games)
      .find((entry) => entry.gameId === game._id);
    expect(shown).toMatchObject({ winnerTeamId: null, result: { score } });
    await expect(
      s.as(s.admin).mutation(api.tournamentGames.createPoolGames, {
        tournamentId: s.gulf,
        replace: true,
      }),
    ).rejects.toMatchObject({ data: { code: 'poolResultEntered' } });
  });

  test('is refused in beach volleyball with the reason, and nothing is stored', async () => {
    const { s, teamIds } = await world('beachVolleyball');
    const game = await gameOf(s, teamIds, 1, 4);
    const tiedSet: Score = { kind: 'sets', sets: [{ a: 21, b: 21 }] };
    expect(await enter(s, game, { score: tiedSet }).catch(refusalOf)).toMatchObject({
      code: 'invalidScore',
      field: 'set1',
      message: SCORE_MESSAGES.setTied(1),
    });
    expect((await stored(s, game)).score).toBeUndefined();
  });

  test('is refused in best of 3 beach volleyball when the sets are level', async () => {
    const { s, teamIds } = await world('beachVolleyball', 3);
    const game = await gameOf(s, teamIds, 1, 4);
    const level: Score = {
      kind: 'sets',
      sets: [
        { a: 21, b: 15 },
        { a: 15, b: 21 },
      ],
    };
    expect(await enter(s, game, { score: level }).catch(refusalOf)).toMatchObject({
      code: 'invalidScore',
      message: SCORE_MESSAGES.setMissing(3),
    });
  });

  test('is still refused for a bracket game of soccer', async () => {
    vi.useFakeTimers({ now: AFTER_DEADLINE });
    const s = await tournamentWorld();
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', s.gulf))!;
      await ctx.db.patch('tournaments', s.gulf, { sport: 'soccer' });
      await ctx.db.patch('programs', tournament.programId, { sport: 'soccer' });
    });
    for (const name of ['Alpha', 'Bravo']) {
      registeredAt += 1;
      await s.t.run(async (ctx) => {
        const tournament = (await ctx.db.get('tournaments', s.gulf))!;
        return ctx.db.insert('teams', {
          organizationId: tournament.organizationId,
          tournamentId: s.gulf,
          name,
          sortName: name.toLowerCase(),
          captainUserId: s.captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        });
      });
    }
    await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
    const final = (
      await s.t.run((ctx) =>
        ctx.db
          .query('tournamentGames')
          .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'bracket'))
          .collect(),
      )
    )[0];
    expect(await enter(s, final, { score: goals(1, 1) }).catch(refusalOf)).toMatchObject({
      code: 'invalidScore',
      message: SCORE_MESSAGES.tied,
    });
  });
});

describe('correcting, clearing, and undoing a pool result', () => {
  test('a correction turns a tie into a win, and the answer holds the tie as the earlier result', async () => {
    const { s, teamIds } = await world('soccer');
    const game = await gameOf(s, teamIds, 1, 4);
    await enter(s, game, { score: goals(1, 1) });
    const corrected = await correct(s, game, { score: goals(3, 1) });
    expect(corrected).toMatchObject({
      winnerTeamId: game.teamIds[0],
      previous: { score: goals(1, 1) },
    });
    expect(await stored(s, game)).toMatchObject({
      winnerTeamId: game.teamIds[0],
      score: goals(3, 1),
    });
  });

  test('a correction turns a win into a tie, which leaves no winner', async () => {
    const { s, teamIds } = await world('softball');
    const game = await gameOf(s, teamIds, 1, 4);
    await enter(s, game, { score: runs(4, 2) });
    expect(await correct(s, game, { score: runs(3, 3) })).toMatchObject({
      winnerTeamId: null,
      winnerName: null,
    });
    expect((await stored(s, game)).winnerTeamId).toBeUndefined();
  });

  test('clearing a tied result empties the game, and undoing the clear enters the tie again', async () => {
    const { s, teamIds } = await world('soccer');
    const game = await gameOf(s, teamIds, 1, 4);
    const saved = await enter(s, game, { score: goals(0, 0) });
    await undo(s, game, { expected: saved.resultEnteredAt });
    const cleared = await stored(s, game);
    expect(cleared.score).toBeUndefined();
    expect(cleared.winnerTeamId).toBeUndefined();
    expect((await view(s))!.hasResult).toBe(false);
    await enter(s, game, { score: goals(0, 0) });
    expect((await stored(s, game)).score).toEqual(goals(0, 0));
  });

  test('an undo that restores a tie stores the tie', async () => {
    const { s, teamIds } = await world('soccer');
    const game = await gameOf(s, teamIds, 1, 4);
    await enter(s, game, { score: goals(2, 2) });
    const corrected = await correct(s, game, { score: goals(3, 1) });
    await undo(s, game, {
      expected: corrected.resultEnteredAt,
      restore: corrected.previous!,
    });
    const restored = await stored(s, game);
    expect(restored.score).toEqual(goals(2, 2));
    expect(restored.winnerTeamId).toBeUndefined();
  });

  test('an undo that restores a tie is refused for beach volleyball', async () => {
    const { s, teamIds } = await world('beachVolleyball');
    const game = await gameOf(s, teamIds, 1, 4);
    const saved = await enter(s, game, { score: ONE_SET });
    await expect(
      undo(s, game, {
        expected: saved.resultEnteredAt,
        restore: { score: { kind: 'sets', sets: [{ a: 21, b: 21 }] } },
      }),
    ).rejects.toMatchObject({ data: { code: 'invalidScore' } });
    expect((await stored(s, game)).score).toEqual(ONE_SET);
  });

  test('clearing a result that changed since is refused', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    const first = await enter(s, game, { score: ONE_SET });
    await correct(s, game, { score: { kind: 'sets', sets: [{ a: 21, b: 19 }] } });
    expect(await undo(s, game, { expected: first.resultEnteredAt }).catch(refusalOf)).toMatchObject(
      { code: 'resultChanged' },
    );
  });

  test('the last result cleared unlocks the pools again', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    await enter(s, game, { score: ONE_SET });
    await undo(s, game);
    await s.as(s.admin).mutation(api.tournamentGames.splitPools, {
      tournamentId: s.gulf,
      poolCount: 2,
    });
  });
});

describe('access to the pool result functions', () => {
  const REFUSED = ['foreignAdmin', 'otherOrganizer', 'leagueOrganizer', 'stranger'] as const;

  test.each(REFUSED)('%s is refused by every function', async (who) => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    const args = { gameId: game._id, score: ONE_SET };
    await expect(s.as(s[who]).mutation(api.tournamentGames.enterResult, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.as(s[who]).mutation(api.tournamentGames.correctResult, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(
      s.as(s[who]).mutation(api.tournamentGames.undoResult, { gameId: game._id }),
    ).rejects.toThrow(/Not allowed/);
    expect((await stored(s, game)).score).toBeUndefined();
  });

  test('a signed-out caller is refused by every function', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    const args = { gameId: game._id, score: ONE_SET };
    await expect(s.t.mutation(api.tournamentGames.enterResult, args)).rejects.toThrow(
      /Sign in required/,
    );
    await expect(s.t.mutation(api.tournamentGames.correctResult, args)).rejects.toThrow(
      /Sign in required/,
    );
    await expect(
      s.t.mutation(api.tournamentGames.undoResult, { gameId: game._id }),
    ).rejects.toThrow(/Sign in required/);
  });

  test('the organizer assigned to the tournament may enter a result', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    await enter(s, game, { score: ONE_SET }, s.assignedOrganizer);
    expect((await stored(s, game)).score).toEqual(ONE_SET);
  });

  test('an organizer cannot confirm a captain’s report of a pool game', async () => {
    const { s, teamIds } = await world();
    const game = await gameOf(s, teamIds, 1, 4);
    const reportId = await s.t.run((ctx) =>
      ctx.db.insert('scoreReports', {
        gameId: game._id,
        teamId: game.teamIds[0]!,
        reportedByUserId: s.captain.userId,
        score: ONE_SET,
        reportedAt: 5,
      }),
    );
    await expect(
      s.as(s.admin).mutation(api.scoreReports.confirm, { reportId, expected: 5 }),
    ).rejects.toThrow(/Not allowed/);
    expect((await stored(s, game)).score).toBeUndefined();
  });
});
