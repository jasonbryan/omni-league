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
});
