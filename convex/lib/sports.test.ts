import { describe, expect, test } from 'vitest';
import {
  ROSTER_SIZE_INPUT_MAX,
  SPORT_FORMATS,
  SPORT_NAMES,
  formatMinimumRosterSize,
  formatName,
  formatValidator,
  SPORT_SEGMENTS,
  isFormatOfSport,
  playersPerSideOfFormat,
  seasonPlayersPerSide,
  sportFromSegment,
  sportSegment,
  type Sport,
} from './sports';

const sports = Object.keys(SPORT_NAMES) as Sport[];

describe('SPORT_FORMATS', () => {
  test('sets the minimum roster size of each format from the requirements', () => {
    const minimums = (sport: Sport) => SPORT_FORMATS[sport].map((f) => f.minimumRosterSize);
    expect(minimums('beachVolleyball')).toEqual([2, 4, 6]);
    expect(minimums('soccer')).toEqual([5, 7, 11]);
    expect(minimums('softball')).toEqual([10]);
  });

  test('gives every sport at least one format', () => {
    for (const sport of sports) {
      expect(SPORT_FORMATS[sport].length).toBeGreaterThanOrEqual(1);
    }
  });

  test('has no sport outside SPORT_NAMES', () => {
    expect(Object.keys(SPORT_FORMATS).sort()).toEqual([...sports].sort());
  });
});

describe('isFormatOfSport', () => {
  test('answers whether the format belongs to the sport', () => {
    expect(isFormatOfSport('soccer', '7v7')).toBe(true);
    expect(isFormatOfSport('soccer', '2v2')).toBe(false);
    expect(isFormatOfSport('softball', '10v10')).toBe(true);
  });
});

describe('formatMinimumRosterSize', () => {
  test('returns the minimum of a format of the sport', () => {
    expect(formatMinimumRosterSize('beachVolleyball', '4v4')).toBe(4);
  });

  test('throws for a format of another sport', () => {
    expect(() => formatMinimumRosterSize('beachVolleyball', '11v11')).toThrow();
  });
});

describe('formatName', () => {
  test('returns the placeholder display name', () => {
    expect(formatName('soccer', '7v7')).toBe('7v7');
  });
});

describe('formatValidator', () => {
  test('accepts exactly the format keys in SPORT_FORMATS', () => {
    const literals = formatValidator.members.map((member) => member.value).sort();
    const keys = sports.flatMap((sport) => SPORT_FORMATS[sport].map((f) => f.key)).sort();
    expect(literals).toEqual(keys);
  });
});

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

describe('players per side of a season', () => {
  test('is the number a format key names', () => {
    expect(formatValidator.members.map((member) => playersPerSideOfFormat(member.value))).toEqual([
      2, 4, 6, 5, 7, 11, 10,
    ]);
  });

  test('reads playersPerSide, else the number in format, and throws for neither', () => {
    expect(seasonPlayersPerSide({ playersPerSide: 7 })).toBe(7);
    expect(seasonPlayersPerSide({ format: '11v11' })).toBe(11);
    expect(seasonPlayersPerSide({ playersPerSide: 4, format: '6v6' })).toBe(4);
    expect(() => seasonPlayersPerSide({})).toThrow(/neither/);
  });
});
