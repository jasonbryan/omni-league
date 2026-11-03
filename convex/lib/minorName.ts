// Imports nothing, so the app can import it.

export const MAX_MINOR_NAME_LENGTH = 60;

export const MAX_MINORS_PER_GUARDIAN_IN_SEASON = 20;

export type MinorNameCode = 'minorNameEmpty' | 'minorNameTooLong' | 'minorNameInvisible';

export interface MinorNameError {
  field: 'minorName';
  code: MinorNameCode;
  message: string;
}

export interface MinorInSeasonRefusal {
  field: 'minorName';
  code: 'minorInSeason';
  /** The name as stored, which may differ from the one entered in case and spacing. */
  minorName: string;
  teamName: string;
  message: string;
}

/** Removed minors count, so the limit cannot be reset by removing them. */
export interface MinorLimitRefusal {
  field: 'minorName';
  code: 'minorLimit';
  message: string;
}

export interface NothingChosenRefusal {
  code: 'nothingChosen';
  message: string;
}

export const MINOR_MESSAGES = {
  minorNameEmpty: 'Enter the minor’s name.',
  minorNameTooLong: (length: number) =>
    `Use ${MAX_MINOR_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  minorNameInvisible: 'Remove the hidden or control characters from the name.',
  minorInSeason: (minorName: string, teamName: string) =>
    `${minorName} is already on ${teamName} in this season.`,
  minorLimit: `You’ve added ${MAX_MINORS_PER_GUARDIAN_IN_SEASON} minors in this season, removed ones included, which is the most one guardian can add.`,
  nothingChosen: 'Choose at least one: join yourself, add a minor, or both.',
} as const;

export function normalizeMinorName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** One guardian's minors are told apart by this key. */
export function minorNameKey(name: string): string {
  return normalizeMinorName(name).toLowerCase();
}

// A zero-width space would join the surname to the first name in `shortMinorName`, and a bidi override reorders the name on other teams' pages.
const INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}]/u;

export function checkMinorName(
  name: string,
): { ok: true; name: string } | { ok: false; error: MinorNameError } {
  const normalized = normalizeMinorName(name);
  if (normalized === '') {
    return {
      ok: false,
      error: { field: 'minorName', code: 'minorNameEmpty', message: MINOR_MESSAGES.minorNameEmpty },
    };
  }
  if (normalized.length > MAX_MINOR_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'minorName',
        code: 'minorNameTooLong',
        message: MINOR_MESSAGES.minorNameTooLong(normalized.length),
      },
    };
  }
  if (INVISIBLE_CHARACTER.test(normalized)) {
    return {
      ok: false,
      error: {
        field: 'minorName',
        code: 'minorNameInvisible',
        message: MINOR_MESSAGES.minorNameInvisible,
      },
    };
  }
  return { ok: true, name: normalized };
}

export function shortMinorName(name: string): string {
  const words = normalizeMinorName(name).split(' ');
  if (words.length < 2) return words[0] ?? '';
  const [initial = ''] = Array.from(words[words.length - 1]);
  return `${words[0]} ${initial.toUpperCase()}.`;
}
