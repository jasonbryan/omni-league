import { MAX_MAX_TEAMS, MIN_MAX_TEAMS } from '../../../../convex/lib/seasonInput';
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

export function maxTeamsSavedText(maxTeams: number | null): AlertText {
  return maxTeams === null
    ? { title: 'Maximum teams removed.', description: 'There’s no limit now.' }
    : { title: 'Maximum teams saved.', description: `The season takes up to ${maxTeams} teams.` };
}

export const MAX_TEAMS_ALERTS = {
  failed: {
    title: 'The limit could not be saved.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: 'Your limit is still here. Try again when you’re connected.',
  },
} as const;
