import { v, type Infer } from 'convex/values';
import type { Sport } from './sports';

// Imports stay `convex/values` and `./sports` so the Angular app can import these values.

export const GENDERS = ['coed', 'mens', 'womens'] as const;

export const genderValidator = v.union(v.literal('coed'), v.literal('mens'), v.literal('womens'));

export type Gender = Infer<typeof genderValidator>;

export const standardLevelValidator = v.union(
  v.literal('rec'),
  v.literal('b'),
  v.literal('bb'),
  v.literal('a'),
  v.literal('aa'),
  v.literal('open'),
  v.literal('intermediate'),
  v.literal('competitive'),
);

export type StandardLevel = Infer<typeof standardLevelValidator>;

export const STANDARD_LEVEL_LABELS: Readonly<Record<StandardLevel, string>> = {
  rec: 'Rec',
  b: 'B',
  bb: 'BB',
  a: 'A',
  aa: 'AA',
  open: 'Open',
  intermediate: 'Intermediate',
  competitive: 'Competitive',
};

const LEVELS_BY_SPORT: Readonly<Record<Sport, readonly StandardLevel[]>> = {
  beachVolleyball: ['rec', 'b', 'bb', 'a', 'aa', 'open'],
  soccer: ['rec', 'intermediate', 'competitive'],
  softball: ['rec', 'intermediate', 'competitive'],
};

export const ageGroupValidator = v.union(
  v.literal('adult'),
  v.literal('over30'),
  v.literal('over35'),
  v.literal('over40'),
  v.literal('over50'),
  v.literal('over55'),
  v.literal('over60'),
  v.literal('u6'),
  v.literal('u7'),
  v.literal('u8'),
  v.literal('u9'),
  v.literal('u10'),
  v.literal('u11'),
  v.literal('u12'),
  v.literal('u13'),
  v.literal('u14'),
  v.literal('u15'),
  v.literal('u16'),
  v.literal('u17'),
  v.literal('u18'),
  v.literal('u19'),
);

export type AgeGroup = Infer<typeof ageGroupValidator>;

export const AGE_GROUPS: readonly { readonly key: AgeGroup; readonly label: string }[] = [
  { key: 'adult', label: 'Adult' },
  { key: 'over30', label: '30+' },
  { key: 'over35', label: '35+' },
  { key: 'over40', label: '40+' },
  { key: 'over50', label: '50+' },
  { key: 'over55', label: '55+' },
  { key: 'over60', label: '60+' },
  { key: 'u6', label: 'U6' },
  { key: 'u7', label: 'U7' },
  { key: 'u8', label: 'U8' },
  { key: 'u9', label: 'U9' },
  { key: 'u10', label: 'U10' },
  { key: 'u11', label: 'U11' },
  { key: 'u12', label: 'U12' },
  { key: 'u13', label: 'U13' },
  { key: 'u14', label: 'U14' },
  { key: 'u15', label: 'U15' },
  { key: 'u16', label: 'U16' },
  { key: 'u17', label: 'U17' },
  { key: 'u18', label: 'U18' },
  { key: 'u19', label: 'U19' },
];

const PLAYERS_PER_SIDE_RANGE: Readonly<
  Record<Sport, { readonly min: number; readonly max: number }>
> = {
  beachVolleyball: { min: 2, max: 6 },
  soccer: { min: 4, max: 11 },
  softball: { min: 9, max: 10 },
};

export function levelsOfSport(sport: Sport): readonly StandardLevel[] {
  return LEVELS_BY_SPORT[sport];
}

export function isLevelOfSport(sport: Sport, level: StandardLevel): boolean {
  return LEVELS_BY_SPORT[sport].includes(level);
}

export function levelLabel(level: StandardLevel): string {
  return STANDARD_LEVEL_LABELS[level];
}

export function ageGroupLabel(ageGroup: AgeGroup): string {
  return AGE_GROUPS.find((group) => group.key === ageGroup)?.label ?? ageGroup;
}

export function isYouth(ageGroup: AgeGroup): boolean {
  return /^u\d+$/.test(ageGroup);
}

export function genderLabel(gender: Gender, ageGroup?: AgeGroup): string {
  const youth = ageGroup !== undefined && isYouth(ageGroup);
  if (gender === 'coed') return 'Coed';
  if (gender === 'mens') return youth ? 'Boys' : "Men's";
  return youth ? 'Girls' : "Women's";
}

export function playersPerSideOfSport(sport: Sport): readonly number[] {
  const { min, max } = PLAYERS_PER_SIDE_RANGE[sport];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

export function isPlayersPerSideOfSport(sport: Sport, count: number): boolean {
  const { min, max } = PLAYERS_PER_SIDE_RANGE[sport];
  return Number.isInteger(count) && count >= min && count <= max;
}

export function formatLabel(playersPerSide: number): string {
  return `${playersPerSide}v${playersPerSide}`;
}

export function divisionLabel(division: {
  gender: Gender;
  playersPerSide: number;
  levelLabel: string;
  ageGroup?: AgeGroup;
}): string {
  const { gender, playersPerSide, ageGroup } = division;
  const parts = [genderLabel(gender, ageGroup), formatLabel(playersPerSide), division.levelLabel];
  if (ageGroup !== undefined && ageGroup !== 'adult') parts.push(ageGroupLabel(ageGroup));
  return parts.join(' · ');
}

export function customLevelLabel(name: string, standardLevel: StandardLevel, sport: Sport): string {
  if (!isLevelOfSport(sport, standardLevel)) {
    throw new Error(`Level ${standardLevel} is not a level of ${sport}`);
  }
  return `${name} (${levelLabel(standardLevel)})`;
}

export interface DerivedDivision {
  gender?: Gender;
  playersPerSide?: number;
  level?: StandardLevel;
}

// iOS types this character for the apostrophe.
const TYPOGRAPHIC_APOSTROPHE = '\u2019';

const WORD_BEFORE = "(?<![\\p{L}\\p{N}'])";
const WORD_AFTER = "(?![\\p{L}\\p{N}'])";

const GENDER_WORDS: readonly (readonly [Gender, RegExp])[] = [
  ['womens', new RegExp(`${WORD_BEFORE}(?:women's|womens|ladies)${WORD_AFTER}`, 'iu')],
  ['mens', new RegExp(`${WORD_BEFORE}(?:men's|mens)${WORD_AFTER}`, 'iu')],
  ['coed', new RegExp(`${WORD_BEFORE}(?:co-ed|coed)${WORD_AFTER}`, 'iu')],
];

const FORMAT_WORDS = /(?<![\p{L}\p{N}])(\d{1,2})(?:\s*v\s*(\d{1,2})|'?s)(?![\p{L}\p{N}])/giu;

const CASE_INSENSITIVE_LEVELS: ReadonlySet<StandardLevel> = new Set([
  'rec',
  'open',
  'intermediate',
  'competitive',
]);

export function deriveDivisionFromName(name: string, sport: Sport): DerivedDivision {
  const text = name.replaceAll(TYPOGRAPHIC_APOSTROPHE, "'");
  const derived: DerivedDivision = {};

  let earliest = Number.POSITIVE_INFINITY;
  for (const [gender, pattern] of GENDER_WORDS) {
    const index = pattern.exec(text)?.index;
    if (index !== undefined && index < earliest) {
      earliest = index;
      derived.gender = gender;
    }
  }

  for (const match of text.matchAll(FORMAT_WORDS)) {
    const count = Number(match[1]);
    const other = match[2];
    if (other !== undefined && Number(other) !== count) continue;
    if (isPlayersPerSideOfSport(sport, count)) {
      derived.playersPerSide = count;
      break;
    }
  }

  const words = (text.match(/[\p{L}\p{N}']+/gu) ?? []).map((word) => word.replace(/^'+|'+$/g, ''));
  const levels = LEVELS_BY_SPORT[sport];
  for (const [position, word] of words.entries()) {
    const level = levels.find((candidate) =>
      CASE_INSENSITIVE_LEVELS.has(candidate)
        ? word.toLowerCase() === candidate
        : word === candidate.toUpperCase(),
    );
    const isArticle = level === 'a' && position === 0;
    if (level === undefined || isArticle) continue;
    derived.level = level;
    break;
  }

  return derived;
}

/** The key a custom level is unique by: trimmed, inner whitespace collapsed, lower case. */
export function customLevelNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
