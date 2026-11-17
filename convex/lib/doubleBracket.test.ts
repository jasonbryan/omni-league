import { describe, expect, test } from 'vitest';
import {
  GRAND_FINAL_NAMES,
  losersRoundName,
  planDoubleBracket,
  winnersRoundName,
  type PlayoffGame,
  type PlayoffStage,
} from './doubleBracket';

const labelOf = (stage: PlayoffStage, round: number, slot: number) =>
  `${{ bracket: 'W', losers: 'L', grandFinal: 'G' }[stage]}${round}.${slot}`;

/** What feeds each place of a game, as `loser of W1.2` or `winner of L1.1`, so a test reads the pairing off the plan. */
function feedersOf(plan: readonly PlayoffGame[], game: PlayoffGame): string[] {
  const feeds: string[] = [];
  for (const other of plan) {
    // A bye game is already decided, so it feeds nothing.
    if (other.advances !== null) continue;
    const label = labelOf(other.stage, other.round, other.slot);
    if (other.winnerTo && labelOf(...target(other.winnerTo)) === labelOf(...target(game))) {
      feeds.push(`winner of ${label}`);
    }
    if (other.loserTo && labelOf(...target(other.loserTo)) === labelOf(...target(game))) {
      feeds.push(`loser of ${label}`);
    }
  }
  return feeds.sort();
}

const target = (place: {
  stage: PlayoffStage;
  round: number;
  slot: number;
}): [PlayoffStage, number, number] => [place.stage, place.round, place.slot];

const gamesOf = (plan: readonly PlayoffGame[], stage: PlayoffStage, round?: number) =>
  plan.filter((game) => game.stage === stage && (round === undefined || game.round === round));

const played = (plan: readonly PlayoffGame[]) => plan.filter((game) => game.advances === null);

const feedersIn = (plan: readonly PlayoffGame[], stage: PlayoffStage, round: number) =>
  gamesOf(plan, stage, round).map((game) => feedersOf(plan, game));

describe('planDoubleBracket', () => {
  test('8 teams have the standard 6 losers bracket games and 14 games before a second grand final game', () => {
    const plan = planDoubleBracket(8);
    expect(gamesOf(plan, 'bracket')).toHaveLength(7);
    expect(gamesOf(plan, 'losers')).toHaveLength(6);
    expect(gamesOf(plan, 'grandFinal')).toHaveLength(1);
    expect(played(plan)).toHaveLength(14);
    expect(feedersIn(plan, 'losers', 1)).toEqual([
      ['loser of W1.1', 'loser of W1.2'],
      ['loser of W1.3', 'loser of W1.4'],
    ]);
    expect(feedersIn(plan, 'losers', 2)).toEqual([
      ['loser of W2.2', 'winner of L1.1'],
      ['loser of W2.1', 'winner of L1.2'],
    ]);
    expect(feedersIn(plan, 'losers', 3)).toEqual([['winner of L2.1', 'winner of L2.2']]);
    expect(feedersIn(plan, 'losers', 4)).toEqual([['loser of W3.1', 'winner of L3.1']]);
  });

  test('6 teams: winners round 1 is 3 v 6 and 4 v 5, and the semifinals are 1 v the winner of 4 v 5 and 2 v the winner of 3 v 6', () => {
    const plan = planDoubleBracket(6);
    expect(gamesOf(plan, 'bracket', 1).map((game) => game.entrants)).toEqual([
      [1, null],
      [4, 5],
      [2, null],
      [3, 6],
    ]);
    expect(gamesOf(plan, 'bracket', 1).map((game) => game.advances)).toEqual([1, null, 2, null]);
    const semifinals = gamesOf(plan, 'bracket', 2);
    expect(semifinals.map((game) => game.entrants)).toEqual([
      [1, null],
      [2, null],
    ]);
    expect(feedersIn(plan, 'bracket', 2)).toEqual([['winner of W1.2'], ['winner of W1.4']]);
  });

  test('6 teams: the losers bracket pairs the two round 1 losers, then each semifinal loser, then the winners final loser, for 10 games', () => {
    const plan = planDoubleBracket(6);
    expect(feedersIn(plan, 'losers', 1)).toEqual([['loser of W1.2', 'loser of W1.4']]);
    // The 1-seed semifinal is W2.1 and the other semifinal's loser waits a round.
    expect(feedersIn(plan, 'losers', 2)).toEqual([['loser of W2.1', 'winner of L1.1']]);
    expect(feedersIn(plan, 'losers', 3)).toEqual([['loser of W2.2', 'winner of L2.1']]);
    expect(feedersIn(plan, 'losers', 4)).toEqual([['loser of W3.1', 'winner of L3.1']]);
    expect(gamesOf(plan, 'losers')).toHaveLength(4);
    expect(played(plan)).toHaveLength(10);
  });

  test('5 teams: winners round 1 is 4 v 5, and the semifinals are 1 v the winner of 4 v 5 and 2 v 3', () => {
    const plan = planDoubleBracket(5);
    expect(
      gamesOf(plan, 'bracket', 1)
        .filter((game) => game.advances === null)
        .map((game) => game.entrants),
    ).toEqual([[4, 5]]);
    expect(gamesOf(plan, 'bracket', 2).map((game) => game.entrants)).toEqual([
      [1, null],
      [2, 3],
    ]);
    expect(feedersIn(plan, 'bracket', 2)).toEqual([['winner of W1.2'], []]);
  });

  test('5 teams: losers round 1 pairs the losers of 4 v 5 and 2 v 3 while the 1-seed semifinal loser waits, for 8 games', () => {
    const plan = planDoubleBracket(5);
    expect(feedersIn(plan, 'losers', 1)).toEqual([['loser of W1.2', 'loser of W2.2']]);
    expect(feedersIn(plan, 'losers', 2)).toEqual([['loser of W2.1', 'winner of L1.1']]);
    expect(feedersIn(plan, 'losers', 3)).toEqual([['loser of W3.1', 'winner of L2.1']]);
    expect(gamesOf(plan, 'losers')).toHaveLength(3);
    expect(played(plan)).toHaveLength(8);
  });

  test('3 teams: the 2 v 3 loser meets the winners final loser', () => {
    const plan = planDoubleBracket(3);
    expect(feedersIn(plan, 'losers', 1)).toEqual([['loser of W1.2', 'loser of W2.1']]);
    expect(gamesOf(plan, 'losers')).toHaveLength(1);
  });

  test('2 teams: the winners final loser goes straight to the grand final', () => {
    const plan = planDoubleBracket(2);
    expect(gamesOf(plan, 'losers')).toHaveLength(0);
    const [final] = gamesOf(plan, 'bracket');
    expect(final.winnerTo).toEqual({ stage: 'grandFinal', round: 1, slot: 1, side: 0 });
    expect(final.loserTo).toEqual({ stage: 'grandFinal', round: 1, slot: 1, side: 1 });
  });

  test('the winners final winner takes the first side of the grand final and the losers final winner the second', () => {
    const plan = planDoubleBracket(8);
    const winnersFinal = gamesOf(plan, 'bracket', 3)[0];
    const losersFinal = gamesOf(plan, 'losers', 4)[0];
    expect(winnersFinal.winnerTo).toEqual({ stage: 'grandFinal', round: 1, slot: 1, side: 0 });
    expect(winnersFinal.loserTo).toEqual({ stage: 'losers', round: 4, slot: 1, side: 1 });
    expect(losersFinal.winnerTo).toEqual({ stage: 'grandFinal', round: 1, slot: 1, side: 1 });
    expect(gamesOf(plan, 'grandFinal')[0].winnerTo).toBeNull();
  });

  test('a bye game sends no loser anywhere', () => {
    const plan = planDoubleBracket(5);
    for (const game of plan.filter((row) => row.advances !== null)) {
      expect(game.loserTo).toBeNull();
    }
  });

  test.each(Array.from({ length: 127 }, (_, index) => index + 2))(
    '%i teams have N-2 losers bracket games, and every team but two leaves on a second loss whoever wins',
    (teamCount) => {
      const plan = planDoubleBracket(teamCount);
      expect(gamesOf(plan, 'losers')).toHaveLength(teamCount - 2);
      for (const seedsWinFirst of [true, false]) {
        const result = playOut(plan, teamCount, seedsWinFirst);
        expect(result.unresolved).toEqual([]);
        expect(result.grandFinal.every((seed) => seed !== null)).toBe(true);
        const losses = [...result.losses.values()];
        expect(losses.filter((count) => count === 2)).toHaveLength(teamCount - 2);
        expect(losses.filter((count) => count < 2).sort()).toEqual([0, 1]);
      }
    },
  );
});

describe('round names', () => {
  test('winners rounds count up and end with the winners final', () => {
    expect([1, 2, 3, 4].map((round) => winnersRoundName(round, 4))).toEqual([
      'Winners’ round 1',
      'Winners’ round 2',
      'Winners’ semifinals',
      'Winners’ final',
    ]);
  });

  test('losers rounds count up and end with the losers final', () => {
    expect([1, 2, 3].map((round) => losersRoundName(round, 3))).toEqual([
      'Losers’ round 1',
      'Losers’ round 2',
      'Losers’ final',
    ]);
  });

  test('the grand final has a name for each of its two games', () => {
    expect(GRAND_FINAL_NAMES).toEqual(['Grand final', 'Grand final, deciding game']);
  });
});

/** Plays every game with the lower seed winning, or the higher when `lowerWins` is false, and counts each team's losses before the grand final. */
function playOut(plan: readonly PlayoffGame[], teamCount: number, lowerWins: boolean) {
  const placed = new Map<string, (number | null)[]>();
  const key = (game: Pick<PlayoffGame, 'stage' | 'round' | 'slot'>) =>
    labelOf(game.stage, game.round, game.slot);
  for (const game of plan) placed.set(key(game), [...game.entrants]);
  const losses = new Map<number, number>(
    Array.from({ length: teamCount }, (_, index) => [index + 1, 0]),
  );
  const done = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const game of plan) {
      const id = key(game);
      if (done.has(id) || game.stage === 'grandFinal') continue;
      const entrants = placed.get(id)!;
      let winner: number;
      let loser: number | null = null;
      if (game.advances !== null) {
        winner = game.advances;
      } else {
        if (entrants.includes(null)) continue;
        const [a, b] = entrants as [number, number];
        [winner, loser] = a < b === lowerWins ? [a, b] : [b, a];
        losses.set(loser, losses.get(loser)! + 1);
      }
      done.add(id);
      progressed = true;
      if (game.winnerTo) {
        placed.get(key(game.winnerTo))![game.winnerTo.side] = winner;
      }
      if (game.loserTo && loser !== null) placed.get(key(game.loserTo))![game.loserTo.side] = loser;
    }
  }
  return {
    losses,
    grandFinal: placed.get('G1.1')!,
    unresolved: plan.filter((game) => game.stage !== 'grandFinal' && !done.has(key(game))).map(key),
  };
}
