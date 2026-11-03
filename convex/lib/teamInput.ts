// Imports nothing, so the app can import it.

export const MAX_TEAM_NAME_LENGTH = 60;

export type TeamNameCode = 'nameEmpty' | 'nameTooLong' | 'nameTaken';

export interface TeamNameError {
  field: 'name';
  code: TeamNameCode;
  message: string;
}

export interface RegistrationClosedError {
  code: 'registrationClosed';
  message: string;
}

export interface SeasonFullRefusal {
  code: 'seasonFull';
  message: string;
}

export interface TeamFullRefusal {
  code: 'teamFull';
  message: string;
}

export type RosterRefusalCode = 'alreadyOnTeam' | 'alreadyOnAnotherTeam';

export interface RosterRefusal {
  code: RosterRefusalCode;
  teamName: string;
  message: string;
}

export interface WaitingFreeAgentRefusal {
  code: 'waitingFreeAgent';
  message: string;
}

export interface AlreadyFreeAgentRefusal {
  code: 'alreadyFreeAgent';
  message: string;
}

export interface AlreadyPlacedRefusal {
  code: 'alreadyPlaced';
  message: string;
}

export interface CaptainRequiredRefusal {
  code: 'captainRequired';
  message: string;
}

export interface NotRosteredRefusal {
  code: 'notRostered';
  message: string;
}

export const SEASON_NOT_FOUND_CODE = 'seasonNotFound';

export const TEAM_MESSAGES = {
  nameEmpty: 'Enter a team name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_TEAM_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  nameTaken: (registered: string) =>
    `${registered} is already registered in this season. Choose another name.`,
  registrationClosed: 'Registration for this season is closed.',
  seasonFull: 'This season is full.',
  teamFull: 'The team is full.',
  alreadyOnTeam: 'Already on the team.',
  alreadyOnAnotherTeam: (teamName: string) => `Already on ${teamName} in this season.`,
  waitingFreeAgent:
    "You're registered as a free agent in this season. An organizer places free agents on teams.",
  alreadyFreeAgent: 'Already registered as a free agent in this season.',
  alreadyPlaced: 'Already placed on a team.',
  captainRequired: 'A team needs its captain.',
  notRostered: 'No longer on the team.',
} as const;

export function normalizeTeamName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Names are unique in a season by this key. */
export function teamSortName(name: string): string {
  return normalizeTeamName(name).toLowerCase();
}

export function checkTeamName(
  name: string,
): { ok: true; name: string } | { ok: false; error: TeamNameError } {
  const normalized = normalizeTeamName(name);
  if (normalized === '') {
    return {
      ok: false,
      error: { field: 'name', code: 'nameEmpty', message: TEAM_MESSAGES.nameEmpty },
    };
  }
  if (normalized.length > MAX_TEAM_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: TEAM_MESSAGES.nameTooLong(normalized.length),
      },
    };
  }
  return { ok: true, name: normalized };
}
