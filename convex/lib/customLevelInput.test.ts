import { describe, expect, test } from 'vitest';
import {
  CUSTOM_LEVEL_MESSAGES,
  MAX_CUSTOM_LEVEL_NAME_LENGTH,
  checkCustomLevelName,
  checkCustomLevelStandard,
  normalizeCustomLevelName,
} from './customLevelInput';

describe('normalizeCustomLevelName', () => {
  test('trims and collapses inner whitespace, and keeps the case', () => {
    expect(normalizeCustomLevelName('  Gold \t  Plus ')).toBe('Gold Plus');
  });
});

describe('checkCustomLevelName', () => {
  test('accepts a name and returns it normalized', () => {
    expect(checkCustomLevelName('beachVolleyball', '  Gold  ')).toEqual({ ok: true, name: 'Gold' });
  });

  test('refuses an empty name and one of only spaces', () => {
    for (const name of ['', '   ']) {
      expect(checkCustomLevelName('soccer', name)).toEqual({
        ok: false,
        error: { field: 'name', code: 'nameEmpty', message: CUSTOM_LEVEL_MESSAGES.nameEmpty },
      });
    }
  });

  test('accepts 30 characters and refuses 31, counting the normalized name', () => {
    expect(checkCustomLevelName('soccer', 'a'.repeat(MAX_CUSTOM_LEVEL_NAME_LENGTH)).ok).toBe(true);
    expect(checkCustomLevelName('soccer', ` ${'a'.repeat(30)} `).ok).toBe(true);
    expect(checkCustomLevelName('soccer', 'a'.repeat(31))).toEqual({
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: 'Use 30 characters or fewer. This name has 31.',
      },
    });
  });

  test('refuses the label of a standard level of the sport, ignoring case', () => {
    expect(checkCustomLevelName('beachVolleyball', 'bb')).toEqual({
      ok: false,
      error: {
        field: 'name',
        code: 'standardLevel',
        message: 'BB is a standard level. Choose it above.',
      },
    });
    expect(checkCustomLevelName('soccer', ' INTERMEDIATE ')).toMatchObject({
      error: { message: 'Intermediate is a standard level. Choose it above.' },
    });
  });

  test('allows the label of a level the sport does not have', () => {
    expect(checkCustomLevelName('soccer', 'BB').ok).toBe(true);
    expect(checkCustomLevelName('beachVolleyball', 'Competitive').ok).toBe(true);
  });
});

describe('checkCustomLevelStandard', () => {
  test('accepts a standard level of the sport', () => {
    expect(checkCustomLevelStandard('beachVolleyball', 'Gold', 'a')).toEqual({
      ok: true,
      standardLevel: 'a',
    });
  });

  test('refuses none, an unknown value, and another sport’s level, naming the custom level', () => {
    const refused = {
      ok: false,
      error: {
        field: 'standardLevel',
        code: 'standardLevelEmpty',
        message: 'Choose the standard level Gold matches, so players can filter for it.',
      },
    };
    for (const value of [null, '', 'platinum', 'competitive']) {
      expect(checkCustomLevelStandard('beachVolleyball', 'Gold', value), String(value)).toEqual(
        refused,
      );
    }
  });

  test('names a blank custom level as "it"', () => {
    expect(checkCustomLevelStandard('soccer', '  ', null)).toMatchObject({
      error: { message: 'Choose the standard level it matches, so players can filter for it.' },
    });
  });
});

describe('the messages only the server needs', () => {
  test('say which sport and which league', () => {
    expect(CUSTOM_LEVEL_MESSAGES.duplicate('Gold', 'beachVolleyball')).toBe(
      'Gold is already a custom level for beach volleyball.',
    );
    expect(CUSTOM_LEVEL_MESSAGES.inUse('Gold')).toBe('A league uses Gold.');
    expect(CUSTOM_LEVEL_MESSAGES.limit('softball')).toBe(
      'You can have at most 20 custom levels for softball.',
    );
  });
});
