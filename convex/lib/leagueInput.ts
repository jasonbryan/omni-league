// Imports only `./slugs`, so the app can import it.
import { isChoosableSlug, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH } from './slugs';

export const MAX_LEAGUE_NAME_LENGTH = 100;

export type LeagueInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'slugEmpty'
  | 'slugInvalid'
  | 'slugTaken'
  | 'sportEmpty'
  | 'locationsEmpty';

export type LeagueField = 'name' | 'slug' | 'sport' | 'locations';

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
  // The organization form's message, word for word.
  slugInvalid: `Use ${MIN_SLUG_LENGTH} to ${MAX_SLUG_LENGTH} lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.`,
  slugTaken: (slug: string) =>
    `${slug} is already used by another league here. Choose another slug.`,
  sportEmpty: 'Choose a sport.',
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
