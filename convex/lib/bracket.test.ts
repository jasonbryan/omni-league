import { describe, expect, test } from 'vitest';
import {
  BRACKET_MESSAGES,
  inSeedOrder,
  isConfirmedTeam,
  MIN_BRACKET_TEAMS,
  planBracket,
  roundCount,
  roundName,
  type PlannedGame,
} from './bracket';

const pairings = (games: readonly PlannedGame[], round: number) =>
  games.filter((game) => game.round === round).map((game) => game.entrants);

const names = (teamCount: number) =>
  Array.from({ length: roundCount(teamCount) }, (_, index) =>
    roundName(index + 1, roundCount(teamCount)),
  );

describe('planBracket', () => {
  test('5 teams make 8 slots: seeds 1 to 3 get byes into round 2 and 4 plays 5', () => {
    const games = planBracket(5);
    expect(games.filter((game) => game.round === 1)).toHaveLength(4);
    expect(games.filter((game) => game.advances !== null).map((game) => game.advances)).toEqual([
      1, 2, 3,
    ]);
    expect(
      games
        .filter((game) => game.round === 1 && game.advances === null)
        .map((game) => game.entrants),
    ).toEqual([[4, 5]]);
    expect(pairings(games, 2)).toEqual([
      [1, null],
      [2, 3],
    ]);
    expect(pairings(games, 3)).toEqual([[null, null]]);
  });

  test('2 teams make one game, the Final', () => {
    expect(planBracket(2)).toEqual([
      { round: 1, slot: 1, entrants: [1, 2], advances: null, next: null },
    ]);
    expect(names(2)).toEqual(['Final']);
  });

  test('8 teams pair 1 v 8, 4 v 5, 2 v 7, 3 v 6 and then the winners of neighbouring games', () => {
    const games = planBracket(8);
    expect(pairings(games, 1)).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    expect(pairings(games, 2)).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(games.some((game) => game.advances !== null)).toBe(false);
    expect(names(8)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
  });

  test('9 teams make 16 slots: only seed 9 plays in round 1, against 8', () => {
    const games = planBracket(9);
    expect(games.filter((game) => game.round === 1)).toHaveLength(8);
    expect(
      games
        .filter((game) => game.round === 1 && game.advances === null)
        .map((game) => game.entrants),
    ).toEqual([[8, 9]]);
    expect(games.filter((game) => game.advances !== null).map((game) => game.advances)).toEqual([
      1, 4, 5, 2, 7, 3, 6,
    ]);
    expect(names(9)).toEqual(['Round of 16', 'Quarterfinals', 'Semifinals', 'Final']);
  });

  test('16 teams pair by the standard table and name the first round Round of 16', () => {
    const games = planBracket(16);
    expect(pairings(games, 1)).toEqual([
      [1, 16],
      [8, 9],
      [4, 13],
      [5, 12],
      [2, 15],
      [7, 10],
      [3, 14],
      [6, 11],
    ]);
    expect(names(16)).toEqual(['Round of 16', 'Quarterfinals', 'Semifinals', 'Final']);
    expect(games).toHaveLength(15);
  });

  test('3 and 4 teams end in Semifinals and the Final', () => {
    expect(names(3)).toEqual(['Semifinals', 'Final']);
    expect(names(4)).toEqual(['Semifinals', 'Final']);
    expect(pairings(planBracket(3), 1)).toEqual([
      [1, null],
      [2, 3],
    ]);
  });

  test('3 teams: seed 1 takes the bye into the Final round and 2 plays 3', () => {
    const games = planBracket(3);
    expect(games.filter((game) => game.advances !== null).map((game) => game.advances)).toEqual([
      1,
    ]);
    expect(pairings(games, 1)).toEqual([
      [1, null],
      [2, 3],
    ]);
    expect(pairings(games, 2)).toEqual([[1, null]]);
    expect(games).toHaveLength(3);
  });

  test('6 teams: seeds 1 and 2 take byes, 4 plays 5 and 3 plays 6', () => {
    const games = planBracket(6);
    expect(games).toHaveLength(7);
    expect(pairings(games, 1)).toEqual([
      [1, null],
      [4, 5],
      [2, null],
      [3, 6],
    ]);
    expect(games.filter((game) => game.advances !== null).map((game) => game.advances)).toEqual([
      1, 2,
    ]);
    expect(pairings(games, 2)).toEqual([
      [1, null],
      [2, null],
    ]);
    expect(pairings(games, 3)).toEqual([[null, null]]);
    expect(names(6)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
  });

  test('seeds 1 and 2 sit in opposite halves, so they meet only in the Final', () => {
    for (const count of [4, 5, 6, 8, 16]) {
      const first = planBracket(count).filter((game) => game.round === 1);
      const half = (seed: number) =>
        first.findIndex((game) => game.entrants.includes(seed)) < first.length / 2;
      expect(half(1)).not.toBe(half(2));
    }
  });

  test('33 teams name the first round Round of 64', () => {
    expect(names(33)[0]).toBe('Round of 64');
    expect(names(128)[0]).toBe('Round of 128');
  });

  test('each game points at the game its winner joins, on the side of its slot parity', () => {
    const games = planBracket(8);
    const byKey = new Map(games.map((game) => [`${game.round}.${game.slot}`, game]));
    expect(byKey.get('1.1')!.next).toEqual({ slot: 1, side: 0 });
    expect(byKey.get('1.2')!.next).toEqual({ slot: 1, side: 1 });
    expect(byKey.get('1.3')!.next).toEqual({ slot: 2, side: 0 });
    expect(byKey.get('1.4')!.next).toEqual({ slot: 2, side: 1 });
    expect(byKey.get('2.1')!.next).toEqual({ slot: 1, side: 0 });
    expect(byKey.get('2.2')!.next).toEqual({ slot: 1, side: 1 });
    expect(byKey.get('3.1')!.next).toBeNull();
  });

  test('a team count below 2 has no bracket', () => {
    expect(MIN_BRACKET_TEAMS).toBe(2);
    expect(() => planBracket(1)).toThrow();
    expect(() => planBracket(0)).toThrow();
  });

  test('every seed from 1 to the team count is an entrant of exactly one round 1 game', () => {
    for (const count of [2, 3, 5, 6, 7, 9, 12, 17, 33, 100, 128]) {
      const entrants = planBracket(count)
        .filter((game) => game.round === 1)
        .flatMap((game) => game.entrants)
        .filter((seed): seed is number => seed !== null);
      expect(entrants.sort((a, b) => a - b)).toEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
    }
  });
});

describe('roundName', () => {
  test('names the last three rounds and counts the teams of earlier ones', () => {
    expect(roundName(3, 3)).toBe('Final');
    expect(roundName(2, 3)).toBe('Semifinals');
    expect(roundName(1, 3)).toBe('Quarterfinals');
    expect(roundName(1, 5)).toBe('Round of 32');
    expect(roundName(2, 5)).toBe('Round of 16');
  });
});

describe('isConfirmedTeam', () => {
  test('a team is confirmed once its roster reaches the minimum roster size', () => {
    expect(isConfirmedTeam({ rosterCount: 1 }, 2)).toBe(false);
    expect(isConfirmedTeam({ rosterCount: 2 }, 2)).toBe(true);
    expect(isConfirmedTeam({ rosterCount: 3 }, 2)).toBe(true);
  });
});

describe('inSeedOrder', () => {
  const team = (id: string, _creationTime: number, seed?: number) => ({
    id,
    _creationTime,
    ...(seed !== undefined && { seed }),
  });
  const ids = (teams: readonly { id: string }[]) => teams.map((entry) => entry.id);

  test('puts teams with no seed in registration order', () => {
    expect(ids(inSeedOrder([team('c', 30), team('a', 10), team('b', 20)]))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  test('puts seeded teams first, by seed, and the rest after them in registration order', () => {
    const ordered = inSeedOrder([team('d', 40), team('b', 20, 2), team('a', 10), team('c', 30, 1)]);
    expect(ids(ordered)).toEqual(['c', 'b', 'a', 'd']);
  });

  test('breaks a tie of two equal seeds by registration order', () => {
    expect(ids(inSeedOrder([team('z', 10, 1), team('y', 5, 1)]))).toEqual(['y', 'z']);
  });

  test('does not change its input', () => {
    const input = [team('b', 2), team('a', 1)];
    inSeedOrder(input);
    expect(ids(input)).toEqual(['b', 'a']);
  });
});

describe('BRACKET_MESSAGES', () => {
  test('says what a bracket needs', () => {
    expect(BRACKET_MESSAGES.tooFewTeams).toBe('A bracket needs at least 2 confirmed teams.');
  });

  test('names the registration deadline in the refusal before it', () => {
    expect(BRACKET_MESSAGES.registrationOpen('2030-05-20')).toBe(
      'Registration is open until May 20, 2030. Create the bracket after it closes.',
    );
  });
});
