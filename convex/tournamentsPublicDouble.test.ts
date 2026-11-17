/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { PlayoffStage } from './lib/doubleBracket';
import type { GrandFinal } from './lib/tournamentEdit';
import { TOURNAMENT_SLUGS, tournamentWorld, type TournamentWorld } from './tournamentWorld.setup';

afterEach(() => {
  vi.useRealTimers();
});

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

let registeredAt = 1_000;

async function world(
  teamCount: number,
  {
    grandFinal,
    bracketType = 'double',
  }: { grandFinal?: GrandFinal; bracketType?: 'single' | 'double' } = {},
) {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  const teamIds: Id<'teams'>[] = [];
  for (let number = 1; number <= teamCount; number++) {
    registeredAt += 1;
    teamIds.push(
      await s.t.run((ctx) =>
        ctx.db.insert('teams', {
          organizationId: s.a,
          tournamentId: s.gulf,
          name: `Team ${String(number).padStart(2, '0')}`,
          sortName: `team ${number}`,
          captainUserId: s.captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        }),
      ),
    );
  }
  await s.t.run((ctx) =>
    ctx.db.patch('tournaments', s.gulf, {
      bracketType,
      maximumTeams: 128,
      ...(grandFinal && { grandFinal }),
    }),
  );
  await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
  return { s, teamIds };
}

const bracketOf = async (s: TournamentWorld) =>
  (await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS))?.bracket;

const gamesOf = (s: TournamentWorld, stage: PlayoffStage) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', stage))
      .collect(),
  );

async function gameAt(s: TournamentWorld, stage: PlayoffStage, round: number, slot: number) {
  return (await gamesOf(s, stage)).find((game) => game.round === round && game.slot === slot)!;
}

async function win(s: TournamentWorld, game: Doc<'tournamentGames'>, teamId: Id<'teams'>) {
  const side = game.teamIds.indexOf(teamId);
  await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
    gameId: game._id,
    score: { kind: 'sets', sets: [side === 0 ? { a: 21, b: 15 } : { a: 15, b: 21 }] },
  });
}

async function playToGrandFinal(s: TournamentWorld, teamIds: readonly Id<'teams'>[]) {
  for (;;) {
    let played = false;
    for (const stage of ['bracket', 'losers'] as const) {
      for (const game of await gamesOf(s, stage)) {
        if (game.winnerTeamId !== undefined || game.teamIds.includes(null)) continue;
        const [a, b] = game.teamIds.map((id) => teamIds.indexOf(id!));
        await win(s, game, game.teamIds[a < b ? 0 : 1]!);
        played = true;
      }
    }
    if (!played) return gameAt(s, 'grandFinal', 1, 1);
  }
}

const seeded = (name: string, seed: number) => ({ name, seed });

describe('tournaments.getPublicPage for a double-elimination bracket', () => {
  test('lists the winners’ bracket, the losers’ bracket with its rounds, and the grand final, before any result', async () => {
    const { s } = await world(6);
    const bracket = (await bracketOf(s))!;
    expect(bracket.rounds.map((round) => round.name)).toEqual([
      'Winners’ round 1',
      'Winners’ semifinals',
      'Winners’ final',
    ]);
    expect(bracket.losers?.map((round) => [round.name, round.games.length])).toEqual([
      ['Losers’ round 1', 1],
      ['Losers’ round 2', 1],
      ['Losers’ round 3', 1],
      ['Losers’ final', 1],
    ]);
    expect(bracket.losers?.[0].games).toEqual([{ teams: [null, null], bye: false }]);
    expect(bracket.grandFinal).toEqual({
      games: [{ teams: [null, null], bye: false }],
      decidingGameIfNeeded: true,
    });
    expect(bracket).not.toHaveProperty('winner');
  });

  test('seats a winners’ bracket loser in the losers’ bracket, with its seed and the game’s winner', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    const bracket = (await bracketOf(s))!;
    expect(bracket.losers?.[0].games).toEqual([
      { teams: [seeded('Team 05', 5), seeded('Team 06', 6)], bye: false },
    ]);
  });

  test('keeps a single-elimination bracket to its rounds, with no losers’ bracket or grand final', async () => {
    const { s } = await world(6, { bracketType: 'single' });
    const bracket = (await bracketOf(s))!;
    expect(bracket).not.toHaveProperty('losers');
    expect(bracket).not.toHaveProperty('grandFinal');
    expect(bracket.rounds.map((round) => round.name)).toEqual([
      'Quarterfinals',
      'Semifinals',
      'Final',
    ]);
  });

  test('has a grand final and no losers’ bracket for two teams', async () => {
    const { s } = await world(2);
    const bracket = (await bracketOf(s))!;
    expect(bracket).not.toHaveProperty('losers');
    expect(bracket.grandFinal?.games).toHaveLength(1);
  });

  test('holds no ids in any section', async () => {
    const { s, teamIds } = await world(6);
    await playToGrandFinal(s, teamIds);
    expect(JSON.stringify(await bracketOf(s))).not.toMatch(/_id|_creationTime|"id"/);
  });
});

describe('tournaments.getPublicPage for the grand final', () => {
  test('waiting: game 1 is unplayed and may be followed by a deciding game', async () => {
    const { s, teamIds } = await world(6);
    await playToGrandFinal(s, teamIds);
    const { grandFinal } = (await bracketOf(s))!;
    expect(grandFinal).toEqual({
      games: [{ teams: [seeded('Team 01', 1), seeded('Team 02', 2)], bye: false }],
      decidingGameIfNeeded: true,
    });
  });

  test('not needed: the winners’ bracket team wins game 1, which names the winner and adds no game 2', async () => {
    const { s, teamIds } = await world(6);
    const first = await playToGrandFinal(s, teamIds);
    await win(s, first, first.teamIds[0]!);
    const bracket = (await bracketOf(s))!;
    expect(bracket.grandFinal?.games).toHaveLength(1);
    expect(bracket.grandFinal?.games[0].winner).toBe(0);
    expect(bracket.winner).toBe('Team 01');
  });

  test('deciding: the losers’ bracket team wins game 1, so game 2 has the same teams and no winner yet', async () => {
    const { s, teamIds } = await world(6);
    const first = await playToGrandFinal(s, teamIds);
    await win(s, first, first.teamIds[1]!);
    const bracket = (await bracketOf(s))!;
    const teams = [seeded('Team 01', 1), seeded('Team 02', 2)];
    expect(bracket.grandFinal?.games).toEqual([
      { teams, bye: false, winner: 1, score: { kind: 'sets', sets: [{ a: 15, b: 21 }] } },
      { teams, bye: false },
    ]);
    expect(bracket).not.toHaveProperty('winner');
  });

  test('played: game 2 shows its score and winner, and the winner is the tournament’s', async () => {
    const { s, teamIds } = await world(6);
    const first = await playToGrandFinal(s, teamIds);
    await win(s, first, first.teamIds[1]!);
    const second = await gameAt(s, 'grandFinal', 2, 1);
    await win(s, second, second.teamIds[0]!);
    const bracket = (await bracketOf(s))!;
    expect(bracket.grandFinal?.games[1]).toMatchObject({
      winner: 0,
      score: { kind: 'sets', sets: [{ a: 21, b: 15 }] },
    });
    expect(bracket.winner).toBe('Team 01');
  });

  test('a single game: the section says it has no deciding game', async () => {
    const { s, teamIds } = await world(6, { grandFinal: 'single' });
    const first = await playToGrandFinal(s, teamIds);
    await win(s, first, first.teamIds[1]!);
    const bracket = (await bracketOf(s))!;
    expect(bracket.grandFinal?.decidingGameIfNeeded).toBe(false);
    expect(bracket.grandFinal?.games).toHaveLength(1);
    expect(bracket.winner).toBe('Team 02');
  });
});
