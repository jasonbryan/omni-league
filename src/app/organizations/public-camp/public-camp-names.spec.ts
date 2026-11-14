import { publicCampNames, readPublicCampNames, type PublicCampNames } from './public-camp-names';

const NAMES: PublicCampNames = {
  organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
  camp: { slug: 'junior-beach-volleyball-camp', name: 'Junior Beach Volleyball Camp' },
};
const ROUTE = { orgSlug: 'gulf-coast-sport-social', campSlug: 'junior-beach-volleyball-camp' };

describe('publicCampNames', () => {
  it('keeps the slug and the name of the organization and the camp, and nothing else', () => {
    const organization = { ...NAMES.organization, logoUrl: 'https://cdn.example/a.png' };
    const camp = { ...NAMES.camp, minimumAge: 9 };
    const state = publicCampNames({ organization, camp });

    expect(state).toEqual(NAMES);
    expect(Object.keys(state.organization)).toEqual(['slug', 'name']);
    expect(Object.keys(state.camp)).toEqual(['slug', 'name']);
  });
});

describe('readPublicCampNames', () => {
  it('returns the names of a state that matches the route', () => {
    expect(readPublicCampNames(NAMES, ROUTE)).toEqual(NAMES);
  });

  it.each([
    ['no state', undefined],
    ['null', null],
    ['a string', 'Junior'],
    ['another camp’s slug', { ...NAMES, camp: { ...NAMES.camp, slug: 'fall-break-camp' } }],
    [
      'another organization’s slug',
      { ...NAMES, organization: { ...NAMES.organization, slug: 'lakeshore-sand-league' } },
    ],
    ['a name that is not text', { ...NAMES, camp: { ...NAMES.camp, name: 4 } }],
    ['an empty name', { ...NAMES, camp: { ...NAMES.camp, name: '' } }],
    ['a missing camp', { organization: NAMES.organization }],
    ['another page’s state', { registered: true }],
  ])('returns nothing for %s', (_, state) => {
    expect(readPublicCampNames(state, ROUTE)).toBeUndefined();
  });
});
