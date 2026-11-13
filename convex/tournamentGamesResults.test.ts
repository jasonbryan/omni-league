/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { BRACKET_MESSAGES } from './lib/bracket';
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

const ANY_ID = expect.any(String) as string;

const ONE_SET: Score = { kind: 'sets', sets: [{ a: 21, b: 15 }] };

/**
 * Five teams make 8 places: Alpha, Bravo, and Charlie have byes, so round 1 slot 2 is Delta v Echo,
 * round 2 slot 1 is Alpha v the winner of that, slot 2 is Bravo v Charlie, and round 3 is the Final.
 */
const FIVE = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

let registeredAt = 1_000;

async function world(teamNames: readonly string[] = FIVE) {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  const teamIds: Id<'teams'>[] = [];
  for (const name of teamNames) {
    registeredAt += 1;
    teamIds.push(
      await s.t.run((ctx) =>
        ctx.db.insert('teams', {
          organizationId: s.a,
          tournamentId: s.gulf,
          name,
          sortName: name.toLowerCase(),
          captainUserId: s.captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        }),
      ),
    );
  }
  await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
  return { s, teamIds };
}

async function useSport(s: TournamentWorld, sport: Sport, setsPerGame?: 1 | 3) {
  await s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', s.gulf))!;
    await ctx.db.patch('tournaments', s.gulf, { sport, setsPerGame });
    await ctx.db.patch('programs', tournament.programId, { sport });
  });
}

const rows = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'bracket'))
      .collect(),
  );

async function gameAt(
  s: TournamentWorld,
  round: number,
  slot: number,
): Promise<Doc<'tournamentGames'>> {
  return (await rows(s)).find((game) => game.round === round && game.slot === slot)!;
}

const enter = (
  s: TournamentWorld,
  game: Doc<'tournamentGames'>,
  result: { score?: Score; forfeitTeamId?: Id<'teams'> },
  who: Person = s.admin,
) => s.as(who).mutation(api.tournamentGames.enterResult, { gameId: game._id, ...result });

const correct = (
  s: TournamentWorld,
  game: Doc<'tournamentGames'>,
  result: { score?: Score; forfeitTeamId?: Id<'teams'> },
  who: Person = s.admin,
) => s.as(who).mutation(api.tournamentGames.correctResult, { gameId: game._id, ...result });

const undo = (
  s: TournamentWorld,
  game: Doc<'tournamentGames'>,
  restore?: { score: Score; forfeitTeamId?: Id<'teams'> },
  who: Person = s.admin,
) =>
  s.as(who).mutation(api.tournamentGames.undoResult, {
    gameId: game._id,
    ...(restore && { restore }),
  });

const setup = (s: TournamentWorld, who: Person = s.admin) =>
  s.as(who).query(api.tournamentGames.getSetup, TOURNAMENT_SLUGS);

const goals = (a: number, b: number): Score => ({ kind: 'goals', a, b });

describe('tournamentGames.enterResult', () => {
  test('a semifinal of 21–15 puts the winner into the Final', async () => {
    const { s, teamIds } = await world();
    const semifinal = await gameAt(s, 2, 2);
    expect(await enter(s, semifinal, { score: ONE_SET })).toMatchObject({
      winnerTeamId: teamIds[1],
      winnerName: 'Bravo',
      advancesTo: 'Final',
      previous: null,
    });
    const stored = await gameAt(s, 2, 2);
    expect(stored).toMatchObject({
      winnerTeamId: teamIds[1],
      score: ONE_SET,
      resultEnteredBy: s.admin.userId,
      resultEnteredAt: expect.any(Number) as number,
    });
    expect(stored.resultEnteredAt).toBeGreaterThanOrEqual(AFTER_DEADLINE);
    expect(stored.forfeitTeamId).toBeUndefined();
    expect((await gameAt(s, 3, 1)).teamIds).toEqual([null, teamIds[1]]);
  });

  test('the second team wins when its score is higher, and joins the side the bracket names', async () => {
    const { s, teamIds } = await world();
    await enter(s, await gameAt(s, 1, 2), { score: { kind: 'sets', sets: [{ a: 18, b: 21 }] } });
    expect((await gameAt(s, 1, 2)).winnerTeamId).toBe(teamIds[4]);
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds[0], teamIds[4]]);
  });

  test('says the winner of the Final wins the tournament, and the setup names them', async () => {
    const { s, teamIds } = await world();
    await enter(s, await gameAt(s, 1, 2), { score: ONE_SET });
    await enter(s, await gameAt(s, 2, 1), { score: ONE_SET });
    await enter(s, await gameAt(s, 2, 2), { score: ONE_SET });
    expect((await setup(s))!.bracket!.winner).toBeNull();
    const final = await gameAt(s, 3, 1);
    expect(final.teamIds).toEqual([teamIds[0], teamIds[1]]);
    expect(await enter(s, final, { score: ONE_SET })).toMatchObject({
      winnerTeamId: teamIds[0],
      advancesTo: null,
    });
    expect((await setup(s))!.bracket!.winner).toEqual({ teamId: teamIds[0], name: 'Alpha' });
  });

  test('refuses a tied score under the score, and an invalid set under that set, writing nothing', async () => {
    const { s } = await world();
    await useSport(s, 'soccer');
    const game = await gameAt(s, 1, 2);
    const before = await rows(s);
    expect(await enter(s, game, { score: goals(2, 2) }).catch(refusalOf)).toEqual({
      code: 'invalidScore',
      message: SCORE_MESSAGES.tied,
      field: 'score',
    });
    await useSport(s, 'beachVolleyball');
    expect(
      await enter(s, game, { score: { kind: 'sets', sets: [{ a: 21, b: 20 }] } }).catch(refusalOf),
    ).toEqual({ code: 'invalidScore', message: SCORE_MESSAGES.winByTwo(1), field: 'set1' });
    expect(await rows(s)).toEqual(before);
  });

  test("refuses another sport's kind of score", async () => {
    const { s } = await world();
    expect(await enter(s, await gameAt(s, 1, 2), { score: goals(3, 1) }).catch(refusalOf)).toEqual({
      code: 'invalidScore',
      message: SCORE_MESSAGES.wrongKind,
      field: 'score',
    });
  });

  test('soccer scores goals and softball scores runs', async () => {
    const soccer = await world();
    await useSport(soccer.s, 'soccer');
    await enter(soccer.s, await gameAt(soccer.s, 1, 2), { score: goals(3, 1) });
    expect((await gameAt(soccer.s, 1, 2)).score).toEqual(goals(3, 1));
    const softball = await world();
    await useSport(softball.s, 'softball');
    const runs: Score = { kind: 'runs', a: 4, b: 9 };
    await enter(softball.s, await gameAt(softball.s, 1, 2), { score: runs });
    expect((await gameAt(softball.s, 1, 2)).winnerTeamId).toBe(softball.teamIds[4]);
  });

  test('a best of 3 needs the third set when the teams split the first two', async () => {
    const { s, teamIds } = await world();
    await useSport(s, 'beachVolleyball', 3);
    const game = await gameAt(s, 1, 2);
    expect(
      await enter(s, game, { score: { kind: 'sets', sets: [{ a: 21, b: 15 }] } }).catch(refusalOf),
    ).toMatchObject({ field: 'set2' });
    const split: Score = {
      kind: 'sets',
      sets: [
        { a: 21, b: 15 },
        { a: 18, b: 21 },
      ],
    };
    expect(await enter(s, game, { score: split }).catch(refusalOf)).toMatchObject({
      field: 'set3',
    });
    const decided: Score = {
      kind: 'sets',
      sets: [...split.sets, { a: 9, b: 15 }],
    };
    expect(await enter(s, game, { score: decided })).toMatchObject({ winnerTeamId: teamIds[4] });
  });

  test('a game of 1 set refuses a second set', async () => {
    const { s } = await world();
    const two: Score = {
      kind: 'sets',
      sets: [
        { a: 21, b: 15 },
        { a: 21, b: 15 },
      ],
    };
    expect(await enter(s, await gameAt(s, 1, 2), { score: two }).catch(refusalOf)).toMatchObject({
      field: 'set2',
    });
  });

  test.each([
    ['a bye', 1, 1],
    ['a game waiting on an earlier result', 2, 1],
    ['the Final before its semifinals', 3, 1],
  ])('refuses %s, which has one team or none', async (_name, round, slot) => {
    const { s } = await world();
    const before = await rows(s);
    expect(
      await enter(s, await gameAt(s, round, slot), { score: ONE_SET }).catch(refusalOf),
    ).toEqual({
      code: 'gameNotReady',
      message: BRACKET_MESSAGES.gameNotReady,
    });
    expect(await rows(s)).toEqual(before);
  });

  test('refuses a game that has a result already, pointing to Correct', async () => {
    const { s } = await world();
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { score: ONE_SET });
    expect(await enter(s, game, { score: ONE_SET }).catch(refusalOf)).toEqual({
      code: 'resultExists',
      message: BRACKET_MESSAGES.resultExists,
    });
  });

  test('refuses a forfeit together with a score, and neither', async () => {
    const { s, teamIds } = await world();
    const game = await gameAt(s, 1, 2);
    await expect(enter(s, game, { score: ONE_SET, forfeitTeamId: teamIds[3] })).rejects.toThrow(
      /Not allowed/,
    );
    await expect(enter(s, game, {})).rejects.toThrow(/Not allowed/);
  });

  describe('a forfeit', () => {
    test.each([
      ['beachVolleyball', { kind: 'sets', sets: [{ a: 0, b: 21 }] }],
      ['soccer', { kind: 'goals', a: 0, b: 3 }],
      ['softball', { kind: 'runs', a: 0, b: 7 }],
    ] as const)(
      'stores the configured %s forfeit score, and the other team wins',
      async (sport, score) => {
        const { s, teamIds } = await world();
        await useSport(s, sport);
        const game = await gameAt(s, 1, 2);
        expect(await enter(s, game, { forfeitTeamId: teamIds[3] })).toMatchObject({
          winnerTeamId: teamIds[4],
        });
        expect(await gameAt(s, 1, 2)).toMatchObject({
          score,
          forfeitTeamId: teamIds[3],
          winnerTeamId: teamIds[4],
        });
        expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds[0], teamIds[4]]);
      },
    );

    test('a best of 3 forfeit is a straight-sets loss', async () => {
      const { s, teamIds } = await world();
      await useSport(s, 'beachVolleyball', 3);
      await enter(s, await gameAt(s, 1, 2), { forfeitTeamId: teamIds[4] });
      expect((await gameAt(s, 1, 2)).score).toEqual({
        kind: 'sets',
        sets: [
          { a: 21, b: 0 },
          { a: 21, b: 0 },
        ],
      });
    });

    test('refuses a team that is not in the game', async () => {
      const { s, teamIds } = await world();
      await expect(enter(s, await gameAt(s, 1, 2), { forfeitTeamId: teamIds[0] })).rejects.toThrow(
        /Not allowed/,
      );
    });
  });

  describe('who may enter a result', () => {
    test('an organizer assigned to the tournament may', async () => {
      const { s } = await world();
      expect(
        await enter(s, await gameAt(s, 1, 2), { score: ONE_SET }, s.assignedOrganizer),
      ).toMatchObject({
        advancesTo: 'Semifinals',
      });
      expect((await gameAt(s, 1, 2)).resultEnteredBy).toBe(s.assignedOrganizer.userId);
    });

    test.each([
      'foreignAdmin',
      'otherOrganizer',
      'leagueOrganizer',
      'stranger',
      'captain',
    ] as const)('refuses %s, and writes nothing', async (who) => {
      const { s } = await world();
      const game = await gameAt(s, 1, 2);
      const before = await rows(s);
      await expect(enter(s, game, { score: ONE_SET }, s[who])).rejects.toThrow(/Not allowed/);
      await expect(correct(s, game, { score: ONE_SET }, s[who])).rejects.toThrow(/Not allowed/);
      await expect(undo(s, game, undefined, s[who])).rejects.toThrow(/Not allowed/);
      expect(await rows(s)).toEqual(before);
    });

    test('refuses a signed-out caller', async () => {
      const { s } = await world();
      const game = await gameAt(s, 1, 2);
      await expect(
        s.t.mutation(api.tournamentGames.enterResult, { gameId: game._id, score: ONE_SET }),
      ).rejects.toThrow();
      await expect(
        s.t.mutation(api.tournamentGames.correctResult, { gameId: game._id, score: ONE_SET }),
      ).rejects.toThrow();
      await expect(
        s.t.mutation(api.tournamentGames.undoResult, { gameId: game._id }),
      ).rejects.toThrow();
      expect((await gameAt(s, 1, 2)).winnerTeamId).toBeUndefined();
    });

    test("refuses a game of another organization's tournament", async () => {
      const { s } = await world();
      await expect(
        enter(s, await gameAt(s, 1, 2), { score: ONE_SET }, s.foreignAdmin),
      ).rejects.toThrow(/Not allowed/);
    });
  });
});

describe('tournamentGames.undoResult', () => {
  test('returns the game and the next game to before', async () => {
    const { s } = await world();
    const before = await rows(s);
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { score: ONE_SET });
    expect(await undo(s, game)).toBeNull();
    expect(await rows(s)).toEqual(before);
  });

  test('is refused once the next game has a result, which stays', async () => {
    const { s } = await world();
    await enter(s, await gameAt(s, 1, 2), { score: ONE_SET });
    await enter(s, await gameAt(s, 2, 1), { score: ONE_SET });
    const before = await rows(s);
    expect(await undo(s, await gameAt(s, 1, 2)).catch(refusalOf)).toEqual({
      code: 'nextGamePlayed',
      message: BRACKET_MESSAGES.nextGamePlayed,
    });
    expect(await rows(s)).toEqual(before);
  });

  test('works again once the next game is undone', async () => {
    const { s } = await world();
    const before = await rows(s);
    await enter(s, await gameAt(s, 1, 2), { score: ONE_SET });
    await enter(s, await gameAt(s, 2, 1), { score: ONE_SET });
    await undo(s, await gameAt(s, 2, 1));
    await undo(s, await gameAt(s, 1, 2));
    expect(await rows(s)).toEqual(before);
  });

  test('is refused for a game with no result', async () => {
    const { s } = await world();
    expect(await undo(s, await gameAt(s, 1, 2)).catch(refusalOf)).toEqual({
      code: 'noResult',
      message: BRACKET_MESSAGES.noResult,
    });
  });

  test('undoing the Final leaves the tournament without a winner', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    const final = await gameAt(s, 1, 1);
    await enter(s, final, { score: ONE_SET });
    expect((await setup(s))!.bracket!.winner).not.toBeNull();
    await undo(s, final);
    expect((await setup(s))!.bracket!.winner).toBeNull();
  });

  test('restores the earlier result of a correction when it is given', async () => {
    const { s, teamIds } = await world();
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { score: ONE_SET });
    const lost: Score = { kind: 'sets', sets: [{ a: 12, b: 21 }] };
    const corrected = await correct(s, game, { score: lost });
    expect(corrected.previous).toEqual({ score: ONE_SET });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds[0], teamIds[4]]);
    await undo(s, game, corrected.previous!);
    expect(await gameAt(s, 1, 2)).toMatchObject({ score: ONE_SET, winnerTeamId: teamIds[3] });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds[0], teamIds[3]]);
  });

  test('restores a forfeit with the team that forfeited', async () => {
    const { s, teamIds } = await world();
    await useSport(s, 'soccer');
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { forfeitTeamId: teamIds[3] });
    const corrected = await correct(s, game, { score: goals(2, 1) });
    expect(corrected.previous).toEqual({ score: goals(0, 3), forfeitTeamId: teamIds[3] });
    await undo(s, game, corrected.previous!);
    expect(await gameAt(s, 1, 2)).toMatchObject({
      score: goals(0, 3),
      forfeitTeamId: teamIds[3],
      winnerTeamId: teamIds[4],
    });
  });

  test('refuses a restore that is not a valid result', async () => {
    const { s } = await world();
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { score: ONE_SET });
    expect(await undo(s, game, { score: goals(2, 2) }).catch(refusalOf)).toMatchObject({
      code: 'invalidScore',
    });
  });
});

describe('tournamentGames.correctResult', () => {
  test('a correction that changes the winner replaces the team in the next game', async () => {
    const { s, teamIds } = await world();
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { score: ONE_SET });
    expect(
      await correct(s, game, { score: { kind: 'sets', sets: [{ a: 12, b: 21 }] } }),
    ).toMatchObject({ winnerTeamId: teamIds[4], advancesTo: 'Semifinals' });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds[0], teamIds[4]]);
    expect((await gameAt(s, 1, 2)).winnerTeamId).toBe(teamIds[4]);
  });

  test('a correction that keeps the winner changes only the score', async () => {
    const { s, teamIds } = await world();
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { score: ONE_SET });
    await correct(s, game, { score: { kind: 'sets', sets: [{ a: 21, b: 12 }] } });
    expect((await gameAt(s, 1, 2)).score).toEqual({ kind: 'sets', sets: [{ a: 21, b: 12 }] });
    expect((await gameAt(s, 2, 1)).teamIds).toEqual([teamIds[0], teamIds[3]]);
  });

  test('is refused once the next game has a result, and the result stays', async () => {
    const { s } = await world();
    await enter(s, await gameAt(s, 1, 2), { score: ONE_SET });
    await enter(s, await gameAt(s, 2, 1), { score: ONE_SET });
    const before = await rows(s);
    expect(await correct(s, await gameAt(s, 1, 2), { score: ONE_SET }).catch(refusalOf)).toEqual({
      code: 'nextGamePlayed',
      message: BRACKET_MESSAGES.nextGamePlayed,
    });
    expect(await rows(s)).toEqual(before);
  });

  test('is refused for a game with no result, and for a score that does not fit', async () => {
    const { s } = await world();
    const game = await gameAt(s, 1, 2);
    expect(await correct(s, game, { score: ONE_SET }).catch(refusalOf)).toMatchObject({
      code: 'noResult',
    });
    await enter(s, game, { score: ONE_SET });
    expect(
      await correct(s, game, { score: { kind: 'sets', sets: [{ a: 21, b: 21 }] } }).catch(
        refusalOf,
      ),
    ).toMatchObject({ code: 'invalidScore', field: 'set1' });
    expect((await gameAt(s, 1, 2)).score).toEqual(ONE_SET);
  });

  test('the Final is corrected while it is the last game', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo']);
    const final = await gameAt(s, 1, 1);
    await enter(s, final, { score: ONE_SET });
    await correct(s, final, { score: { kind: 'sets', sets: [{ a: 10, b: 21 }] } });
    expect((await setup(s))!.bracket!.winner).toEqual({ teamId: teamIds[1], name: 'Bravo' });
  });
});

describe('the locks a result sets', () => {
  const move = (s: TournamentWorld, teamId: Id<'teams'>) =>
    s
      .as(s.admin)
      .mutation(api.tournamentGames.moveSeed, { tournamentId: s.gulf, teamId, direction: 'up' });
  const recreate = (s: TournamentWorld) =>
    s
      .as(s.admin)
      .mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf, replace: true });

  test('a result locks the seeds and Recreate, and Undo opens them again', async () => {
    const { s, teamIds } = await world();
    const game = await gameAt(s, 1, 2);
    await enter(s, game, { score: ONE_SET });
    expect((await setup(s))!.bracket!.hasResult).toBe(true);
    expect(await move(s, teamIds[2]).catch(refusalOf)).toEqual({
      code: 'seedsLocked',
      message: BRACKET_MESSAGES.seedsLocked,
    });
    expect(await recreate(s).catch(refusalOf)).toEqual({
      code: 'resultEntered',
      message: BRACKET_MESSAGES.resultEntered,
    });
    await undo(s, game);
    expect((await setup(s))!.bracket!.hasResult).toBe(false);
    expect(await move(s, teamIds[2])).toEqual({ seed: 2, seedCount: 5 });
    expect(await recreate(s)).toEqual({ gameCount: 7, replaced: true });
  });

  test('a forfeit locks them too', async () => {
    const { s, teamIds } = await world();
    await enter(s, await gameAt(s, 1, 2), { forfeitTeamId: teamIds[3] });
    expect(await move(s, teamIds[2]).catch(refusalOf)).toMatchObject({ code: 'seedsLocked' });
    expect(await recreate(s).catch(refusalOf)).toMatchObject({ code: 'resultEntered' });
  });

  test('a bye is not a result, so the seeds move until a game is played', async () => {
    const { s, teamIds } = await world();
    expect((await setup(s))!.bracket!.hasResult).toBe(false);
    expect(await move(s, teamIds[2])).toMatchObject({ seed: 2 });
  });
});

describe('the bracket in tournamentGames.getSetup after a result', () => {
  test('shows the result of a game, who forfeited, and whether Undo and Correct are open', async () => {
    const { s, teamIds } = await world();
    await useSport(s, 'soccer');
    await enter(s, await gameAt(s, 1, 2), { forfeitTeamId: teamIds[3] });
    const { bracket } = (await setup(s))!;
    const [, played] = bracket!.rounds[0].games;
    expect(played).toMatchObject({
      winnerTeamId: teamIds[4],
      result: {
        score: goals(0, 3),
        forfeitTeamId: teamIds[3],
      },
      locked: false,
    });
    const [bye] = bracket!.rounds[0].games;
    expect(bye.result).toBeNull();
    expect(bye.locked).toBe(false);
    expect(bracket!.rounds[1].games[0]).toMatchObject({ result: null, locked: false });
    expect(bracket!.winner).toBeNull();
  });

  test('marks a game locked once the next game has a result', async () => {
    const { s } = await world();
    await useSport(s, 'soccer');
    await enter(s, await gameAt(s, 1, 2), { score: goals(2, 1) });
    await enter(s, await gameAt(s, 2, 1), { score: goals(2, 1) });
    const { rounds } = (await setup(s))!.bracket!;
    expect(rounds[0].games[1].locked).toBe(true);
    expect(rounds[1].games[0].locked).toBe(false);
  });

  test('shows the name of a winner placed in the next game', async () => {
    const { s } = await world();
    await enter(s, await gameAt(s, 1, 2), { score: ONE_SET });
    const { rounds } = (await setup(s))!.bracket!;
    expect(rounds[1].games[0].teams).toEqual([
      { teamId: ANY_ID, name: 'Alpha' },
      { teamId: ANY_ID, name: 'Delta' },
    ]);
  });

  test('the setup of the previous release still reads: a game keeps its slot, teams, and winner', async () => {
    const { s } = await world();
    const [first] = (await setup(s))!.bracket!.rounds[0].games;
    expect(first).toMatchObject({
      gameId: ANY_ID,
      slot: 1,
      teams: [{ teamId: ANY_ID, name: 'Alpha' }, null],
      winnerTeamId: ANY_ID,
    });
  });
});

describe('an existing game without result fields', () => {
  test('reads as having no result, so rows from before the fields stay valid', async () => {
    const { s } = await world();
    const game = await gameAt(s, 1, 2);
    expect(game.score).toBeUndefined();
    expect(game.resultEnteredAt).toBeUndefined();
    expect(game.resultEnteredBy).toBeUndefined();
    expect(game.forfeitTeamId).toBeUndefined();
    const { bracket } = (await setup(s))!;
    expect(bracket!.rounds[0].games[1].result).toBeNull();
  });
});
