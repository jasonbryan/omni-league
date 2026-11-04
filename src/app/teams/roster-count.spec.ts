import { rosterCount } from './roster-count';

describe('rosterCount against the minimum roster size', () => {
  it('below the minimum: "N of M players" and how many more are needed', () => {
    expect(rosterCount(1, 4)).toEqual({
      count: '1 of 4 players',
      note: '3 more needed to reach the minimum of 4 players.',
      met: false,
      full: false,
    });
    expect(rosterCount(3, 4).note).toBe('1 more needed to reach the minimum of 4 players.');
  });

  it('at the minimum: "M of M players" and the minimum is met', () => {
    expect(rosterCount(4, 4)).toEqual({
      count: '4 of 4 players',
      note: 'The roster meets the minimum of 4 players.',
      met: true,
      full: false,
    });
  });

  it('above the minimum: "N players" and the minimum is met', () => {
    expect(rosterCount(6, 4)).toEqual({
      count: '6 players',
      note: 'The roster meets the minimum of 4 players.',
      met: true,
      full: false,
    });
  });

  it('says "player" for one', () => {
    expect(rosterCount(1, 1)).toEqual({
      count: '1 of 1 player',
      note: 'The roster meets the minimum of 1 player.',
      met: true,
      full: false,
    });
  });
});

describe('rosterCount against the maximum roster size', () => {
  it('below the maximum: the minimum note says how many the team can have', () => {
    expect(rosterCount(3, 4, 6)).toEqual({
      count: '3 of 4 players',
      note: '1 more needed to reach the minimum of 4 players. Up to 6 players.',
      met: false,
      full: false,
    });
    expect(rosterCount(5, 4, 6).note).toBe(
      'The roster meets the minimum of 4 players. Up to 6 players.',
    );
  });

  it('at the maximum: "M of M players" when it equals the minimum, and the team is full', () => {
    expect(rosterCount(4, 4, 4)).toEqual({
      count: '4 of 4 players',
      note: 'The team is full: 4 players is this season’s maximum.',
      met: true,
      full: true,
    });
    expect(rosterCount(6, 4, 6)).toEqual({
      count: '6 players',
      note: 'The team is full: 6 players is this season’s maximum.',
      met: true,
      full: true,
    });
  });
});
