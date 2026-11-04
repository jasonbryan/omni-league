import {
  MAX_MAX_TEAMS,
  MIN_MAX_TEAMS,
  type LargestRoster,
} from '../../../../convex/lib/seasonInput';
import { ROSTER_SIZE_INPUT_MAX } from '../../../../convex/lib/sports';
import type { AlertText } from '../admin/alert-text';

export function maxTeamsSummary(maxTeams: number | undefined, teamCount: number): string {
  if (maxTeams === undefined) return `No limit · ${teamCount} registered`;
  const full = teamCount >= maxTeams ? ', so the season is full' : '';
  return `${maxTeams} teams · ${teamCount} registered${full}`;
}

export function maxTeamsDescription(teamCount: number): string {
  const range = `${MIN_MAX_TEAMS} to ${MAX_MAX_TEAMS}, or blank for no limit.`;
  return teamCount >= MIN_MAX_TEAMS
    ? `${range} At least the ${teamCount} teams already registered.`
    : range;
}

/** While teams wait, new teams still join the waitlist, so the text says to promote them into the room the change made. */
export function maxTeamsSavedText(
  maxTeams: number | null,
  { teamCount, waitlistCount }: { teamCount: number; waitlistCount: number } = {
    teamCount: 0,
    waitlistCount: 0,
  },
): AlertText {
  if (maxTeams === null) {
    return { title: 'Maximum teams removed.', description: 'There’s no limit now.' };
  }
  const room = maxTeams - teamCount;
  const promote =
    waitlistCount > 0 && room > 0
      ? ` Teams on the waitlist keep their place: promote them to fill the ${room === 1 ? 'place' : `${room} places`}.`
      : '';
  return {
    title: 'Maximum teams saved.',
    description: `The season takes up to ${maxTeams} teams.${promote}`,
  };
}

export function maxRosterSizeSummary(maxRosterSize: number | undefined): string {
  return maxRosterSize === undefined ? 'No limit' : `${maxRosterSize} players per team`;
}

export function maxRosterSizeDescription(
  minimumRosterSize: number,
  largest: LargestRoster | undefined,
): string {
  const range = `From the minimum roster size (${minimumRosterSize}) to ${ROSTER_SIZE_INPUT_MAX}, or blank for no limit.`;
  return largest && largest.rosterCount > minimumRosterSize
    ? `${range} At least the largest roster (${largest.name}, ${largest.rosterCount} players).`
    : range;
}

export function maxRosterSizeSavedText(maxRosterSize: number | null): AlertText {
  return maxRosterSize === null
    ? { title: 'Maximum roster size removed.', description: 'There’s no limit now.' }
    : {
        title: 'Maximum roster size saved.',
        description: `Teams can have up to ${maxRosterSize} players.`,
      };
}

export const LIMIT_ALERTS = {
  failed: {
    title: 'The limit could not be saved.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: 'Your limit is still here. Try again when you’re connected.',
  },
} as const;
