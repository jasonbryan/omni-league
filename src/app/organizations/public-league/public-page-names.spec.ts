import { publicPageNames, readPublicPageNames, type PublicPageNames } from './public-page-names';

const NAMES: PublicPageNames = {
  organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
  league: {
    slug: 'sunday-reverse-coed-4s',
    name: 'Sunday Reverse Coed 4s',
    sportName: 'Beach volleyball',
  },
};
const ROUTE = { orgSlug: 'gulf-coast-sport-social', leagueSlug: 'sunday-reverse-coed-4s' };

describe('publicPageNames', () => {
  it('keeps the slug and the name of the organization and the league, and the sport name', () => {
    const league = { ...NAMES.league, divisionLabel: 'Coed · 4v4 · BB' };

    expect(publicPageNames({ organization: NAMES.organization, league })).toEqual(NAMES);
  });

  it('keeps no field other than the names, so the state stays small and holds nothing private', () => {
    const organization = { slug: 'a', name: 'A', logoUrl: 'https://cdn.example/a.png' };
    const league = { slug: 'b', name: 'B', sportName: 'Softball', seasons: [] };
    const state = publicPageNames({ organization, league });

    expect(Object.keys(state.organization)).toEqual(['slug', 'name']);
    expect(Object.keys(state.league)).toEqual(['slug', 'name', 'sportName']);
  });
});

describe('readPublicPageNames', () => {
  it('returns the names of a state that matches the route', () => {
    expect(readPublicPageNames(NAMES, ROUTE)).toEqual(NAMES);
  });

  it('returns the season of a state that carries one', () => {
    const withSeason = { ...NAMES, season: { slug: 'summer-2027', name: 'Summer 2027' } };

    expect(readPublicPageNames(withSeason, ROUTE)).toEqual(withSeason);
  });

  it.each([
    ['no state', undefined],
    ['null', null],
    ['a string', 'Gulf Coast'],
    ['an empty object', {}],
    ['a state with another key, such as the team page’s', { registered: true }],
  ])('returns nothing for %s', (_, state) => {
    expect(readPublicPageNames(state, ROUTE)).toBeUndefined();
  });

  it.each([
    ['organization', { ...ROUTE, orgSlug: 'lakeshore-sand-league' }],
    ['league', { ...ROUTE, leagueSlug: 'thursday-night-coed-2s' }],
  ])('returns nothing when the %s slug is not the route’s', (_, route) => {
    expect(readPublicPageNames(NAMES, route)).toBeUndefined();
  });

  it.each<[string, (names: PublicPageNames) => unknown]>([
    ['the organization name', (n) => ({ ...n, organization: { ...n.organization, name: 4 } })],
    ['the organization slug', (n) => ({ ...n, organization: { ...n.organization, slug: null } })],
    ['the league name', (n) => ({ ...n, league: { ...n.league, name: ['a'] } })],
    ['the sport name', (n) => ({ ...n, league: { ...n.league, sportName: undefined } })],
    ['the season name', (n) => ({ ...n, season: { slug: 'summer-2027', name: 7 } })],
    ['the organization', (n) => ({ ...n, organization: 'Gulf Coast' })],
    ['the league', (n) => ({ ...n, league: undefined })],
    ['an empty league name', (n) => ({ ...n, league: { ...n.league, name: '' } })],
  ])('returns nothing when %s is not a string', (_, break_) => {
    expect(readPublicPageNames(break_(NAMES), ROUTE)).toBeUndefined();
  });
});
