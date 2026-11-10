import { NO_DIVISION_FILTERS } from '../../../convex/lib/leagueFilters';
import { findPath, findQuery } from './find-path';

describe('findPath', () => {
  it('is the bare path for no search', () => {
    expect(findPath('')).toBe('/leagues');
  });

  it('encodes the search into the q parameter', () => {
    expect(findPath('north beach')).toBe('/leagues?q=north%20beach');
    expect(findPath('a&b=c#d')).toBe('/leagues?q=a%26b%3Dc%23d');
  });
});

describe('findPath with a sport, filters, and a page', () => {
  const GIRLS_U10 = { ...NO_DIVISION_FILTERS, gender: ['womens'], ageGroup: ['u10'] } as const;

  it('names the sport by its segment, after the search', () => {
    expect(findPath('', { sport: 'soccer' })).toBe('/leagues?sport=soccer');
    expect(findPath('coed', { sport: 'beachVolleyball' })).toBe(
      '/leagues?q=coed&sport=beach-volleyball',
    );
  });

  it('puts the filters after the sport, in the order the filter form submits them', () => {
    expect(findPath('', { sport: 'soccer', filters: GIRLS_U10 })).toBe(
      '/leagues?sport=soccer&gender=girls&age=u10',
    );
    expect(
      findPath('', {
        sport: 'softball',
        filters: { ...NO_DIVISION_FILTERS, playersPerSide: [10], level: ['rec'] },
      }),
    ).toBe('/leagues?sport=softball&format=10v10&level=rec');
  });

  it('adds the page only above 1, last', () => {
    expect(findPath('', { sport: 'soccer', filters: GIRLS_U10, page: 2 })).toBe(
      '/leagues?sport=soccer&gender=girls&age=u10&page=2',
    );
    expect(findPath('', { sport: 'soccer', page: 1 })).toBe('/leagues?sport=soccer');
  });
});

describe('findQuery', () => {
  it('is the router params of the same URL', () => {
    expect(
      findQuery('north beach', {
        sport: 'soccer',
        filters: { ...NO_DIVISION_FILTERS, ageGroup: ['adult', 'u10'] },
        page: 3,
      }),
    ).toEqual({ q: 'north beach', sport: 'soccer', age: ['adult', 'u10'], page: 3 });
  });

  it('is empty for no search and no view', () => {
    expect(findQuery('')).toEqual({});
  });
});
