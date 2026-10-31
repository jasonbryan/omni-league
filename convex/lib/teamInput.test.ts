import { describe, expect, test } from 'vitest';
import { checkTeamName, normalizeTeamName, teamSortName } from './teamInput';

describe('the team name rule', () => {
  test('trims the name and turns each inner run of whitespace into one space', () => {
    expect(normalizeTeamName('  Sand \t  Sharks \n')).toBe('Sand Sharks');
    expect(checkTeamName('  Sand   Sharks ')).toEqual({ ok: true, name: 'Sand Sharks' });
  });

  test('keys names by the normalized name in lower case', () => {
    expect(teamSortName('Sand  Sharks')).toBe('sand sharks');
    expect(teamSortName(' SAND SHARKS')).toBe(teamSortName('sand sharks'));
  });

  test.each(['', '   ', '\t\n'])('refuses %j as empty', (name) => {
    expect(checkTeamName(name)).toEqual({
      ok: false,
      error: { field: 'name', code: 'nameEmpty', message: 'Enter a team name.' },
    });
  });

  test('accepts 1 and 60 characters, and refuses 61 with the count', () => {
    expect(checkTeamName('A')).toEqual({ ok: true, name: 'A' });
    expect(checkTeamName('a'.repeat(60)).ok).toBe(true);
    expect(checkTeamName(` ${'a'.repeat(61)} `)).toEqual({
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: 'Use 60 characters or fewer. This name has 61.',
      },
    });
  });

  test('counts the length after the spaces are collapsed', () => {
    expect(checkTeamName(`${'a'.repeat(30)}     ${'b'.repeat(29)}`).ok).toBe(true);
  });
});
