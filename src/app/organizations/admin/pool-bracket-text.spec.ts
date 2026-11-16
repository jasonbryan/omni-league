import { advanceDescription, advanceOptions, placeText, tieNote } from './pool-bracket-text';

describe('pool bracket text', () => {
  it('names the pool and the ordinal place', () => {
    expect([1, 2, 3, 4, 8].map((place) => placeText('A', place, null))).toEqual([
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

  it('labels a tied team with the place it shares, whichever place it was given', () => {
    expect(placeText('A', 3, { place: 2 })).toBe('Pool A, 2nd, tied');
  });

  it('says what decided a tie on the advance line', () => {
    const teams = ['Team 04', 'Team 05'];
    expect(tieNote('A', teams, 2, 'headToHead')).toBe(
      'Pool A is tied for 2nd between Team 04 and Team 05. The team that scored more points in the games between them advances.',
    );
    expect(tieNote('A', teams, 2, 'seedOrder')).toContain('so seed order decides.');
    expect(tieNote('A', teams, 2, 'organizer')).toContain('Your choice decides who advances.');
  });
});
