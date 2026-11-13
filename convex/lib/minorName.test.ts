import { describe, expect, test } from 'vitest';
import {
  checkMinorName,
  minorInMessage,
  minorLimitMessage,
  minorNameKey,
  shortMinorName,
} from './minorName';

describe('shortMinorName', () => {
  test.each([
    ['Maya Rivera', 'Maya R.'],
    ['Maya', 'Maya'],
    ['  Ana de la Cruz ', 'Ana C.'],
    ['maya rivera', 'maya R.'],
  ])('%j gives %j', (name, short) => {
    expect(shortMinorName(name)).toBe(short);
  });
});

describe('checkMinorName', () => {
  test('trims and collapses inner spaces', () => {
    expect(checkMinorName('  Maya   Rivera ')).toEqual({ ok: true, name: 'Maya Rivera' });
  });

  test('refuses an empty name and one over 60 characters', () => {
    expect(checkMinorName('   ')).toMatchObject({ ok: false, error: { code: 'minorNameEmpty' } });
    expect(checkMinorName('M'.repeat(60))).toMatchObject({ ok: true });
    expect(checkMinorName('M'.repeat(61))).toMatchObject({
      ok: false,
      error: {
        field: 'minorName',
        code: 'minorNameTooLong',
        message: 'Use 60 characters or fewer. This name has 61.',
      },
    });
  });

  test.each([
    ['a zero-width space', 'Maya\u200BRivera'],
    ['a zero-width joiner', 'Maya\u200DRivera'],
    ['a right-to-left override', 'Maya \u202ERivera'],
    ['a left-to-right mark', 'Maya\u200ERivera'],
    ['a null character', 'Maya\u0000 Rivera'],
    ['a delete character', 'Maya Rivera\u007F'],
  ])('refuses a name with %s', (_, name) => {
    expect(checkMinorName(name)).toEqual({
      ok: false,
      error: {
        field: 'minorName',
        code: 'minorNameInvisible',
        message: 'Remove the hidden or control characters from the name.',
      },
    });
  });

  test('accepts accents, apostrophes, and hyphens, and turns tabs and line breaks into spaces', () => {
    expect(checkMinorName('Zoë O’Brien-Núñez')).toEqual({ ok: true, name: 'Zoë O’Brien-Núñez' });
    expect(checkMinorName('Maya\tRivera\n')).toEqual({ ok: true, name: 'Maya Rivera' });
  });

  test('the key ignores case and spacing', () => {
    expect(minorNameKey(' maya  RIVERA')).toBe(minorNameKey('Maya Rivera'));
  });
});

describe('the messages for a season and for a tournament', () => {
  test('say where the minor already plays', () => {
    expect(minorInMessage('season', 'Maya R.', 'Sand Sharks')).toBe(
      'Maya R. is already on Sand Sharks in this season.',
    );
    expect(minorInMessage('tournament', 'Maya R.', 'Sand Crabs')).toBe(
      'Maya R. is already on Sand Crabs in this tournament.',
    );
  });

  test('say where the limit counts', () => {
    expect(minorLimitMessage('season')).toContain('20 minors in this season');
    expect(minorLimitMessage('tournament')).toContain('20 minors in this tournament');
  });
});
