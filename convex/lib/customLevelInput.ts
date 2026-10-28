// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import { levelLabel, levelsOfSport, type StandardLevel } from './divisions';
import { sportName, type Sport } from './sports';

export const MAX_CUSTOM_LEVEL_NAME_LENGTH = 30;
export const MAX_CUSTOM_LEVELS_PER_SPORT = 20;

export type CustomLevelInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'standardLevel'
  | 'duplicate'
  | 'limit'
  | 'standardLevelEmpty'
  | 'inUse';

export type CustomLevelField = 'name' | 'standardLevel';

export interface CustomLevelInputError {
  field: CustomLevelField;
  code: CustomLevelInputCode;
  message: string;
}

const lowerSportName = (sport: Sport) => sportName(sport).toLowerCase();

export const CUSTOM_LEVEL_MESSAGES = {
  nameEmpty: 'Enter the level’s name, such as Gold or Social.',
  nameTooLong: (length: number) =>
    `Use ${MAX_CUSTOM_LEVEL_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  standardLevel: (label: string) => `${label} is a standard level. Choose it above.`,
  duplicate: (name: string, sport: Sport) =>
    `${name} is already a custom level for ${lowerSportName(sport)}.`,
  limit: (sport: Sport) =>
    `You can have at most ${MAX_CUSTOM_LEVELS_PER_SPORT} custom levels for ${lowerSportName(sport)}.`,
  standardLevelEmpty: (name: string) =>
    `Choose the standard level ${name === '' ? 'it' : name} matches, so players can filter for it.`,
  inUse: (name: string) => `A league uses ${name}.`,
} as const;

export function normalizeCustomLevelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function checkCustomLevelName(
  sport: Sport,
  name: string,
): { ok: true; name: string } | { ok: false; error: CustomLevelInputError } {
  const normalized = normalizeCustomLevelName(name);
  if (normalized === '') {
    return {
      ok: false,
      error: { field: 'name', code: 'nameEmpty', message: CUSTOM_LEVEL_MESSAGES.nameEmpty },
    };
  }
  if (normalized.length > MAX_CUSTOM_LEVEL_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: CUSTOM_LEVEL_MESSAGES.nameTooLong(normalized.length),
      },
    };
  }
  const standard = levelsOfSport(sport).find(
    (level) => levelLabel(level).toLowerCase() === normalized.toLowerCase(),
  );
  if (standard !== undefined) {
    return {
      ok: false,
      error: {
        field: 'name',
        code: 'standardLevel',
        message: CUSTOM_LEVEL_MESSAGES.standardLevel(levelLabel(standard)),
      },
    };
  }
  return { ok: true, name: normalized };
}

export function checkCustomLevelStandard(
  sport: Sport,
  name: string,
  standardLevel: string | null,
): { ok: true; standardLevel: StandardLevel } | { ok: false; error: CustomLevelInputError } {
  const chosen = levelsOfSport(sport).find((level) => level === standardLevel);
  if (chosen !== undefined) return { ok: true, standardLevel: chosen };
  return {
    ok: false,
    error: {
      field: 'standardLevel',
      code: 'standardLevelEmpty',
      message: CUSTOM_LEVEL_MESSAGES.standardLevelEmpty(normalizeCustomLevelName(name)),
    },
  };
}
