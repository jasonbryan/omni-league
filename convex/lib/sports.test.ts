import { describe, expect, test } from 'vitest';
import {
  checkScore,
  forfeitScore,
  MAX_SCORE,
  ROSTER_SIZE_INPUT_MAX,
  SCORE_MESSAGES,
  scoreKindOf,
  scoreText,
  scoresEqual,
  scoreWinnerSide,
  SPORT_NAMES,
  SPORT_SEGMENTS,
  sportFromSegment,
  sportSegment,
  type Sport,
} from './sports';

const sports = Object.keys(SPORT_NAMES) as Sport[];

describe('ROSTER_SIZE_INPUT_MAX', () => {
  test('is the largest roster size an input accepts', () => {
    expect(ROSTER_SIZE_INPUT_MAX).toBe(99);
  });
});

describe('SPORT_SEGMENTS', () => {
  test('maps each sport key to its kebab-case segment', () => {
    expect(sports.map((sport) => [sport, sportSegment(sport)])).toEqual([
      ['beachVolleyball', 'beach-volleyball'],
      ['soccer', 'soccer'],
      ['softball', 'softball'],
    ]);
    expect(Object.keys(SPORT_SEGMENTS)).toEqual(sports);
  });

  test('maps each segment back to its sport key', () => {
    for (const sport of sports) expect(sportFromSegment(sportSegment(sport))).toBe(sport);
  });

  test.each([
    'beachVolleyball',
    'Soccer',
    'SOCCER',
    'soccer ',
    '',
    'hockey',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
  ])('gives no sport for the segment %j', (segment) => {
    expect(sportFromSegment(segment)).toBeUndefined();
  });
});

describe('scoreKindOf', () => {
  test('scores beach volleyball in sets, soccer in goals, and softball in runs', () => {
    expect(sports.map((sport) => [sport, scoreKindOf(sport)])).toEqual([
      ['beachVolleyball', 'sets'],
      ['soccer', 'goals'],
      ['softball', 'runs'],
    ]);
  });
});

describe('checkScore: goals and runs', () => {
  test.each([
    ['soccer', 'goals'],
    ['softball', 'runs'],
  ] as const)('accepts a win in %s', (sport, kind) => {
    expect(checkScore(sport, 1, { kind, a: 3, b: 1 })).toBeNull();
    expect(checkScore(sport, 1, { kind, a: 0, b: 1 })).toBeNull();
  });

  test('refuses a tie, under the score', () => {
    expect(checkScore('soccer', 1, { kind: 'goals', a: 2, b: 2 })).toEqual({
      field: 'score',
      message: SCORE_MESSAGES.tied,
    });
    expect(checkScore('softball', 1, { kind: 'runs', a: 0, b: 0 })).toMatchObject({
      field: 'score',
    });
  });

  test('names the side that is blank, negative, fractional, or over the largest score', () => {
    expect(checkScore('soccer', 1, { kind: 'goals', a: null, b: 1 })).toEqual({
      field: 'a',
      message: SCORE_MESSAGES.blank,
    });
    expect(checkScore('soccer', 1, { kind: 'goals', a: 2, b: null })).toMatchObject({ field: 'b' });
    expect(checkScore('soccer', 1, { kind: 'goals', a: -1, b: 1 })).toEqual({
      field: 'a',
      message: SCORE_MESSAGES.wholeNumber,
    });
    expect(checkScore('soccer', 1, { kind: 'goals', a: 2, b: 1.5 })).toMatchObject({ field: 'b' });
    expect(checkScore('softball', 1, { kind: 'runs', a: MAX_SCORE + 1, b: 1 })).toMatchObject({
      field: 'a',
    });
    expect(checkScore('softball', 1, { kind: 'runs', a: Number.NaN, b: 1 })).toMatchObject({
      field: 'a',
    });
    expect(checkScore('softball', 1, { kind: 'runs', a: MAX_SCORE, b: 0 })).toBeNull();
  });

  test("refuses the other sport's kind of score", () => {
    expect(checkScore('soccer', 1, { kind: 'runs', a: 3, b: 1 })).toEqual({
      field: 'score',
      message: SCORE_MESSAGES.wrongKind,
    });
    expect(checkScore('beachVolleyball', 1, { kind: 'goals', a: 3, b: 1 })).toMatchObject({
      field: 'score',
    });
  });
});

describe('checkScore: beach volleyball sets', () => {
  const sets = (...scores: [number | null, number | null][]) => ({
    kind: 'sets' as const,
    sets: scores.map(([a, b]) => ({ a, b })),
  });

  test('a game of 1 set is one set with a winner, however close or capped', () => {
    expect(checkScore('beachVolleyball', 1, sets([21, 15]))).toBeNull();
    expect(checkScore('beachVolleyball', 1, sets([22, 24]))).toBeNull();
    expect(checkScore('beachVolleyball', 1, sets([21, 20]))).toBeNull();
    expect(checkScore('beachVolleyball', 1, sets([25, 24]))).toBeNull();
  });

  test('refuses a tied set under that set', () => {
    expect(checkScore('beachVolleyball', 1, sets([21, 21]))).toEqual({
      field: 'set1',
      message: SCORE_MESSAGES.setTied(1),
    });
  });

  test('refuses a missing or half-filled first set', () => {
    expect(checkScore('beachVolleyball', 1, sets())).toEqual({
      field: 'set1',
      message: SCORE_MESSAGES.setMissing(1),
    });
    expect(checkScore('beachVolleyball', 1, sets([null, null]))).toMatchObject({ field: 'set1' });
    expect(checkScore('beachVolleyball', 1, sets([21, null]))).toEqual({
      field: 'set1',
      message: SCORE_MESSAGES.blank,
    });
  });

  test('refuses a negative or fractional set score', () => {
    expect(checkScore('beachVolleyball', 1, sets([21, -1]))).toMatchObject({
      field: 'set1',
      message: SCORE_MESSAGES.wholeNumber,
    });
    expect(checkScore('beachVolleyball', 1, sets([21.5, 10]))).toMatchObject({ field: 'set1' });
  });

  test('refuses a second set in a game of 1 set, and a fourth in a best of 3, on the score', () => {
    expect(checkScore('beachVolleyball', 1, sets([21, 15], [21, 10]))).toEqual({
      field: 'score',
      message: SCORE_MESSAGES.extraSet(2),
    });
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [18, 21], [15, 12], [15, 12]))).toEqual({
      field: 'score',
      message: SCORE_MESSAGES.extraSet(4),
    });
  });

  test('a best of 3 won 2 to 0 stops after 2 sets', () => {
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [21, 18]))).toBeNull();
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [21, 18], [15, 3]))).toEqual({
      field: 'set3',
      message: SCORE_MESSAGES.extraSet(3),
    });
  });

  test('a best of 3 split 1 to 1 needs the third set, and a third set decides it', () => {
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [18, 21]))).toEqual({
      field: 'set3',
      message: SCORE_MESSAGES.setMissing(3),
    });
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [18, 21], [15, 12]))).toBeNull();
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [18, 21], [15, 14]))).toBeNull();
  });

  test('a trailing row left blank is dropped, a blank row between sets is not', () => {
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [21, 18], [null, null]))).toBeNull();
    expect(checkScore('beachVolleyball', 3, sets([21, 15], [null, null], [15, 3]))).toMatchObject({
      field: 'set2',
    });
  });

  test('the first set checked is the one reported', () => {
    expect(checkScore('beachVolleyball', 3, sets([21, 21], [21, 20]))).toMatchObject({
      field: 'set1',
    });
  });
});

describe('scoreWinnerSide', () => {
  test('is the side with the higher goals or runs', () => {
    expect(scoreWinnerSide({ kind: 'goals', a: 3, b: 1 })).toBe(0);
    expect(scoreWinnerSide({ kind: 'runs', a: 2, b: 5 })).toBe(1);
  });

  test('is the side that won more sets', () => {
    expect(scoreWinnerSide({ kind: 'sets', sets: [{ a: 21, b: 15 }] })).toBe(0);
    expect(
      scoreWinnerSide({
        kind: 'sets',
        sets: [
          { a: 21, b: 15 },
          { a: 18, b: 21 },
          { a: 10, b: 15 },
        ],
      }),
    ).toBe(1);
  });

  test('is null for a tie', () => {
    expect(scoreWinnerSide({ kind: 'goals', a: 1, b: 1 })).toBeNull();
    expect(scoreWinnerSide({ kind: 'sets', sets: [{ a: 21, b: 21 }] })).toBeNull();
  });
});

describe('forfeitScore', () => {
  test('is the configured forfeit score with the other team ahead', () => {
    expect(forfeitScore('soccer', 1, 0)).toEqual({ kind: 'goals', a: 0, b: 3 });
    expect(forfeitScore('soccer', 1, 1)).toEqual({ kind: 'goals', a: 3, b: 0 });
    expect(forfeitScore('softball', 1, 0)).toEqual({ kind: 'runs', a: 0, b: 7 });
    expect(forfeitScore('softball', 1, 1)).toEqual({ kind: 'runs', a: 7, b: 0 });
  });

  test('beach volleyball is a straight-sets loss: 1 set, or 2 sets of a best of 3', () => {
    expect(forfeitScore('beachVolleyball', 1, 0)).toEqual({
      kind: 'sets',
      sets: [{ a: 0, b: 21 }],
    });
    expect(forfeitScore('beachVolleyball', 3, 1)).toEqual({
      kind: 'sets',
      sets: [
        { a: 21, b: 0 },
        { a: 21, b: 0 },
      ],
    });
  });

  test('is a score the check accepts, with the other team as the winner', () => {
    for (const sport of sports) {
      for (const setsPerGame of [1, 3]) {
        for (const side of [0, 1] as const) {
          const score = forfeitScore(sport, setsPerGame, side);
          expect(checkScore(sport, setsPerGame, score)).toBeNull();
          expect(scoreWinnerSide(score)).toBe(side === 0 ? 1 : 0);
        }
      }
    }
  });
});

describe('scoreText', () => {
  test('writes goals and runs as a pair and sets in order', () => {
    expect(scoreText({ kind: 'goals', a: 3, b: 1 })).toBe('3–1');
    expect(scoreText({ kind: 'runs', a: 0, b: 7 })).toBe('0–7');
    expect(
      scoreText({
        kind: 'sets',
        sets: [
          { a: 21, b: 15 },
          { a: 18, b: 21 },
        ],
      }),
    ).toBe('21–15, 18–21');
  });
});

describe('scoresEqual', () => {
  const sets = (...pairs: [number, number][]) => ({
    kind: 'sets' as const,
    sets: pairs.map(([a, b]) => ({ a, b })),
  });

  test('two scores with the same sets are equal, whatever order the keys came in', () => {
    expect(scoresEqual(sets([21, 18]), { kind: 'sets', sets: [{ b: 18, a: 21 }] })).toBe(true);
    expect(scoresEqual(sets([21, 15], [18, 21], [15, 9]), sets([21, 15], [18, 21], [15, 9]))).toBe(
      true,
    );
  });

  test('a different set, or a different number of sets, is not equal', () => {
    expect(scoresEqual(sets([21, 18]), sets([21, 19]))).toBe(false);
    expect(scoresEqual(sets([21, 18]), sets([18, 21]))).toBe(false);
    expect(scoresEqual(sets([21, 15], [21, 10]), sets([21, 15]))).toBe(false);
  });

  test('goals and runs compare both sides, and a kind never equals another', () => {
    expect(scoresEqual({ kind: 'goals', a: 3, b: 1 }, { kind: 'goals', a: 3, b: 1 })).toBe(true);
    expect(scoresEqual({ kind: 'goals', a: 3, b: 1 }, { kind: 'goals', a: 1, b: 3 })).toBe(false);
    expect(scoresEqual({ kind: 'goals', a: 3, b: 1 }, { kind: 'runs', a: 3, b: 1 })).toBe(false);
    expect(scoresEqual({ kind: 'goals', a: 3, b: 1 }, sets([3, 1]))).toBe(false);
  });
});
