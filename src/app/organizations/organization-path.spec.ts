import {
  listPagesPath,
  listPagesQuery,
  organizationPath,
  pageQueryFor,
  sportViewPath,
} from './organization-path';

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

describe('listPagesQuery', () => {
  it('omits page 1 of each list', () => {
    expect(listPagesQuery({ leagues: 1, locations: 1 }, false)).toEqual({});
    expect(listPagesQuery({ leagues: 1, locations: 1 }, true)).toEqual({});
  });

  it('names the leagues page leagues on the organization page, before locations', () => {
    const query = listPagesQuery({ leagues: 3, locations: 2 }, false);
    expect(query).toEqual({ leagues: 3, locations: 2 });
    expect(Object.keys(query)).toEqual(['leagues', 'locations']);
  });

  it('names the leagues page page on the sport view, before locations', () => {
    const query = listPagesQuery({ leagues: 3, locations: 2 }, true);
    expect(query).toEqual({ page: 3, locations: 2 });
    expect(Object.keys(query)).toEqual(['page', 'locations']);
  });
});

describe('listPagesPath', () => {
  it('is the bare path when both lists are on page 1', () => {
    expect(listPagesPath('gulf', undefined, { leagues: 1, locations: 1 })).toBe(
      '/organizations/gulf',
    );
    expect(listPagesPath('gulf', 'soccer', { leagues: 1, locations: 1 })).toBe(
      '/organizations/gulf/sports/soccer',
    );
  });

  it('adds leagues then locations on the organization page', () => {
    expect(listPagesPath('gulf', undefined, { leagues: 6, locations: 3 })).toBe(
      '/organizations/gulf?leagues=6&locations=3',
    );
    expect(listPagesPath('gulf', undefined, { leagues: 1, locations: 3 })).toBe(
      '/organizations/gulf?locations=3',
    );
  });

  it('adds page then locations on the sport view', () => {
    expect(listPagesPath('gulf', 'soccer', { leagues: 2, locations: 2 })).toBe(
      '/organizations/gulf/sports/soccer?page=2&locations=2',
    );
    expect(listPagesPath('gulf', 'soccer', { leagues: 3, locations: 1 })).toBe(
      '/organizations/gulf/sports/soccer?page=3',
    );
  });
});

describe('pageQueryFor', () => {
  it('keeps the locations page in each leagues link of the organization page', () => {
    const queryFor = pageQueryFor('leagues', { leagues: 3, locations: 2 }, false);
    expect(queryFor(1)).toEqual({ locations: 2 });
    expect(queryFor(4)).toEqual({ leagues: 4, locations: 2 });
  });

  it('keeps the leagues page in each locations link of the organization page', () => {
    const queryFor = pageQueryFor('locations', { leagues: 6, locations: 3 }, false);
    expect(queryFor(2)).toEqual({ leagues: 6, locations: 2 });
    expect(queryFor(1)).toEqual({ leagues: 6 });
  });

  it('keeps the other list in the links of the sport view', () => {
    expect(pageQueryFor('leagues', { leagues: 2, locations: 2 }, true)(3)).toEqual({
      page: 3,
      locations: 2,
    });
    expect(pageQueryFor('locations', { leagues: 2, locations: 2 }, true)(1)).toEqual({ page: 2 });
  });
});
