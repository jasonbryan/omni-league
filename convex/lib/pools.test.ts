import { describe, expect, test } from 'vitest';
import {
  MAX_POOL_PLAY_TEAMS,
  MIN_POOL_PLAY_TEAMS,
  POOL_MESSAGES,
  checkPoolSizes,
  checkSplit,
  gamesMatchPools,
  planPoolGames,
  poolCountsFor,
  poolNameAt,
  poolSizesAfterMove,
  snakeSplit,
} from './pools';

describe('snakeSplit', () => {
  test('puts 12 seeds in 3 pools of 4, pool A holding 1, 6, 7, and 12', () => {
    expect(snakeSplit(12, 3)).toEqual([
      [1, 6, 7, 12],
      [2, 5, 8, 11],
      [3, 4, 9, 10],
    ]);
  });

  test('gives the extra teams to the pools the last row reaches when the count does not divide', () => {
    expect(snakeSplit(7, 2)).toEqual([
      [1, 4, 5],
      [2, 3, 6, 7],
    ]);
    expect(snakeSplit(10, 3).map((seeds) => seeds.length)).toEqual([3, 3, 4]);
  });

  test('places every seed once', () => {
    const seeds = snakeSplit(64, 8).flat();
    expect([...seeds].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
  });
});

describe('checkPoolSizes', () => {
  test('accepts pools of 3 to 8 teams', () => {
    expect(checkPoolSizes([3, 8, 5])).toBeNull();
  });

  test('refuses a pool of 2 with the limits', () => {
    expect(checkPoolSizes([4, 2, 4])).toEqual({
      code: 'poolSize',
      message: 'Pool B would have 2 teams. Each pool needs 3 to 8 teams.',
    });
  });

  test('refuses a pool of 9 with the limits', () => {
    expect(checkPoolSizes([9, 4])).toEqual({
      code: 'poolSize',
      message: 'Pool A would have 9 teams. Each pool needs 3 to 8 teams.',
    });
  });

  test('names the first pool outside the limits', () => {
    expect(checkPoolSizes([4, 9, 2])?.message).toContain('Pool B');
  });
});

describe('checkSplit', () => {
  test('accepts 12 teams in 3 pools', () => {
    expect(checkSplit(12, 3)).toBeNull();
  });

  test.each([5, 65])('refuses %s teams with the team limits', (teams) => {
    expect(checkSplit(teams, 2)).toEqual({ code: 'teamLimits', message: POOL_MESSAGES.teamLimits });
  });

  test('words the team limits as the page shows them', () => {
    expect(POOL_MESSAGES.teamLimits).toBe('Pools need 6 to 64 confirmed teams.');
    expect([MIN_POOL_PLAY_TEAMS, MAX_POOL_PLAY_TEAMS]).toEqual([6, 64]);
  });

  test.each([1, 9, 2.5, Number.NaN])('refuses %s pools', (pools) => {
    expect(checkSplit(12, pools)?.code).toBe('poolCount');
  });

  test('refuses a count that leaves a pool with 2 teams', () => {
    expect(checkSplit(12, 5)).toEqual({
      code: 'poolSize',
      message: 'Pool C would have 2 teams. Each pool needs 3 to 8 teams.',
    });
  });

  test('refuses a count that leaves a pool with 9 teams', () => {
    expect(checkSplit(18, 2)?.message).toBe(
      'Pool A would have 9 teams. Each pool needs 3 to 8 teams.',
    );
  });
});

describe('poolCountsFor', () => {
  test('lists the counts that keep every pool within the limits', () => {
    expect(poolCountsFor(12)).toEqual([2, 3, 4]);
    expect(poolCountsFor(6)).toEqual([2]);
    expect(poolCountsFor(64)).toEqual([8]);
    expect(poolCountsFor(17)).toEqual([3, 4, 5]);
  });

  test('lists none when no split exists', () => {
    expect(poolCountsFor(5)).toEqual([]);
    expect(poolCountsFor(65)).toEqual([]);
  });

  test('offers a count for every team total from 6 to 64', () => {
    for (let teams = MIN_POOL_PLAY_TEAMS; teams <= MAX_POOL_PLAY_TEAMS; teams++) {
      expect(poolCountsFor(teams).length).toBeGreaterThan(0);
    }
  });
});

describe('planPoolGames', () => {
  const pairKeys = (teams: number) =>
    planPoolGames(teams).map((game) => [...game.entrants].sort((a, b) => a - b).join('-'));

  test('plays 6 games in a pool of 4, in 3 rounds of 2', () => {
    const games = planPoolGames(4);
    expect(games).toHaveLength(6);
    expect(games.map((game) => game.round)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(games.map((game) => game.slot)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  test.each([3, 4, 5, 6, 7, 8])('pairs every two of %s teams once', (teams) => {
    const keys = pairKeys(teams);
    expect(keys).toHaveLength((teams * (teams - 1)) / 2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test.each([3, 4, 5, 6, 7, 8])('plays no team twice in a round of %s teams', (teams) => {
    const games = planPoolGames(teams);
    const rounds = new Set(games.map((game) => game.round));
    for (const round of rounds) {
      const places = games.filter((game) => game.round === round).flatMap((game) => game.entrants);
      expect(new Set(places).size).toBe(places.length);
    }
  });

  test('numbers the places from 1', () => {
    const places = planPoolGames(3).flatMap((game) => game.entrants);
    expect(Math.min(...places)).toBe(1);
    expect(Math.max(...places)).toBe(3);
  });

  test('gives each team a rest in a round when the pool is odd', () => {
    expect(planPoolGames(5).map((game) => game.round)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('poolSizesAfterMove', () => {
  test('moves one team from a pool to another', () => {
    expect(poolSizesAfterMove([4, 4, 3], 0, 2)).toEqual([3, 4, 4]);
  });

  test('leaves the sizes as they are for a move within a pool', () => {
    expect(poolSizesAfterMove([4, 4], 1, 1)).toEqual([4, 4]);
  });
});

describe('poolNameAt', () => {
  test('names the pools A to H', () => {
    expect(Array.from({ length: 8 }, (_, index) => poolNameAt(index)).join('')).toBe('ABCDEFGH');
  });
});

describe('gamesMatchPools', () => {
  const pools = new Map([
    ['A' as const, ['a1', 'a2', 'a3']],
    ['B' as const, ['b1', 'b2', 'b3']],
  ]);
  const game = (pool: 'A' | 'B', one: string, other: string) => ({ pool, teamIds: [one, other] });
  const ALL = [
    game('A', 'a1', 'a2'),
    game('A', 'a1', 'a3'),
    game('A', 'a2', 'a3'),
    game('B', 'b1', 'b2'),
    game('B', 'b1', 'b3'),
    game('B', 'b2', 'b3'),
  ];

  test('is true when each pool plays all its pairs', () => {
    expect(gamesMatchPools(pools, ALL)).toBe(true);
  });

  test('is false when a team moved to another pool since', () => {
    const moved = new Map([
      ['A' as const, ['a1', 'a2', 'b3']],
      ['B' as const, ['b1', 'b2', 'a3']],
    ]);
    expect(gamesMatchPools(moved, ALL)).toBe(false);
  });

  test('is false when a pool has a team its games do not', () => {
    const joined = new Map(pools).set('B', ['b1', 'b2', 'b3', 'b4']);
    expect(gamesMatchPools(joined, ALL)).toBe(false);
  });

  test('is false when a game is missing', () => {
    expect(gamesMatchPools(pools, ALL.slice(1))).toBe(false);
  });
});
