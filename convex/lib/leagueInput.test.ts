import { describe, expect, test } from 'vitest';
import {
  checkLeagueAgeGroup,
  checkLeagueFormat,
  checkLeagueLevel,
  checkLeagueMinimumRosterSize,
  LEAGUE_MESSAGES,
} from './leagueInput';

describe('checkLeagueFormat', () => {
  test('accepts the formats of the sport and nothing outside its range', () => {
    expect(checkLeagueFormat('beachVolleyball', 2)).toBeNull();
    expect(checkLeagueFormat('beachVolleyball', 6)).toBeNull();
    expect(checkLeagueFormat('soccer', 4)).toBeNull();
    expect(checkLeagueFormat('soccer', 11)).toBeNull();
    for (const count of [1, 7, 2.5, Number.NaN]) {
      expect(checkLeagueFormat('beachVolleyball', count), String(count)).toMatchObject({
        field: 'format',
        code: 'formatInvalid',
      });
    }
    expect(checkLeagueFormat('soccer', 3)).toMatchObject({ code: 'formatInvalid' });
  });

  test('no format chosen says why players need it', () => {
    expect(checkLeagueFormat('softball', null)).toEqual({
      field: 'format',
      code: 'formatInvalid',
      message: 'Choose a format. Players filter leagues by it.',
    });
  });
});

describe('checkLeagueLevel', () => {
  test('accepts the levels of the sport and refuses another sport’s', () => {
    expect(checkLeagueLevel('beachVolleyball', 'bb')).toBeNull();
    expect(checkLeagueLevel('soccer', 'competitive')).toBeNull();
    expect(checkLeagueLevel('soccer', 'bb')).toEqual({
      field: 'level',
      code: 'levelInvalid',
      message: 'Choose one of the levels listed.',
    });
  });
});

describe('checkLeagueAgeGroup', () => {
  test('returns the age group for a known key and refuses an unknown one', () => {
    expect(checkLeagueAgeGroup('adult')).toEqual({ ok: true, ageGroup: 'adult' });
    expect(checkLeagueAgeGroup('u19')).toEqual({ ok: true, ageGroup: 'u19' });
    expect(checkLeagueAgeGroup('over45')).toEqual({
      ok: false,
      error: {
        field: 'ageGroup',
        code: 'ageGroupInvalid',
        message: 'Choose an age group from the list.',
      },
    });
  });
});

describe('checkLeagueMinimumRosterSize', () => {
  test('blank means the format’s own minimum', () => {
    expect(checkLeagueMinimumRosterSize(4, undefined)).toBeNull();
  });

  test('accepts the format’s players per side up to the input maximum', () => {
    expect(checkLeagueMinimumRosterSize(4, 4)).toBeNull();
    expect(checkLeagueMinimumRosterSize(4, 99)).toBeNull();
  });

  test('below the format says how many are needed', () => {
    expect(checkLeagueMinimumRosterSize(4, 3)).toEqual({
      field: 'minimumRosterSize',
      code: 'minimumRosterSizeLow',
      message: '4v4 needs at least 4 players. Enter 4 or more.',
    });
    expect(checkLeagueMinimumRosterSize(2, 0)).toMatchObject({ code: 'minimumRosterSizeLow' });
  });

  test('a fraction, a number past the maximum, and a non-number say what to enter', () => {
    for (const value of [4.5, 100, Number.NaN]) {
      expect(checkLeagueMinimumRosterSize(4, value), String(value)).toEqual({
        field: 'minimumRosterSize',
        code: 'minimumRosterSizeInvalid',
        message: 'Enter a whole number from 4 to 99.',
      });
    }
  });
});

describe('LEAGUE_MESSAGES', () => {
  test('the format message is the one the form shows under Format', () => {
    expect(LEAGUE_MESSAGES.formatInvalid).toBe('Choose a format. Players filter leagues by it.');
  });
});
