import { publicTournamentPageValidator } from '../../../../convex/lib/publicPage';
import { matchesValidator } from '../../core/data/convex/matches-validator';
import { BEACH_OPEN, BEACH_OPEN_BRACKET } from './testing/tournament-data';

const matches = (value: unknown) => matchesValidator(value, publicTournamentPageValidator);

describe('a saved tournament page checked against the current shape', () => {
  it('accepts a copy saved before the bracket and the full flag existed', () => {
    const older = Object.fromEntries(
      Object.entries(BEACH_OPEN).filter(([key]) => key !== 'isFull' && key !== 'bracket'),
    );
    expect(older).not.toHaveProperty('bracket');
    expect(older).not.toHaveProperty('isFull');
    expect(matches(older)).toBe(true);
  });

  it('accepts a copy saved with a bracket', () => {
    expect(matches({ ...BEACH_OPEN, bracket: BEACH_OPEN_BRACKET })).toBe(true);
  });

  it('accepts a bracket that names a winner and places no team fills yet', () => {
    const bracket = { ...BEACH_OPEN_BRACKET, winner: 'Sand Crabs' };
    expect(matches({ ...BEACH_OPEN, bracket })).toBe(true);
  });

  it('rejects a bracket whose rounds are not a list', () => {
    expect(matches({ ...BEACH_OPEN, bracket: { rounds: 'Final' } })).toBe(false);
  });

  it('rejects a game whose winner is not a place in the game', () => {
    const [round] = BEACH_OPEN_BRACKET.rounds;
    const game = { ...round.games[0], winner: 2 };
    const bracket = { rounds: [{ ...round, games: [game] }] };
    expect(matches({ ...BEACH_OPEN, bracket })).toBe(false);
  });

  describe('with a score or a forfeit', () => {
    const [round] = BEACH_OPEN_BRACKET.rounds;
    const copyWith = (game: object) => ({
      ...BEACH_OPEN,
      bracket: { rounds: [{ ...round, games: [{ ...round.games[0], ...game }] }] },
    });
    const SCORE = { kind: 'sets', sets: [{ a: 21, b: 15 }] };

    it('accepts a copy saved before score and forfeit existed', () => {
      for (const game of round.games) {
        expect(game).not.toHaveProperty('score');
        expect(game).not.toHaveProperty('forfeit');
      }
      expect(matches({ ...BEACH_OPEN, bracket: BEACH_OPEN_BRACKET })).toBe(true);
    });

    it.each([
      ['sets', SCORE],
      ['goals', { kind: 'goals', a: 3, b: 1 }],
      ['runs', { kind: 'runs', a: 7, b: 2 }],
    ])('accepts a game with a %s score', (_, score) => {
      expect(matches(copyWith({ winner: 0, score }))).toBe(true);
    });

    it.each([0, 1])('accepts a game with a forfeit in place %i', (forfeit) => {
      expect(matches(copyWith({ winner: 1, forfeit }))).toBe(true);
    });

    it('rejects a forfeit that is not a place in the game', () => {
      expect(matches(copyWith({ forfeit: 2 }))).toBe(false);
    });

    it('rejects a score of an unknown kind and a score that is not a pair', () => {
      expect(matches(copyWith({ score: { kind: 'points', a: 1, b: 0 } }))).toBe(false);
      expect(matches(copyWith({ score: { kind: 'goals', a: 'three', b: 1 } }))).toBe(false);
    });
  });
});
