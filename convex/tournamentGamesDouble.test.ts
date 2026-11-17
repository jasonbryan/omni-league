/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { BRACKET_MESSAGES } from './lib/bracket';
import { FORBIDDEN_CODE } from './lib/forbidden';
import type { PlayoffStage } from './lib/doubleBracket';
import type { Score } from './lib/sports';
import type { GrandFinal, TournamentEditable } from './lib/tournamentEdit';
import {
  NOT_MANAGERS,
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

let registeredAt = 1_000;

/** Teams `Team 01` onward, registered in that order, so Team 01 is seed 1; the bracket is double elimination and created. */
async function world(
  teamCount: number,
  { grandFinal, create = true }: { grandFinal?: GrandFinal; create?: boolean } = {},
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
      bracketType: 'double',
      maximumTeams: 128,
      ...(grandFinal && { grandFinal }),
    }),
  );
  if (create) await createBracket(s);
  return { s, teamIds };
}

const createBracket = (
  s: TournamentWorld,
  args: { replace?: boolean } = {},
  who: Person = s.admin,
) => s.as(who).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf, ...args });

const gamesOf = (s: TournamentWorld, stage: PlayoffStage) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', stage))
      .collect(),
  );

async function gameAt(
  s: TournamentWorld,
  stage: PlayoffStage,
  round: number,
  slot: number,
): Promise<Doc<'tournamentGames'>> {
  return (await gamesOf(s, stage)).find((game) => game.round === round && game.slot === slot)!;
}

const nameOf = async (s: TournamentWorld, teamId: Id<'teams'> | null | undefined) =>
  teamId ? (await s.t.run((ctx) => ctx.db.get('teams', teamId)))!.name : null;

const teamsOfGame = async (s: TournamentWorld, game: Doc<'tournamentGames'>) =>
  Promise.all(game.teamIds.map((teamId) => nameOf(s, teamId)));

const scoreFor = (side: 0 | 1): Score => ({
  kind: 'sets',
  sets: [side === 0 ? { a: 21, b: 15 } : { a: 15, b: 21 }],
});

/** The named team wins 21 to 15. */
async function win(
  s: TournamentWorld,
  game: Doc<'tournamentGames'>,
  teamId: Id<'teams'>,
  { correct = false }: { correct?: boolean } = {},
) {
  const side = game.teamIds.indexOf(teamId);
  if (side !== 0 && side !== 1) throw new Error('The team is not in the game');
  return s
    .as(s.admin)
    .mutation(correct ? api.tournamentGames.correctResult : api.tournamentGames.enterResult, {
      gameId: game._id,
      score: scoreFor(side),
    });
}

const STAGE_ORDER: readonly PlayoffStage[] = ['bracket', 'losers', 'grandFinal'];

/** Plays every game that has two teams and no result, until none is left, with `pick` choosing each winner. */
async function playOut(
  s: TournamentWorld,
  pick: (game: Doc<'tournamentGames'>) => Id<'teams'>,
  { skip = () => false }: { skip?: (game: Doc<'tournamentGames'>) => boolean } = {},
): Promise<void> {
  for (;;) {
    let played = false;
    for (const stage of STAGE_ORDER) {
      for (const game of await gamesOf(s, stage)) {
        if (game.winnerTeamId !== undefined || game.teamIds.includes(null) || skip(game)) continue;
        await win(s, game, pick(game));
        played = true;
      }
    }
    if (!played) return;
  }
}

/** The team with the lower seed wins, except in the grand final, where `grandFinalWinner` picks the side. */
function lowerSeedWins(teamIds: readonly Id<'teams'>[], grandFinalSide: 0 | 1) {
  return (game: Doc<'tournamentGames'>) => {
    if (game.stage === 'grandFinal' && game.round === 1) return game.teamIds[grandFinalSide]!;
    if (game.stage === 'grandFinal') return game.teamIds[0]!;
    const [a, b] = game.teamIds.map((id) => teamIds.indexOf(id!));
    return game.teamIds[a < b ? 0 : 1]!;
  };
}

const isDecidingGame = (game: Doc<'tournamentGames'>) =>
  game.stage === 'grandFinal' && game.round === 2;

const setup = (s: TournamentWorld, who: Person = s.admin) =>
  s.as(who).query(api.tournamentGames.getSetup, TOURNAMENT_SLUGS);

const HELD: TournamentEditable = {
  startDate: '2030-06-01',
  endDate: '2030-06-02',
  registrationDeadline: '2030-05-20',
  maximumTeams: 4,
  setsPerGame: 1,
  structure: 'bracket',
  bracketType: 'single',
  grandFinal: 'ifNecessary',
};

const editDetails = (
  s: TournamentWorld,
  change: Partial<TournamentEditable>,
  held: TournamentEditable = HELD,
  who: Pick<Person, 'authUserId' | 'name'> = s.admin,
) =>
  s.as(who).mutation(api.tournaments.updateDetails, {
    tournamentId: s.gulf,
    startDate: held.startDate,
    endDate: held.endDate,
    registrationDeadline: held.registrationDeadline,
    maximumTeams: held.maximumTeams,
    ...change,
    expected: held,
  });

const heldNow = async (s: TournamentWorld): Promise<TournamentEditable> => {
  const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
  return {
    ...HELD,
    maximumTeams: row.maximumTeams,
    bracketType: row.bracketType,
    grandFinal: row.grandFinal ?? 'ifNecessary',
    structure: row.structure,
  };
};

describe('tournamentGames.createBracket for a double-elimination bracket', () => {
  test('makes the winners bracket, the losers bracket, and the first grand final game for 6 teams', async () => {
    const { s } = await world(6, { create: false });
    expect(await createBracket(s)).toEqual({ gameCount: 12, replaced: false });
    expect((await gamesOf(s, 'bracket')).map((game) => [game.round, game.slot])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 1],
      [2, 2],
      [3, 1],
    ]);
    expect((await gamesOf(s, 'losers')).map((game) => [game.round, game.slot])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    expect((await gamesOf(s, 'grandFinal')).map((game) => [game.round, game.slot])).toEqual([
      [1, 1],
    ]);
  });

  test('pairs the 6 teams as the plan does and leaves the later places empty', async () => {
    const { s } = await world(6);
    const round1 = (await gamesOf(s, 'bracket')).filter((game) => game.round === 1);
    expect(await Promise.all(round1.map((game) => teamsOfGame(s, game)))).toEqual([
      ['Team 01', null],
      ['Team 04', 'Team 05'],
      ['Team 02', null],
      ['Team 03', 'Team 06'],
    ]);
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 1, 1))).toEqual([null, null]);
  });

  test('a single-elimination tournament still makes only winners bracket games', async () => {
    const { s } = await world(6, { create: false });
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { bracketType: 'single' }));
    expect(await createBracket(s)).toEqual({ gameCount: 7, replaced: false });
    expect(await gamesOf(s, 'losers')).toEqual([]);
    expect(await gamesOf(s, 'grandFinal')).toEqual([]);
  });

  test('recreating replaces the losers bracket and the grand final too', async () => {
    const { s } = await world(6);
    expect(await createBracket(s, { replace: true })).toEqual({ gameCount: 12, replaced: true });
    expect(await gamesOf(s, 'bracket')).toHaveLength(7);
    expect(await gamesOf(s, 'losers')).toHaveLength(4);
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(1);
  });

  test('recreating is refused once a result exists, and writes nothing', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    const before = await s.t.run((ctx) => ctx.db.query('tournamentGames').collect());
    expect(await createBracket(s, { replace: true }).catch(refusalOf)).toMatchObject({
      code: 'resultEntered',
    });
    expect(await s.t.run((ctx) => ctx.db.query('tournamentGames').collect())).toEqual(before);
  });
});

describe('tournamentGames.enterResult in a double-elimination bracket', () => {
  test('a winners bracket loss puts the loser in its losers bracket place and the winner in the next winners game', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 1, 1))).toEqual(['Team 05', null]);
    expect(await teamsOfGame(s, await gameAt(s, 'bracket', 2, 1))).toEqual(['Team 01', 'Team 04']);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 1, 1))).toEqual(['Team 05', 'Team 06']);
  });

  test('the loser of a semifinal drops to the losers bracket, and the loser of a losers bracket game is out', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    await win(s, await gameAt(s, 'bracket', 2, 1), teamIds[0]);
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 2, 1))).toEqual([null, 'Team 04']);
    await win(s, await gameAt(s, 'losers', 1, 1), teamIds[4]);
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 2, 1))).toEqual(['Team 05', 'Team 04']);
    const out = await gameAt(s, 'losers', 1, 1);
    expect(out.loserNextGameId).toBeUndefined();
    expect(out.nextGameId).toBeDefined();
  });

  test('every team goes out on a second loss and the grand final holds the two that have not', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 0));
    const grandFinal = await gameAt(s, 'grandFinal', 1, 1);
    expect(await teamsOfGame(s, grandFinal)).toEqual(['Team 01', 'Team 02']);
    expect(grandFinal.winnerTeamId).toEqual(teamIds[0]);
  });

  test('the winners bracket winner takes the grand final’s first side', async () => {
    const { s, teamIds } = await world(8);
    await playOut(s, lowerSeedWins(teamIds, 0));
    const [first] = await gamesOf(s, 'grandFinal');
    expect(await teamsOfGame(s, first)).toEqual(['Team 01', 'Team 02']);
  });
});

describe('the grand final', () => {
  test('Deciding game if needed: the losers bracket team winning the first game creates a second game that decides the tournament', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 1));
    const grandFinals = await gamesOf(s, 'grandFinal');
    expect(grandFinals.map((game) => [game.round, game.slot])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(await teamsOfGame(s, grandFinals[1])).toEqual(['Team 01', 'Team 02']);
    // The first game's loser is the winners bracket team and plays the second game as the first side.
    expect(grandFinals[0].winnerTeamId).toEqual(teamIds[1]);
    expect(grandFinals[1].winnerTeamId).toEqual(teamIds[0]);
    expect((await setup(s))!.bracket!.winner).toEqual({ teamId: teamIds[0], name: 'Team 01' });
  });

  test('Deciding game if needed: nobody has won while the second game has no result', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 1), { skip: isDecidingGame });
    const bracket = (await setup(s))!.bracket!;
    expect(bracket.winner).toBeNull();
    expect(bracket.grandFinalRounds!.map((round) => round.name)).toEqual([
      'Grand final',
      'Grand final, deciding game',
    ]);
  });

  test('Deciding game if needed: the winners bracket team winning the first game wins, with no second game', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 0));
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(1);
    expect((await setup(s))!.bracket!.winner).toEqual({ teamId: teamIds[0], name: 'Team 01' });
  });

  test('Single game: the first game decides the tournament whoever wins it', async () => {
    const { s, teamIds } = await world(6, { grandFinal: 'single' });
    await playOut(s, lowerSeedWins(teamIds, 1));
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(1);
    expect((await setup(s))!.bracket!.winner).toEqual({ teamId: teamIds[1], name: 'Team 02' });
  });

  test('correcting the first game so the winners bracket team wins removes the second game', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 1), { skip: isDecidingGame });
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(2);
    await win(s, await gameAt(s, 'grandFinal', 1, 1), teamIds[0], { correct: true });
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(1);
    expect((await setup(s))!.bracket!.winner).toEqual({ teamId: teamIds[0], name: 'Team 01' });
  });

  test('clearing the first game removes the second game and the winner', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 1));
    const second = await gameAt(s, 'grandFinal', 2, 1);
    await s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId: second._id });
    const first = await gameAt(s, 'grandFinal', 1, 1);
    await s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId: first._id });
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(1);
    expect((await setup(s))!.bracket!.winner).toBeNull();
  });

  test('the first game cannot change once the second game has a result', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 1));
    const first = await gameAt(s, 'grandFinal', 1, 1);
    expect(await win(s, first, teamIds[0], { correct: true }).catch(refusalOf)).toMatchObject({
      code: 'nextGamePlayed',
    });
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(2);
  });
});

describe('corrections in a double-elimination bracket', () => {
  test('a correction that changes the winner moves both teams: the new loser drops to the losers bracket', async () => {
    const { s, teamIds } = await world(6);
    const game = await gameAt(s, 'bracket', 1, 2);
    await win(s, game, teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[4], { correct: true });
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 1, 1))).toEqual(['Team 04', null]);
    expect(await teamsOfGame(s, await gameAt(s, 'bracket', 2, 1))).toEqual(['Team 01', 'Team 05']);
  });

  test('a correction is refused once the loser has played in the losers bracket', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    await win(s, await gameAt(s, 'losers', 1, 1), teamIds[4]);
    const game = await gameAt(s, 'bracket', 1, 2);
    const before = await s.t.run((ctx) => ctx.db.query('tournamentGames').collect());
    expect(await win(s, game, teamIds[4], { correct: true }).catch(refusalOf)).toMatchObject({
      code: 'loserGamePlayed',
      message: BRACKET_MESSAGES.loserGamePlayed,
    });
    expect(await s.t.run((ctx) => ctx.db.query('tournamentGames').collect())).toEqual(before);
    const view = (await setup(s))!.bracket!;
    expect(view.rounds[0].games[1]).toMatchObject({ locked: true, lockedBy: 'loser' });
  });

  test('clearing a winners bracket result empties the loser’s losers bracket place', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    const game = await gameAt(s, 'bracket', 1, 2);
    await s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId: game._id });
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 1, 1))).toEqual([null, null]);
  });

  test('a forfeit drops the forfeiting team to the losers bracket', async () => {
    const { s, teamIds } = await world(6);
    const game = await gameAt(s, 'bracket', 1, 2);
    await s
      .as(s.admin)
      .mutation(api.tournamentGames.enterResult, { gameId: game._id, forfeitTeamId: teamIds[3] });
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 1, 1))).toEqual(['Team 04', null]);
  });
});

describe('tournamentGames.getSetup for a double-elimination bracket', () => {
  test('lists the winners rounds, the losers rounds, and the grand final', async () => {
    const { s } = await world(6);
    const bracket = (await setup(s))!.bracket!;
    expect(bracket.bracketType).toBe('double');
    expect(bracket.rounds.map((round) => round.name)).toEqual([
      'Winners’ round 1',
      'Winners’ semifinals',
      'Winners’ final',
    ]);
    expect(bracket.losersRounds!.map((round) => round.name)).toEqual([
      'Losers’ round 1',
      'Losers’ round 2',
      'Losers’ round 3',
      'Losers’ final',
    ]);
    expect(bracket.grandFinalRounds!.map((round) => round.name)).toEqual(['Grand final']);
  });

  test('keeps the winners rounds of a single-elimination bracket as they were, with no losers rounds', async () => {
    const { s } = await world(5, { create: false });
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { bracketType: 'single' }));
    await createBracket(s);
    const bracket = (await setup(s))!.bracket!;
    expect(bracket.rounds.map((round) => round.name)).toEqual([
      'Quarterfinals',
      'Semifinals',
      'Final',
    ]);
    expect(bracket.losersRounds).toBeUndefined();
    expect(bracket.grandFinalRounds).toBeUndefined();
  });
});

describe('tournaments.updateDetails: the bracket type and the grand final', () => {
  test('an organizer chooses Double elimination and Single game before the bracket exists', async () => {
    const { s } = await world(6, { create: false });
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { bracketType: 'single' }));
    const result = await editDetails(
      s,
      { bracketType: 'double', grandFinal: 'single' },
      await heldNow(s),
    );
    expect(result.written).toMatchObject({ bracketType: 'double', grandFinal: 'single' });
    expect(result.earlier).toMatchObject({ bracketType: 'single' });
    expect(result.earlier).not.toHaveProperty('grandFinal');
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect([row.bracketType, row.grandFinal]).toEqual(['double', 'single']);
  });

  test('a save of a single-elimination tournament leaves the grand final absent', async () => {
    const { s } = await world(6, { create: false });
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { bracketType: 'single' }));
    await editDetails(s, { maximumTeams: 90, bracketType: 'single' }, await heldNow(s));
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect(row).not.toHaveProperty('grandFinal');
  });

  test('a grand final that was sent is kept by a later save that sends none', async () => {
    const { s } = await world(6, { create: false });
    await editDetails(s, { grandFinal: 'single' }, await heldNow(s));
    await editDetails(s, { maximumTeams: 90 }, await heldNow(s));
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect(row.grandFinal).toBe('single');
  });

  test('an older form that sends neither leaves both as they are', async () => {
    const { s } = await world(6, { create: false });
    const held = await heldNow(s);
    const { bracketType, grandFinal, ...older } = held;
    expect([bracketType, grandFinal]).toEqual(['double', 'ifNecessary']);
    await s.as(s.admin).mutation(api.tournaments.updateDetails, {
      tournamentId: s.gulf,
      startDate: held.startDate,
      endDate: held.endDate,
      registrationDeadline: held.registrationDeadline,
      maximumTeams: 100,
      expected: older,
    });
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect([row.bracketType, row.grandFinal, row.maximumTeams]).toEqual(['double', undefined, 100]);
  });

  test('the bracket type is refused once bracket games exist, and nothing changes', async () => {
    const { s } = await world(6);
    expect(
      await editDetails(s, { bracketType: 'single' }, await heldNow(s)).catch(refusalOf),
    ).toMatchObject({ code: 'bracketTypeLocked', field: 'bracketType' });
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect(row.bracketType).toBe('double');
  });

  test('a save that keeps the bracket type still saves after bracket games exist', async () => {
    const { s } = await world(6);
    const result = await editDetails(s, { maximumTeams: 64 }, await heldNow(s));
    expect(result.written).toMatchObject({ maximumTeams: 64, bracketType: 'double' });
  });

  test('the grand final can change after the bracket exists, until it has a result', async () => {
    const { s, teamIds } = await world(6);
    const first = await editDetails(s, { grandFinal: 'single' }, await heldNow(s));
    expect(first.written.grandFinal).toBe('single');
    await playOut(s, lowerSeedWins(teamIds, 0));
    expect(
      await editDetails(s, { grandFinal: 'ifNecessary' }, await heldNow(s)).catch(refusalOf),
    ).toMatchObject({ code: 'grandFinalLocked', field: 'grandFinal' });
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect(row.grandFinal).toBe('single');
  });

  test('the grand final can change again once its result is cleared', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 0));
    const first = await gameAt(s, 'grandFinal', 1, 1);
    await s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId: first._id });
    const result = await editDetails(s, { grandFinal: 'single' }, await heldNow(s));
    expect(result.written.grandFinal).toBe('single');
  });

  test('Undo restores the earlier bracket type and grand final while no bracket exists', async () => {
    const { s } = await world(6, { create: false });
    const held = await heldNow(s);
    const result = await editDetails(s, { bracketType: 'single', grandFinal: 'single' }, held);
    await s.as(s.admin).mutation(api.tournaments.undoUpdateDetails, {
      tournamentId: s.gulf,
      ...result,
    });
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect([row.bracketType, row.grandFinal]).toEqual(['double', undefined]);
  });

  test('an organizer assigned to the tournament changes the bracket type and the grand final', async () => {
    const { s } = await world(6, { create: false });
    const result = await editDetails(
      s,
      { bracketType: 'single', grandFinal: 'single' },
      await heldNow(s),
      s.assignedOrganizer,
    );
    expect(result.written).toMatchObject({ bracketType: 'single', grandFinal: 'single' });
  });

  test.each([...NOT_MANAGERS])('refuses %s', async (who) => {
    const { s } = await world(6, { create: false });
    const held = await heldNow(s);
    await expect(
      editDetails(s, { bracketType: 'single', grandFinal: 'single' }, held, s[who]),
    ).rejects.toThrow(/Not allowed/);
    const row = (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!;
    expect([row.bracketType, row.grandFinal]).toEqual(['double', undefined]);
  });

  test('refuses a signed-out caller', async () => {
    const { s } = await world(6, { create: false });
    const held = await heldNow(s);
    await expect(
      s.t.mutation(api.tournaments.updateDetails, {
        tournamentId: s.gulf,
        startDate: held.startDate,
        registrationDeadline: held.registrationDeadline,
        maximumTeams: held.maximumTeams,
        bracketType: 'single',
        expected: held,
      }),
    ).rejects.toThrow();
  });
});

describe('access to a double-elimination bracket', () => {
  test.each([...NOT_MANAGERS])(
    '%s cannot create the bracket, enter a losers bracket result, or read it',
    async (who) => {
      const { s, teamIds } = await world(6);
      await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
      await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
      const losersGame = await gameAt(s, 'losers', 1, 1);
      await expect(createBracket(s, { replace: true }, s[who])).rejects.toThrow(/Not allowed/);
      await expect(
        s.as(s[who]).mutation(api.tournamentGames.enterResult, {
          gameId: losersGame._id,
          score: scoreFor(0),
        }),
      ).rejects.toThrow(/Not allowed/);
      expect(await setup(s, s[who]).catch(refusalOf)).toEqual({ code: FORBIDDEN_CODE });
      expect((await gameAt(s, 'losers', 1, 1)).winnerTeamId).toBeUndefined();
    },
  );

  test('a signed-out caller cannot enter a losers bracket result', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    const losersGame = await gameAt(s, 'losers', 1, 1);
    await expect(
      s.t.mutation(api.tournamentGames.enterResult, {
        gameId: losersGame._id,
        score: scoreFor(0),
      }),
    ).rejects.toThrow();
  });

  test('an organizer assigned to the tournament enters a losers bracket result', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    const losersGame = await gameAt(s, 'losers', 1, 1);
    await s
      .as(s.assignedOrganizer)
      .mutation(api.tournamentGames.enterResult, { gameId: losersGame._id, score: scoreFor(0) });
    expect((await gameAt(s, 'losers', 1, 1)).winnerTeamId).toEqual(teamIds[4]);
  });
});

describe('the public page for a double-elimination bracket', () => {
  const page = (s: TournamentWorld) => s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS);

  test('shows the winners’ bracket with its round names, and no winner before the grand final is decided', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    const { bracket } = (await page(s))!;
    expect(bracket!.rounds.map((round) => round.name)).toEqual([
      'Winners’ round 1',
      'Winners’ semifinals',
      'Winners’ final',
    ]);
    expect(bracket!.winner).toBeUndefined();
  });

  test('does not name the winners’ bracket winner as the tournament winner', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 1), { skip: (game) => game.stage === 'grandFinal' });
    expect((await page(s))!.bracket!.winner).toBeUndefined();
  });

  test('names the winner once the deciding game is played', async () => {
    const { s, teamIds } = await world(6);
    await playOut(s, lowerSeedWins(teamIds, 1));
    expect((await page(s))!.bracket!.winner).toBe('Team 01');
  });
});

describe('a captain’s score report in a double-elimination bracket', () => {
  const forTeam = (s: TournamentWorld, teamId: Id<'teams'>) =>
    s.as(s.captain).query(api.scoreReports.forTeam, { teamId });

  test('offers the losers’ bracket game to the team that dropped into it, as a bracket game', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    const view = (await forTeam(s, teamIds[4]))!;
    expect(view.games).toEqual([
      expect.objectContaining({ stage: 'bracket', roundName: 'Losers’ round 1' }),
    ]);
    expect(view.game).toEqual(view.games[0]);
  });

  test('lets the captain report the score, and the organizer confirm it into the losers’ bracket', async () => {
    const { s, teamIds } = await world(6);
    await win(s, await gameAt(s, 'bracket', 1, 2), teamIds[3]);
    await win(s, await gameAt(s, 'bracket', 1, 4), teamIds[2]);
    const game = await gameAt(s, 'losers', 1, 1);
    await s.as(s.captain).mutation(api.scoreReports.report, {
      gameId: game._id,
      teamId: teamIds[4],
      score: scoreFor(0),
    });
    const reportId = (await s.t.run((ctx) => ctx.db.query('scoreReports').collect()))[0];
    await s.as(s.admin).mutation(api.scoreReports.confirm, {
      reportId: reportId._id,
      expected: reportId.reportedAt,
    });
    expect((await gameAt(s, 'losers', 1, 1)).winnerTeamId).toEqual(teamIds[4]);
    expect(await teamsOfGame(s, await gameAt(s, 'losers', 2, 1))).toEqual(['Team 05', null]);
  });
});

describe('Pools, then bracket with Double elimination', () => {
  /** Six teams in 2 pools of 3 with the pool games created; `bracketType` is as the organizer left it. */
  async function poolsWorld(bracketType: 'single' | 'double') {
    const { s, teamIds } = await world(6, { create: false });
    await s.t.run((ctx) =>
      ctx.db.patch('tournaments', s.gulf, { structure: 'pools', bracketType }),
    );
    await s
      .as(s.admin)
      .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 });
    await s.as(s.admin).mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf });
    return { s, teamIds };
  }

  async function playPools(s: TournamentWorld, teamIds: readonly Id<'teams'>[]) {
    const poolGames = await s.t.run((ctx) =>
      ctx.db
        .query('tournamentGames')
        .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'pool'))
        .collect(),
    );
    for (const game of poolGames) {
      const [a, b] = game.teamIds.map((id) => teamIds.indexOf(id!));
      await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
        gameId: game._id,
        score: scoreFor(a < b ? 0 : 1),
      });
    }
  }

  const createFromPools = async (s: TournamentWorld) => {
    const { ranked } = (await s
      .as(s.admin)
      .query(api.tournamentGames.getPoolBracket, TOURNAMENT_SLUGS))!;
    return s.as(s.admin).mutation(api.tournamentGames.createBracketFromPools, {
      tournamentId: s.gulf,
      advancePerPool: 2,
      expectedRanking: ranked.map((team) => team.teamId),
    });
  };

  test('the bracket from the pools is double elimination', async () => {
    const { s, teamIds } = await poolsWorld('double');
    await playPools(s, teamIds);
    expect(await createFromPools(s)).toEqual({ gameCount: 6, replaced: false, teamCount: 4 });
    expect(await gamesOf(s, 'bracket')).toHaveLength(3);
    expect(await gamesOf(s, 'losers')).toHaveLength(2);
    expect(await gamesOf(s, 'grandFinal')).toHaveLength(1);
    const view = (await s.as(s.admin).query(api.tournamentGames.getPoolBracket, TOURNAMENT_SLUGS))!
      .bracket!;
    expect(view.losersRounds).toHaveLength(2);
  });

  test('the bracket from the pools stays single elimination for a single-elimination tournament', async () => {
    const { s, teamIds } = await poolsWorld('single');
    await playPools(s, teamIds);
    expect(await createFromPools(s)).toEqual({ gameCount: 3, replaced: false, teamCount: 4 });
    expect(await gamesOf(s, 'losers')).toEqual([]);
  });

  test('the bracket type can change while pool games exist, and not once the bracket exists', async () => {
    const { s, teamIds } = await poolsWorld('single');
    const changed = await editDetails(
      s,
      { bracketType: 'double' },
      {
        ...(await heldNow(s)),
        bracketType: 'single',
      },
    );
    expect(changed.written.bracketType).toBe('double');
    await playPools(s, teamIds);
    await createFromPools(s);
    expect(
      await editDetails(s, { bracketType: 'single' }, await heldNow(s)).catch(refusalOf),
    ).toMatchObject({ code: 'bracketTypeLocked' });
  });
});
