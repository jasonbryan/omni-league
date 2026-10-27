import { organizationPath, sportViewCanonicalPath, sportViewPath } from './organization-path';

describe('sportViewPath', () => {
  it('is the organization path, /sports/, and the segment', () => {
    expect(sportViewPath('gulf-coast-sport-social', 'beach-volleyball')).toBe(
      `${organizationPath('gulf-coast-sport-social')}/sports/beach-volleyball`,
    );
  });

  it('encodes the segment, so a request value never adds a path or a query string', () => {
    expect(sportViewPath('gulf', 'a/b?x=1#y')).toBe('/organizations/gulf/sports/a%2Fb%3Fx%3D1%23y');
  });
});

describe('sportViewCanonicalPath', () => {
  it('is the bare path for page 1', () => {
    expect(sportViewCanonicalPath('gulf', 'soccer', 1)).toBe('/organizations/gulf/sports/soccer');
  });

  it('adds ?page=N past page 1', () => {
    expect(sportViewCanonicalPath('gulf', 'soccer', 3)).toBe(
      '/organizations/gulf/sports/soccer?page=3',
    );
  });
});
