/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { forfeitScore, scoreWinnerSide, type Score } from './lib/sports';
import { TOURNAMENT_SLUGS, tournamentWorld, type TournamentWorld } from './tournamentWorld.setup';

afterEach(() => {
  vi.useRealTimers();
});

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

let registeredAt = 1_000;

async function worldWithBracket(names: readonly string[]) {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  for (const name of names) await addTeam(s, name);
  if (names.length > 0) {
    await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
  }
  return s;
}

function addTeam(s: TournamentWorld, name: string) {
  registeredAt += 1;
  return s.t.run(async (ctx) => {
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

const publicPage = (s: TournamentWorld) =>
  s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS);

const bracketOf = async (s: TournamentWorld) => (await publicPage(s))?.bracket;

function gameAt(s: TournamentWorld, round: number, slot: number) {
  return s.t.run(
    async (ctx) =>
      (await ctx.db
        .query('tournamentGames')
        .withIndex(GAME_INDEX, (q) =>
          q.eq('tournamentId', s.gulf).eq('stage', 'bracket').eq('round', round).eq('slot', slot),
        )
        .unique())!,
  );
}

/** Stands in for the result writer: a winner among two teams in a place of the bracket. */
async function settle(
  s: TournamentWorld,
  round: number,
  slot: number,
  teamIds: [Id<'teams'>, Id<'teams'>],
  winner: 0 | 1,
) {
  const game = await gameAt(s, round, slot);
  await s.t.run((ctx) =>
    ctx.db.patch('tournamentGames', game._id, { teamIds, winnerTeamId: teamIds[winner] }),
  );
}

const ONE_SET: Score = { kind: 'sets', sets: [{ a: 21, b: 15 }] };
const THREE_SETS: Score = {
  kind: 'sets',
  sets: [
    { a: 21, b: 15 },
    { a: 18, b: 21 },
    { a: 15, b: 10 },
  ],
};

/** A played game as the result writer leaves it: the winner and the score, and the forfeiting team for a forfeit. */
async function play(
  s: TournamentWorld,
  round: number,
  slot: number,
  teamIds: [Id<'teams'>, Id<'teams'>],
  result: { score: Score; forfeitSide?: 0 | 1 },
) {
  const game = await gameAt(s, round, slot);
  const winnerSide = scoreWinnerSide(result.score)!;
  await s.t.run((ctx) =>
    ctx.db.patch('tournamentGames', game._id, {
      teamIds,
      winnerTeamId: teamIds[winnerSide],
      score: result.score,
      forfeitTeamId: result.forfeitSide === undefined ? undefined : teamIds[result.forfeitSide],
    }),
  );
}

const teamIdOf = (s: TournamentWorld, name: string) =>
  s.t.run(
    async (ctx) => (await ctx.db.query('teams').collect()).find((team) => team.name === name)!._id,
  );

describe('tournaments.getPublicPage bracket', () => {
  test('leaves the bracket out before an organizer creates it', async () => {
    const s = await worldWithBracket([]);
    expect(await publicPage(s)).not.toHaveProperty('bracket');
  });

  test('lists the rounds with their games, seeds, and byes, top to bottom', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    const seeded = (name: string, seed: number) => ({ name, seed });
    expect(await bracketOf(s)).toEqual({
      rounds: [
        {
          name: 'Quarterfinals',
          games: [
            { teams: [seeded('Alpha', 1), null], bye: true },
            { teams: [seeded('Delta', 4), seeded('Echo', 5)], bye: false },
            { teams: [seeded('Bravo', 2), null], bye: true },
            { teams: [seeded('Charlie', 3), null], bye: true },
          ],
        },
        {
          name: 'Semifinals',
          games: [
            { teams: [seeded('Alpha', 1), null], bye: false },
            { teams: [seeded('Bravo', 2), seeded('Charlie', 3)], bye: false },
          ],
        },
        { name: 'Final', games: [{ teams: [null, null], bye: false }] },
      ],
    });
  });

  test('names the winner of a game that has a result, by its place in the game', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    await settle(s, 1, 2, [await teamIdOf(s, 'Delta'), await teamIdOf(s, 'Echo')], 1);
    const bracket = (await bracketOf(s))!;
    expect(bracket.rounds[0].games[1]).toEqual({
      teams: [
        { name: 'Delta', seed: 4 },
        { name: 'Echo', seed: 5 },
      ],
      bye: false,
      winner: 1,
    });
    expect(bracket.rounds[0].games[0]).not.toHaveProperty('winner');
    expect(bracket).not.toHaveProperty('winner');
  });

  test('names the tournament winner once the Final has a result', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo']);
    expect((await bracketOf(s))!.rounds).toHaveLength(1);
    expect(await bracketOf(s)).not.toHaveProperty('winner');
    await settle(s, 1, 1, [await teamIdOf(s, 'Alpha'), await teamIdOf(s, 'Bravo')], 0);
    const bracket = (await bracketOf(s))!;
    expect(bracket.winner).toBe('Alpha');
    expect(bracket.rounds[0].games).toEqual([
      {
        teams: [
          { name: 'Alpha', seed: 1 },
          { name: 'Bravo', seed: 2 },
        ],
        bye: false,
        winner: 0,
      },
    ]);
  });

  test('holds no ids, and gives every caller the same answer', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo', 'Charlie']);
    const bracket = await bracketOf(s);
    expect(bracket).toBeDefined();
    const idsInDatabase = await s.t.run(async (ctx) => [
      ...(await ctx.db.query('teams').collect()).map((team) => team._id),
      ...(await ctx.db.query('tournamentGames').collect()).map((game) => game._id),
      s.gulf,
    ]);
    const keys = new Set<string>();
    const json = JSON.stringify(bracket, (key, value: unknown) => {
      keys.add(key);
      return value;
    });
    for (const id of idsInDatabase) expect(json).not.toContain(id);
    expect([...keys].filter((key) => /id/i.test(key))).toEqual([]);
    for (const caller of [s.as(s.admin), s.as(s.stranger)]) {
      expect(
        (await caller.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS))?.bracket,
      ).toEqual(bracket);
    }
  });

  test('lists a bracket of 17 teams in five rounds with 15 byes and one first-round game', async () => {
    const names = Array.from({ length: 17 }, (_, index) => `Team ${index + 1}`);
    const s = await worldWithBracket(names);
    const bracket = (await bracketOf(s))!;
    expect(bracket.rounds.map((round) => round.name)).toEqual([
      'Round of 32',
      'Round of 16',
      'Quarterfinals',
      'Semifinals',
      'Final',
    ]);
    expect(bracket.rounds.map((round) => round.games.length)).toEqual([16, 8, 4, 2, 1]);
    const first = bracket.rounds[0].games;
    expect(first.filter((game) => game.bye)).toHaveLength(15);
    expect(first[1]).toEqual({
      teams: [
        { name: 'Team 16', seed: 16 },
        { name: 'Team 17', seed: 17 },
      ],
      bye: false,
    });
    expect(first[0]).toEqual({ teams: [{ name: 'Team 1', seed: 1 }, null], bye: true });
    expect(bracket).not.toHaveProperty('winner');
  });

  test('leaves a place empty when its team is gone', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo']);
    const bravo = await teamIdOf(s, 'Bravo');
    await s.t.run((ctx) => ctx.db.delete('teams', bravo));
    const bracket = (await bracketOf(s))!;
    expect(bracket.rounds[0].games[0].teams).toEqual([{ name: 'Alpha', seed: 1 }, null]);
  });
});

describe('tournaments.getPublicPage bracket scores', () => {
  const FIVE = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

  async function delta(s: TournamentWorld, result: { score: Score; forfeitSide?: 0 | 1 }) {
    await play(s, 1, 2, [await teamIdOf(s, 'Delta'), await teamIdOf(s, 'Echo')], result);
    return (await bracketOf(s))!.rounds[0].games[1];
  }

  test('gives a game with a result its score, first team first', async () => {
    const s = await worldWithBracket(FIVE);
    expect(await delta(s, { score: THREE_SETS })).toEqual({
      teams: [
        { name: 'Delta', seed: 4 },
        { name: 'Echo', seed: 5 },
      ],
      bye: false,
      winner: 0,
      score: THREE_SETS,
    });
  });

  test('gives a soccer game its goals', async () => {
    const s = await worldWithBracket(FIVE);
    const goals: Score = { kind: 'goals', a: 1, b: 3 };
    expect(await delta(s, { score: goals })).toMatchObject({ winner: 1, score: goals });
  });

  test('gives a softball game its runs', async () => {
    const s = await worldWithBracket(FIVE);
    const runs: Score = { kind: 'runs', a: 7, b: 2 };
    expect(await delta(s, { score: runs })).toMatchObject({ winner: 0, score: runs });
  });

  test.each([0, 1] as const)(
    'gives a forfeit the place of the team that forfeited and no score (place %i)',
    async (side) => {
      const s = await worldWithBracket(FIVE);
      const game = await delta(s, {
        score: forfeitScore('beachVolleyball', 1, side),
        forfeitSide: side,
      });
      expect(game).toMatchObject({ forfeit: side, winner: side === 0 ? 1 : 0 });
      expect(game).not.toHaveProperty('score');
    },
  );

  test('leaves score and forfeit off a bye, a place to be decided, and a game with no result', async () => {
    const s = await worldWithBracket(FIVE);
    await delta(s, { score: ONE_SET });
    const rounds = (await bracketOf(s))!.rounds;
    const unplayed = [
      rounds[0].games[0],
      rounds[0].games[2],
      rounds[1].games[0],
      rounds[1].games[1],
      rounds[2].games[0],
    ];
    for (const game of unplayed) {
      expect(game).not.toHaveProperty('score');
      expect(game).not.toHaveProperty('forfeit');
    }
    expect(rounds[0].games[1]).not.toHaveProperty('forfeit');
  });

  test('leaves a bye out even when its row holds a winner and a stray score', async () => {
    const s = await worldWithBracket(FIVE);
    const bye = await gameAt(s, 1, 1);
    await s.t.run((ctx) => ctx.db.patch('tournamentGames', bye._id, { score: ONE_SET }));
    expect((await bracketOf(s))!.rounds[0].games[0]).not.toHaveProperty('score');
  });

  test('leaves the score off a game with a winner but no stored score', async () => {
    const s = await worldWithBracket(FIVE);
    await settle(s, 1, 2, [await teamIdOf(s, 'Delta'), await teamIdOf(s, 'Echo')], 0);
    const game = (await bracketOf(s))!.rounds[0].games[1];
    expect(game).toMatchObject({ winner: 0 });
    expect(game).not.toHaveProperty('score');
    expect(game).not.toHaveProperty('forfeit');
  });

  test('shows the corrected score once an organizer corrects a result', async () => {
    const s = await worldWithBracket(FIVE);
    expect(await delta(s, { score: ONE_SET })).toMatchObject({ score: ONE_SET });
    const corrected: Score = { kind: 'sets', sets: [{ a: 15, b: 21 }] };
    expect(await delta(s, { score: corrected })).toMatchObject({ winner: 1, score: corrected });
  });

  test('shows the corrected score through the result writer', async () => {
    const s = await worldWithBracket(FIVE);
    const game = await gameAt(s, 1, 2);
    const organizer = s.as(s.admin);
    await organizer.mutation(api.tournamentGames.enterResult, { gameId: game._id, score: ONE_SET });
    expect((await bracketOf(s))!.rounds[0].games[1]).toMatchObject({ score: ONE_SET });
    const corrected: Score = { kind: 'sets', sets: [{ a: 12, b: 21 }] };
    await organizer.mutation(api.tournamentGames.correctResult, {
      gameId: game._id,
      score: corrected,
    });
    expect((await bracketOf(s))!.rounds[0].games[1]).toMatchObject({ winner: 1, score: corrected });
  });

  test('holds no ids, the forfeiting team included', async () => {
    const s = await worldWithBracket(FIVE);
    await delta(s, { score: forfeitScore('beachVolleyball', 1, 1), forfeitSide: 1 });
    const bracket = await bracketOf(s);
    const stored = await gameAt(s, 1, 2);
    expect(stored.forfeitTeamId).toBeDefined();
    const json = JSON.stringify(bracket);
    expect(json).not.toContain(stored.forfeitTeamId!);
    expect(json).not.toMatch(/forfeitTeamId/);
  });
});
