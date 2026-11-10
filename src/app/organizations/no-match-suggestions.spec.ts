import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import { divisionFilterQuery, type LeagueFacet } from './division-filters';
import { noMatchSentence, removalSuggestions } from './no-match-suggestions';

const filters = (partial: Partial<DivisionFilters>): DivisionFilters => ({
  ...NO_DIVISION_FILTERS,
  ...partial,
});

const ORGANIZATION = 'Lakeshore Sand League';

describe('noMatchSentence', () => {
  it('names the gender and format of a view with no sport', () => {
    expect(
      noMatchSentence(ORGANIZATION, filters({ gender: ['mens'], playersPerSide: [6] }), undefined),
    ).toBe("Lakeshore Sand League has no men's 6v6 league.");
  });

  it('says youth gender as boys and girls, and puts the sport name before league', () => {
    expect(
      noMatchSentence(ORGANIZATION, filters({ gender: ['womens'], ageGroup: ['u10'] }), 'Soccer'),
    ).toBe("Lakeshore Sand League has no girls' U10 soccer league.");
    expect(
      noMatchSentence(ORGANIZATION, filters({ gender: ['mens'], ageGroup: ['u10'] }), 'Soccer'),
    ).toBe("Lakeshore Sand League has no boys' U10 soccer league.");
  });

  it('joins the values of one dimension with or and keeps the sport name in lower case', () => {
    expect(
      noMatchSentence(
        ORGANIZATION,
        filters({ gender: ['coed', 'mens'], playersPerSide: [2] }),
        'Beach volleyball',
      ),
    ).toBe("Lakeshore Sand League has no coed or men's 2v2 beach volleyball league.");
    expect(noMatchSentence(ORGANIZATION, filters({ gender: ['coed', 'womens'] }), undefined)).toBe(
      "Lakeshore Sand League has no coed or women's league.",
    );
  });

  it('lists gender, format, level, then age, with level and age by their labels', () => {
    expect(
      noMatchSentence(
        ORGANIZATION,
        filters({
          ageGroup: ['over40', 'u10'],
          level: ['bb'],
          playersPerSide: [4, 6],
          gender: ['coed'],
        }),
        undefined,
      ),
    ).toBe('Lakeshore Sand League has no coed 4v4 or 6v6 BB 40+ or U10 league.');
  });

  it('keeps men and women when an age group is not youth', () => {
    expect(
      noMatchSentence(
        ORGANIZATION,
        filters({ gender: ['womens'], ageGroup: ['adult', 'u10'] }),
        undefined,
      ),
    ).toBe("Lakeshore Sand League has no women's Adult or U10 league.");
  });
});

describe('removalSuggestions', () => {
  const queryFor = (without: DivisionFilters) => divisionFilterQuery(without);

  const suggest = (
    active: DivisionFilters,
    facets: readonly LeagueFacet[],
    sport: 'beachVolleyball' | 'soccer' | undefined = 'beachVolleyball',
  ) =>
    removalSuggestions({
      facets,
      filters: active,
      sportLeagueCounts: sport ? { [sport]: facets.length } : { beachVolleyball: facets.length },
      sport,
      total: facets.length,
      queryFor,
    });

  const SAND: LeagueFacet[] = [
    { gender: 'coed', playersPerSide: 6, level: 'rec', ageGroup: 'adult' },
    { gender: 'coed', playersPerSide: 6, level: 'b', ageGroup: 'adult' },
    { gender: 'womens', playersPerSide: 6, level: 'a', ageGroup: 'adult' },
    { gender: 'mens', playersPerSide: 4, level: 'aa', ageGroup: 'adult' },
  ];

  it('counts the leagues the other values match and puts the larger count first', () => {
    const suggestions = suggest(filters({ gender: ['mens'], playersPerSide: [6] }), SAND);
    expect(suggestions.map((s) => [s.label, s.count, s.text])).toEqual([
      ["Men's", 3, '(3 leagues)'],
      ['6v6', 1, '(1 league)'],
    ]);
  });

  it("says youth gender as Boys' and Girls', and level and age as the pills do", () => {
    const facets: LeagueFacet[] = [
      { gender: 'womens', level: 'rec', ageGroup: 'u12' },
      { gender: 'mens', level: 'rec', ageGroup: 'u10' },
      { gender: 'mens', level: 'rec', ageGroup: 'u10' },
    ];
    const active = filters({ gender: ['womens'], level: ['rec'], ageGroup: ['u10'] });
    expect(suggest(active, facets, 'soccer').map((s) => [s.label, s.count])).toEqual([
      ["Girls'", 2],
      ['U10', 1],
    ]);
  });

  it('keeps the order gender, format, level, age between equal counts', () => {
    const facets: LeagueFacet[] = [
      { gender: 'coed', playersPerSide: 6, level: 'b', ageGroup: 'u10' },
      { gender: 'womens', playersPerSide: 4, level: 'b', ageGroup: 'u10' },
      { gender: 'womens', playersPerSide: 4, level: 'b', ageGroup: 'u10' },
      { gender: 'womens', playersPerSide: 6, level: 'rec', ageGroup: 'u10' },
      { gender: 'womens', playersPerSide: 6, level: 'b', ageGroup: 'adult' },
    ];
    const active = filters({
      gender: ['womens'],
      playersPerSide: [6],
      level: ['b'],
      ageGroup: ['u10'],
    });
    expect(suggest(active, facets).map((s) => [s.label, s.count])).toEqual([
      ['6v6', 2],
      ["Girls'", 1],
      ['Level: B', 1],
      ['U10', 1],
    ]);
  });

  it('hides a link whose removal still matches nothing', () => {
    const active = filters({ gender: ['womens'], playersPerSide: [4], ageGroup: ['u10'] });
    expect(suggest(active, SAND)).toEqual([]);
    const mens = filters({ gender: ['mens'], playersPerSide: [6] });
    expect(suggest(mens, [SAND[0], SAND[3]]).map((s) => s.label)).toEqual(["Men's", '6v6']);
    expect(
      suggest(filters({ gender: ['womens'], playersPerSide: [2], level: ['aa'] }), SAND),
    ).toEqual([]);
  });

  it('labels a level and an age group as their pills do, and hides only the links that still match nothing', () => {
    const facets: LeagueFacet[] = [
      { gender: 'mens', playersPerSide: 6, level: 'bb', ageGroup: 'adult' },
      { gender: 'mens', playersPerSide: 6, level: 'rec', ageGroup: 'u10' },
      { gender: 'mens', playersPerSide: 6, level: 'rec', ageGroup: 'u10' },
    ];
    const active = filters({
      gender: ['mens'],
      playersPerSide: [6],
      level: ['bb'],
      ageGroup: ['u10'],
    });
    expect(suggest(active, facets).map((s) => [s.label, s.text])).toEqual([
      ['Level: BB', '(2 leagues)'],
      ['U10', '(1 league)'],
    ]);
  });

  it('counts every league of the view when the removed value was the only one', () => {
    const suggestions = suggest(filters({ ageGroup: ['u10'] }), SAND);
    expect(suggestions.map((s) => [s.label, s.count])).toEqual([['U10', 4]]);
  });

  it('gives each link the query of the filters without its value', () => {
    const [first, second] = suggest(filters({ gender: ['mens'], playersPerSide: [6] }), SAND);
    expect(first.query).toEqual({ format: ['6v6'] });
    expect(second.query).toEqual({ gender: ['mens'] });
  });

  it('shows none with no facets', () => {
    expect(suggest(filters({ gender: ['mens'] }), [])).toEqual([]);
  });
});
