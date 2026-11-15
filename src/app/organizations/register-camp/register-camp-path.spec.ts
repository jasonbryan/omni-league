import { registerCampPath } from './register-camp-path';

describe('registerCampPath', () => {
  it('is the signed-in route with the session in the query string', () => {
    expect(registerCampPath('gulf-coast-sport-social', 'adult-beach-skills-camp', 'abc123')).toBe(
      '/app/organizations/gulf-coast-sport-social/camps/adult-beach-skills-camp/register?session=abc123',
    );
  });

  it('leaves the query string off without a session', () => {
    expect(registerCampPath('org', 'camp')).toBe('/app/organizations/org/camps/camp/register');
  });

  it('encodes what it is given', () => {
    expect(registerCampPath('org', 'camp', 'a&b=c')).toBe(
      '/app/organizations/org/camps/camp/register?session=a%26b%3Dc',
    );
  });
});
