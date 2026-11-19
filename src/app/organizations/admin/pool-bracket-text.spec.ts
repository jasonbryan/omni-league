import { SCORE_WORDS, STANDINGS_TIEBREAKER_NOTES } from '../../../../convex/lib/standings';
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

  describe('tieNote', () => {
    const teams = ['Team 04', 'Team 05'];

    it.each([
      ['beachVolleyball', 'points'],
      ['soccer', 'goals'],
      ['softball', 'runs'],
    ] as const)('says what decided a tie on the advance line in %s, in %s', (sport, word) => {
      expect(tieNote('A', teams, 2, 'headToHead', sport)).toBe(
        `Pool A is tied for 2nd between Team 04 and Team 05. The team that scored more ${word} in the games between them advances.`,
      );
      expect(tieNote('A', teams, 2, 'seedOrder', sport)).toBe(
        `Pool A is tied for 2nd between Team 04 and Team 05. They scored the same number of ${word} against each other, or did not all play each other, so seed order decides.`,
      );
    });

    it('says a tie the organizer decided is their choice', () => {
      expect(tieNote('A', teams, 2, 'organizer', 'soccer')).toContain(
        'Your choice decides who advances.',
      );
    });

    it('uses the words of the standings notes', () => {
      for (const sport of ['beachVolleyball', 'soccer', 'softball'] as const) {
        expect(STANDINGS_TIEBREAKER_NOTES[sport]).toContain(
          `listed by the ${SCORE_WORDS[sport]} they scored against each other`,
        );
        expect(tieNote('A', teams, 2, 'headToHead', sport)).toContain(
          `scored more ${SCORE_WORDS[sport]} in the games between them`,
        );
      }
    });
  });
});
