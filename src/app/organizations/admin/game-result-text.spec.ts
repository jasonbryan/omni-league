import { TIED_GAME_TEXT } from '../../../../convex/lib/sports';
import { offenders } from '../../ui/testing/app-sources';
import { poolGameResultText } from '../public-tournament/public-pool-text';
import { confirmedText, playedText, restoredText, savedText } from './game-result-text';

const SCORE = { kind: 'goals' as const, a: 2, b: 2 };

describe('playedText', () => {
  it('names the winner of a game', () => {
    expect(
      playedText({
        teams: ['Ace', 'Bay'],
        score: { kind: 'goals', a: 3, b: 1 },
        winnerName: 'Ace',
        forfeitName: null,
      }),
    ).toBe('Ace 3–1 Bay. Ace won.');
  });

  it('says a game with no winner ended in a tie', () => {
    expect(
      playedText({ teams: ['Ace', 'Bay'], score: SCORE, winnerName: null, forfeitName: null }),
    ).toBe('Ace 2–2 Bay. The game ended in a tie.');
  });
});

describe('the wording of a tied game', () => {
  it('is one sentence in the organizer’s result line, the saved and confirmed status, and the public game', () => {
    const tied = {
      teams: ['Ace', 'Bay'] as const,
      score: SCORE,
      winnerName: null,
      forfeitName: null,
    };
    expect(TIED_GAME_TEXT).toBe('The game ended in a tie.');
    expect(playedText(tied)).toContain(TIED_GAME_TEXT);
    expect(savedText(null, null, false, 'pool').description).toBe(TIED_GAME_TEXT);
    expect(confirmedText(null, null, 'pool').description).toBe(TIED_GAME_TEXT);
    expect(poolGameResultText({ round: 1, teams: ['Ace', 'Bay'], score: SCORE })).toContain(
      TIED_GAME_TEXT,
    );
  });

  it('is the only wording in the app: no template or string says the game was tied or gives the bare result Tied.', () => {
    expect(offenders('The game was tied.')).toEqual([]);
    expect(offenders(/['"`]Tied\./)).toEqual([]);
  });
});

describe('savedText', () => {
  it('says where a bracket winner goes', () => {
    expect(savedText('Ace', 'Final', false)).toEqual({
      title: 'Result saved',
      description: 'Ace advances to the Final.',
    });
    expect(savedText('Ace', null, true)).toEqual({
      title: 'Result corrected',
      description: 'Ace wins the tournament.',
    });
  });

  it('says only who won a pool game, because no round follows it', () => {
    expect(savedText('Ace', null, false, 'pool').description).toBe('Ace won.');
  });

  it('says a game with no winner ended in a tie, in either stage', () => {
    expect(savedText(null, null, false, 'pool').description).toBe('The game ended in a tie.');
    expect(savedText(null, null, true).description).toBe('The game ended in a tie.');
  });
});

describe('confirmedText', () => {
  it('follows the stage of the game', () => {
    expect(confirmedText('Ace', 'Final').description).toBe('Ace advances to the Final.');
    expect(confirmedText('Ace', null).description).toBe('Ace wins the tournament.');
    expect(confirmedText('Ace', null, 'pool')).toEqual({
      title: 'Report confirmed',
      description: 'Ace won.',
    });
    expect(confirmedText(null, null, 'pool').description).toBe('The game ended in a tie.');
  });
});

describe('restoredText', () => {
  it('follows the stage of the game', () => {
    expect(restoredText('Ace', 'Final').description).toBe('Ace advances to the Final.');
    expect(restoredText('Ace', null, 'pool').description).toBe('Ace won.');
    expect(restoredText(null, null, 'pool')).toEqual({
      title: 'Result restored',
      description: 'The game ended in a tie.',
    });
  });
});
