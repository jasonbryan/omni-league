import { describe, expect, test } from 'vitest';
import { planBracket } from './bracket';
import { POOL_MESSAGES, type Pool } from './pools';
import { checkAdvance, checkAdvancing, seedsFromPools, type PoolStanding } from './poolBracket';
import type { Score, Sport } from './sports';
import type { StandingsGame } from './standings';

const set = (a: number, b: number): Score => ({ kind: 'sets', sets: [{ a, b }] });
const goals = (a: number, b: number): Score => ({ kind: 'goals', a, b });

const game = (first: string, second: string, score: Score): StandingsGame => ({
  teamIds: [first, second],
  score,
});

const pool = (name: Pool, teamIds: string[], games: StandingsGame[]): PoolStanding => ({
  pool: name,
  teamIds,
  games,
});

const labels = (sport: Sport, pools: PoolStanding[]) =>
  seedsFromPools(sport, pools).map((seed) => seed.teamId);

/** A pool of three where team 1 beats teams 2 and 3, and team 2 beats team 3, by the given scores. */
const trio = (name: Pool, scores: [Score, Score, Score]): PoolStanding => {
  const [one, two, three] = [1, 2, 3].map((number) => `${name.toLowerCase()}${number}`);
  return pool(
    name,
    [one, two, three],
    [game(one, two, scores[0]), game(one, three, scores[1]), game(two, three, scores[2])],
  );
};

describe('seedsFromPools: two equal pools', () => {
  // Both winners win every game, so the sport's tiebreakers that need no head-to-head decide.
  const pools = [
    trio('A', [set(21, 10), set(21, 10), set(21, 5)]),
    trio('B', [set(21, 19), set(21, 19), set(21, 19)]),
  ];

  test('takes the winners first and then the runners-up: A1, B1, A2, B2', () => {
    expect(labels('beachVolleyball', pools).slice(0, 4)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  test('pairs the first seed against the fourth in a 4-team bracket', () => {
    const seeds = labels('beachVolleyball', pools).slice(0, 4);
    const [firstGame] = planBracket(seeds.length);
    const [top, bottom] = firstGame.entrants;
    expect([seeds[top! - 1], seeds[bottom! - 1]]).toEqual(['a1', 'b2']);
  });

  test('names the pool and the place each team finished in', () => {
    expect(seedsFromPools('beachVolleyball', pools).slice(0, 4)).toEqual([
      { teamId: 'a1', pool: 'A', place: 1, tie: null },
      { teamId: 'b1', pool: 'B', place: 1, tie: null },
      { teamId: 'a2', pool: 'A', place: 2, tie: null },
      { teamId: 'b2', pool: 'B', place: 2, tie: null },
    ]);
  });

  test('puts the better team of a place first, whichever pool it is in', () => {
    const swapped = [
      trio('A', [set(21, 19), set(21, 19), set(21, 19)]),
      trio('B', [set(21, 10), set(21, 10), set(21, 5)]),
    ];
    expect(labels('beachVolleyball', swapped).slice(0, 2)).toEqual(['b1', 'a1']);
  });

  test('breaks a level place by pool letter, not by the order the pools are given', () => {
    const level = [
      trio('A', [set(21, 10), set(21, 10), set(21, 5)]),
      trio('B', [set(21, 10), set(21, 10), set(21, 5)]),
    ];
    expect(labels('beachVolleyball', level)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
    expect(labels('beachVolleyball', [level[1], level[0]]).slice(0, 2)).toEqual(['a1', 'b1']);
  });

  test('keeps teams that nothing separates in their pool seed order', () => {
    const none = [pool('A', ['a1', 'a2', 'a3'], []), pool('B', ['b1', 'b2', 'b3'], [])];
    expect(labels('soccer', none)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
  });
});

describe('seedsFromPools: teams level in a pool', () => {
  const cycle = (scores: [Score, Score, Score]) =>
    pool(
      'A',
      ['a1', 'a2', 'a3'],
      [game('a1', 'a2', scores[0]), game('a2', 'a3', scores[1]), game('a3', 'a1', scores[2])],
    );

  test('puts the team that scored more points in the games between them first, and names it', () => {
    const seeds = seedsFromPools('beachVolleyball', [
      cycle([set(21, 15), set(25, 19), set(30, 24)]),
      trio('B', [set(21, 19), set(21, 19), set(21, 19)]),
    ]).filter((seed) => seed.pool === 'A');
    expect(seeds.map((seed) => seed.teamId)).toEqual(['a3', 'a1', 'a2']);
    expect(seeds.map((seed) => seed.place)).toEqual([1, 2, 3]);
    expect(seeds[0].tie).toEqual({ place: 1, decidedBy: 'headToHead' });
  });

  test('falls back to the pool seed order when they scored the same points', () => {
    const seeds = seedsFromPools('beachVolleyball', [
      cycle([set(21, 15), set(21, 15), set(21, 15)]),
      trio('B', [set(21, 19), set(21, 19), set(21, 19)]),
    ]).filter((seed) => seed.pool === 'A');
    expect(seeds.map((seed) => seed.teamId)).toEqual(['a1', 'a2', 'a3']);
    expect(seeds[0].tie).toEqual({ place: 1, decidedBy: 'seedOrder' });
  });

  test('falls back to the pool seed order when they did not play each other', () => {
    const seeds = seedsFromPools('soccer', [
      pool('A', ['a1', 'a2', 'a3'], []),
      pool('B', ['b1', 'b2', 'b3'], []),
    ]);
    expect(seeds.filter((seed) => seed.pool === 'A').map((seed) => seed.teamId)).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
    expect(seeds[0].tie).toEqual({ place: 1, decidedBy: 'seedOrder' });
  });
});

describe('checkAdvancing', () => {
  const team = (teamId: string, name: Pool) => ({ teamId, pool: name });

  test('accepts the advance from each pool, whichever teams', () => {
    expect(
      checkAdvancing(
        [team('a2', 'A'), team('b1', 'B'), team('a1', 'A'), team('b3', 'B')],
        ['A', 'B'],
        2,
      ),
    ).toBeNull();
  });

  test('refuses another count from a pool, a team twice, and a missing pool', () => {
    const refused = { code: 'advancingInvalid', message: POOL_MESSAGES.advancingInvalid(2) };
    expect(
      checkAdvancing(
        [team('a1', 'A'), team('a2', 'A'), team('a3', 'A'), team('b1', 'B')],
        ['A', 'B'],
        2,
      ),
    ).toEqual(refused);
    expect(
      checkAdvancing(
        [team('a1', 'A'), team('a1', 'A'), team('b1', 'B'), team('b2', 'B')],
        ['A', 'B'],
        2,
      ),
    ).toEqual(refused);
    expect(checkAdvancing([team('a1', 'A'), team('a2', 'A')], ['A', 'B'], 2)).toEqual(refused);
  });
});

describe('seedsFromPools: unequal pools', () => {
  // Pool A has 4 teams and plays 3 games each; Pools B and C have 3 teams and play 2.
  const pools = [
    pool(
      'A',
      ['a1', 'a2', 'a3', 'a4'],
      [
        game('a1', 'a2', goals(2, 0)),
        game('a1', 'a3', goals(2, 0)),
        game('a1', 'a4', goals(1, 1)),
        game('a2', 'a3', goals(1, 0)),
        game('a2', 'a4', goals(1, 0)),
        game('a3', 'a4', goals(1, 0)),
      ],
    ),
    pool(
      'B',
      ['b1', 'b2', 'b3'],
      [game('b1', 'b2', goals(3, 0)), game('b1', 'b3', goals(3, 0)), game('b2', 'b3', goals(1, 0))],
    ),
    pool(
      'C',
      ['c1', 'c2', 'c3'],
      [game('c1', 'c2', goals(1, 0)), game('c1', 'c3', goals(1, 0)), game('c2', 'c3', goals(1, 0))],
    ),
  ];

  test('compares the winners by points per game played, not by total points', () => {
    // Totals: A1 7 points, B1 and C1 6 each. Per game: A1 2.33, B1 and C1 3.
    const winners = labels('soccer', pools).slice(0, 3);
    expect(winners).toEqual(['b1', 'c1', 'a1']);
  });

  test('breaks a level points-per-game place by the goal difference per game', () => {
    // B1 is +3 a game and C1 is +1 a game, both on 3 points a game; B2 and C2 are level on 1.5 and split by -1 and 0.
    expect(labels('soccer', pools).slice(0, 2)).toEqual(['b1', 'c1']);
    expect(labels('soccer', pools).slice(3, 6)).toEqual(['a2', 'c2', 'b2']);
  });

  test('lists every team, the third places after the second places', () => {
    const all = seedsFromPools('soccer', pools);
    expect(all).toHaveLength(10);
    expect(all.map((seed) => seed.place)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
    expect(all.at(-1)).toMatchObject({ teamId: 'a4', pool: 'A', place: 4 });
  });
});

describe('checkAdvance', () => {
  test('accepts 1 up to the smallest pool', () => {
    expect(checkAdvance([4, 3, 3], 1)).toBeNull();
    expect(checkAdvance([4, 3, 3], 3)).toBeNull();
  });

  test('refuses an advance above the smallest pool', () => {
    expect(checkAdvance([4, 3, 3], 4)).toEqual({
      code: 'advanceCount',
      message: POOL_MESSAGES.advanceCount(3),
    });
  });

  test('refuses none, a part of a team, and a number that is not a number', () => {
    for (const advance of [0, -1, 1.5, Number.NaN]) {
      expect(checkAdvance([3, 3], advance)?.code).toBe('advanceCount');
    }
  });

  test('refuses fewer than 2 teams in total', () => {
    expect(checkAdvance([3], 1)).toEqual({
      code: 'advanceTotal',
      message: POOL_MESSAGES.advanceTotal,
    });
    expect(checkAdvance([3, 3], 1)).toBeNull();
  });
});

describe('poolGamesPending message', () => {
  test('says how many pool games still need a confirmed result', () => {
    expect(POOL_MESSAGES.poolGamesPending(3)).toBe('3 pool games still need a confirmed result.');
    expect(POOL_MESSAGES.poolGamesPending(1)).toBe('1 pool game still needs a confirmed result.');
  });
});
