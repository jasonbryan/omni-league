import { registerTournamentTeamPath } from './team-paths';

describe('registerTournamentTeamPath', () => {
  it('is the register route under the organization and tournament slugs', () => {
    expect(registerTournamentTeamPath('gulf-coast-sport-social', 'gulf-coast-beach-open')).toBe(
      '/app/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open/register',
    );
  });

  it('encodes each slug, so one cannot change the path', () => {
    expect(registerTournamentTeamPath('a/b', '../x?y#z')).toBe(
      '/app/organizations/a%2Fb/tournaments/..%2Fx%3Fy%23z/register',
    );
  });
});
