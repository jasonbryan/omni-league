import { convertToParamMap } from '@angular/router';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import {
  divisionFilterQueryArgs,
  divisionFilterQuery,
  filterGroups,
  filterPills,
  parseDivisionFilters,
} from './division-filters';
import { listPagesPath, pageQueryFor } from './organization-path';

const parse = (query: string, sport?: 'beachVolleyball' | 'soccer') =>
  parseDivisionFilters(convertToParamMap(paramsOf(query)), sport);

function paramsOf(query: string): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const [name, value] of new URLSearchParams(query)) (params[name] ??= []).push(value);
  return params;
}

const filters = (partial: Partial<DivisionFilters>): DivisionFilters => ({
  ...NO_DIVISION_FILTERS,
  ...partial,
});

describe('parseDivisionFilters', () => {
  it('reads each dimension, with boys and girls as the youth names of mens and womens', () => {
    expect(parse('gender=coed&gender=girls&format=4v4&level=bb&age=u10&age=over40')).toEqual({
      gender: ['coed', 'womens'],
      playersPerSide: [4],
      level: ['bb'],
      ageGroup: ['over40', 'u10'],
    });
    expect(parse('gender=boys').gender).toEqual(['mens']);
  });

  it('gives one canonical form: deduped, in the standard order', () => {
    expect(parse('format=6v6&format=4v4&format=4v4')).toEqual(parse('format=4v4&format=6v6'));
    expect(parse('format=6v6&format=4v4&format=4v4').playersPerSide).toEqual([4, 6]);
    expect(parse('gender=womens&gender=coed&gender=girls').gender).toEqual(['coed', 'womens']);
    expect(parse('level=open&level=rec&level=bb', 'beachVolleyball').level).toEqual([
      'rec',
      'bb',
      'open',
    ]);
    expect(parse('level=competitive&level=bb&level=rec').level).toEqual([
      'rec',
      'bb',
      'competitive',
    ]);
    expect(parse('age=u10&age=adult&age=over40').ageGroup).toEqual(['adult', 'over40', 'u10']);
  });

  it.each([
    'gender=nope',
    'format=4x4',
    'format=4v5',
    'format=1v1',
    'format=12v12',
    'level=x',
    'age=u5',
    'level=BB',
    'gender=Coed',
    'format=04v04',
  ])('ignores the unknown value %s', (query) => {
    expect(parse(query)).toEqual(NO_DIVISION_FILTERS);
  });

  it("on a sport view, a format or level outside the sport's lists is unknown", () => {
    expect(parse('format=11v11&level=competitive', 'beachVolleyball')).toEqual(NO_DIVISION_FILTERS);
    expect(parse('format=11v11&level=competitive', 'soccer')).toEqual(
      filters({ playersPerSide: [11], level: ['competitive'] }),
    );
  });

  it('gives womens for both girls and womens, so both share one set of query args', () => {
    const girls = divisionFilterQueryArgs(parse('gender=girls&age=u10'));
    const womens = divisionFilterQueryArgs(parse('gender=womens&age=u10'));
    expect(girls).toEqual({ gender: ['womens'], ageGroup: ['u10'] });
    expect(womens).toEqual(girls);
  });
});

describe('divisionFilterQueryArgs', () => {
  it('adds no argument for a dimension with no value', () => {
    expect(divisionFilterQueryArgs(NO_DIVISION_FILTERS)).toEqual({});
    expect(divisionFilterQueryArgs(filters({ playersPerSide: [4, 6] }))).toEqual({
      playersPerSide: [4, 6],
    });
  });
});

describe('divisionFilterQuery', () => {
  it('writes gender as boys or girls only when every chosen age group is youth', () => {
    expect(divisionFilterQuery(parse('gender=womens&age=u10'))).toEqual({
      gender: ['girls'],
      age: ['u10'],
    });
    expect(divisionFilterQuery(parse('gender=girls&age=u10&age=adult'))).toEqual({
      gender: ['womens'],
      age: ['adult', 'u10'],
    });
    expect(divisionFilterQuery(parse('gender=boys&gender=coed'))).toEqual({
      gender: ['coed', 'mens'],
    });
  });
});

describe('links built from the filters', () => {
  it('write the filters first, in the order gender, format, level, age, then the pages', () => {
    const shown = parse('age=adult&level=bb&format=6v6&format=4v4&format=4v4&gender=coed');
    expect(listPagesPath('lake', undefined, { leagues: 2, locations: 3 }, shown)).toBe(
      '/organizations/lake?gender=coed&format=4v4&format=6v6&level=bb&age=adult&leagues=2&locations=3',
    );
  });

  it('keep both format values on the page links of a filtered list', () => {
    const shown = parse('format=4v4&format=6v6');
    const query = pageQueryFor('leagues', { leagues: 2, locations: 1 }, false, shown)(1);
    expect(query).toEqual({ format: ['4v4', '6v6'] });
    expect(pageQueryFor('leagues', { leagues: 1, locations: 1 }, true, shown)(2)).toEqual({
      format: ['4v4', '6v6'],
      page: 2,
    });
  });

  it('keep gender=coed on the Locations page links', () => {
    const query = pageQueryFor(
      'locations',
      { leagues: 1, locations: 2 },
      false,
      parse('gender=coed'),
    );
    expect(query(1)).toEqual({ gender: ['coed'] });
    expect(query(3)).toEqual({ gender: ['coed'], locations: 3 });
  });

  it('write nothing for no filter', () => {
    expect(listPagesPath('lake', 'soccer', { leagues: 2, locations: 1 })).toBe(
      '/organizations/lake/sports/soccer?page=2',
    );
  });
});

describe('filterPills', () => {
  it('gives one pill per value, each linking to the filters without it and with no page', () => {
    const pills = filterPills(parse('gender=coed&format=4v4&format=6v6&level=bb&age=u10'));
    expect(pills.map((pill) => [pill.label, pill.dimension])).toEqual([
      ['Gender: Coed', 'gender'],
      ['4v4', 'format'],
      ['6v6', 'format'],
      ['Level: BB', 'level'],
      ['U10', 'age group'],
    ]);
    expect(divisionFilterQuery(pills[1].without)).toEqual({
      gender: ['coed'],
      format: ['6v6'],
      level: ['bb'],
      age: ['u10'],
    });
  });

  it('names gender by its youth name when every chosen age group is youth', () => {
    expect(filterPills(parse('gender=womens&age=u10')).map((pill) => pill.label)).toEqual([
      'Gender: Girls',
      'U10',
    ]);
  });
});

describe('filterGroups', () => {
  const FACETS = [
    { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
    { gender: 'womens', playersPerSide: 2, level: 'a', ageGroup: 'adult' },
    { gender: 'coed', playersPerSide: 6 },
  ] as const;

  it('offers only values some league in view has, in the standard order', () => {
    const groups = filterGroups(FACETS, NO_DIVISION_FILTERS, 'beachVolleyball');
    expect(groups.map((group) => [group.legend, group.options.map((o) => o.label)])).toEqual([
      ['Gender', ['Coed', "Women's"]],
      ['Format', ['2v2', '4v4', '6v6']],
      ['Level', ['BB', 'A']],
      ['Age group', ['Adult']],
    ]);
    expect(groups[0].options.map((option) => option.value)).toEqual(['coed', 'womens']);
  });

  it("does not offer Men's when no league in view is men's", () => {
    const [gender] = filterGroups(FACETS, NO_DIVISION_FILTERS, 'beachVolleyball');
    expect(gender.options.map((option) => option.value)).not.toContain('mens');
  });

  it('offers no Format or Level with leagues of several sports', () => {
    const groups = filterGroups(FACETS, NO_DIVISION_FILTERS, undefined);
    expect(groups.map((group) => group.legend)).toEqual(['Gender', 'Age group']);
  });

  it('checks the chosen values and names gender Boys and Girls under the youth rule', () => {
    const youth = [{ gender: 'womens', ageGroup: 'u10' }] as const;
    const [gender, age] = filterGroups(youth, parse('gender=girls&age=u10'), 'soccer');
    expect(gender.options).toEqual([
      { name: 'gender', value: 'girls', label: 'Girls', checked: true },
    ]);
    expect(age.options).toEqual([{ name: 'age', value: 'u10', label: 'U10', checked: true }]);
  });

  it('leaves out a dimension no league has a value in', () => {
    expect(
      filterGroups([{ gender: 'coed' }], NO_DIVISION_FILTERS, 'soccer').map((g) => g.legend),
    ).toEqual(['Gender']);
  });
});
