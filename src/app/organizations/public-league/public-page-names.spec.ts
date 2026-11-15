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
const SEASON_NAMES: PublicPageNames = {
  ...NAMES,
  season: { slug: 'summer-2027', name: 'Summer 2027' },
};
const SEASON_ROUTE = { ...ROUTE, seasonSlug: 'summer-2027' };

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

  describe('given a season', () => {
    const SEASON = {
      slug: 'summer-2027',
      name: 'Summer 2027',
      startDate: '2027-06-06',
      endDate: '2027-08-29',
      registrationDeadline: '2027-05-23',
      isFull: true,
    };
    const names = (season: Parameters<typeof publicPageNames>[0]['season']) =>
      publicPageNames({ organization: NAMES.organization, league: NAMES.league, season });

    it('carries the deadline, the start date, and whether it is full', () => {
      expect(names(SEASON).season).toEqual({
        slug: 'summer-2027',
        name: 'Summer 2027',
        registration: { deadline: '2027-05-23', startDate: '2027-06-06', isFull: true },
      });
    });

    it('reads a season with no isFull as not full', () => {
      const noIsFull = { ...SEASON, isFull: undefined };

      expect(names(noIsFull).season?.registration?.isFull).toBe(false);
    });

    it('carries no registration for a season row with no deadline, such as a saved copy’s', () => {
      const saved = { ...SEASON, registrationDeadline: undefined };

      expect(names(saved).season).toEqual({ slug: 'summer-2027', name: 'Summer 2027' });
    });

    it('carries no registration for a season that gives only names', () => {
      expect(names({ slug: 'summer-2027', name: 'Summer 2027' }).season).toEqual({
        slug: 'summer-2027',
        name: 'Summer 2027',
      });
    });
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
  ])('returns nothing when %s is missing, empty, or not a string', (_, break_) => {
    expect(readPublicPageNames(break_(NAMES), ROUTE)).toBeUndefined();
  });
});

describe('readPublicPageNames for a season route', () => {
  it('returns the names of a state that carries the route’s season', () => {
    expect(readPublicPageNames(SEASON_NAMES, SEASON_ROUTE)).toEqual(SEASON_NAMES);
  });

  it('returns nothing for a state with no season, such as the league page’s', () => {
    expect(readPublicPageNames(NAMES, SEASON_ROUTE)).toBeUndefined();
  });

  it.each([
    ['organization', { ...SEASON_ROUTE, orgSlug: 'lakeshore-sand-league' }],
    ['league', { ...SEASON_ROUTE, leagueSlug: 'thursday-night-coed-2s' }],
    ['season', { ...SEASON_ROUTE, seasonSlug: 'fall-2027' }],
  ])('returns nothing when the %s slug is not the route’s', (_, route) => {
    expect(readPublicPageNames(SEASON_NAMES, route)).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ['the season name is not text', { ...SEASON_NAMES, season: { slug: 'summer-2027', name: 7 } }],
    ['the season name is empty', { ...SEASON_NAMES, season: { slug: 'summer-2027', name: '' } }],
    ['the season has no slug', { ...SEASON_NAMES, season: { name: 'Summer 2027' } }],
    ['the season is not an object', { ...SEASON_NAMES, season: 'Summer 2027' }],
    ['the season is null', { ...SEASON_NAMES, season: null }],
  ])('returns nothing when %s', (_, state) => {
    expect(readPublicPageNames(state, SEASON_ROUTE)).toBeUndefined();
  });
});

describe('readPublicPageNames given a registration', () => {
  const REGISTRATION = { deadline: '2027-05-23', startDate: '2027-06-06', isFull: false };
  const withRegistration = (registration: unknown) => ({
    ...SEASON_NAMES,
    season: { slug: 'summer-2027', name: 'Summer 2027', registration },
  });

  it('keeps the registration of a state that carries a valid one', () => {
    const state = withRegistration(REGISTRATION);

    expect(readPublicPageNames(state, SEASON_ROUTE)).toEqual(state);
    expect(
      readPublicPageNames(withRegistration({ ...REGISTRATION, isFull: true }), SEASON_ROUTE),
    ).toEqual(withRegistration({ ...REGISTRATION, isFull: true }));
  });

  it.each<[string, unknown]>([
    ['an empty deadline', { ...REGISTRATION, deadline: '' }],
    ['a deadline written as words', { ...REGISTRATION, deadline: 'May 1' }],
    ['a deadline that is a number', { ...REGISTRATION, deadline: 20270523 }],
    ['a deadline with a time', { ...REGISTRATION, deadline: '2027-05-23T00:00:00Z' }],
    ['an empty start date', { ...REGISTRATION, startDate: '' }],
    ['a start date written as words', { ...REGISTRATION, startDate: 'June 6' }],
    ['a start date that is a number', { ...REGISTRATION, startDate: 7 }],
    ['an isFull that is text', { ...REGISTRATION, isFull: 'true' }],
    ['an isFull that is a number', { ...REGISTRATION, isFull: 1 }],
    ['no isFull', { deadline: '2027-05-23', startDate: '2027-06-06' }],
    ['no deadline', { startDate: '2027-06-06', isFull: false }],
    ['a registration that is text', 'open'],
    ['a registration that is null', null],
  ])('returns the names without the registration for %s', (_, registration) => {
    expect(readPublicPageNames(withRegistration(registration), SEASON_ROUTE)).toEqual(SEASON_NAMES);
  });

  it('still returns nothing when the season slug is not the route’s', () => {
    expect(
      readPublicPageNames(withRegistration(REGISTRATION), { ...SEASON_ROUTE, seasonSlug: 'fall' }),
    ).toBeUndefined();
  });

  it('keeps only the three registration fields', () => {
    const state = withRegistration({ ...REGISTRATION, private: 'x' });

    expect(readPublicPageNames(state, SEASON_ROUTE)?.season?.registration).toEqual(REGISTRATION);
  });
});
