import { advanceDescription, advanceOptions, placeText } from './pool-bracket-text';

describe('pool bracket text', () => {
  it('names the pool and the ordinal place', () => {
    expect([1, 2, 3, 4, 8].map((place) => placeText('A', place))).toEqual([
      'Pool A, 1st',
      'Pool A, 2nd',
      'Pool A, 3rd',
      'Pool A, 4th',
      'Pool A, 8th',
    ]);
  });

  it('offers 1 team up to the smallest pool', () => {
    expect(advanceOptions(3)).toEqual([
      { key: '1', label: '1 team' },
      { key: '2', label: '2 teams' },
      { key: '3', label: '3 teams' },
    ]);
  });

  it('says why the choice stops at the smallest pool', () => {
    expect(advanceDescription(3)).toContain('The smallest pool has 3 teams');
  });
});
