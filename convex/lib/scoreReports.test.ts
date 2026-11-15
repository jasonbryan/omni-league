import { describe, expect, test } from 'vitest';
import type { Doc, Id, TableNames } from '../_generated/dataModel';
import { reportableGamesOf } from './scoreReports';
import type { Score } from './sports';

const id = <T extends TableNames>(name: string) => name as Id<T>;
const team = (name: string) => id<'teams'>(name);

type Game = Doc<'tournamentGames'>;

function game(
  stage: Game['stage'],
  round: number,
  slot: number,
  teamIds: readonly (string | null)[],
  rest: Partial<Game> = {},
): Game {
  return {
    _id: id<'tournamentGames'>(`${stage}-${round}-${slot}`),
    tournamentId: id<'tournaments'>('tournament'),
    stage,
    round,
    slot,
    teamIds: teamIds.map((name) => (name === null ? null : team(name))),
    ...rest,
  } as Game;
}

const SCORE: Score = { kind: 'sets', sets: [{ a: 21, b: 15 }] };

describe('reportableGamesOf for a pool', () => {
  test('lists the two pool games of a team with three games that have no result, in round order', () => {
    const games = [
      game('pool', 3, 1, ['crabs', 'bombers']),
      game('pool', 1, 1, ['crabs', 'squad'], { winnerTeamId: team('crabs'), score: SCORE }),
      game('pool', 2, 2, ['squad', 'crabs']),
      game('pool', 2, 1, ['bombers', 'point']),
    ];
    expect(reportableGamesOf(games, team('crabs')).map((row) => [row.round, row.slot])).toEqual([
      [2, 2],
      [3, 1],
    ]);
  });

  test('lists a game in slot order within a round', () => {
    const games = [
      game('pool', 2, 2, ['crabs', 'squad']),
      game('pool', 1, 2, ['crabs', 'point']),
      game('pool', 1, 1, ['crabs', 'bombers']),
    ];
    expect(reportableGamesOf(games, team('crabs')).map((row) => [row.round, row.slot])).toEqual([
      [1, 1],
      [1, 2],
      [2, 2],
    ]);
  });

  test('counts a tied game, which has a score and no winner, as having a result', () => {
    const games = [
      game('pool', 1, 1, ['crabs', 'squad'], { score: SCORE }),
      game('pool', 2, 1, ['crabs', 'bombers']),
    ];
    expect(reportableGamesOf(games, team('crabs')).map((row) => row.round)).toEqual([2]);
  });

  test('lists nothing once every game of the team has a result', () => {
    const games = [game('pool', 1, 1, ['crabs', 'squad'], { score: SCORE })];
    expect(reportableGamesOf(games, team('crabs'))).toEqual([]);
  });
});

describe('reportableGamesOf for a bracket', () => {
  test('lists only the current game: the first without a winner, when both of its teams are set', () => {
    const games = [game('bracket', 1, 1, ['crabs', 'squad']), game('bracket', 2, 1, [null, null])];
    expect(reportableGamesOf(games, team('crabs')).map((row) => row.round)).toEqual([1]);
  });

  test('lists nothing while the current game waits on its other place', () => {
    const games = [
      game('bracket', 1, 1, ['crabs', 'squad'], { winnerTeamId: team('crabs'), score: SCORE }),
      game('bracket', 2, 1, ['crabs', null]),
    ];
    expect(reportableGamesOf(games, team('crabs'))).toEqual([]);
  });

  test('skips a bye, which has a winner from the start', () => {
    const games = [
      game('bracket', 1, 1, ['crabs', null], { winnerTeamId: team('crabs') }),
      game('bracket', 2, 1, ['crabs', 'squad']),
    ];
    expect(reportableGamesOf(games, team('crabs')).map((row) => row.round)).toEqual([2]);
  });
});
