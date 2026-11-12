import {
  publicTournamentNames,
  readPublicTournamentNames,
  type PublicTournamentNames,
} from './public-tournament-names';

const NAMES: PublicTournamentNames = {
  organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
  tournament: { slug: 'gulf-coast-beach-open', name: 'Gulf Coast Beach Open' },
};
const ROUTE = { orgSlug: 'gulf-coast-sport-social', tournamentSlug: 'gulf-coast-beach-open' };

describe('publicTournamentNames', () => {
  it('keeps the slug and the name of the organization and the tournament, and nothing else', () => {
    const organization = { ...NAMES.organization, logoUrl: 'https://cdn.example/a.png' };
    const tournament = { ...NAMES.tournament, maximumTeams: 16 };
    const state = publicTournamentNames({ organization, tournament });

    expect(state).toEqual(NAMES);
    expect(Object.keys(state.organization)).toEqual(['slug', 'name']);
    expect(Object.keys(state.tournament)).toEqual(['slug', 'name']);
  });
});

describe('readPublicTournamentNames', () => {
  it('returns the names of a state that matches the route', () => {
    expect(readPublicTournamentNames(NAMES, ROUTE)).toEqual(NAMES);
  });

  it.each([
    ['no state', undefined],
    ['null', null],
    ['a string', 'Gulf Coast'],
    ['an empty object', {}],
    ['the league page’s names', { organization: NAMES.organization, league: NAMES.tournament }],
  ])('returns nothing for %s', (_, state) => {
    expect(readPublicTournamentNames(state, ROUTE)).toBeUndefined();
  });

  it.each([
    ['organization', { ...ROUTE, orgSlug: 'lakeshore-sand-league' }],
    ['tournament', { ...ROUTE, tournamentSlug: 'winter-doubles-classic' }],
  ])('returns nothing when the %s slug is not the route’s', (_, route) => {
    expect(readPublicTournamentNames(NAMES, route)).toBeUndefined();
  });

  it.each<[string, (names: PublicTournamentNames) => unknown]>([
    ['the organization name', (n) => ({ ...n, organization: { ...n.organization, name: 4 } })],
    ['the organization slug', (n) => ({ ...n, organization: { ...n.organization, slug: null } })],
    ['the tournament name', (n) => ({ ...n, tournament: { ...n.tournament, name: ['a'] } })],
    ['an empty tournament name', (n) => ({ ...n, tournament: { ...n.tournament, name: '' } })],
    ['the tournament', (n) => ({ ...n, tournament: undefined })],
  ])('returns nothing when %s is missing, empty, or not a string', (_, break_) => {
    expect(readPublicTournamentNames(break_(NAMES), ROUTE)).toBeUndefined();
  });
});
