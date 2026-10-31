import type { ParamMap, Params } from '@angular/router';
import {
  AGE_GROUPS,
  GENDERS,
  STANDARD_LEVEL_LABELS,
  ageGroupLabel,
  formatLabel,
  isYouth,
  levelLabel,
  levelsOfSport,
  playersPerSideOfSport,
  type AgeGroup,
  type Gender,
  type StandardLevel,
} from '../../../convex/lib/divisions';
import type { DivisionFilters } from '../../../convex/lib/leagueFilters';
import { SPORT_NAMES, type Sport } from '../../../convex/lib/sports';

const ALL_SPORTS = Object.keys(SPORT_NAMES) as Sport[];

const ALL_LEVELS = Object.keys(STANDARD_LEVEL_LABELS) as StandardLevel[];

const AGE_GROUP_KEYS = AGE_GROUPS.map((group) => group.key);

const GENDER_PARAMS: Readonly<Record<string, Gender>> = {
  coed: 'coed',
  mens: 'mens',
  womens: 'womens',
  boys: 'mens',
  girls: 'womens',
};

const FORMAT_PARAM = /^([1-9][0-9]?)v\1$/;

function formatsOf(sport: Sport | undefined): number[] {
  const counts = (sport === undefined ? ALL_SPORTS : [sport]).flatMap(playersPerSideOfSport);
  return [...new Set(counts)].sort((a, b) => a - b);
}

/** Deduped, and in `order`, so every URL that names the same filters gives the same query args and saved copy. */
function inOrder<T>(order: readonly T[], values: readonly unknown[]): T[] {
  return order.filter((value) => values.includes(value));
}

/** Only values from the standard lists reach the args, the links, or the HTML: an unknown one is dropped, never echoed. */
export function parseDivisionFilters(params: ParamMap, sport: Sport | undefined): DivisionFilters {
  const known = (name: string, read: (value: string) => unknown = (value) => value) =>
    params.getAll(name).map(read);
  return {
    gender: inOrder(
      GENDERS,
      known('gender', (value) =>
        Object.hasOwn(GENDER_PARAMS, value) ? GENDER_PARAMS[value] : undefined,
      ),
    ),
    playersPerSide: inOrder(
      formatsOf(sport),
      known('format', (value) => {
        const match = FORMAT_PARAM.exec(value);
        return match ? Number(match[1]) : undefined;
      }),
    ),
    level: inOrder(sport === undefined ? ALL_LEVELS : levelsOfSport(sport), known('level')),
    ageGroup: inOrder(AGE_GROUP_KEYS, known('age')),
  };
}

export interface DivisionFilterArgs {
  gender?: Gender[];
  playersPerSide?: number[];
  level?: StandardLevel[];
  ageGroup?: AgeGroup[];
}

/** An empty dimension adds no argument, so unfiltered args, and the saved copies under them, stay as they were. */
export function divisionFilterQueryArgs(filters: DivisionFilters): DivisionFilterArgs {
  const { gender, playersPerSide, level, ageGroup } = filters;
  return {
    ...(gender.length > 0 && { gender: [...gender] }),
    ...(playersPerSide.length > 0 && { playersPerSide: [...playersPerSide] }),
    ...(level.length > 0 && { level: [...level] }),
    ...(ageGroup.length > 0 && { ageGroup: [...ageGroup] }),
  };
}

function youthOnly(filters: DivisionFilters): boolean {
  return filters.ageGroup.length > 0 && filters.ageGroup.every(isYouth);
}

function genderParam(gender: Gender, youth: boolean): string {
  if (!youth || gender === 'coed') return gender;
  return gender === 'mens' ? 'boys' : 'girls';
}

function genderName(gender: Gender, youth: boolean): string {
  if (gender === 'coed') return 'Coed';
  if (gender === 'mens') return youth ? 'Boys' : "Men's";
  return youth ? 'Girls' : "Women's";
}

/** In the order gender, format, level, age; gender is spelled as the form's check boxes are, so a submit and a built link give one URL. */
export function divisionFilterQuery(filters: DivisionFilters): Params {
  const youth = youthOnly(filters);
  const { gender, playersPerSide, level, ageGroup } = filters;
  return {
    ...(gender.length > 0 && { gender: gender.map((value) => genderParam(value, youth)) }),
    ...(playersPerSide.length > 0 && { format: playersPerSide.map(formatLabel) }),
    ...(level.length > 0 && { level: [...level] }),
    ...(ageGroup.length > 0 && { age: [...ageGroup] }),
  };
}

export interface FilterPill {
  readonly label: string;
  readonly dimension: 'gender' | 'format' | 'level' | 'age group';
  readonly without: DivisionFilters;
}

export function filterPills(filters: DivisionFilters): FilterPill[] {
  const youth = youthOnly(filters);
  const without = <K extends keyof DivisionFilters>(key: K, value: DivisionFilters[K][number]) => ({
    ...filters,
    [key]: (filters[key] as readonly unknown[]).filter((other) => other !== value),
  });
  return [
    ...filters.gender.map((gender) => ({
      label: `Gender: ${genderName(gender, youth)}`,
      dimension: 'gender' as const,
      without: without('gender', gender),
    })),
    ...filters.playersPerSide.map((count) => ({
      label: formatLabel(count),
      dimension: 'format' as const,
      without: without('playersPerSide', count),
    })),
    ...filters.level.map((level) => ({
      label: `Level: ${levelLabel(level)}`,
      dimension: 'level' as const,
      without: without('level', level),
    })),
    ...filters.ageGroup.map((ageGroup) => ({
      label: ageGroupLabel(ageGroup),
      dimension: 'age group' as const,
      without: without('ageGroup', ageGroup),
    })),
  ];
}

export interface FilterOption {
  readonly name: string;
  readonly value: string;
  readonly label: string;
  readonly checked: boolean;
}

export interface FilterGroup {
  readonly legend: string;
  readonly options: readonly FilterOption[];
}

/** A league's division values as the facets query gives them: strings, of which only the standard ones are offered. */
export interface LeagueFacet {
  readonly gender?: string;
  readonly playersPerSide?: number;
  readonly level?: string;
  readonly ageGroup?: string;
}

/** Offers the values some league in view has, plus any chosen one, so a submit keeps it. */
export function filterGroups(
  facets: readonly LeagueFacet[],
  filters: DivisionFilters,
  formatAndLevelSport: Sport | undefined,
): FilterGroup[] {
  const youth = youthOnly(filters);
  const offered = <T>(
    order: readonly T[],
    read: (facet: LeagueFacet) => unknown,
    chosen: readonly T[],
  ) =>
    inOrder(order, [...facets.map(read), ...chosen]).map((value) => ({
      value,
      checked: chosen.includes(value),
    }));
  const groups: FilterGroup[] = [
    {
      legend: 'Gender',
      options: offered(GENDERS, (facet) => facet.gender, filters.gender).map(
        ({ value, checked }) => ({
          name: 'gender',
          value: genderParam(value, youth),
          label: genderName(value, youth),
          checked,
        }),
      ),
    },
    ...(formatAndLevelSport === undefined
      ? []
      : [
          {
            legend: 'Format',
            options: offered(
              playersPerSideOfSport(formatAndLevelSport),
              (facet) => facet.playersPerSide,
              filters.playersPerSide,
            ).map(({ value, checked }) => ({
              name: 'format',
              value: formatLabel(value),
              label: formatLabel(value),
              checked,
            })),
          },
          {
            legend: 'Level',
            options: offered(
              levelsOfSport(formatAndLevelSport),
              (facet) => facet.level,
              filters.level,
            ).map(({ value, checked }) => ({
              name: 'level',
              value,
              label: levelLabel(value),
              checked,
            })),
          },
        ]),
    {
      legend: 'Age group',
      options: offered(AGE_GROUP_KEYS, (facet) => facet.ageGroup, filters.ageGroup).map(
        ({ value, checked }) => ({ name: 'age', value, label: ageGroupLabel(value), checked }),
      ),
    },
  ];
  return groups.filter((group) => group.options.length > 0);
}
