import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import {
  draftLeagueCount,
  hiddenDraftInputs,
  offeredFacets,
  showLeaguesLabel,
} from './filter-draft';
import { GULF_COAST, SAND } from './testing/pages';

const filters = (partial: Partial<DivisionFilters>): DivisionFilters => ({
  ...NO_DIVISION_FILTERS,
  ...partial,
});

const SAND_COUNTS = { beachVolleyball: 7 };
const GULF_COUNTS = { beachVolleyball: 2, soccer: 2, softball: 1 };

describe('draftLeagueCount', () => {
  const sand = (draft: DivisionFilters) =>
    draftLeagueCount(SAND.facets, draft, SAND_COUNTS, undefined, 7);

  it('counts the facet leagues the draft matches', () => {
    expect(sand(filters({ gender: ['coed'], playersPerSide: [4] }))).toBe(2);
    expect(sand(filters({ playersPerSide: [4, 6] }))).toBe(6);
    expect(sand(filters({ gender: ['womens'] }))).toBe(2);
  });

  it('is 0 when no league matches', () => {
    expect(sand(filters({ gender: ['mens'], playersPerSide: [6] }))).toBe(0);
  });

  it('is the total with no filter, so a league with no division values still counts', () => {
    expect(sand(NO_DIVISION_FILTERS)).toBe(7);
    expect(draftLeagueCount([], NO_DIVISION_FILTERS, SAND_COUNTS, undefined, 3)).toBe(3);
  });

  it('ignores Format and Level on All sports with several sports, as the backend does', () => {
    const draft = filters({ gender: ['coed'], playersPerSide: [4], level: ['bb'] });
    expect(draftLeagueCount(GULF_COAST.facets, draft, GULF_COUNTS, undefined, 5)).toBe(4);
    expect(
      draftLeagueCount(
        GULF_COAST.facets,
        filters({ playersPerSide: [4], level: ['bb'] }),
        GULF_COUNTS,
        undefined,
        5,
      ),
    ).toBe(5);
  });

  it('applies Format and Level in a sport view of an organization with several sports', () => {
    const beach = GULF_COAST.facets?.slice(2, 4);
    expect(
      draftLeagueCount(beach, filters({ playersPerSide: [4] }), GULF_COUNTS, 'beachVolleyball', 2),
    ).toBe(1);
  });

  it('is unknown until the facets arrive', () => {
    expect(
      draftLeagueCount(undefined, filters({ gender: ['coed'] }), SAND_COUNTS, undefined, 7),
    ).toBeUndefined();
  });
});

describe('showLeaguesLabel', () => {
  it('names the count, singular for one, and no number while it is unknown', () => {
    expect(showLeaguesLabel(2)).toBe('Show 2 leagues');
    expect(showLeaguesLabel(1)).toBe('Show 1 league');
    expect(showLeaguesLabel(0)).toBe('Show 0 leagues');
    expect(showLeaguesLabel(undefined)).toBe('Show leagues');
  });
});

describe('hiddenDraftInputs', () => {
  const draft = filters({ gender: ['coed'], playersPerSide: [4], level: ['bb', 'a'] });

  it('carries the draft values of the dimensions the form does not show', () => {
    expect(hiddenDraftInputs(draft, ['level'])).toEqual([
      { name: 'gender', value: 'coed' },
      { name: 'format', value: '4v4' },
    ]);
  });

  it('carries nothing when every dimension with a value is shown', () => {
    expect(hiddenDraftInputs(draft, ['gender', 'format', 'level', 'age'])).toEqual([]);
  });

  it('spells gender as the youth form does when every age group is youth', () => {
    expect(hiddenDraftInputs(filters({ gender: ['womens'], ageGroup: ['u10'] }), ['age'])).toEqual([
      { name: 'gender', value: 'girls' },
    ]);
  });
});

describe('offeredFacets', () => {
  it('adds each applied value as a facet of its own, so unchecking it in a draft keeps its chip', () => {
    const offered = offeredFacets(
      [{ gender: 'coed', playersPerSide: 4 }],
      filters({ gender: ['mens'], level: ['a'] }),
    );
    expect(offered).toEqual([
      { gender: 'coed', playersPerSide: 4 },
      { gender: 'mens' },
      { level: 'a' },
    ]);
  });
});
