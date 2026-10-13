import { v, type Infer } from 'convex/values';
import type { Sport } from './sports';

// The standard division values, their labels, and the fill-from-name rules (#232; owner decisions
// 14 to 18, 23, and 24 on PR #224). A division is a league's classification: gender, players per
// side, level, and age group (glossary, Division). This file imports only `convex/values` and
// `./sports`, so the Angular app can import the same values for the forms, the filters, and the
// public pages (convex.md, Functions). The values live in code so they can change without a data
// migration; nothing here is stored (#233 adds the fields).

/** The gender keys, in the order forms and filters offer them (decision 15). There is no Open. */
export const GENDERS = ['coed', 'mens', 'womens'] as const;

/** A gender key as stored on a league. */
export const genderValidator = v.union(v.literal('coed'), v.literal('mens'), v.literal('womens'));

export type Gender = Infer<typeof genderValidator>;

/** The standard level keys of every sport. A sport offers a subset: `levelsOfSport`. */
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

/** The display label of each standard level key. */
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

/** The standard levels of each sport, lowest first (decision 16). */
const LEVELS_BY_SPORT: Readonly<Record<Sport, readonly StandardLevel[]>> = {
  beachVolleyball: ['rec', 'b', 'bb', 'a', 'aa', 'open'],
  soccer: ['rec', 'intermediate', 'competitive'],
  softball: ['rec', 'intermediate', 'competitive'],
};

/** The age group keys: Adult, the adult brackets 30+ to 60+, then U6 to U19 (decision 17). */
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

/** The age groups with their labels, in the order forms and filters offer them. */
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

/** The fewest and most players per side a sport's divisions offer (decision 18). */
const PLAYERS_PER_SIDE_RANGE: Readonly<
  Record<Sport, { readonly min: number; readonly max: number }>
> = {
  beachVolleyball: { min: 2, max: 6 },
  soccer: { min: 4, max: 11 },
  softball: { min: 9, max: 10 },
};

/** The standard level keys of a sport, lowest first. */
export function levelsOfSport(sport: Sport): readonly StandardLevel[] {
  return LEVELS_BY_SPORT[sport];
}

/** Whether the level is one of the sport's standard levels. */
export function isLevelOfSport(sport: Sport, level: StandardLevel): boolean {
  return LEVELS_BY_SPORT[sport].includes(level);
}

/** The display label of a standard level. */
export function levelLabel(level: StandardLevel): string {
  return STANDARD_LEVEL_LABELS[level];
}

/** The display label of an age group. */
export function ageGroupLabel(ageGroup: AgeGroup): string {
  return AGE_GROUPS.find((group) => group.key === ageGroup)?.label ?? ageGroup;
}

/** Whether the age group is U6 to U19. Adult and the adult brackets are not youth. */
export function isYouth(ageGroup: AgeGroup): boolean {
  return /^u\d+$/.test(ageGroup);
}

/**
 * The display label of a gender: Coed, Men's, Women's; with a youth age group, Coed, Boys, Girls
 * (decision 15).
 */
export function genderLabel(gender: Gender, ageGroup?: AgeGroup): string {
  const youth = ageGroup !== undefined && isYouth(ageGroup);
  if (gender === 'coed') return 'Coed';
  if (gender === 'mens') return youth ? 'Boys' : "Men's";
  return youth ? 'Girls' : "Women's";
}

/** The players per side a sport offers, fewest first. */
export function playersPerSideOfSport(sport: Sport): readonly number[] {
  const { min, max } = PLAYERS_PER_SIDE_RANGE[sport];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

/** Whether `count` is a whole number in the sport's players-per-side range. */
export function isPlayersPerSideOfSport(sport: Sport, count: number): boolean {
  const { min, max } = PLAYERS_PER_SIDE_RANGE[sport];
  return Number.isInteger(count) && count >= min && count <= max;
}

/** Players per side written as leagues write it: `"4v4"` (decision 24). */
export function formatLabel(playersPerSide: number): string {
  return `${playersPerSide}v${playersPerSide}`;
}

/**
 * A division as the public pages show it, such as "Coed · 4v4 · BB" (decision 14). An age group
 * other than Adult is added last ("· U10", "· 40+"), and a youth group reads gender as Boys or
 * Girls. `levelLabel` is the text to show: a standard level's label or a `customLevelLabel`.
 */
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

/**
 * An organization's own level shown with the standard level it maps to: "Gold (A)" (decision 21).
 * Throws for a standard level that is not one of the sport's.
 */
export function customLevelLabel(name: string, standardLevel: StandardLevel, sport: Sport): string {
  if (!isLevelOfSport(sport, standardLevel)) {
    throw new Error(`Level ${standardLevel} is not a level of ${sport}`);
  }
  return `${name} (${levelLabel(standardLevel)})`;
}

/** What a league name states about its division; each field is present only when found. */
export interface DerivedDivision {
  gender?: Gender;
  playersPerSide?: number;
  level?: StandardLevel;
}

const WORD_BEFORE = "(?<![\\p{L}\\p{N}'])";
const WORD_AFTER = "(?![\\p{L}\\p{N}'])";

const GENDER_WORDS: readonly (readonly [Gender, RegExp])[] = [
  ['womens', new RegExp(`${WORD_BEFORE}(?:women's|womens|ladies)${WORD_AFTER}`, 'iu')],
  ['mens', new RegExp(`${WORD_BEFORE}(?:men's|mens)${WORD_AFTER}`, 'iu')],
  ['coed', new RegExp(`${WORD_BEFORE}(?:co-ed|coed)${WORD_AFTER}`, 'iu')],
];

/** "4v4", "4 v 4", "4s", or "4's": the number, and for the v form the number after it. */
const FORMAT_WORDS = /(?<![\p{L}\p{N}])(\d{1,2})(?:\s*v\s*(\d{1,2})|'?s)(?![\p{L}\p{N}])/giu;

/** Levels that match in any case. The letter levels (B, BB, A, AA) match capitals only. */
const CASE_INSENSITIVE_LEVELS: ReadonlySet<StandardLevel> = new Set([
  'rec',
  'open',
  'intermediate',
  'competitive',
]);

/**
 * The gender, players per side, and level a league name states (decision 23), each only when
 * found. The typographic apostrophe U+2019, which iOS types by default, counts as `'`.
 *
 * - Gender, from whole words ignoring case: "women's", "womens", "ladies"; "men's", "mens";
 *   "coed", "co-ed". The earliest in the name wins.
 * - Players per side, ignoring case, from "4v4", "4 v 4", "4s", or "4's", only when the number
 *   is in the sport's range. The first such match wins ("4s and 6s" gives 4).
 * - Level, from a whole word naming one of the sport's standard levels. Rec, Open, Intermediate,
 *   and Competitive match in any case; B, BB, A, and AA match capitals only, and a lone "A" as the
 *   first word is the article, not level A. The first match wins.
 *
 * The age group is not derived.
 */
export function deriveDivisionFromName(name: string, sport: Sport): DerivedDivision {
  const text = name.replaceAll('’', "'");
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
    if (level === undefined || (level === 'a' && position === 0)) continue;
    derived.level = level;
    break;
  }

  return derived;
}
