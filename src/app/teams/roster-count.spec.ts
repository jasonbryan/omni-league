import { rosterCount } from './roster-count';

describe('rosterCount against the minimum roster size', () => {
  it('below the minimum: "N of M players" and how many more are needed', () => {
    expect(rosterCount(1, 4)).toEqual({
      count: '1 of 4 players',
      note: '3 more needed to reach the minimum of 4 players.',
      met: false,
    });
    expect(rosterCount(3, 4).note).toBe('1 more needed to reach the minimum of 4 players.');
  });

  it('at the minimum: "M of M players" and the minimum is met', () => {
    expect(rosterCount(4, 4)).toEqual({
      count: '4 of 4 players',
      note: 'The roster meets the minimum of 4 players.',
      met: true,
    });
  });

  it('above the minimum: "N players" and the minimum is met', () => {
    expect(rosterCount(6, 4)).toEqual({
      count: '6 players',
      note: 'The roster meets the minimum of 4 players.',
      met: true,
    });
  });

  it('says "player" for one', () => {
    expect(rosterCount(1, 1)).toEqual({
      count: '1 of 1 player',
      note: 'The roster meets the minimum of 1 player.',
      met: true,
    });
  });
});
