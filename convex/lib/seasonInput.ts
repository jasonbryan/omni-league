// Imports only `convex/lib` files that import nothing from the server, so the app can import it.
import { LEAGUE_MESSAGES } from './leagueInput';
import {
  HIDDEN_CHARACTER_MESSAGE,
  hasControlOrBidiCharacter,
  hasVisibleCharacter,
} from './nameCharacters';
import { isChoosableSlug } from './slugs';
import { ROSTER_SIZE_INPUT_MAX } from './sports';

export const MAX_SEASON_NAME_LENGTH = 100;

export const MIN_MAX_TEAMS = 2;
/** The organizer season page reads at most this many teams. */
export const MAX_MAX_TEAMS = 200;

export type SeasonField =
  'name' | 'slug' | 'startDate' | 'endDate' | 'registrationDeadline' | 'maxTeams' | 'maxRosterSize';

export const SEASON_FIELDS: readonly SeasonField[] = [
  'name',
  'slug',
  'startDate',
  'endDate',
  'registrationDeadline',
  'maxTeams',
  'maxRosterSize',
];

export type SeasonDateField = 'startDate' | 'endDate' | 'registrationDeadline';

export type SeasonInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameInvisible'
  | 'slugEmpty'
  | 'slugInvalid'
  | 'slugTaken'
  | 'dateEmpty'
  | 'dateInvalid'
  | 'endBeforeStart'
  | 'deadlineNotBeforeStart'
  | 'maxTeamsInvalid'
  | 'maxTeamsBelowCount'
  | 'maxRosterSizeInvalid'
  | 'maxRosterSizeBelowRoster';

export interface SeasonInputError {
  field: SeasonField;
  code: SeasonInputCode;
  message: string;
}

export interface LeagueFormatMissingError {
  code: 'leagueFormatMissing';
  message: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DATE_LABELS: Record<SeasonDateField, string> = {
  startDate: 'the start date',
  endDate: 'the end date',
  registrationDeadline: 'the registration deadline',
};

export const SEASON_MESSAGES = {
  nameEmpty: 'Enter the season’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_SEASON_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  nameInvisible: HIDDEN_CHARACTER_MESSAGE,
  slugEmpty: 'Enter a slug for the season.',
  slugInvalid: LEAGUE_MESSAGES.slugInvalid,
  slugTaken: (slug: string, leagueName: string) =>
    `${slug} is already used by another season of ${leagueName}. Choose another slug.`,
  dateEmpty: (field: SeasonDateField) => `Enter ${DATE_LABELS[field]}.`,
  dateInvalid: 'Enter a real date.',
  endBeforeStart: 'The end date must be on or after the start date.',
  deadlineNotBeforeStart: (startDate: string) =>
    `The registration deadline must be before the start date, ${formatCalendarDate(startDate)}.`,
  leagueFormatMissing: 'Set this league’s format in its details first.',
  maxTeamsInvalid: `Enter a whole number from ${MIN_MAX_TEAMS} to ${MAX_MAX_TEAMS}, or leave it blank.`,
  maxTeamsBelowCount: (teamCount: number) =>
    `${teamCount} teams are already registered. Enter ${teamCount} or more, or leave it blank.`,
  maxRosterSizeInvalid: (minimumRosterSize: number) =>
    `Enter a whole number from ${minimumRosterSize} to ${ROSTER_SIZE_INPUT_MAX}, or leave it blank.`,
  maxRosterSizeBelowRoster: (teamName: string, rosterCount: number) =>
    `${teamName} already has ${rosterCount} players. Enter ${rosterCount} or more, or leave it blank.`,
} as const;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

export function checkSeasonName(
  name: string,
): { ok: true; name: string } | { ok: false; error: SeasonInputError } {
  const trimmed = name.trim();
  if (!hasVisibleCharacter(trimmed)) {
    return {
      ok: false,
      error: { field: 'name', code: 'nameEmpty', message: SEASON_MESSAGES.nameEmpty },
    };
  }
  if (trimmed.length > MAX_SEASON_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: SEASON_MESSAGES.nameTooLong(trimmed.length),
      },
    };
  }
  if (hasControlOrBidiCharacter(trimmed)) {
    return {
      ok: false,
      error: { field: 'name', code: 'nameInvisible', message: SEASON_MESSAGES.nameInvisible },
    };
  }
  return { ok: true, name: trimmed };
}

export function checkSeasonSlug(slug: string): SeasonInputError | null {
  if (slug === '') {
    return { field: 'slug', code: 'slugEmpty', message: SEASON_MESSAGES.slugEmpty };
  }
  if (!isChoosableSlug(slug)) {
    return { field: 'slug', code: 'slugInvalid', message: SEASON_MESSAGES.slugInvalid };
  }
  return null;
}

export interface SeasonDates {
  startDate: string;
  endDate: string;
  registrationDeadline: string;
}

// Registration closes when the season starts, so a deadline after the start could never apply.
export function checkSeasonDates(
  dates: SeasonDates,
): Partial<Record<SeasonDateField, SeasonInputError>> {
  const errors: Partial<Record<SeasonDateField, SeasonInputError>> = {};
  const real: Partial<Record<SeasonDateField, boolean>> = {};
  for (const field of ['startDate', 'endDate', 'registrationDeadline'] as const) {
    const value = dates[field];
    if (value === '') {
      errors[field] = { field, code: 'dateEmpty', message: SEASON_MESSAGES.dateEmpty(field) };
    } else if (!isCalendarDate(value)) {
      errors[field] = { field, code: 'dateInvalid', message: SEASON_MESSAGES.dateInvalid };
    } else {
      real[field] = true;
    }
  }
  if (real.startDate && real.endDate && dates.endDate < dates.startDate) {
    errors.endDate = {
      field: 'endDate',
      code: 'endBeforeStart',
      message: SEASON_MESSAGES.endBeforeStart,
    };
  }
  if (
    real.startDate &&
    real.registrationDeadline &&
    dates.registrationDeadline >= dates.startDate
  ) {
    errors.registrationDeadline = {
      field: 'registrationDeadline',
      code: 'deadlineNotBeforeStart',
      message: SEASON_MESSAGES.deadlineNotBeforeStart(dates.startDate),
    };
  }
  return errors;
}

export interface SeasonTeamLimit {
  teamCount?: number | undefined;
  maxTeams?: number | undefined;
  waitlistCount?: number | undefined;
}

/** Room for one more team under the maximum: what promoting a waiting team needs. */
export function seasonHasRoom({ teamCount, maxTeams }: SeasonTeamLimit): boolean {
  return maxTeams === undefined || (teamCount ?? 0) < maxTeams;
}

/** Full for registration: while any team waits, a new team joins the waitlist behind it even when there is room. */
export function seasonIsFull(season: SeasonTeamLimit): boolean {
  return !seasonHasRoom(season) || (season.waitlistCount ?? 0) > 0;
}

/** `undefined` is no limit. */
export function checkMaxTeams(maxTeams: number | undefined): SeasonInputError | null {
  if (maxTeams === undefined) return null;
  if (Number.isInteger(maxTeams) && maxTeams >= MIN_MAX_TEAMS && maxTeams <= MAX_MAX_TEAMS) {
    return null;
  }
  return { field: 'maxTeams', code: 'maxTeamsInvalid', message: SEASON_MESSAGES.maxTeamsInvalid };
}

export function teamIsFull(rosterCount: number, maxRosterSize: number | undefined): boolean {
  return maxRosterSize !== undefined && rosterCount >= maxRosterSize;
}

/** `undefined` is no limit. The maximum is at least the minimum, so a team at the maximum meets it. */
export function checkMaxRosterSize(
  maxRosterSize: number | undefined,
  minimumRosterSize: number,
): SeasonInputError | null {
  if (maxRosterSize === undefined) return null;
  if (
    Number.isInteger(maxRosterSize) &&
    maxRosterSize >= minimumRosterSize &&
    maxRosterSize <= ROSTER_SIZE_INPUT_MAX
  ) {
    return null;
  }
  return {
    field: 'maxRosterSize',
    code: 'maxRosterSizeInvalid',
    message: SEASON_MESSAGES.maxRosterSizeInvalid(minimumRosterSize),
  };
}

export interface LargestRoster {
  name: string;
  rosterCount: number;
}

/** A whole number below the largest roster names that team; a largest roster below the minimum leaves the range message to say what fits. */
export function checkMaxRosterSizeFor(
  maxRosterSize: number | undefined,
  minimumRosterSize: number,
  largest: LargestRoster | null,
): SeasonInputError | null {
  if (
    maxRosterSize !== undefined &&
    largest !== null &&
    Number.isInteger(maxRosterSize) &&
    maxRosterSize < largest.rosterCount &&
    largest.rosterCount >= minimumRosterSize
  ) {
    return {
      field: 'maxRosterSize',
      code: 'maxRosterSizeBelowRoster',
      message: SEASON_MESSAGES.maxRosterSizeBelowRoster(largest.name, largest.rosterCount),
    };
  }
  return checkMaxRosterSize(maxRosterSize, minimumRosterSize);
}

/** Blank is no limit. Text other than digits reads as `NaN`, which the range checks refuse, so `1e1` is not 10. */
export function limitFromText(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export interface SeasonValues extends SeasonDates {
  name: string;
  slug: string;
  maxTeams?: number | undefined;
  maxRosterSize?: number | undefined;
  /** Absent skips the maximum roster size check: the league has no format yet, which `seasons.create` refuses. */
  minimumRosterSize?: number | undefined;
}

export function checkSeasonFields(
  values: SeasonValues,
): Partial<Record<SeasonField, SeasonInputError>> {
  const errors: Partial<Record<SeasonField, SeasonInputError>> = {};
  const name = checkSeasonName(values.name);
  if (!name.ok) errors.name = name.error;
  const slug = checkSeasonSlug(values.slug);
  if (slug) errors.slug = slug;
  Object.assign(errors, checkSeasonDates(values));
  const maxTeams = checkMaxTeams(values.maxTeams);
  if (maxTeams) errors.maxTeams = maxTeams;
  if (values.minimumRosterSize !== undefined) {
    const maxRosterSize = checkMaxRosterSize(values.maxRosterSize, values.minimumRosterSize);
    if (maxRosterSize) errors.maxRosterSize = maxRosterSize;
  }
  return errors;
}

export function firstSeasonError(
  errors: Partial<Record<SeasonField, SeasonInputError>>,
): SeasonInputError | null {
  for (const field of SEASON_FIELDS) {
    const error = errors[field];
    if (error) return error;
  }
  return null;
}
