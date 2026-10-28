import { initialsOf } from './initials';

describe('initialsOf', () => {
  it.each([
    ['Maya Okafor', 'MO'],
    ['  maya   de la cruz ', 'MC'],
    ['Prince', 'P'],
    ['Élodie Ånström', 'ÉÅ'],
    ['', ''],
  ])('%j gives %j', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
