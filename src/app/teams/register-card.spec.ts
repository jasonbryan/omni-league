import { rosterRange } from './register-card';

describe('rosterRange', () => {
  it('gives the minimum alone without a maximum', () => {
    expect(rosterRange(4)).toBe('At least 4 players');
  });

  it('gives the minimum to the maximum', () => {
    expect(rosterRange(4, 6)).toBe('4 to 6 players');
  });

  it('gives one number when the minimum and maximum are the same', () => {
    expect(rosterRange(6, 6)).toBe('6 players');
  });
});
