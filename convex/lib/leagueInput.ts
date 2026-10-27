// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import {
  ageGroupValidator,
  formatLabel,
  isLevelOfSport,
  isPlayersPerSideOfSport,
  type AgeGroup,
  type StandardLevel,
} from './divisions';
import { ORGANIZATION_MESSAGES } from './organizationInput';
import { isChoosableSlug } from './slugs';
import { ROSTER_SIZE_INPUT_MAX, type Sport } from './sports';

export const MAX_LEAGUE_NAME_LENGTH = 100;

export type LeagueInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'slugEmpty'
  | 'slugInvalid'
  | 'slugTaken'
  | 'sportEmpty'
  | 'formatInvalid'
  | 'levelInvalid'
  | 'ageGroupInvalid'
  | 'minimumRosterSizeLow'
  | 'minimumRosterSizeInvalid'
  | 'draftSeasonsTooMany'
  | 'changedSince'
  | 'locationsEmpty';

export type LeagueField =
  'name' | 'slug' | 'sport' | 'format' | 'minimumRosterSize' | 'level' | 'ageGroup' | 'locations';

export interface LeagueInputError {
  field: LeagueField;
  code: LeagueInputCode;
  message: string;
}

export const LEAGUE_MESSAGES = {
  nameEmpty: 'Enter the league’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_LEAGUE_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  slugEmpty: 'Enter a slug for the league.',
  slugInvalid: ORGANIZATION_MESSAGES.slugInvalid,
  slugTaken: (slug: string) =>
    `${slug} is already used by another league here. Choose another slug.`,
  sportEmpty: 'Choose a sport.',
  formatInvalid: 'Choose a format. Players filter leagues by it.',
  levelInvalid: 'Choose one of the levels listed.',
  ageGroupInvalid: 'Choose an age group from the list.',
  minimumRosterSizeLow: (playersPerSide: number) =>
    `${formatLabel(playersPerSide)} needs at least ${playersPerSide} players. Enter ${playersPerSide} or more.`,
  minimumRosterSizeInvalid: (playersPerSide: number) =>
    `Enter a whole number from ${playersPerSide} to ${ROSTER_SIZE_INPUT_MAX}.`,
  draftSeasonsTooMany:
    'This league has too many draft seasons to update. Publish or remove some first.',
  changedSince: 'The league details changed since this save, so it cannot be undone.',
  locationsEmpty: 'Choose at least one location.',
} as const;

export function checkLeagueName(
  name: string,
): { ok: true; name: string } | { ok: false; error: LeagueInputError } {
  const trimmed = name.trim();
  if (trimmed === '') {
    return {
      ok: false,
      error: { field: 'name', code: 'nameEmpty', message: LEAGUE_MESSAGES.nameEmpty },
    };
  }
  if (trimmed.length > MAX_LEAGUE_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: LEAGUE_MESSAGES.nameTooLong(trimmed.length),
      },
    };
  }
  return { ok: true, name: trimmed };
}

export function checkLeagueSlug(slug: string): LeagueInputError | null {
  if (slug === '') {
    return { field: 'slug', code: 'slugEmpty', message: LEAGUE_MESSAGES.slugEmpty };
  }
  if (!isChoosableSlug(slug)) {
    return { field: 'slug', code: 'slugInvalid', message: LEAGUE_MESSAGES.slugInvalid };
  }
  return null;
}

export function checkLeagueLocations(locationCount: number): LeagueInputError | null {
  return locationCount === 0
    ? { field: 'locations', code: 'locationsEmpty', message: LEAGUE_MESSAGES.locationsEmpty }
    : null;
}

export function checkLeagueFormat(
  sport: Sport,
  playersPerSide: number | null,
): LeagueInputError | null {
  if (playersPerSide !== null && isPlayersPerSideOfSport(sport, playersPerSide)) return null;
  return { field: 'format', code: 'formatInvalid', message: LEAGUE_MESSAGES.formatInvalid };
}

export function checkLeagueLevel(sport: Sport, level: StandardLevel): LeagueInputError | null {
  if (isLevelOfSport(sport, level)) return null;
  return { field: 'level', code: 'levelInvalid', message: LEAGUE_MESSAGES.levelInvalid };
}

export function checkLeagueAgeGroup(
  ageGroup: string,
): { ok: true; ageGroup: AgeGroup } | { ok: false; error: LeagueInputError } {
  const known = ageGroupValidator.members.find((member) => member.value === ageGroup);
  if (known) return { ok: true, ageGroup: known.value };
  return {
    ok: false,
    error: { field: 'ageGroup', code: 'ageGroupInvalid', message: LEAGUE_MESSAGES.ageGroupInvalid },
  };
}

export function checkLeagueMinimumRosterSize(
  playersPerSide: number,
  minimumRosterSize: number | undefined,
): LeagueInputError | null {
  if (minimumRosterSize === undefined) return null;
  const field = 'minimumRosterSize';
  if (!Number.isInteger(minimumRosterSize) || minimumRosterSize > ROSTER_SIZE_INPUT_MAX) {
    return {
      field,
      code: 'minimumRosterSizeInvalid',
      message: LEAGUE_MESSAGES.minimumRosterSizeInvalid(playersPerSide),
    };
  }
  if (minimumRosterSize < playersPerSide) {
    return {
      field,
      code: 'minimumRosterSizeLow',
      message: LEAGUE_MESSAGES.minimumRosterSizeLow(playersPerSide),
    };
  }
  return null;
}
