import { describe, expect, test } from 'vitest';
import {
  ROSTER_SIZE_INPUT_MAX,
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
