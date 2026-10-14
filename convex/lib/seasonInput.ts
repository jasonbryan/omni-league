// Imports only `convex/lib` files that import nothing from the server, so the app can import it.
import { LEAGUE_MESSAGES } from './leagueInput';
import { isChoosableSlug } from './slugs';
import { ROSTER_SIZE_INPUT_MAX, SPORT_FORMATS, type Sport, type SportFormat } from './sports';

export const MAX_SEASON_NAME_LENGTH = 100;

export type SeasonField =
  | 'name'
  | 'slug'
  | 'startDate'
  | 'endDate'
  | 'registrationDeadline'
  | 'format'
  | 'minimumRosterSize';

export const SEASON_FIELDS: readonly SeasonField[] = [
  'name',
  'slug',
  'startDate',
  'endDate',
  'registrationDeadline',
  'format',
  'minimumRosterSize',
];

export type SeasonDateField = 'startDate' | 'endDate' | 'registrationDeadline';

export type SeasonInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'slugEmpty'
  | 'slugInvalid'
  | 'slugTaken'
  | 'dateEmpty'
  | 'dateInvalid'
  | 'endBeforeStart'
  | 'deadlineNotBeforeStart'
  | 'formatInvalid'
  | 'minimumEmpty'
  | 'minimumBelowFormat'
  | 'minimumOutOfRange';

export interface SeasonInputError {
  field: SeasonField;
  code: SeasonInputCode;
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
  slugEmpty: 'Enter a slug for the season.',
  slugInvalid: LEAGUE_MESSAGES.slugInvalid,
  slugTaken: (slug: string, leagueName: string) =>
    `${slug} is already used by another season of ${leagueName}. Choose another slug.`,
  dateEmpty: (field: SeasonDateField) => `Enter ${DATE_LABELS[field]}.`,
  dateInvalid: 'Enter a real date.',
  endBeforeStart: 'The end date must be on or after the start date.',
  deadlineNotBeforeStart: (startDate: string) =>
    `The registration deadline must be before the start date, ${formatCalendarDate(startDate)}.`,
  formatInvalid: 'Choose a format.',
  minimumEmpty: 'Enter the minimum roster size.',
  minimumBelowFormat: (formatName: string, minimum: number) =>
    `${formatName} needs at least ${minimum} players. Enter ${minimum} or more.`,
  minimumOutOfRange: (minimum: number) =>
    `Enter a whole number from ${minimum} to ${ROSTER_SIZE_INPUT_MAX}.`,
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

export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function checkSeasonName(
  name: string,
): { ok: true; name: string } | { ok: false; error: SeasonInputError } {
  const trimmed = name.trim();
  if (trimmed === '') {
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

function formatOf(sport: Sport, key: string | null): SportFormat | undefined {
  return SPORT_FORMATS[sport].find((candidate) => candidate.key === key);
}

export function checkSeasonFormat(sport: Sport, format: string | null): SeasonInputError | null {
  return formatOf(sport, format)
    ? null
    : { field: 'format', code: 'formatInvalid', message: SEASON_MESSAGES.formatInvalid };
}

export function checkMinimumRosterSize(
  sport: Sport,
  format: string | null,
  value: number | null,
): SeasonInputError | null {
  const field = 'minimumRosterSize';
  if (value === null) {
    return { field, code: 'minimumEmpty', message: SEASON_MESSAGES.minimumEmpty };
  }
  const chosen = formatOf(sport, format);
  const minimum = chosen?.minimumRosterSize ?? 1;
  if (!Number.isInteger(value) || value > ROSTER_SIZE_INPUT_MAX) {
    return {
      field,
      code: 'minimumOutOfRange',
      message: SEASON_MESSAGES.minimumOutOfRange(minimum),
    };
  }
  if (value < minimum) {
    return chosen
      ? {
          field,
          code: 'minimumBelowFormat',
          message: SEASON_MESSAGES.minimumBelowFormat(chosen.name, minimum),
        }
      : { field, code: 'minimumOutOfRange', message: SEASON_MESSAGES.minimumOutOfRange(minimum) };
  }
  return null;
}

export interface SeasonValues extends SeasonDates {
  name: string;
  slug: string;
  format: string | null;
  minimumRosterSize: number | null;
}

export function checkSeasonFields(
  sport: Sport,
  values: SeasonValues,
): Partial<Record<SeasonField, SeasonInputError>> {
  const errors: Partial<Record<SeasonField, SeasonInputError>> = {};
  const name = checkSeasonName(values.name);
  if (!name.ok) errors.name = name.error;
  const slug = checkSeasonSlug(values.slug);
  if (slug) errors.slug = slug;
  Object.assign(errors, checkSeasonDates(values));
  const format = checkSeasonFormat(sport, values.format);
  if (format) errors.format = format;
  const minimum = checkMinimumRosterSize(sport, values.format, values.minimumRosterSize);
  if (minimum) errors.minimumRosterSize = minimum;
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
