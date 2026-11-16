// Imports only `convex/values` and `convex/lib` files that import nothing from the server, so the app can import it.
import { v, type Infer } from 'convex/values';
import { formatDailyTime, isDailyTime } from './campSessionInput';
import { addCalendarDays, utcDate } from './registration';
import { formatCalendarDate, isCalendarDate } from './seasonInput';

export const MIN_TRAINING_YEAR = 1000;
export const MAX_TRAINING_YEAR = 9999;

export const MIN_TRAINING_WEEKS = 1;
export const MAX_TRAINING_WEEKS = 52;

export const MIN_TRAINING_CLASS_PLACES = 1;
export const MAX_TRAINING_CLASS_PLACES = 200;

/** Sunday is 0, as `Date.getUTCDay` counts. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const trainingPatternValidator = v.object({
  weekday: v.number(),
  startTime: v.string(),
  endTime: v.string(),
  firstDate: v.string(),
  weeks: v.number(),
  placesPerClass: v.number(),
  registrationDeadline: v.string(),
  allowSingleRegistration: v.boolean(),
});

export type TrainingPattern = Infer<typeof trainingPatternValidator>;

export const trainingClassStatusValidator = v.union(v.literal('scheduled'), v.literal('cancelled'));

export type TrainingClassStatus = Infer<typeof trainingClassStatusValidator>;

export type TrainingPatternField =
  | 'weekday'
  | 'startTime'
  | 'endTime'
  | 'firstDate'
  | 'weeks'
  | 'placesPerClass'
  | 'registrationDeadline';

// The order of the page, which is the order focus follows to the first invalid field.
export const TRAINING_PATTERN_FIELDS: readonly TrainingPatternField[] = [
  'weekday',
  'startTime',
  'endTime',
  'firstDate',
  'weeks',
  'placesPerClass',
  'registrationDeadline',
];

export type TrainingPatternCode =
  | 'weekdayEmpty'
  | 'weekdayInvalid'
  | 'startTimeEmpty'
  | 'endTimeEmpty'
  | 'timeInvalid'
  | 'endTimeNotAfterStart'
  | 'dateEmpty'
  | 'dateInvalid'
  | 'lastClassTooLate'
  | 'firstDateOffWeekday'
  | 'firstDateInPast'
  | 'deadlineAfterFirstClass'
  | 'weeksEmpty'
  | 'weeksInvalid'
  | 'placesEmpty'
  | 'placesInvalid';

export interface TrainingPatternError {
  field: TrainingPatternField;
  code: TrainingPatternCode;
  message: string;
}

const WEEKS_RANGE = `from ${MIN_TRAINING_WEEKS} to ${MAX_TRAINING_WEEKS}`;
const PLACES_RANGE = `from ${MIN_TRAINING_CLASS_PLACES} to ${MAX_TRAINING_CLASS_PLACES}`;

export const TRAINING_PATTERN_MESSAGES = {
  weekdayEmpty: 'Choose a weekday.',
  weekdayInvalid: 'Choose a weekday from Sunday to Saturday.',
  startTimeEmpty: 'Enter the start time.',
  endTimeEmpty: 'Enter the end time.',
  timeInvalid: 'Enter a time such as 6:00 PM.',
  endTimeNotAfterStart: (startTime: string) =>
    `The end time must be after the start time, ${formatDailyTime(startTime)}.`,
  firstDateEmpty: 'Enter the date of the first class.',
  deadlineEmpty: 'Enter the series registration deadline.',
  dateInvalid: 'Enter a real date.',
  yearOutOfRange: `Enter a date in a year from ${MIN_TRAINING_YEAR} to ${MAX_TRAINING_YEAR}.`,
  lastClassTooLate: `The last class would fall after the year ${MAX_TRAINING_YEAR}. Use fewer weeks or an earlier first date.`,
  firstDateInPast: (today: string) =>
    `The first class must be today, ${formatCalendarDate(today)}, or later.`,
  firstDateOffWeekday: (weekday: number, firstDate: string) =>
    `The first class must be on a ${WEEKDAY_NAMES[weekday]}. ${formatCalendarDate(firstDate)} is a ${WEEKDAY_NAMES[weekdayOf(firstDate)]}.`,
  deadlineAfterFirstClass: (firstDate: string) =>
    `The series registration deadline must be on or before the first class, ${formatCalendarDate(firstDate)}.`,
  weeksEmpty: `Enter the number of weeks, ${WEEKS_RANGE}.`,
  weeksInvalid: `Enter a whole number of weeks ${WEEKS_RANGE}.`,
  placesEmpty: `Enter the places per class, ${PLACES_RANGE}.`,
  placesInvalid: `Enter a whole number of places ${PLACES_RANGE}.`,
  alreadyScheduled: 'Classes are already scheduled for this training program.',
  hasRegistrations: (registeredCount: number) =>
    `${registeredCount} ${registeredCount === 1 ? 'registration is' : 'registrations are'} in this class, so it cannot be cancelled.`,
} as const;

export interface TrainingPatternValues {
  /** `undefined` while none is chosen. */
  weekday: number | undefined;
  /** `HH:MM`, 24-hour, no time zone; empty while none is entered. */
  startTime: string;
  endTime: string;
  firstDate: string;
  /** `undefined` while none is entered; text that is not a number is `NaN`. */
  weeks: number | undefined;
  placesPerClass: number | undefined;
  registrationDeadline: string;
}

type Errors = Partial<Record<TrainingPatternField, TrainingPatternError>>;

/** The year a series ends in, counted past 9999 too, which `addCalendarDays` writes as `+010000-…`. */
function lastClassYear(firstDate: string, weeks: number): number {
  const [year, month, day] = firstDate.split('-').map(Number) as [number, number, number];
  return utcDate(year, month, day + (weeks - 1) * 7).getUTCFullYear();
}

/** The weekday of a stored calendar date, read as text so a browser in any time zone agrees. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return utcDate(year, month, day).getUTCDay();
}

export function classDates(firstDate: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, week) => addCalendarDays(firstDate, week * 7));
}

export function trainingClassTimes(startTime: string, endTime: string): string {
  return `${formatDailyTime(startTime)} to ${formatDailyTime(endTime)}`;
}

function isWeekday(weekday: number | undefined): weekday is number {
  return weekday !== undefined && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6;
}

function timeErrors({ startTime, endTime }: TrainingPatternValues): Errors {
  const errors: Errors = {};
  const times = { startTime, endTime } as const;
  for (const field of ['startTime', 'endTime'] as const) {
    const value = times[field];
    if (value === '') {
      errors[field] = {
        field,
        code: `${field}Empty`,
        message: TRAINING_PATTERN_MESSAGES[`${field}Empty`],
      };
    } else if (!isDailyTime(value)) {
      errors[field] = {
        field,
        code: 'timeInvalid',
        message: TRAINING_PATTERN_MESSAGES.timeInvalid,
      };
    }
  }
  if (!errors.startTime && !errors.endTime && endTime <= startTime) {
    errors.endTime = {
      field: 'endTime',
      code: 'endTimeNotAfterStart',
      message: TRAINING_PATTERN_MESSAGES.endTimeNotAfterStart(startTime),
    };
  }
  return errors;
}

function dateErrors(
  { weekday, firstDate, registrationDeadline }: TrainingPatternValues,
  today: string,
): Errors {
  const errors: Errors = {};
  const dates = { firstDate, registrationDeadline } as const;
  const empty = {
    firstDate: TRAINING_PATTERN_MESSAGES.firstDateEmpty,
    registrationDeadline: TRAINING_PATTERN_MESSAGES.deadlineEmpty,
  };
  const real = { firstDate: false, registrationDeadline: false };
  for (const field of ['firstDate', 'registrationDeadline'] as const) {
    const value = dates[field];
    if (value === '') {
      errors[field] = { field, code: 'dateEmpty', message: empty[field] };
    } else if (isCalendarDate(value) && Number(value.slice(0, 4)) < MIN_TRAINING_YEAR) {
      errors[field] = {
        field,
        code: 'dateInvalid',
        message: TRAINING_PATTERN_MESSAGES.yearOutOfRange,
      };
    } else if (isCalendarDate(value)) {
      real[field] = true;
    } else {
      errors[field] = {
        field,
        code: 'dateInvalid',
        message: TRAINING_PATTERN_MESSAGES.dateInvalid,
      };
    }
  }
  if (real.firstDate && isWeekday(weekday) && weekdayOf(firstDate) !== weekday) {
    errors.firstDate = {
      field: 'firstDate',
      code: 'firstDateOffWeekday',
      message: TRAINING_PATTERN_MESSAGES.firstDateOffWeekday(weekday, firstDate),
    };
  }
  if (real.firstDate && !errors.firstDate && firstDate < today) {
    errors.firstDate = {
      field: 'firstDate',
      code: 'firstDateInPast',
      message: TRAINING_PATTERN_MESSAGES.firstDateInPast(today),
    };
  }
  if (real.firstDate && real.registrationDeadline && registrationDeadline > firstDate) {
    errors.registrationDeadline = {
      field: 'registrationDeadline',
      code: 'deadlineAfterFirstClass',
      message: TRAINING_PATTERN_MESSAGES.deadlineAfterFirstClass(firstDate),
    };
  }
  return errors;
}

function countError(
  field: 'weeks' | 'placesPerClass',
  value: number | undefined,
): TrainingPatternError | null {
  const kind = field === 'weeks' ? 'weeks' : 'places';
  const [minimum, maximum] =
    field === 'weeks'
      ? [MIN_TRAINING_WEEKS, MAX_TRAINING_WEEKS]
      : [MIN_TRAINING_CLASS_PLACES, MAX_TRAINING_CLASS_PLACES];
  if (value === undefined) {
    return { field, code: `${kind}Empty`, message: TRAINING_PATTERN_MESSAGES[`${kind}Empty`] };
  }
  const valid = Number.isInteger(value) && value >= minimum && value <= maximum;
  return valid
    ? null
    : { field, code: `${kind}Invalid`, message: TRAINING_PATTERN_MESSAGES[`${kind}Invalid`] };
}

/** `today` is the caller's clock, as a calendar date: the server's for a refusal, the form's for a message. */
export function checkTrainingPattern(values: TrainingPatternValues, today: string): Errors {
  const errors: Errors = {};
  if (values.weekday === undefined) {
    errors.weekday = {
      field: 'weekday',
      code: 'weekdayEmpty',
      message: TRAINING_PATTERN_MESSAGES.weekdayEmpty,
    };
  } else if (!isWeekday(values.weekday)) {
    errors.weekday = {
      field: 'weekday',
      code: 'weekdayInvalid',
      message: TRAINING_PATTERN_MESSAGES.weekdayInvalid,
    };
  }
  Object.assign(errors, timeErrors(values), dateErrors(values, today));
  const weeks = countError('weeks', values.weeks);
  if (weeks) errors.weeks = weeks;
  else if (
    values.weeks !== undefined &&
    isCalendarDate(values.firstDate) &&
    Number(values.firstDate.slice(0, 4)) >= MIN_TRAINING_YEAR &&
    lastClassYear(values.firstDate, values.weeks) > MAX_TRAINING_YEAR
  ) {
    errors.weeks = {
      field: 'weeks',
      code: 'lastClassTooLate',
      message: TRAINING_PATTERN_MESSAGES.lastClassTooLate,
    };
  }
  const places = countError('placesPerClass', values.placesPerClass);
  if (places) errors.placesPerClass = places;
  return errors;
}

export function firstTrainingPatternError(errors: Errors): TrainingPatternError | null {
  for (const field of TRAINING_PATTERN_FIELDS) {
    const error = errors[field];
    if (error) return error;
  }
  return null;
}

export function trainingClassDate(date: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(date)].slice(0, 3)}, ${formatCalendarDate(date)}`;
}
