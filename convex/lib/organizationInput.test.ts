import { describe, expect, test } from 'vitest';
import {
  checkCityState,
  CITY_STATE_HINT,
  MAX_CITY_STATE_LENGTH,
  MIN_CITY_STATE_LENGTH,
} from './organizationInput';

const REFUSAL = {
  ok: false,
  error: {
    field: 'cityState',
    code: 'cityStateInvalid',
    message: 'Use 2 to 60 characters, such as Corpus Christi, TX.',
  },
};

describe('checkCityState', () => {
  test('keeps a city and state', () => {
    expect(checkCityState('Corpus Christi, TX')).toEqual({ ok: true, value: 'Corpus Christi, TX' });
  });

  test('trims and collapses inner whitespace', () => {
    expect(checkCityState('  Corpus \t Christi,\n  TX  ')).toEqual({
      ok: true,
      value: 'Corpus Christi, TX',
    });
  });

  test('stores none for an empty or whitespace-only value', () => {
    for (const raw of ['', '   ', ' \t\n ']) {
      expect(checkCityState(raw), JSON.stringify(raw)).toEqual({ ok: true, value: null });
    }
  });

  test('counts after trimming and collapsing: 2 and 60 characters pass, 1 and 61 are refused', () => {
    expect([MIN_CITY_STATE_LENGTH, MAX_CITY_STATE_LENGTH]).toEqual([2, 60]);
    expect(checkCityState('TX')).toEqual({ ok: true, value: 'TX' });
    expect(checkCityState(` ${'c'.repeat(60)} `)).toEqual({ ok: true, value: 'c'.repeat(60) });
    expect(checkCityState('X')).toEqual(REFUSAL);
    expect(checkCityState(' X ')).toEqual(REFUSAL);
    expect(checkCityState('c'.repeat(61))).toEqual(REFUSAL);
    expect(checkCityState(`${'c'.repeat(30)}     ${'c'.repeat(29)}`)).toEqual({
      ok: true,
      value: `${'c'.repeat(30)} ${'c'.repeat(29)}`,
    });
  });

  test('has the hint from the issue', () => {
    expect(CITY_STATE_HINT).toBe('Such as Corpus Christi, TX');
  });
});
