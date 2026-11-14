/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { BRACKET_MESSAGES } from './lib/bracket';
import { SCORE_MESSAGES, type Score } from './lib/sports';
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

/**
 * Four teams make two semifinals, Sand Crabs v Spike Squad and Beach Bombers v Set Point, and a Final.
 * Each team has its own captain.
 */
async function world() {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  const captains: [string, Person][] = [
    ['Sand Crabs', s.captain],
    ['Beach Bombers', s.rival],
    ['Set Point', s.player],
    ['Spike Squad', s.rivalPlayer],
  ];
  const teamIds: Record<string, Id<'teams'>> = {};
  let createdAt = 1_000;
  for (const [name, captain] of captains) {
    createdAt += 1;
    teamIds[name] = await s.t.run((ctx) =>
      ctx.db.insert('teams', {
        organizationId: s.a,
        tournamentId: s.gulf,
        name,
        sortName: name.toLowerCase(),
        captainUserId: captain.userId,
        rosterCount: 2,
        createdAt,
      }),
    );
  }
  await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
  return { s, teamIds };
}

type World = Awaited<ReturnType<typeof world>>;

const games = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'bracket'))
      .collect(),
  );

async function gameAt(s: TournamentWorld, round: number, slot: number) {
  return (await games(s)).find((game) => game.round === round && game.slot === slot)!;
}

const reportRows = (s: TournamentWorld) => s.t.run((ctx) => ctx.db.query('scoreReports').collect());

const report = (
  s: TournamentWorld,
  who: Person,
  game: Doc<'tournamentGames'>,
  teamId: Id<'teams'>,
  score: Score,
) => s.as(who).mutation(api.scoreReports.report, { gameId: game._id, teamId, score });

const confirm = (s: TournamentWorld, who: Person, row: Doc<'scoreReports'>) =>
  s.as(who).mutation(api.scoreReports.confirm, { reportId: row._id, expected: row.reportedAt });

const setup = async (s: TournamentWorld, who: Person = s.admin) =>
  (await s.as(who).query(api.tournamentGames.getSetup, TOURNAMENT_SLUGS))!;

async function setupGame(s: TournamentWorld, round: number, slot: number) {
  const bracket = (await setup(s)).bracket!;
  return bracket.rounds[round - 1].games.find((game) => game.slot === slot)!;
}

const forTeam = (s: TournamentWorld, who: Person, teamId: Id<'teams'>) =>
  s.as(who).query(api.scoreReports.forTeam, { teamId });

async function expectRefused(promise: Promise<unknown>, code: string) {
  const failure = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusalOf(failure)).toMatchObject({ code });
}

const crabsSemifinal = (w: World) => gameAt(w.s, 1, 1);
const bombersSemifinal = (w: World) => gameAt(w.s, 1, 2);

describe('scoreReports.report', () => {
  test('the captain of Sand Crabs reports 21–18, the organizer sees it as reported, and the game has no winner', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    const saved = await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    expect(saved.reportedAt).toBeGreaterThan(0);
    expect(await reportRows(s)).toEqual([
      expect.objectContaining({
        gameId: game._id,
        teamId: teamIds['Sand Crabs'],
        reportedByUserId: s.captain.userId,
        score: set(21, 18),
        reportedAt: saved.reportedAt,
      }),
    ]);
    const shown = await setupGame(s, 1, 1);
    expect(shown.reports).toEqual([
      {
        reportId: expect.any(String) as string,
        teamId: teamIds['Sand Crabs'],
        teamName: 'Sand Crabs',
        score: set(21, 18),
        reportedAt: saved.reportedAt,
      },
    ]);
    expect(shown.result).toBeNull();
    expect(shown.winnerTeamId).toBeNull();
    expect((await gameAt(s, 1, 1)).winnerTeamId).toBeUndefined();
  });

  test('the public bracket is the same with a score reported, and shows no winner', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const publicBracket = async () =>
      (await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS))?.bracket;
    const before = await publicBracket();
    await report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18));
    const after = await publicBracket();
    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('winner');
    for (const game of after!.rounds.flatMap((round) => round.games)) {
      expect(game).not.toHaveProperty('winner');
    }
  });

  test('a second report from the same team replaces the first', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    const first = await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    const second = await report(s, s.captain, game, teamIds['Sand Crabs'], set(18, 21));
    const rows = await reportRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: set(18, 21), reportedAt: second.reportedAt });
    expect(second.reportedAt).toBeGreaterThan(first.reportedAt);
  });

  test('the other team’s different report is kept beside it, and the organizer sees both in the order of the game', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.rivalPlayer, game, teamIds['Spike Squad'], set(15, 21));
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    expect(await reportRows(s)).toHaveLength(2);
    const shown = await setupGame(s, 1, 1);
    expect(shown.reports.map((row) => [row.teamName, row.score])).toEqual([
      ['Sand Crabs', set(21, 18)],
      ['Spike Squad', set(15, 21)],
    ]);
  });

  test('a report is checked like a result: a tie is refused under the score and nothing is stored', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    const failure = await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 21)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusalOf(failure)).toMatchObject({
      code: 'invalidScore',
      field: 'set1',
      message: SCORE_MESSAGES.setTied(1),
    });
    expect(await reportRows(s)).toEqual([]);
  });

  test('a score of another sport’s kind is refused', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await expectRefused(
      report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], {
        kind: 'goals',
        a: 3,
        b: 1,
      }),
      'invalidScore',
    );
  });

  describe('who may report', () => {
    test('a player who is not a captain is refused', async () => {
      const w = await world();
      const { s, teamIds } = w;
      await expect(
        report(s, s.stranger, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18)),
      ).rejects.toThrow('Not allowed');
      expect(await reportRows(s)).toEqual([]);
    });

    test('a captain of another game is refused', async () => {
      const w = await world();
      const { s, teamIds } = w;
      await expect(
        report(s, s.player, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18)),
      ).rejects.toThrow('Not allowed');
      await expect(
        report(s, s.player, await crabsSemifinal(w), teamIds['Set Point'], set(21, 18)),
      ).rejects.toThrow('Not allowed');
      expect(await reportRows(s)).toEqual([]);
    });

    test('the captain of the other team of the game cannot report for the opponent', async () => {
      const w = await world();
      const { s, teamIds } = w;
      await expect(
        report(s, s.rivalPlayer, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18)),
      ).rejects.toThrow('Not allowed');
    });

    test('a signed-out caller is refused', async () => {
      const w = await world();
      const { s, teamIds } = w;
      const game = await crabsSemifinal(w);
      await expect(
        s.t.mutation(api.scoreReports.report, {
          gameId: game._id,
          teamId: teamIds['Sand Crabs'],
          score: set(21, 18),
        }),
      ).rejects.toThrow('Sign in required');
      expect(await reportRows(s)).toEqual([]);
    });

    test('an organizer who is not the captain is refused', async () => {
      const w = await world();
      const { s, teamIds } = w;
      await expect(
        report(s, s.admin, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18)),
      ).rejects.toThrow('Not allowed');
    });

    test('a game that waits on an earlier result refuses a report, for a team that is not in it', async () => {
      const w = await world();
      const { s, teamIds } = w;
      await expect(
        report(s, s.captain, await gameAt(s, 2, 1), teamIds['Sand Crabs'], set(21, 18)),
      ).rejects.toThrow('Not allowed');
    });
  });

  test('a game whose other place is still empty refuses a report', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await crabsSemifinal(w))._id,
      score: set(21, 10),
    });
    await expectRefused(
      report(s, s.captain, await gameAt(s, 2, 1), teamIds['Sand Crabs'], set(21, 18)),
      'gameNotReady',
    );
    expect(await reportRows(s)).toEqual([]);
  });

  describe('once the game has a result', () => {
    test('a result an organizer entered closes reports, and the captain is told why', async () => {
      const w = await world();
      const { s, teamIds } = w;
      const game = await crabsSemifinal(w);
      await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
        gameId: game._id,
        score: set(21, 10),
      });
      const failure = await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18)).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusalOf(failure)).toEqual({
        code: 'reportsClosed',
        message: BRACKET_MESSAGES.reportsClosed,
      });
      expect(await reportRows(s)).toEqual([]);
    });

    test('a confirmed report closes reports too, and the first report stays as it was', async () => {
      const w = await world();
      const { s, teamIds } = w;
      const game = await crabsSemifinal(w);
      await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
      await confirm(s, s.admin, (await reportRows(s))[0]);
      await expectRefused(
        report(s, s.captain, game, teamIds['Sand Crabs'], set(18, 21)),
        'reportsClosed',
      );
      expect((await reportRows(s))[0].score).toEqual(set(21, 18));
    });
  });
});

describe('scoreReports.confirm', () => {
  test('the winner of the confirmed score advances, through the writer that stamps the result', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    const saved = await confirm(s, s.admin, (await reportRows(s))[0]);
    expect(saved).toMatchObject({
      winnerTeamId: teamIds['Sand Crabs'],
      winnerName: 'Sand Crabs',
      advancesTo: 'Final',
      previous: null,
    });
    const stored = await gameAt(s, 1, 1);
    expect(stored).toMatchObject({
      winnerTeamId: teamIds['Sand Crabs'],
      score: set(21, 18),
      resultEnteredAt: saved.resultEnteredAt,
      resultEnteredBy: s.admin.userId,
    });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds['Sand Crabs'], null]);
  });

  test('the second team wins when its score is higher', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(15, 21));
    expect(await confirm(s, s.admin, (await reportRows(s))[0])).toMatchObject({
      winnerTeamId: teamIds['Spike Squad'],
    });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds['Spike Squad'], null]);
  });

  test('the game shows its result and no reports once confirmed, and the seeds lock as for any result', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await confirm(s, s.admin, (await reportRows(s))[0]);
    const shown = await setupGame(s, 1, 1);
    expect(shown.reports).toEqual([]);
    expect(shown.result).toMatchObject({ score: set(21, 18) });
    expect((await setup(s)).bracket?.hasResult).toBe(true);
    await expectRefused(
      s.as(s.admin).mutation(api.tournamentGames.moveSeed, {
        tournamentId: s.gulf,
        teamId: teamIds['Beach Bombers'],
        direction: 'up',
      }),
      'seedsLocked',
    );
  });

  test('Clear and Undo work on a confirmed result, and the reports show again once it is cleared', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    const saved = await confirm(s, s.admin, (await reportRows(s))[0]);
    await s.as(s.admin).mutation(api.tournamentGames.undoResult, {
      gameId: game._id,
      expected: saved.resultEnteredAt,
    });
    expect((await gameAt(s, 1, 1)).winnerTeamId).toBeUndefined();
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([null, null]);
    expect((await setupGame(s, 1, 1)).reports).toHaveLength(1);
  });

  test('a confirm that is refused for a result already entered writes nothing', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    const row = (await reportRows(s))[0];
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: game._id,
      score: set(10, 21),
    });
    await expectRefused(confirm(s, s.admin, row), 'resultExists');
    expect(await gameAt(s, 1, 1)).toMatchObject({ score: set(10, 21) });
  });

  test('a report the captain replaced after the organizer saw it is refused, and the new score is not confirmed unseen', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    const seen = (await reportRows(s))[0];
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(18, 21));
    const failure = await confirm(s, s.admin, seen).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusalOf(failure)).toEqual({
      code: 'reportChanged',
      message: BRACKET_MESSAGES.reportChanged,
    });
    expect((await gameAt(s, 1, 1)).winnerTeamId).toBeUndefined();
  });

  test('either of two differing reports can be confirmed', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await report(s, s.rivalPlayer, game, teamIds['Spike Squad'], set(19, 21));
    const spikeSquad = (await reportRows(s)).find((row) => row.teamId === teamIds['Spike Squad'])!;
    expect(await confirm(s, s.admin, spikeSquad)).toMatchObject({
      winnerTeamId: teamIds['Spike Squad'],
    });
  });

  test('an organizer assigned to the tournament confirms', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18));
    expect(await confirm(s, s.assignedOrganizer, (await reportRows(s))[0])).toMatchObject({
      winnerName: 'Sand Crabs',
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
    const { s, teamIds } = w;
    await report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18));
    await expect(confirm(s, s[key], (await reportRows(s))[0])).rejects.toThrow('Not allowed');
    expect((await gameAt(s, 1, 1)).winnerTeamId).toBeUndefined();
  });

  test('a signed-out caller is refused', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18));
    const row = (await reportRows(s))[0];
    await expect(
      s.t.mutation(api.scoreReports.confirm, { reportId: row._id, expected: row.reportedAt }),
    ).rejects.toThrow('Sign in required');
  });
});

describe('Correct: the organizer enters the result of a reported game', () => {
  test('an organizer enters a result over the reports, and the game shows the result', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await report(s, s.rivalPlayer, game, teamIds['Spike Squad'], set(21, 19));
    expect(
      await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
        gameId: game._id,
        score: set(21, 19),
      }),
    ).toMatchObject({ winnerTeamId: teamIds['Sand Crabs'] });
    const shown = await setupGame(s, 1, 1);
    expect(shown.reports).toEqual([]);
    expect(shown.result?.score).toEqual(set(21, 19));
  });

  test.each([
    ['a captain', 'captain'],
    ['an org admin of another organization', 'foreignAdmin'],
    ['a league organizer not assigned to the tournament', 'leagueOrganizer'],
    ['an organizer assigned to another tournament', 'otherOrganizer'],
  ] as const)('%s is refused', async (_label, key) => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await expect(
      s.as(s[key]).mutation(api.tournamentGames.enterResult, {
        gameId: game._id,
        score: set(21, 19),
      }),
    ).rejects.toThrow('Not allowed');
  });

  test('a signed-out caller is refused', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await expect(
      s.t.mutation(api.tournamentGames.enterResult, { gameId: game._id, score: set(21, 19) }),
    ).rejects.toThrow('Sign in required');
  });
});

describe('the setup of an organizer', () => {
  test('a game with no report has an empty list, and so does a game with a bye', async () => {
    const w = await world();
    expect((await setupGame(w.s, 1, 1)).reports).toEqual([]);
    expect((await setupGame(w.s, 2, 1)).reports).toEqual([]);
  });

  test('a caller who may not read the setup still gets nothing', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18));
    await expect(setup(s, s.captain)).rejects.toThrow();
  });
});

describe('a report whose game changes its teams', () => {
  test('is removed when a correction puts another team in the Final, because it was about another opponent', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await crabsSemifinal(w))._id,
      score: set(21, 10),
    });
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await bombersSemifinal(w))._id,
      score: set(21, 10),
    });
    const final = await gameAt(s, 2, 1);
    expect(final.teamIds).toEqual([teamIds['Sand Crabs'], teamIds['Beach Bombers']]);
    await report(s, s.captain, final, teamIds['Sand Crabs'], set(21, 18));
    expect(await reportRows(s)).toHaveLength(1);

    await s.as(s.admin).mutation(api.tournamentGames.correctResult, {
      gameId: (await bombersSemifinal(w))._id,
      score: set(10, 21),
    });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds['Sand Crabs'], teamIds['Set Point']]);
    expect(await reportRows(s)).toEqual([]);
  });

  test('stays when a correction keeps the same team in the Final', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await crabsSemifinal(w))._id,
      score: set(21, 10),
    });
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await bombersSemifinal(w))._id,
      score: set(21, 10),
    });
    await report(s, s.captain, await gameAt(s, 2, 1), teamIds['Sand Crabs'], set(21, 18));
    await s.as(s.admin).mutation(api.tournamentGames.correctResult, {
      gameId: (await bombersSemifinal(w))._id,
      score: set(21, 5),
    });
    expect(await reportRows(s)).toHaveLength(1);
  });

  test('is removed when the bracket is recreated, with its game', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18));
    await s.as(s.admin).mutation(api.tournamentGames.createBracket, {
      tournamentId: s.gulf,
      replace: true,
    });
    expect(await reportRows(s)).toEqual([]);
  });
});

describe('scoreReports.forTeam', () => {
  test('gives the captain the team’s current game, the sport, and no report before one is sent', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    expect(await forTeam(s, s.captain, teamIds['Sand Crabs'])).toEqual({
      sport: 'beachVolleyball',
      setsPerGame: 1,
      game: {
        gameId: game._id,
        roundName: 'Semifinals',
        teams: [
          { teamId: teamIds['Sand Crabs'], name: 'Sand Crabs' },
          { teamId: teamIds['Spike Squad'], name: 'Spike Squad' },
        ],
        report: null,
      },
    });
  });

  test('shows the team’s own report, and not the other team’s', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    const saved = await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await report(s, s.rivalPlayer, game, teamIds['Spike Squad'], set(15, 21));
    const mine = await forTeam(s, s.captain, teamIds['Sand Crabs']);
    expect(mine?.game?.report).toEqual({ score: set(21, 18), reportedAt: saved.reportedAt });
    const theirs = await forTeam(s, s.rivalPlayer, teamIds['Spike Squad']);
    expect(theirs?.game?.report?.score).toEqual(set(15, 21));
  });

  test('has no game once the game has a result and the next waits on the other semifinal', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await crabsSemifinal(w))._id,
      score: set(21, 10),
    });
    expect((await forTeam(s, s.captain, teamIds['Sand Crabs']))?.game).toBeNull();
  });

  test('moves to the Final once both semifinals are settled, and a team that lost has no game', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await crabsSemifinal(w))._id,
      score: set(21, 10),
    });
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: (await bombersSemifinal(w))._id,
      score: set(21, 10),
    });
    expect((await forTeam(s, s.captain, teamIds['Sand Crabs']))?.game).toMatchObject({
      roundName: 'Final',
    });
    expect((await forTeam(s, s.rivalPlayer, teamIds['Spike Squad']))?.game).toBeNull();
  });

  test('is null for a player who is not the captain, an organizer, and a team of no tournament', async () => {
    const w = await world();
    const { s, teamIds } = w;
    expect(await forTeam(s, s.stranger, teamIds['Sand Crabs'])).toBeNull();
    expect(await forTeam(s, s.admin, teamIds['Sand Crabs'])).toBeNull();
    const seasonTeam = await s.t.run((ctx) =>
      ctx.db.insert('teams', {
        organizationId: s.a,
        seasonId: s.season,
        name: 'Season Team',
        sortName: 'season team',
        captainUserId: s.captain.userId,
        rosterCount: 2,
        createdAt: 5,
      }),
    );
    expect(await forTeam(s, s.captain, seasonTeam)).toBeNull();
  });

  test('refuses a signed-out caller', async () => {
    const w = await world();
    await expect(
      w.s.t.query(api.scoreReports.forTeam, { teamId: w.teamIds['Sand Crabs'] }),
    ).rejects.toThrow('Sign in required');
  });

  test('has no game before the bracket exists', async () => {
    vi.useFakeTimers({ now: AFTER_DEADLINE });
    const s = await tournamentWorld();
    const teamId = await s.t.run((ctx) =>
      ctx.db.insert('teams', {
        organizationId: s.a,
        tournamentId: s.gulf,
        name: 'Solo',
        sortName: 'solo',
        captainUserId: s.captain.userId,
        rosterCount: 2,
        createdAt: 1,
      }),
    );
    expect((await forTeam(s, s.captain, teamId))?.game).toBeNull();
  });
});

describe('a confirmed report, then Correct, Clear, and Undo', () => {
  const enter = (s: TournamentWorld, game: Doc<'tournamentGames'>, score: Score) =>
    s.as(s.admin).mutation(api.tournamentGames.enterResult, { gameId: game._id, score });
  const correct = (s: TournamentWorld, game: Doc<'tournamentGames'>, score: Score) =>
    s.as(s.admin).mutation(api.tournamentGames.correctResult, { gameId: game._id, score });
  const clear = (s: TournamentWorld, game: Doc<'tournamentGames'>) =>
    s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId: game._id });

  test('Correct changes a confirmed score and moves the other team into the Final', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await confirm(s, s.admin, (await reportRows(s))[0]);
    expect(await correct(s, game, set(10, 21))).toMatchObject({
      winnerTeamId: teamIds['Spike Squad'],
      previous: { score: set(21, 18) },
    });
    expect((await gameAt(s, 1, 1)).score).toEqual(set(10, 21));
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds['Spike Squad'], null]);
    expect((await setupGame(s, 1, 1)).reports).toEqual([]);
  });

  test('Correct is refused once the next game has a result, and the confirmed score stays', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await confirm(s, s.admin, (await reportRows(s))[0]);
    await enter(s, await bombersSemifinal(w), set(21, 10));
    await enter(s, await gameAt(s, 2, 1), set(21, 15));

    await expectRefused(correct(s, game, set(10, 21)), 'nextGamePlayed');
    await expectRefused(clear(s, game), 'nextGamePlayed');
    expect(await gameAt(s, 1, 1)).toMatchObject({
      winnerTeamId: teamIds['Sand Crabs'],
      score: set(21, 18),
    });
  });

  test('Clear returns the game to Reported with the same report, and the winner leaves the Final', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await report(s, s.rivalPlayer, game, teamIds['Spike Squad'], set(19, 21));
    const rowsBefore = await reportRows(s);
    await confirm(
      s,
      s.admin,
      rowsBefore.find((row) => row.teamId === teamIds['Sand Crabs'])!,
    );
    await clear(s, game);

    const shown = await setupGame(s, 1, 1);
    expect(shown.result).toBeNull();
    expect(shown.reports.map((view) => [view.teamName, view.score])).toEqual([
      ['Sand Crabs', set(21, 18)],
      ['Spike Squad', set(19, 21)],
    ]);
    expect(await reportRows(s)).toEqual(rowsBefore);
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([null, null]);
  });

  test('Undo of a Clear restores the confirmed score and the winner advances again', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await confirm(s, s.admin, (await reportRows(s))[0]);
    await clear(s, game);

    expect(await enter(s, game, set(21, 18))).toMatchObject({
      winnerTeamId: teamIds['Sand Crabs'],
    });
    expect(await gameAt(s, 1, 1)).toMatchObject({ score: set(21, 18) });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds['Sand Crabs'], null]);
    expect((await setupGame(s, 1, 1)).reports).toEqual([]);
  });

  test('a cleared game takes a new report from the captain again, which replaces the old one', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await confirm(s, s.admin, (await reportRows(s))[0]);
    await expectRefused(
      report(s, s.captain, game, teamIds['Sand Crabs'], set(5, 21)),
      'reportsClosed',
    );
    await clear(s, game);

    await report(s, s.captain, game, teamIds['Sand Crabs'], set(5, 21));
    const rows = await reportRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toEqual(set(5, 21));
  });

  test('Clear of a semifinal drops the report of the Final it fed, which named another opponent', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await confirm(s, s.admin, (await reportRows(s))[0]);
    await enter(s, await bombersSemifinal(w), set(21, 10));
    const final = await gameAt(s, 2, 1);
    await report(s, s.captain, final, teamIds['Sand Crabs'], set(21, 12));
    const finalReports = async () =>
      (await reportRows(s)).filter((row) => row.gameId === final._id);
    expect(await finalReports()).toHaveLength(1);

    await clear(s, game);
    expect(await finalReports()).toEqual([]);
  });
});

describe('reports sent at the same time', () => {
  test('the two captains reporting together each keep their own row', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await Promise.all([
      report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18)),
      report(s, s.rivalPlayer, game, teamIds['Spike Squad'], set(19, 21)),
    ]);
    expect((await reportRows(s)).map((row) => row.teamId).sort()).toEqual(
      [teamIds['Sand Crabs'], teamIds['Spike Squad']].sort(),
    );
  });

  test('two Confirms of different reports settle the game once, and the other is refused', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    await report(s, s.rivalPlayer, game, teamIds['Spike Squad'], set(19, 21));
    const [first, second] = await reportRows(s);
    const outcomes = await Promise.allSettled([
      confirm(s, s.admin, first),
      confirm(s, s.assignedOrganizer, second),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refusalOf(rejected?.reason)).toMatchObject({ code: 'resultExists' });
    expect((await gameAt(s, 1, 1)).score).toBeDefined();
  });

  test('a report and a Confirm of the earlier one never confirm the unseen score', async () => {
    const w = await world();
    const { s, teamIds } = w;
    const game = await crabsSemifinal(w);
    await report(s, s.captain, game, teamIds['Sand Crabs'], set(21, 18));
    const seen = (await reportRows(s))[0];
    await Promise.allSettled([
      report(s, s.captain, game, teamIds['Sand Crabs'], set(5, 21)),
      confirm(s, s.admin, seen),
    ]);
    const stored = await gameAt(s, 1, 1);
    // Either the Confirm ran first (and the later report is refused) or the report did (and the Confirm is refused).
    if (stored.score) expect(stored.score).toEqual(set(21, 18));
    else expect((await reportRows(s))[0].score).toEqual(set(5, 21));
  });
});

describe('invalid input and a removed report', () => {
  const noSets: Score = { kind: 'sets', sets: [] };

  test.each([
    ['a negative score', set(-1, 21)],
    ['a fractional score', set(21.5, 10)],
    ['a score of NaN', set(Number.NaN, 10)],
    ['no sets', noSets],
  ])('%s is refused and nothing is stored', async (_label, score) => {
    const w = await world();
    const { s, teamIds } = w;
    await expect(
      report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], score),
    ).rejects.toThrow();
    expect(await reportRows(s)).toEqual([]);
  });

  test('a Confirm of a report that the recreated bracket removed is refused', async () => {
    const w = await world();
    const { s, teamIds } = w;
    await report(s, s.captain, await crabsSemifinal(w), teamIds['Sand Crabs'], set(21, 18));
    const row = (await reportRows(s))[0];
    await s.as(s.admin).mutation(api.tournamentGames.createBracket, {
      tournamentId: s.gulf,
      replace: true,
    });
    await expect(confirm(s, s.admin, row)).rejects.toThrow('Not allowed');
    expect((await gameAt(s, 1, 1)).winnerTeamId).toBeUndefined();
  });
});
