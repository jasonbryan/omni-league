import { teamRowLines } from './team-row-lines';

describe('teamRowLines', () => {
  it('says how many more a team below the minimum needs, and marks it', () => {
    expect(teamRowLines(2, 4, 0)).toEqual({
      roster: '2 of 4 players · 2 more needed',
      belowMinimum: true,
      invites: null,
    });
  });

  it('gives "N of M players" for a team at the minimum', () => {
    expect(teamRowLines(4, 4, 0)).toMatchObject({ roster: '4 of 4 players', belowMinimum: false });
  });

  it('gives the count and the minimum for a team above it', () => {
    expect(teamRowLines(6, 4, 0)).toMatchObject({
      roster: '6 players · minimum 4',
      belowMinimum: false,
    });
  });

  it('counts pending invites, one and many, and leaves the line out at none', () => {
    expect(teamRowLines(1, 4, 1).invites).toBe('1 pending invite');
    expect(teamRowLines(1, 4, 2).invites).toBe('2 pending invites');
    expect(teamRowLines(1, 4, 0).invites).toBeNull();
  });

  it('says "1 player" for a minimum of one', () => {
    expect(teamRowLines(0, 1, 0).roster).toBe('0 of 1 player · 1 more needed');
  });
});
