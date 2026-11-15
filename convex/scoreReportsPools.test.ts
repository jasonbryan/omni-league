/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { BRACKET_MESSAGES } from './lib/bracket';
import { type Score, type Sport } from './lib/sports';
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

const set = (a: number, b: number): Score => ({ kind: 'sets', sets: [{ a, b }] });
const goals = (a: number, b: number): Score => ({ kind: 'goals', a, b });
const runs = (a: number, b: number): Score => ({ kind: 'runs', a, b });

const SCORE_OF: Record<Sport, (a: number, b: number) => Score> = {
  beachVolleyball: set,
  soccer: goals,
  softball: runs,
};

let registeredAt = 1_000;

/**
 * Eight teams in 2 pools of 4. Pool A holds Team 01, Team 04, Team 05, and Team 08; its rounds are
 * 01 v 08 and 04 v 05, then 01 v 05 and 08 v 04, then 01 v 04 and 05 v 08. Each team has its own captain.
 */
async function world(sport: Sport = 'beachVolleyball') {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  await s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', s.gulf))!;
    await ctx.db.patch('tournaments', s.gulf, { structure: 'pools', sport });
    await ctx.db.patch('programs', tournament.programId, { sport });
  });
  const captains: Person[] = [
    s.captain,
    s.rival,
    s.player,
    s.rivalPlayer,
    s.guardian,
    s.stranger,
    s.traveller,
    s.assignedOrganizer,
  ];
  const teamIds: Id<'teams'>[] = [];
  for (const [index, captain] of captains.entries()) {
    registeredAt += 1;
    teamIds.push(
      await s.t.run((ctx) =>
        ctx.db.insert('teams', {
          organizationId: s.a,
          tournamentId: s.gulf,
          name: `Team ${String(index + 1).padStart(2, '0')}`,
          sortName: `team ${index + 1}`,
          captainUserId: captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        }),
      ),
    );
  }
  await s
    .as(s.admin)
    .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 });
  await s.as(s.admin).mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf });
  return { s, teamIds, captains };
}

type World = Awaited<ReturnType<typeof world>>;

const poolGames = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'pool'))
      .collect(),
  );

async function gameBetween({ s, teamIds }: World, first: number, second: number) {
  const wanted = [teamIds[first - 1], teamIds[second - 1]];
  return (await poolGames(s)).find((game) => wanted.every((id) => game.teamIds.includes(id)))!;
}

/** The captain of Team `number`. */
const captainOf = (w: World, number: number) => w.captains[number - 1];

const reportRows = (s: TournamentWorld) => s.t.run((ctx) => ctx.db.query('scoreReports').collect());

const reportFor = (
  w: World,
  number: number,
  game: Doc<'tournamentGames'>,
  score: Score,
  who: Person = captainOf(w, number),
) =>
  w.s
    .as(who)
    .mutation(api.scoreReports.report, { gameId: game._id, teamId: w.teamIds[number - 1], score });

const confirm = (s: TournamentWorld, who: Person, row: Doc<'scoreReports'>) =>
  s.as(who).mutation(api.scoreReports.confirm, { reportId: row._id, expected: row.reportedAt });

const storedGame = async (s: TournamentWorld, game: Doc<'tournamentGames'>) =>
  (await s.t.run((ctx) => ctx.db.get('tournamentGames', game._id)))!;

const organizerPools = async (s: TournamentWorld) =>
  (await s.as(s.admin).query(api.tournamentGames.getPools, TOURNAMENT_SLUGS))!;

async function shownGame(s: TournamentWorld, game: Doc<'tournamentGames'>) {
  const pools = await organizerPools(s);
  return pools.pools.flatMap((pool) => pool.games).find((row) => row.gameId === game._id)!;
}

const standingsOfPoolA = async (s: TournamentWorld) =>
  (await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS))!.pools![0].standings;

const forTeam = (w: World, who: Person, number: number) =>
  w.s.as(who).query(api.scoreReports.forTeam, { teamId: w.teamIds[number - 1] });

async function expectRefused(promise: Promise<unknown>, code: string) {
  const failure = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusalOf(failure)).toMatchObject({ code });
}

describe('scoreReports.report for a pool game', () => {
  test('stores the captain’s report, the organizer sees it as reported, and the game has no result', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    const saved = await reportFor(w, 1, game, set(21, 18));
    expect(saved.reportedAt).toBeGreaterThan(0);
    expect(await reportRows(w.s)).toEqual([
      expect.objectContaining({
        gameId: game._id,
        teamId: w.teamIds[0],
        reportedByUserId: w.s.captain.userId,
        score: set(21, 18),
      }),
    ]);
    expect((await storedGame(w.s, game)).winnerTeamId).toBeUndefined();
    expect((await storedGame(w.s, game)).score).toBeUndefined();
    expect((await shownGame(w.s, game)).reports).toEqual([
      {
        reportId: (await reportRows(w.s))[0]._id,
        teamId: w.teamIds[0],
        teamName: 'Team 01',
        score: set(21, 18),
        reportedAt: saved.reportedAt,
      },
    ]);
    expect((await shownGame(w.s, game)).result).toBeNull();
  });

  test('keeps the other team’s report beside it, in the order of the game', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 8, game, set(15, 21));
    await reportFor(w, 1, game, set(21, 18));
    expect((await shownGame(w.s, game)).reports.map((row) => row.teamName)).toEqual([
      'Team 01',
      'Team 08',
    ]);
  });

  test('replaces the team’s report, later than the one it replaces', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    const first = await reportFor(w, 1, game, set(21, 18));
    const second = await reportFor(w, 1, game, set(21, 10));
    expect(second.reportedAt).toBeGreaterThan(first.reportedAt);
    expect(await reportRows(w.s)).toHaveLength(1);
    expect((await reportRows(w.s))[0].score).toEqual(set(21, 10));
  });

  test('the standings do not count the reported result until Confirm', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    expect((await standingsOfPoolA(w.s)).every((row) => row.cells[0] === '0')).toBe(true);
    await confirm(w.s, w.s.admin, (await reportRows(w.s))[0]);
    const standings = await standingsOfPoolA(w.s);
    expect(standings.find((row) => row.name === 'Team 01')?.cells.slice(0, 3)).toEqual([
      '1',
      '1',
      '0',
    ]);
    expect(standings.find((row) => row.name === 'Team 08')?.cells.slice(0, 3)).toEqual([
      '1',
      '0',
      '1',
    ]);
  });

  describe('access', () => {
    test('a player on the game’s team who is not the captain is refused', async () => {
      const w = await world();
      const game = await gameBetween(w, 1, 8);
      await w.s.t.run((ctx) =>
        ctx.db.insert('rosterEntries', {
          organizationId: w.s.a,
          tournamentId: w.s.gulf,
          teamId: w.teamIds[0],
          userId: w.s.guardian.userId,
          status: 'rostered',
          source: 'invite',
          addedAt: 1,
          addedByUserId: w.s.captain.userId,
        }),
      );
      await expect(reportFor(w, 1, game, set(21, 18), w.s.guardian)).rejects.toThrow('Not allowed');
      expect(await reportRows(w.s)).toEqual([]);
    });

    test('a captain of another game is refused, for either team of the game', async () => {
      const w = await world();
      const game = await gameBetween(w, 1, 8);
      await expect(reportFor(w, 1, game, set(21, 18), captainOf(w, 4))).rejects.toThrow(
        'Not allowed',
      );
      await expect(reportFor(w, 4, game, set(21, 18))).rejects.toThrow('Not allowed');
      expect(await reportRows(w.s)).toEqual([]);
    });

    test('the captain of the other team of the game cannot report for the opponent', async () => {
      const w = await world();
      const game = await gameBetween(w, 1, 8);
      await expect(reportFor(w, 1, game, set(21, 18), captainOf(w, 8))).rejects.toThrow(
        'Not allowed',
      );
    });

    test('a signed-out caller is refused', async () => {
      const w = await world();
      const game = await gameBetween(w, 1, 8);
      await expect(
        w.s.t.mutation(api.scoreReports.report, {
          gameId: game._id,
          teamId: w.teamIds[0],
          score: set(21, 18),
        }),
      ).rejects.toThrow('Sign in required');
    });

    test('an organizer who is not a captain of the game is refused', async () => {
      const w = await world();
      const game = await gameBetween(w, 1, 8);
      await expect(reportFor(w, 1, game, set(21, 18), w.s.admin)).rejects.toThrow('Not allowed');
    });
  });

  describe('once the game has a result', () => {
    test('a result an organizer entered closes reports, and the captain is told why', async () => {
      const w = await world();
      const game = await gameBetween(w, 1, 8);
      await w.s
        .as(w.s.admin)
        .mutation(api.tournamentGames.enterResult, { gameId: game._id, score: set(21, 10) });
      await expectRefused(reportFor(w, 1, game, set(21, 18)), 'reportsClosed');
      expect(await reportRows(w.s)).toEqual([]);
    });

    test('a tied result closes reports too', async () => {
      const w = await world('soccer');
      const game = await gameBetween(w, 1, 8);
      await w.s
        .as(w.s.admin)
        .mutation(api.tournamentGames.enterResult, { gameId: game._id, score: goals(2, 2) });
      await expectRefused(reportFor(w, 1, game, goals(3, 1)), 'reportsClosed');
    });
  });

  describe('a tied report follows the sport’s pool rule', () => {
    test.each(['soccer', 'softball'] as const)(
      '%s accepts it, and Confirm saves a tie with no winner',
      async (sport) => {
        const w = await world(sport);
        const game = await gameBetween(w, 1, 8);
        await reportFor(w, 1, game, SCORE_OF[sport](2, 2));
        expect(await reportRows(w.s)).toHaveLength(1);
        const saved = await confirm(w.s, w.s.admin, (await reportRows(w.s))[0]);
        expect(saved).toMatchObject({ winnerTeamId: null, winnerName: null, advancesTo: null });
        expect((await storedGame(w.s, game)).score).toEqual(SCORE_OF[sport](2, 2));
        expect((await storedGame(w.s, game)).winnerTeamId).toBeUndefined();
      },
    );

    test('beach volleyball refuses it, and nothing is stored', async () => {
      const w = await world('beachVolleyball');
      const game = await gameBetween(w, 1, 8);
      await expectRefused(reportFor(w, 1, game, set(21, 21)), 'invalidScore');
      expect(await reportRows(w.s)).toEqual([]);
    });
  });
});

describe('scoreReports.confirm for a pool game', () => {
  test('saves the score through the organizer’s writer: the winner, the stamp, and the lock on the pools', async () => {
    const w = await world();
    const { s } = w;
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    const saved = await confirm(s, s.admin, (await reportRows(s))[0]);
    expect(saved).toMatchObject({
      winnerTeamId: w.teamIds[0],
      winnerName: 'Team 01',
      advancesTo: null,
      previous: null,
    });
    expect(await storedGame(s, game)).toMatchObject({
      winnerTeamId: w.teamIds[0],
      score: set(21, 18),
      resultEnteredBy: s.admin.userId,
      resultEnteredAt: saved.resultEnteredAt,
    });
    expect((await organizerPools(s)).hasResult).toBe(true);
    await expect(
      s.as(s.admin).mutation(api.tournamentGames.splitPools, {
        tournamentId: s.gulf,
        poolCount: 2,
      }),
    ).rejects.toThrow();
  });

  test('stops showing the report to the organizer once the game has a result', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    await confirm(w.s, w.s.admin, (await reportRows(w.s))[0]);
    expect((await shownGame(w.s, game)).reports).toEqual([]);
  });

  test('an organizer assigned to the tournament confirms', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    expect(await confirm(w.s, w.s.assignedOrganizer, (await reportRows(w.s))[0])).toMatchObject({
      winnerName: 'Team 01',
    });
  });

  test.each([
    ['a captain', 'captain'],
    ['an org admin of another organization', 'foreignAdmin'],
    ['a league organizer not assigned to the tournament', 'leagueOrganizer'],
    ['an organizer assigned to another tournament', 'otherOrganizer'],
    ['a stranger', 'stranger'],
  ] as const)('%s is refused, and the game keeps no result', async (_label, key) => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    await expect(confirm(w.s, w.s[key], (await reportRows(w.s))[0])).rejects.toThrow('Not allowed');
    expect((await storedGame(w.s, game)).winnerTeamId).toBeUndefined();
  });

  test('a report the captain replaced after the organizer saw it is refused, and the new score is not confirmed', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    const seen = (await reportRows(w.s))[0];
    await reportFor(w, 1, game, set(21, 10));
    const failure = await confirm(w.s, w.s.admin, seen).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusalOf(failure)).toEqual({
      code: 'reportChanged',
      message: BRACKET_MESSAGES.reportChanged,
    });
    expect((await storedGame(w.s, game)).score).toBeUndefined();
  });

  test('a game that already has a result refuses a second Confirm', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    await reportFor(w, 8, game, set(15, 21));
    const rows = await reportRows(w.s);
    await confirm(w.s, w.s.admin, rows[0]);
    await expectRefused(confirm(w.s, w.s.admin, rows[1]), 'resultExists');
  });

  test('Clear then Undo, and Correct, work on a confirmed pool report', async () => {
    const w = await world();
    const { s } = w;
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    const saved = await confirm(s, s.admin, (await reportRows(s))[0]);
    const corrected = await s.as(s.admin).mutation(api.tournamentGames.correctResult, {
      gameId: game._id,
      score: set(10, 21),
    });
    expect(corrected).toMatchObject({
      winnerTeamId: w.teamIds[7],
      previous: { score: set(21, 18) },
    });
    await s.as(s.admin).mutation(api.tournamentGames.undoResult, {
      gameId: game._id,
      expected: corrected.resultEnteredAt,
    });
    expect((await storedGame(s, game)).score).toBeUndefined();
    expect(saved.resultEnteredAt).toBeLessThan(corrected.resultEnteredAt);
  });

  test('a tied confirm in a sport that allows ties is stamped like any result', async () => {
    const w = await world('softball');
    const game = await gameBetween(w, 4, 5);
    await reportFor(w, 4, game, runs(3, 3));
    const saved = await confirm(w.s, w.s.admin, (await reportRows(w.s))[0]);
    expect(await storedGame(w.s, game)).toMatchObject({
      score: runs(3, 3),
      resultEnteredBy: w.s.admin.userId,
      resultEnteredAt: saved.resultEnteredAt,
    });
  });

  test('replacing the pool games removes the reports of the games it replaces', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 1, game, set(21, 18));
    await w.s.as(w.s.admin).mutation(api.tournamentGames.createPoolGames, {
      tournamentId: w.s.gulf,
      replace: true,
    });
    expect(await reportRows(w.s)).toEqual([]);
  });
});

describe('scoreReports.forTeam for pool play', () => {
  test('lists the team’s pool games that have no confirmed result, in round order', async () => {
    const w = await world();
    const { s } = w;
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await gameBetween(w, 1, 8))._id,
      score: set(21, 10),
    });
    const answer = await forTeam(w, captainOf(w, 1), 1);
    expect(answer?.games.map((row) => [row.stage, row.roundName])).toEqual([
      ['pool', 'Round 2'],
      ['pool', 'Round 3'],
    ]);
    expect(answer?.games.map((row) => row.teams.map((team) => team.name))).toEqual([
      ['Team 01', 'Team 05'],
      ['Team 01', 'Team 04'],
    ]);
    expect(answer?.games.every((row) => row.report === null)).toBe(true);
  });

  test('lists every game of a team with none played, and its own report on the one reported', async () => {
    const w = await world();
    const reportedGame = await gameBetween(w, 1, 5);
    const saved = await reportFor(w, 1, reportedGame, set(21, 18));
    const answer = await forTeam(w, captainOf(w, 1), 1);
    expect(answer?.games).toHaveLength(3);
    expect(answer?.games.map((row) => row.report)).toEqual([
      null,
      { score: set(21, 18), reportedAt: saved.reportedAt },
      null,
    ]);
  });

  test('keeps the other team’s report out of the answer', async () => {
    const w = await world();
    const game = await gameBetween(w, 1, 8);
    await reportFor(w, 8, game, set(15, 21));
    const answer = await forTeam(w, captainOf(w, 1), 1);
    expect(answer?.games.every((row) => row.report === null)).toBe(true);
  });

  test('lists a tied game as having a result, so it is no longer reportable', async () => {
    const w = await world('soccer');
    await w.s.as(w.s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await gameBetween(w, 1, 8))._id,
      score: goals(1, 1),
    });
    expect((await forTeam(w, captainOf(w, 1), 1))?.games).toHaveLength(2);
  });

  test('lists nothing once every game of the team has a result', async () => {
    const w = await world();
    for (const other of [8, 5, 4]) {
      await w.s.as(w.s.admin).mutation(api.tournamentGames.enterResult, {
        gameId: (await gameBetween(w, 1, other))._id,
        score: set(21, 10),
      });
    }
    expect((await forTeam(w, captainOf(w, 1), 1))?.games).toEqual([]);
  });

  test('is null for a player who is not the captain of the team', async () => {
    const w = await world();
    expect(await forTeam(w, captainOf(w, 4), 1)).toBeNull();
    expect(await forTeam(w, w.s.admin, 1)).toBeNull();
  });
});

describe('the organizer’s pools answer', () => {
  test('lists reports only on a game that has no result', async () => {
    const w = await world();
    const open = await gameBetween(w, 1, 5);
    const played = await gameBetween(w, 1, 8);
    await reportFor(w, 1, open, set(21, 18));
    await reportFor(w, 1, played, set(21, 18));
    await w.s.as(w.s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: played._id,
      score: set(21, 10),
    });
    const pools = await organizerPools(w.s);
    const games = pools.pools.flatMap((pool) => pool.games);
    expect(games.filter((row) => row.reports.length > 0).map((row) => row.gameId)).toEqual([
      open._id,
    ]);
  });
});
