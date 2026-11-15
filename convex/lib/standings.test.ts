import { describe, expect, test } from 'vitest';
import { forfeitScore, type Score } from './sports';
import {
  STANDINGS_TIEBREAKER_NOTES,
  standingsCells,
  standingsColumns,
  standingsOf,
  type StandingsGame,
} from './standings';

const set = (a: number, b: number): Score => ({ kind: 'sets', sets: [{ a, b }] });
const goals = (a: number, b: number): Score => ({ kind: 'goals', a, b });
const runs = (a: number, b: number): Score => ({ kind: 'runs', a, b });

/** Team `first` is the game's first team. */
const played = (first: string, second: string, score: Score): StandingsGame => ({
  teamIds: [first, second],
  score,
});

const order = (rows: ReturnType<typeof standingsOf>) => rows.map((row) => row.teamId);
const places = (rows: ReturnType<typeof standingsOf>) => rows.map((row) => row.place);

describe('standingsOf: no result', () => {
  test('lists every team in the given order, all in first place, with nothing played', () => {
    const rows = standingsOf('soccer', ['A', 'B', 'C'], []);
    expect(order(rows)).toEqual(['A', 'B', 'C']);
    expect(places(rows)).toEqual([1, 1, 1]);
    expect(rows.every((row) => row.played === 0)).toBe(true);
  });

  test('ignores a game that names a team outside the pool', () => {
    const rows = standingsOf('soccer', ['A', 'B'], [played('A', 'Z', goals(5, 0))]);
    expect(rows.map((row) => row.played)).toEqual([0, 0]);
  });
});

describe('standingsOf: beach volleyball', () => {
  test('ranks by match win percentage', () => {
    const rows = standingsOf(
      'beachVolleyball',
      ['A', 'B', 'C'],
      [played('A', 'B', set(21, 15)), played('A', 'C', set(21, 10)), played('B', 'C', set(21, 18))],
    );
    expect(order(rows)).toEqual(['A', 'B', 'C']);
    expect(places(rows)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ played: 2, won: 2, lost: 0 });
  });

  test('a team that has not played ranks above a team that lost and below a team that won', () => {
    const rows = standingsOf('beachVolleyball', ['A', 'B', 'C'], [played('A', 'B', set(21, 15))]);
    expect(order(rows)).toEqual(['A', 'C', 'B']);
  });

  test('head-to-head comes before the point differential for a two-way tie', () => {
    const rows = standingsOf(
      'beachVolleyball',
      ['A', 'B', 'C', 'D'],
      [
        played('A', 'B', set(21, 20)),
        played('A', 'C', set(21, 20)),
        played('D', 'A', set(21, 0)),
        played('B', 'C', set(21, 0)),
        played('B', 'D', set(21, 0)),
        played('C', 'D', set(21, 20)),
      ],
    );
    expect(order(rows)).toEqual(['A', 'B', 'C', 'D']);
    expect(places(rows)).toEqual([1, 2, 3, 4]);
  });

  test('a three-way tie that head-to-head and set win percentage leave level is ordered by point differential', () => {
    const rows = standingsOf(
      'beachVolleyball',
      ['A', 'B', 'C'],
      [played('A', 'B', set(21, 10)), played('B', 'C', set(21, 19)), played('C', 'A', set(21, 19))],
    );
    expect(order(rows)).toEqual(['A', 'C', 'B']);
    expect(places(rows)).toEqual([1, 2, 3]);
  });

  test('set win percentage comes before the point differential', () => {
    const sets = (...pairs: [number, number][]): Score => ({
      kind: 'sets',
      sets: pairs.map(([a, b]) => ({ a, b })),
    });
    const rows = standingsOf(
      'beachVolleyball',
      ['A', 'B', 'C'],
      [
        played('A', 'B', sets([21, 0], [0, 21], [21, 0])),
        played('B', 'C', sets([21, 19], [21, 19])),
        played('C', 'A', sets([21, 20], [21, 20])),
      ],
    );
    expect(rows.map((row) => row.won)).toEqual([1, 1, 1]);
    expect(order(rows)).toEqual(['B', 'C', 'A']);
    expect(rows.map((row) => [row.setsWon, row.setsLost])).toEqual([
      [3, 2],
      [2, 2],
      [2, 3],
    ]);
  });

  test('a forfeit counts as a loss for the team that forfeited, at the forfeit score', () => {
    const rows = standingsOf(
      'beachVolleyball',
      ['A', 'B'],
      [{ teamIds: ['A', 'B'], score: forfeitScore('beachVolleyball', 1, 0) }],
    );
    expect(rows[0]).toMatchObject({ teamId: 'B', won: 1, pointsFor: 21, pointsAgainst: 0 });
    expect(rows[1]).toMatchObject({ teamId: 'A', lost: 1, pointsFor: 0, pointsAgainst: 21 });
  });

  test('a forfeit that is best of 3 counts the sets it was won by', () => {
    const rows = standingsOf(
      'beachVolleyball',
      ['A', 'B'],
      [{ teamIds: ['A', 'B'], score: forfeitScore('beachVolleyball', 3, 1) }],
    );
    expect(rows[0]).toMatchObject({ teamId: 'A', won: 1, setsWon: 2, setsLost: 0 });
    expect(rows[1]).toMatchObject({ teamId: 'B', lost: 1, setsWon: 0, setsLost: 2 });
  });
});

describe('standingsOf: soccer', () => {
  test('ranks by points: 3 for a win, 1 for a draw, 0 for a loss', () => {
    const rows = standingsOf(
      'soccer',
      ['A', 'B', 'C'],
      [played('A', 'B', goals(1, 1)), played('A', 'C', goals(0, 2)), played('B', 'C', goals(0, 0))],
    );
    expect(rows.map((row) => [row.teamId, row.won, row.tied, row.lost])).toEqual([
      ['C', 1, 1, 0],
      ['B', 0, 2, 0],
      ['A', 0, 1, 1],
    ]);
    expect(standingsCells('soccer', rows[0])).toEqual(['2', '1', '1', '0', '+2', '4']);
  });

  test('goal difference breaks a tie on points', () => {
    const rows = standingsOf(
      'soccer',
      ['A', 'B', 'C', 'D'],
      [
        played('A', 'D', goals(2, 0)),
        played('B', 'D', goals(1, 0)),
        played('C', 'D', goals(1, 0)),
        played('A', 'B', goals(0, 0)),
        played('A', 'C', goals(0, 0)),
        played('B', 'C', goals(0, 0)),
      ],
    );
    expect(order(rows)).toEqual(['A', 'B', 'C', 'D']);
    expect(places(rows)).toEqual([1, 2, 2, 4]);
  });

  test('goals scored breaks a tie on points and goal difference', () => {
    const rows = standingsOf(
      'soccer',
      ['X', 'Y', 'P', 'Q'],
      [
        played('X', 'P', goals(3, 2)),
        played('X', 'Q', goals(0, 1)),
        played('Y', 'P', goals(1, 0)),
        played('Y', 'Q', goals(0, 1)),
      ],
    );
    expect(order(rows)).toEqual(['Q', 'X', 'Y', 'P']);
    expect(places(rows)).toEqual([1, 2, 3, 4]);
  });

  test('a three-way tie on points is ordered by goal difference', () => {
    const rows = standingsOf(
      'soccer',
      ['A', 'B', 'C'],
      [played('A', 'B', goals(3, 0)), played('B', 'C', goals(1, 0)), played('C', 'A', goals(1, 0))],
    );
    expect(order(rows)).toEqual(['A', 'C', 'B']);
    expect(places(rows)).toEqual([1, 2, 3]);
  });

  test('a three-way tie that nothing separates shares a place, in the given order', () => {
    const rows = standingsOf(
      'soccer',
      ['C', 'A', 'B'],
      [played('A', 'B', goals(1, 0)), played('B', 'C', goals(1, 0)), played('C', 'A', goals(1, 0))],
    );
    expect(order(rows)).toEqual(['C', 'A', 'B']);
    expect(places(rows)).toEqual([1, 1, 1]);
  });

  test('head-to-head, the last tiebreaker, separates two teams level on the rest', () => {
    const rows = standingsOf(
      'soccer',
      ['Y', 'X', 'P', 'Q'],
      [played('X', 'Y', goals(1, 0)), played('P', 'X', goals(1, 0)), played('Y', 'Q', goals(1, 0))],
    );
    expect(order(rows)).toEqual(['P', 'X', 'Y', 'Q']);
    expect(places(rows)).toEqual([1, 2, 3, 4]);
  });

  test('a forfeit is a 3-0 loss for the team that forfeited', () => {
    const rows = standingsOf(
      'soccer',
      ['A', 'B'],
      [{ teamIds: ['A', 'B'], score: forfeitScore('soccer', 1, 0) }],
    );
    expect(rows[0]).toMatchObject({ teamId: 'B', won: 1, pointsFor: 3, pointsAgainst: 0 });
    expect(rows[1]).toMatchObject({ teamId: 'A', lost: 1, pointsFor: 0, pointsAgainst: 3 });
  });
});

describe('standingsOf: softball', () => {
  test('a tie counts as half a win in the win percentage', () => {
    const rows = standingsOf(
      'softball',
      ['A', 'B', 'C'],
      [played('A', 'B', runs(4, 4)), played('A', 'C', runs(6, 1)), played('B', 'C', runs(2, 1))],
    );
    expect(order(rows)).toEqual(['A', 'B', 'C']);
    expect(standingsCells('softball', rows[0])).toEqual(['2', '1', '0', '1', '75%']);
    expect(standingsCells('softball', rows[1])).toEqual(['2', '1', '0', '1', '75%']);
  });

  test('a three-way tie caps the run differential at 7 for each game', () => {
    const rows = standingsOf(
      'softball',
      ['A', 'B', 'C'],
      [played('A', 'B', runs(15, 0)), played('B', 'C', runs(7, 0)), played('C', 'A', runs(4, 0))],
    );
    expect(order(rows)).toEqual(['A', 'B', 'C']);
    expect(places(rows)).toEqual([1, 2, 3]);
    const raw = rows.map((row) => row.pointsFor - row.pointsAgainst);
    expect(raw).toEqual([11, -8, -3]);
  });

  test('fewest runs allowed breaks a tie the capped run differential leaves', () => {
    const rows = standingsOf(
      'softball',
      ['A', 'B', 'C'],
      [played('A', 'B', runs(5, 5)), played('A', 'C', runs(10, 3)), played('B', 'C', runs(9, 2))],
    );
    expect(order(rows)).toEqual(['B', 'A', 'C']);
    expect(places(rows)).toEqual([1, 2, 3]);
  });

  test('head-to-head comes before the run differential', () => {
    const rows = standingsOf(
      'softball',
      ['A', 'B', 'C', 'D'],
      [played('B', 'A', runs(1, 0)), played('A', 'C', runs(20, 0)), played('B', 'D', runs(0, 1))],
    );
    expect(order(rows)).toEqual(['D', 'B', 'A', 'C']);
    expect(places(rows)).toEqual([1, 2, 3, 4]);
  });

  test('a forfeit is a 7-0 loss for the team that forfeited', () => {
    const rows = standingsOf(
      'softball',
      ['A', 'B'],
      [{ teamIds: ['A', 'B'], score: forfeitScore('softball', 1, 1) }],
    );
    expect(rows[0]).toMatchObject({ teamId: 'A', won: 1, pointsFor: 7, pointsAgainst: 0 });
  });
});

describe('standingsColumns and standingsCells', () => {
  test('give each sport its own columns, one cell for each column', () => {
    expect(standingsColumns('beachVolleyball').map((column) => column.short)).toEqual([
      'P',
      'W',
      'L',
      'Win %',
      '+/-',
    ]);
    expect(standingsColumns('soccer').map((column) => column.short)).toEqual([
      'P',
      'W',
      'D',
      'L',
      'GD',
      'Pts',
    ]);
    expect(standingsColumns('softball').map((column) => column.short)).toEqual([
      'P',
      'W',
      'L',
      'T',
      'Win %',
    ]);
    for (const sport of ['beachVolleyball', 'soccer', 'softball'] as const) {
      const [row] = standingsOf(sport, ['A', 'B'], []);
      expect(standingsCells(sport, row)).toHaveLength(standingsColumns(sport).length);
    }
  });

  test('write a team with nothing played as zeros, and a differential with its sign', () => {
    const [row] = standingsOf('beachVolleyball', ['A', 'B'], [played('A', 'B', set(21, 15))]);
    expect(standingsCells('beachVolleyball', row)).toEqual(['1', '1', '0', '100%', '+6']);
    expect(standingsCells('beachVolleyball', standingsOf('beachVolleyball', ['A'], [])[0])).toEqual(
      ['0', '0', '0', '0%', '0'],
    );
  });

  test('describe the tiebreakers of each sport in order', () => {
    expect(STANDINGS_TIEBREAKER_NOTES.beachVolleyball).toBe(
      'Teams level on win percentage are ordered by head-to-head, set win percentage, then point differential.',
    );
    expect(STANDINGS_TIEBREAKER_NOTES.soccer).toBe(
      'Teams level on points are ordered by goal difference, goals scored, then head-to-head.',
    );
    expect(STANDINGS_TIEBREAKER_NOTES.softball).toBe(
      'Teams level on win percentage are ordered by head-to-head, run differential (at most 7 a game), then fewest runs allowed.',
    );
  });
});
