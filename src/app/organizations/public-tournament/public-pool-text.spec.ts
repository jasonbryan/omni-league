import type { PublicPool } from '../../../../convex/lib/publicPage';
import { columnKey, poolGameResultText, poolHasResult } from './public-pool-text';

type Game = PublicPool['games'][number];

const game = (more: Partial<Game> = {}): Game => ({
  round: 1,
  teams: ['Ace', 'Bay'],
  ...more,
});

describe('poolGameResultText', () => {
  it('has no text for a game not played yet', () => {
    expect(poolGameResultText(game())).toBeNull();
  });

  it('gives the score and the winner, the first team’s score first', () => {
    expect(
      poolGameResultText(game({ score: { kind: 'sets', sets: [{ a: 21, b: 15 }] }, winner: 0 })),
    ).toBe('21–15. Ace won.');
    expect(
      poolGameResultText(
        game({
          score: {
            kind: 'sets',
            sets: [
              { a: 21, b: 15 },
              { a: 18, b: 21 },
              { a: 9, b: 15 },
            ],
          },
          winner: 1,
        }),
      ),
    ).toBe('21–15, 18–21, 9–15. Bay won.');
  });

  it('says a game with a score and no winner ended in a tie', () => {
    expect(poolGameResultText(game({ score: { kind: 'goals', a: 2, b: 2 } }))).toBe(
      '2–2. The game ended in a tie.',
    );
  });

  it('names the team that forfeited and the winner, with no score', () => {
    expect(poolGameResultText(game({ forfeit: 1, winner: 0 }))).toBe('Bay forfeited. Ace won.');
  });

  it('names a forfeit with no winner without one', () => {
    expect(poolGameResultText(game({ forfeit: 0 }))).toBe('Ace forfeited.');
  });
});

describe('poolHasResult', () => {
  it('is true once a game has a score or a forfeit', () => {
    const played = game({ score: { kind: 'runs', a: 3, b: 1 }, winner: 0 });
    expect(poolHasResult({ games: [game(), played] })).toBe(true);
    expect(poolHasResult({ games: [game({ forfeit: 0, winner: 1 })] })).toBe(true);
  });

  it('is false while every game is unplayed', () => {
    expect(poolHasResult({ games: [game(), game({ round: 2 })] })).toBe(false);
    expect(poolHasResult({ games: [] })).toBe(false);
  });
});

describe('columnKey', () => {
  it('writes each short heading with what it stands for', () => {
    expect(
      columnKey({
        columns: [
          { short: 'P', label: 'Played' },
          { short: 'Win %', label: 'Win percentage' },
          { short: '+/-', label: 'Point differential' },
        ],
      }),
    ).toBe('P played, Win % win percentage, +/- point differential.');
  });
});
