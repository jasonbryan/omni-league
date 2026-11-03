// Imports nothing, so the app can import it.

export const MAX_MINOR_NAME_LENGTH = 60;

export type MinorNameCode = 'minorNameEmpty' | 'minorNameTooLong';

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

export interface NothingChosenRefusal {
  code: 'nothingChosen';
  message: string;
}

export const MINOR_MESSAGES = {
  minorNameEmpty: 'Enter the minor’s name.',
  minorNameTooLong: (length: number) =>
    `Use ${MAX_MINOR_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  minorInSeason: (minorName: string, teamName: string) =>
    `${minorName} is already on ${teamName} in this season.`,
  nothingChosen: 'Choose at least one: join yourself, add a minor, or both.',
} as const;

export function normalizeMinorName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** One guardian's minors are told apart by this key. */
export function minorNameKey(name: string): string {
  return normalizeMinorName(name).toLowerCase();
}

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
  return { ok: true, name: normalized };
}

export function shortMinorName(name: string): string {
  const words = normalizeMinorName(name).split(' ');
  if (words.length < 2) return words[0] ?? '';
  const [initial = ''] = Array.from(words[words.length - 1]);
  return `${words[0]} ${initial.toUpperCase()}.`;
}
