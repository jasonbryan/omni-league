import { publicTournamentPageValidator } from '../../../../convex/lib/publicPage';
import { matchesValidator } from '../../core/data/convex/matches-validator';
import {
  BEACH_OPEN,
  BEACH_OPEN_BRACKET,
  BEACH_OPEN_DOUBLE_BRACKET,
  BEACH_OPEN_POOLS,
} from './testing/tournament-data';

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

  it('accepts a copy saved with a losers’ bracket and a grand final', () => {
    expect(matches({ ...BEACH_OPEN, bracket: BEACH_OPEN_DOUBLE_BRACKET })).toBe(true);
  });

  it('accepts a grand final with its deciding game played', () => {
    const [game] = BEACH_OPEN_DOUBLE_BRACKET.grandFinal!.games;
    const grandFinal = { games: [{ ...game, winner: 1 }, game], decidingGameIfNeeded: true };
    expect(matches({ ...BEACH_OPEN, bracket: { ...BEACH_OPEN_DOUBLE_BRACKET, grandFinal } })).toBe(
      true,
    );
  });

  it('rejects a grand final that does not say whether a deciding game is possible', () => {
    const grandFinal = { games: BEACH_OPEN_DOUBLE_BRACKET.grandFinal!.games };
    expect(matches({ ...BEACH_OPEN, bracket: { ...BEACH_OPEN_DOUBLE_BRACKET, grandFinal } })).toBe(
      false,
    );
  });

  it('rejects a losers’ bracket whose rounds are not a list', () => {
    const bracket = { ...BEACH_OPEN_DOUBLE_BRACKET, losers: 'Losers’ final' };
    expect(matches({ ...BEACH_OPEN, bracket })).toBe(false);
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

  describe('with pools', () => {
    const [pool] = BEACH_OPEN_POOLS;
    const copyWith = (change: object) => ({ ...BEACH_OPEN, pools: [{ ...pool, ...change }] });

    it('accepts a copy saved before pools existed', () => {
      expect(BEACH_OPEN).not.toHaveProperty('pools');
      expect(matches({ ...BEACH_OPEN, bracket: BEACH_OPEN_BRACKET })).toBe(true);
    });

    it('accepts a copy saved with pools', () => {
      expect(matches({ ...BEACH_OPEN, pools: BEACH_OPEN_POOLS })).toBe(true);
    });

    it('accepts a game with a forfeit, and a tied game with a score and no winner', () => {
      const games = [
        { round: 1, teams: ['Sand Crabs', 'Dig Dogs'], forfeit: 1, winner: 0 },
        { round: 2, teams: ['Sand Crabs', 'Net Results'], score: { kind: 'goals', a: 2, b: 2 } },
      ];
      expect(matches(copyWith({ games }))).toBe(true);
    });

    it('rejects standings that are not a list, and a row without cells', () => {
      expect(matches(copyWith({ standings: 'none' }))).toBe(false);
      expect(matches(copyWith({ standings: [{ place: 1, name: 'Sand Crabs' }] }))).toBe(false);
    });

    it('rejects a winner that is not a place in the game', () => {
      expect(matches(copyWith({ games: [{ round: 1, teams: ['A', 'B'], winner: 2 }] }))).toBe(
        false,
      );
    });
  });
});
