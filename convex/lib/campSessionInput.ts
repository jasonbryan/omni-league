// Imports only `convex/lib` files that import nothing from the server, so the app can import it.
import {
  HIDDEN_CHARACTER_MESSAGE,
  hasControlOrBidiCharacter,
  hasVisibleCharacter,
} from './nameCharacters';
import { formatCalendarDate, isCalendarDate } from './seasonInput';

export const MAX_CAMP_SESSION_NAME_LENGTH = 100;

export const MIN_CAMP_SESSION_PLACES = 1;
export const MAX_CAMP_SESSION_PLACES = 500;

export type CampSessionField =
  | 'name'
  | 'startDate'
  | 'endDate'
  | 'registrationDeadline'
  | 'dailyStartTime'
  | 'dailyEndTime'
  | 'places';

// The order of the page, which is the order focus follows to the first invalid field.
export const CAMP_SESSION_FIELDS: readonly CampSessionField[] = [
  'name',
  'startDate',
  'endDate',
  'registrationDeadline',
  'dailyStartTime',
  'dailyEndTime',
  'places',
];

export type CampSessionInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameInvisible'
  | 'dateEmpty'
  | 'dateInvalid'
  | 'endBeforeStart'
  | 'deadlineAfterStart'
  | 'timeInvalid'
  | 'timeMissing'
  | 'endTimeNotAfterStart'
  | 'placesEmpty'
  | 'placesInvalid';

export interface CampSessionInputError {
  field: CampSessionField;
  code: CampSessionInputCode;
  message: string;
}

const PLACES_RANGE = `from ${MIN_CAMP_SESSION_PLACES} to ${MAX_CAMP_SESSION_PLACES}`;

const DATE_LABELS = {
  startDate: 'the start date',
  endDate: 'the end date',
  registrationDeadline: 'the registration deadline',
} as const;

export const CAMP_SESSION_MESSAGES = {
  nameEmpty: 'Enter the session’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_CAMP_SESSION_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  nameInvisible: HIDDEN_CHARACTER_MESSAGE,
  dateEmpty: (field: keyof typeof DATE_LABELS) => `Enter ${DATE_LABELS[field]}.`,
  dateInvalid: 'Enter a real date.',
  endBeforeStart: 'The end date must be on or after the start date.',
  deadlineAfterStart: (startDate: string) =>
    `The registration deadline must be on or before the start date, ${formatCalendarDate(startDate)}.`,
  timeInvalid: 'Enter a time such as 9:00 AM.',
  startTimeMissing: 'Enter the start time, or clear the end time.',
  endTimeMissing: 'Enter the end time, or clear the start time.',
  endTimeNotAfterStart: (startTime: string) =>
    `The end time must be after the start time, ${formatDailyTime(startTime)}.`,
  placesEmpty: `Enter the number of places, ${PLACES_RANGE}.`,
  placesInvalid: `Enter a whole number of places ${PLACES_RANGE}.`,
  hasRegistrations: (registeredCount: number) =>
    `${registeredCount} ${registeredCount === 1 ? 'registration is' : 'registrations are'} in this session, so it cannot be deleted.`,
} as const;

export interface CampSessionValues {
  name: string;
  startDate: string;
  endDate: string;
  /** `HH:MM`, 24-hour, no time zone; absent when the session has no daily times. */
  dailyStartTime?: string | undefined;
  dailyEndTime?: string | undefined;
  /** `undefined` while none is entered; text that is not a number is `NaN`. */
  places: number | undefined;
  registrationDeadline: string;
}

type Errors = Partial<Record<CampSessionField, CampSessionInputError>>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDailyTime(value: string): boolean {
  return TIME.test(value);
}

/** Read as text, never as an instant, so a browser in any time zone shows what was stored. */
export function formatDailyTime(value: string): string {
  const [hours, minutes] = value.split(':').map(Number) as [number, number];
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const minute = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
  return `${hour}${minute} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function campSessionTimes(
  dailyStartTime: string | undefined,
  dailyEndTime: string | undefined,
): string | null {
  if (dailyStartTime === undefined || dailyEndTime === undefined) return null;
  return `${formatDailyTime(dailyStartTime)} to ${formatDailyTime(dailyEndTime)}`;
}

function nameError(name: string): CampSessionInputError | null {
  const trimmed = name.trim();
  const field = 'name';
  if (!hasVisibleCharacter(trimmed)) {
    return { field, code: 'nameEmpty', message: CAMP_SESSION_MESSAGES.nameEmpty };
  }
  if (trimmed.length > MAX_CAMP_SESSION_NAME_LENGTH) {
    return {
      field,
      code: 'nameTooLong',
      message: CAMP_SESSION_MESSAGES.nameTooLong(trimmed.length),
    };
  }
  if (hasControlOrBidiCharacter(trimmed)) {
    return { field, code: 'nameInvisible', message: CAMP_SESSION_MESSAGES.nameInvisible };
  }
  return null;
}

function dateErrors({ startDate, endDate, registrationDeadline }: CampSessionValues): Errors {
  const errors: Errors = {};
  const real = { startDate: false, endDate: false, registrationDeadline: false };
  const dates = { startDate, endDate, registrationDeadline };
  for (const field of ['startDate', 'endDate', 'registrationDeadline'] as const) {
    const value = dates[field];
    if (value === '') {
      errors[field] = { field, code: 'dateEmpty', message: CAMP_SESSION_MESSAGES.dateEmpty(field) };
    } else if (isCalendarDate(value)) {
      real[field] = true;
    } else {
      errors[field] = { field, code: 'dateInvalid', message: CAMP_SESSION_MESSAGES.dateInvalid };
    }
  }
  if (real.startDate && real.endDate && endDate < startDate) {
    errors.endDate = {
      field: 'endDate',
      code: 'endBeforeStart',
      message: CAMP_SESSION_MESSAGES.endBeforeStart,
    };
  }
  if (real.startDate && real.registrationDeadline && registrationDeadline > startDate) {
    errors.registrationDeadline = {
      field: 'registrationDeadline',
      code: 'deadlineAfterStart',
      message: CAMP_SESSION_MESSAGES.deadlineAfterStart(startDate),
    };
  }
  return errors;
}

function timeErrors({ dailyStartTime, dailyEndTime }: CampSessionValues): Errors {
  const errors: Errors = {};
  const times = { dailyStartTime, dailyEndTime };
  for (const field of ['dailyStartTime', 'dailyEndTime'] as const) {
    const value = times[field];
    if (value !== undefined && !isDailyTime(value)) {
      errors[field] = { field, code: 'timeInvalid', message: CAMP_SESSION_MESSAGES.timeInvalid };
    }
  }
  if (dailyStartTime === undefined && dailyEndTime !== undefined && !errors.dailyEndTime) {
    errors.dailyStartTime = {
      field: 'dailyStartTime',
      code: 'timeMissing',
      message: CAMP_SESSION_MESSAGES.startTimeMissing,
    };
  }
  if (dailyEndTime === undefined && dailyStartTime !== undefined && !errors.dailyStartTime) {
    errors.dailyEndTime = {
      field: 'dailyEndTime',
      code: 'timeMissing',
      message: CAMP_SESSION_MESSAGES.endTimeMissing,
    };
  }
  if (
    dailyStartTime !== undefined &&
    dailyEndTime !== undefined &&
    !errors.dailyStartTime &&
    !errors.dailyEndTime &&
    dailyEndTime <= dailyStartTime
  ) {
    errors.dailyEndTime = {
      field: 'dailyEndTime',
      code: 'endTimeNotAfterStart',
      message: CAMP_SESSION_MESSAGES.endTimeNotAfterStart(dailyStartTime),
    };
  }
  return errors;
}

function placesError(places: number | undefined): CampSessionInputError | null {
  const field = 'places';
  if (places === undefined) {
    return { field, code: 'placesEmpty', message: CAMP_SESSION_MESSAGES.placesEmpty };
  }
  const valid =
    Number.isInteger(places) &&
    places >= MIN_CAMP_SESSION_PLACES &&
    places <= MAX_CAMP_SESSION_PLACES;
  return valid
    ? null
    : { field, code: 'placesInvalid', message: CAMP_SESSION_MESSAGES.placesInvalid };
}

export function checkCampSessionFields(values: CampSessionValues): Errors {
  const errors: Errors = {};
  const name = nameError(values.name);
  if (name) errors.name = name;
  Object.assign(errors, dateErrors(values), timeErrors(values));
  const places = placesError(values.places);
  if (places) errors.places = places;
  return errors;
}

export function firstCampSessionError(errors: Errors): CampSessionInputError | null {
  for (const field of CAMP_SESSION_FIELDS) {
    const error = errors[field];
    if (error) return error;
  }
  return null;
}
