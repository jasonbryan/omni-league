// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import {
  ageGroupValidator,
  isLevelOfSport,
  isPlayersPerSideOfSport,
  type StandardLevel,
} from './divisions';
import { ORGANIZATION_MESSAGES } from './organizationInput';
import {
  HIDDEN_CHARACTER_MESSAGE,
  hasControlOrBidiCharacter,
  hasVisibleCharacter,
} from './nameCharacters';
import { formatCalendarDate, isCalendarDate } from './seasonInput';
import { isChoosableSlug, slugTakenMessage } from './slugs';
import type { Sport } from './sports';

export const MAX_TOURNAMENT_NAME_LENGTH = 100;

export const MIN_MAXIMUM_TEAMS = 2;
export const MAX_MAXIMUM_TEAMS = 128;

/** A tournament takes no waitlist, so reaching its maximum teams is the end of registration. */
export function tournamentIsFull(tournament: {
  teamCount?: number | undefined;
  maximumTeams: number;
}): boolean {
  return (tournament.teamCount ?? 0) >= tournament.maximumTeams;
}

export type TournamentField =
  | 'name'
  | 'slug'
  | 'sport'
  | 'format'
  | 'level'
  | 'ageGroup'
  | 'locations'
  | 'startDate'
  | 'endDate'
  | 'registrationDeadline'
  | 'maximumTeams';

// The order of the page, which is the order focus follows to the first invalid field.
export const TOURNAMENT_FIELDS: readonly TournamentField[] = [
  'name',
  'slug',
  'sport',
  'format',
  'level',
  'ageGroup',
  'locations',
  'startDate',
  'endDate',
  'registrationDeadline',
  'maximumTeams',
];

export type TournamentDateField = 'startDate' | 'endDate' | 'registrationDeadline';

export type TournamentInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameInvisible'
  | 'slugEmpty'
  | 'slugInvalid'
  | 'slugTaken'
  | 'sportEmpty'
  | 'formatInvalid'
  | 'levelInvalid'
  | 'ageGroupInvalid'
  | 'locationsEmpty'
  | 'dateEmpty'
  | 'dateInvalid'
  | 'endBeforeStart'
  | 'deadlineAfterStart'
  | 'maximumTeamsEmpty'
  | 'maximumTeamsInvalid';

export interface TournamentInputError {
  field: TournamentField;
  code: TournamentInputCode;
  message: string;
}

const DATE_LABELS: Record<'startDate' | 'registrationDeadline', string> = {
  startDate: 'the start date',
  registrationDeadline: 'the registration deadline',
};

export const TOURNAMENT_MESSAGES = {
  nameEmpty: 'Enter the tournament’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_TOURNAMENT_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  nameInvisible: HIDDEN_CHARACTER_MESSAGE,
  slugEmpty: 'Enter a web address for the tournament.',
  slugInvalid: ORGANIZATION_MESSAGES.slugInvalid,
  slugTaken: slugTakenMessage,
  sportEmpty: 'Choose a sport.',
  formatInvalid: 'Choose a format.',
  levelInvalid: 'Choose one of the levels listed.',
  ageGroupInvalid: 'Choose an age group from the list.',
  locationsEmpty: 'Choose at least one location.',
  dateEmpty: (field: 'startDate' | 'registrationDeadline') => `Enter ${DATE_LABELS[field]}.`,
  dateInvalid: 'Enter a real date.',
  endBeforeStart: 'The end date must be on or after the start date.',
  deadlineAfterStart: (startDate: string) =>
    `The registration deadline must be on or before the start date, ${formatCalendarDate(startDate)}.`,
  maximumTeamsEmpty: `Enter the most teams the tournament takes, from ${MIN_MAXIMUM_TEAMS} to ${MAX_MAXIMUM_TEAMS}.`,
  maximumTeamsInvalid: `Enter a whole number from ${MIN_MAXIMUM_TEAMS} to ${MAX_MAXIMUM_TEAMS}.`,
} as const;

export interface TournamentValues {
  name: string;
  slug: string;
  /** `null` while none is chosen, which only the form can be in. */
  sport: Sport | null;
  /** `null` while none is chosen, which only the form can be in. */
  playersPerSide: number | null;
  level: StandardLevel;
  ageGroup: string;
  locationCount: number;
  startDate: string;
  /** Blank is a one-day tournament, which ends on its start date. */
  endDate: string;
  registrationDeadline: string;
  /** `undefined` while none is entered; text that is not a number is `NaN`. */
  maximumTeams: number | undefined;
}

type Errors = Partial<Record<TournamentField, TournamentInputError>>;

function nameError(name: string): TournamentInputError | null {
  const trimmed = name.trim();
  const field = 'name';
  if (!hasVisibleCharacter(trimmed)) {
    return { field, code: 'nameEmpty', message: TOURNAMENT_MESSAGES.nameEmpty };
  }
  if (trimmed.length > MAX_TOURNAMENT_NAME_LENGTH) {
    return {
      field,
      code: 'nameTooLong',
      message: TOURNAMENT_MESSAGES.nameTooLong(trimmed.length),
    };
  }
  if (hasControlOrBidiCharacter(trimmed)) {
    return { field, code: 'nameInvisible', message: TOURNAMENT_MESSAGES.nameInvisible };
  }
  return null;
}

function slugError(slug: string): TournamentInputError | null {
  if (slug === '') {
    return { field: 'slug', code: 'slugEmpty', message: TOURNAMENT_MESSAGES.slugEmpty };
  }
  if (!isChoosableSlug(slug)) {
    return { field: 'slug', code: 'slugInvalid', message: TOURNAMENT_MESSAGES.slugInvalid };
  }
  return null;
}

function divisionErrors(values: TournamentValues): Errors {
  const { sport, playersPerSide, level, ageGroup } = values;
  if (sport === null) {
    return {
      sport: { field: 'sport', code: 'sportEmpty', message: TOURNAMENT_MESSAGES.sportEmpty },
    };
  }
  const errors: Errors = {};
  if (playersPerSide === null || !isPlayersPerSideOfSport(sport, playersPerSide)) {
    errors.format = {
      field: 'format',
      code: 'formatInvalid',
      message: TOURNAMENT_MESSAGES.formatInvalid,
    };
  }
  if (!isLevelOfSport(sport, level)) {
    errors.level = {
      field: 'level',
      code: 'levelInvalid',
      message: TOURNAMENT_MESSAGES.levelInvalid,
    };
  }
  if (!ageGroupValidator.members.some((member) => member.value === ageGroup)) {
    errors.ageGroup = {
      field: 'ageGroup',
      code: 'ageGroupInvalid',
      message: TOURNAMENT_MESSAGES.ageGroupInvalid,
    };
  }
  return errors;
}

function dateErrors({ startDate, endDate, registrationDeadline }: TournamentValues): Errors {
  const errors: Errors = {};
  const real = { startDate: false, endDate: false, registrationDeadline: false };
  const dates = { startDate, endDate, registrationDeadline };
  for (const field of ['startDate', 'endDate', 'registrationDeadline'] as const) {
    const value = dates[field];
    if (value === '') {
      if (field !== 'endDate') {
        errors[field] = { field, code: 'dateEmpty', message: TOURNAMENT_MESSAGES.dateEmpty(field) };
      }
    } else if (isCalendarDate(value)) {
      real[field] = true;
    } else {
      errors[field] = { field, code: 'dateInvalid', message: TOURNAMENT_MESSAGES.dateInvalid };
    }
  }
  if (real.startDate && real.endDate && endDate < startDate) {
    errors.endDate = {
      field: 'endDate',
      code: 'endBeforeStart',
      message: TOURNAMENT_MESSAGES.endBeforeStart,
    };
  }
  if (real.startDate && real.registrationDeadline && registrationDeadline > startDate) {
    errors.registrationDeadline = {
      field: 'registrationDeadline',
      code: 'deadlineAfterStart',
      message: TOURNAMENT_MESSAGES.deadlineAfterStart(startDate),
    };
  }
  return errors;
}

function maximumTeamsError(maximumTeams: number | undefined): TournamentInputError | null {
  const field = 'maximumTeams';
  if (maximumTeams === undefined) {
    return { field, code: 'maximumTeamsEmpty', message: TOURNAMENT_MESSAGES.maximumTeamsEmpty };
  }
  if (
    Number.isInteger(maximumTeams) &&
    maximumTeams >= MIN_MAXIMUM_TEAMS &&
    maximumTeams <= MAX_MAXIMUM_TEAMS
  ) {
    return null;
  }
  return { field, code: 'maximumTeamsInvalid', message: TOURNAMENT_MESSAGES.maximumTeamsInvalid };
}

export function checkTournamentFields(values: TournamentValues): Errors {
  const errors: Errors = {};
  const name = nameError(values.name);
  if (name) errors.name = name;
  const slug = slugError(values.slug);
  if (slug) errors.slug = slug;
  Object.assign(errors, divisionErrors(values));
  if (values.locationCount === 0) {
    errors.locations = {
      field: 'locations',
      code: 'locationsEmpty',
      message: TOURNAMENT_MESSAGES.locationsEmpty,
    };
  }
  Object.assign(errors, dateErrors(values));
  const maximumTeams = maximumTeamsError(values.maximumTeams);
  if (maximumTeams) errors.maximumTeams = maximumTeams;
  return errors;
}

export function firstTournamentError(errors: Errors): TournamentInputError | null {
  for (const field of TOURNAMENT_FIELDS) {
    const error = errors[field];
    if (error) return error;
  }
  return null;
}
