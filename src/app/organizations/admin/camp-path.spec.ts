import { campPath } from './camp-path';

describe('campPath', () => {
  it('is the camp management page under the organization', () => {
    expect(campPath('gulf-coast-sport-social', 'junior-beach-volleyball-camp')).toBe(
      '/app/organizations/gulf-coast-sport-social/camps/junior-beach-volleyball-camp',
    );
  });

  it('encodes each slug, so a slug cannot add a path segment, a query string, or a fragment', () => {
    expect(campPath('a/b', 'c?d#e')).toBe('/app/organizations/a%2Fb/camps/c%3Fd%23e');
  });
});
