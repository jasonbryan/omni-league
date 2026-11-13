import { describe, expect, test } from 'vitest';
import {
  checkTournamentDetails,
  checkTournamentFields,
  firstTournamentError,
  MAX_TOURNAMENT_NAME_LENGTH,
  TOURNAMENT_FIELDS,
  TOURNAMENT_MESSAGES,
  type TournamentDetailsValues,
  type TournamentValues,
} from './tournamentInput';

const VALID: TournamentValues = {
  name: 'Winter Doubles Classic',
  slug: 'winter-doubles-classic',
  sport: 'beachVolleyball',
  playersPerSide: 2,
  level: 'open',
  ageGroup: 'adult',
  locationCount: 1,
  startDate: '2027-01-16',
  endDate: '2027-01-17',
  registrationDeadline: '2027-01-09',
  maximumTeams: 16,
};

const errorsOf = (change: Partial<TournamentValues>) =>
  checkTournamentFields({ ...VALID, ...change });

describe('checkTournamentFields', () => {
  test('accepts valid input, and a blank end date', () => {
    expect(errorsOf({})).toEqual({});
    expect(errorsOf({ endDate: '' })).toEqual({});
  });

  test('accepts a deadline on the start date, an end date on the start date, and the limits of the maximum', () => {
    expect(errorsOf({ registrationDeadline: '2027-01-16' })).toEqual({});
    expect(errorsOf({ endDate: '2027-01-16' })).toEqual({});
    expect(errorsOf({ maximumTeams: 2 })).toEqual({});
    expect(errorsOf({ maximumTeams: 128 })).toEqual({});
  });

  test('refuses an end date before the start', () => {
    expect(errorsOf({ endDate: '2027-01-15' }).endDate).toEqual({
      field: 'endDate',
      code: 'endBeforeStart',
      message: 'The end date must be on or after the start date.',
    });
  });

  test('refuses a deadline after the start, and names the start date', () => {
    expect(errorsOf({ registrationDeadline: '2027-01-17' }).registrationDeadline).toEqual({
      field: 'registrationDeadline',
      code: 'deadlineAfterStart',
      message: 'The registration deadline must be on or before the start date, Jan 16, 2027.',
    });
  });

  test.each([0, 1, 129, 200, 2.5, Number.NaN, Number.POSITIVE_INFINITY, -4])(
    'refuses %s as the maximum teams',
    (maximumTeams) => {
      expect(errorsOf({ maximumTeams }).maximumTeams).toEqual({
        field: 'maximumTeams',
        code: 'maximumTeamsInvalid',
        message: 'Enter a whole number from 2 to 128.',
      });
    },
  );

  test('asks for the maximum teams when there is none', () => {
    expect(errorsOf({ maximumTeams: undefined }).maximumTeams).toEqual({
      field: 'maximumTeams',
      code: 'maximumTeamsEmpty',
      message: 'Enter the most teams the tournament takes, from 2 to 128.',
    });
  });

  test('asks for a start date and a deadline, and refuses text that is not a real date', () => {
    expect(errorsOf({ startDate: '' }).startDate?.message).toBe('Enter the start date.');
    expect(errorsOf({ registrationDeadline: '' }).registrationDeadline?.message).toBe(
      'Enter the registration deadline.',
    );
    for (const field of ['startDate', 'endDate', 'registrationDeadline'] as const) {
      expect(errorsOf({ [field]: '2027-02-30' })[field]?.message).toBe('Enter a real date.');
    }
  });

  test('compares no date with one that is not a real date', () => {
    const errors = errorsOf({ startDate: '2027-02-30' });
    expect(Object.keys(errors)).toEqual(['startDate']);
    expect(errors.startDate?.code).toBe('dateInvalid');
    expect(errorsOf({ startDate: '' }).endDate).toBeUndefined();
    expect(errorsOf({ startDate: '' }).registrationDeadline).toBeUndefined();
  });

  test('refuses an empty name, one of only spaces, one over 100 characters, and one with a hidden character', () => {
    expect(errorsOf({ name: '' }).name?.message).toBe('Enter the tournament’s name.');
    expect(errorsOf({ name: '   ' }).name?.code).toBe('nameEmpty');
    expect(errorsOf({ name: 'x'.repeat(MAX_TOURNAMENT_NAME_LENGTH) }).name).toBeUndefined();
    expect(errorsOf({ name: 'x'.repeat(101) }).name?.message).toBe(
      'Use 100 characters or fewer. This name has 101.',
    );
    expect(errorsOf({ name: 'Open\u202e' }).name?.code).toBe('nameInvisible');
  });

  test('refuses an empty, malformed, or reserved web address', () => {
    expect(errorsOf({ slug: '' }).slug?.message).toBe('Enter a web address for the tournament.');
    for (const slug of ['ab', 'Winter', 'a--b', '-ab', 'new', 'gulf-coast-sport-social']) {
      expect(errorsOf({ slug }).slug?.code).toBe('slugInvalid');
    }
  });

  test('checks the division: a format and a level of the sport, an age group from the list, and one location', () => {
    expect(errorsOf({ playersPerSide: null }).format?.code).toBe('formatInvalid');
    expect(errorsOf({ playersPerSide: 7 }).format?.code).toBe('formatInvalid');
    expect(errorsOf({ level: 'intermediate' }).level?.code).toBe('levelInvalid');
    expect(errorsOf({ ageGroup: 'over99' }).ageGroup?.code).toBe('ageGroupInvalid');
    expect(errorsOf({ locationCount: 0 }).locations?.message).toBe('Choose at least one location.');
  });

  test('has no sport, so the division is not checked and the sport asks to be chosen', () => {
    const errors = errorsOf({ sport: null, playersPerSide: null });
    expect(Object.keys(errors)).toEqual(['sport']);
    expect(errors.sport).toEqual({
      field: 'sport',
      code: 'sportEmpty',
      message: 'Choose a sport.',
    });
  });

  test('returns every error at once, in the order of the page', () => {
    const errors = errorsOf({ name: '', slug: '', maximumTeams: 1 });
    expect(Object.keys(errors).sort()).toEqual(['maximumTeams', 'name', 'slug']);
    expect(firstTournamentError(errors)?.field).toBe('name');
    expect(firstTournamentError({})).toBeNull();
  });
});

describe('TOURNAMENT_FIELDS', () => {
  test('lists the fields in the order of the page', () => {
    expect(TOURNAMENT_FIELDS).toEqual([
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
    ]);
  });
});

describe('TOURNAMENT_MESSAGES', () => {
  test('shares the web address format message with leagues', () => {
    expect(TOURNAMENT_MESSAGES.slugTaken('open-2027')).toBe(
      'open-2027 is already taken. Choose another web address.',
    );
  });
});

const DETAILS: TournamentDetailsValues = {
  startDate: '2027-01-16',
  endDate: '2027-01-17',
  registrationDeadline: '2027-01-09',
  maximumTeams: 16,
  teamCount: 0,
};

const detailsErrorsOf = (change: Partial<TournamentDetailsValues>) =>
  checkTournamentDetails({ ...DETAILS, ...change });

describe('checkTournamentDetails', () => {
  test('accepts valid details, a blank end date, and a maximum equal to the team count', () => {
    expect(detailsErrorsOf({})).toEqual({});
    expect(detailsErrorsOf({ endDate: '' })).toEqual({});
    expect(detailsErrorsOf({ maximumTeams: 6, teamCount: 6 })).toEqual({});
  });

  test('applies the date and maximum rules of tournamentInput.ts, with the same messages', () => {
    const create = checkTournamentFields({
      ...VALID,
      startDate: '2027-01-16',
      endDate: '2027-01-15',
      registrationDeadline: '2027-01-17',
      maximumTeams: 129,
    });
    expect(
      detailsErrorsOf({
        endDate: '2027-01-15',
        registrationDeadline: '2027-01-17',
        maximumTeams: 129,
      }),
    ).toEqual(create);
  });

  test('refuses an empty maximum', () => {
    expect(detailsErrorsOf({ maximumTeams: undefined }).maximumTeams?.code).toBe(
      'maximumTeamsEmpty',
    );
  });

  test('refuses a maximum below the team count, and says how many teams there are', () => {
    expect(detailsErrorsOf({ maximumTeams: 3, teamCount: 4 }).maximumTeams).toEqual({
      field: 'maximumTeams',
      code: 'maximumTeamsBelowTeams',
      message: '4 teams are registered. Enter 4 or more.',
    });
  });

  test('words the Undo refusal by its reason, with the earlier maximum', () => {
    expect(TOURNAMENT_MESSAGES.undoMaximumTeamsBelowTeams(6, 4)).toBe(
      '6 teams are registered, more than the earlier maximum of 4, so it cannot be undone.',
    );
  });

  test('refuses a maximum outside 2 to 128 with the range message, before it checks the team count', () => {
    expect(detailsErrorsOf({ maximumTeams: 1, teamCount: 4 }).maximumTeams?.code).toBe(
      'maximumTeamsInvalid',
    );
  });
});
