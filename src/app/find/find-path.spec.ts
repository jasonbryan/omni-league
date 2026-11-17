import { NO_DIVISION_FILTERS } from '../../../convex/lib/leagueFilters';
import { findPath, findQuery } from './find-path';

describe('findPath', () => {
  it('is the bare path for no search', () => {
    expect(findPath('')).toBe('/programs');
  });

  it('encodes the search into the q parameter', () => {
    expect(findPath('north beach')).toBe('/programs?q=north%20beach');
    expect(findPath('a&b=c#d')).toBe('/programs?q=a%26b%3Dc%23d');
  });
});

describe('findPath with a sport, filters, and a page', () => {
  const GIRLS_U10 = { ...NO_DIVISION_FILTERS, gender: ['womens'], ageGroup: ['u10'] } as const;

  it('names the sport by its segment, after the search', () => {
    expect(findPath('', { sport: 'soccer' })).toBe('/programs?sport=soccer');
    expect(findPath('coed', { sport: 'beachVolleyball' })).toBe(
      '/programs?q=coed&sport=beach-volleyball',
    );
  });

  it('puts the filters after the sport, in the order the filter form submits them', () => {
    expect(findPath('', { sport: 'soccer', filters: GIRLS_U10 })).toBe(
      '/programs?sport=soccer&gender=girls&age=u10',
    );
    expect(
      findPath('', {
        sport: 'softball',
        filters: { ...NO_DIVISION_FILTERS, playersPerSide: [10], level: ['rec'] },
      }),
    ).toBe('/programs?sport=softball&format=10v10&level=rec');
  });

  it('adds the page only above 1, last', () => {
    expect(findPath('', { sport: 'soccer', filters: GIRLS_U10, page: 2 })).toBe(
      '/programs?sport=soccer&gender=girls&age=u10&page=2',
    );
    expect(findPath('', { sport: 'soccer', page: 1 })).toBe('/programs?sport=soccer');
  });
});

describe('findPath with a type', () => {
  it('names the type first, so the search form and the redirect give one URL', () => {
    expect(findPath('', { type: 'tournament' })).toBe('/programs?type=tournament');
    expect(findPath('coed', { type: 'league', sport: 'soccer', page: 2 })).toBe(
      '/programs?type=league&q=coed&sport=soccer&page=2',
    );
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

  it('puts the type before the search', () => {
    expect(findQuery('coed', { type: 'camp', sport: 'soccer' })).toEqual({
      type: 'camp',
      q: 'coed',
      sport: 'soccer',
    });
  });

  it('is empty for no search and no view', () => {
    expect(findQuery('')).toEqual({});
  });
});
