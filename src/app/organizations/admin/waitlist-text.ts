import { ConvexError } from 'convex/values';
import { TEAM_MESSAGES } from '../../../../convex/lib/teamInput';
import type { AlertText } from '../admin/alert-text';

export type WaitlistSubject = 'season' | 'tournament';

export type PromoteFailure =
  | { kind: 'noRoom' }
  | { kind: 'captainOnTeam'; teamName: string }
  | { kind: 'alreadyPromoted' }
  | { kind: 'failed' };

/** Only a refusal's code is read: any other failure's message is server detail the page never shows. */
export function promoteFailureOf(error: unknown): PromoteFailure {
  if (!(error instanceof ConvexError)) return { kind: 'failed' };
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return { kind: 'failed' };
  const { code, teamName } = data as { code?: unknown; teamName?: unknown };
  if (code === 'noRoom') return { kind: 'noRoom' };
  if (code === 'alreadyPromoted') return { kind: 'alreadyPromoted' };
  if (
    (code === 'alreadyOnTeam' || code === 'alreadyOnAnotherTeam') &&
    typeof teamName === 'string'
  ) {
    return { kind: 'captainOnTeam', teamName };
  }
  return { kind: 'failed' };
}

export function promoteFailureText(
  failure: PromoteFailure,
  teamName: string,
  captainName: string,
  subject: WaitlistSubject,
): AlertText {
  const title = `${teamName} could not be promoted.`;
  switch (failure.kind) {
    case 'noRoom':
      return {
        title,
        description: subject === 'season' ? TEAM_MESSAGES.noRoom : TEAM_MESSAGES.noRoomInTournament,
      };
    case 'captainOnTeam':
      return { title, description: `${captainName} is already on ${failure.teamName}.` };
    case 'alreadyPromoted':
      return { title, description: TEAM_MESSAGES.alreadyPromoted };
    case 'failed':
      return { title, description: 'Check your connection and try again.' };
  }
}

export function promoteOfflineText(teamName: string): string {
  return `${teamName} is still waiting. Try again when you’re connected.`;
}

export function promotedText(
  teamName: string,
  captainName: string,
  teamCount: number,
  maxTeams: number | undefined,
  subject: WaitlistSubject,
): AlertText {
  const teams = maxTeams === undefined ? `${teamCount}` : `${teamCount} of ${maxTeams}`;
  return {
    title: `${teamName} is a team now.`,
    description: `${captainName} is its captain and can invite players. The ${subject} has ${teams} teams.`,
  };
}

export function waitlistEmptyText(subject: WaitlistSubject): string {
  return `When the ${subject} is full, teams that register wait here in the order they joined.`;
}

export function waitlistNote(
  teamCount: number,
  maxTeams: number | undefined,
  subject: WaitlistSubject,
): AlertText {
  if (maxTeams !== undefined && teamCount >= maxTeams) {
    return {
      title: `The ${subject} is full`,
      description: 'Raise the maximum teams to promote a waiting team.',
    };
  }
  const room =
    maxTeams === undefined
      ? 'Room for more teams'
      : `Room for ${maxTeams - teamCount} more ${maxTeams - teamCount === 1 ? 'team' : 'teams'}`;
  return {
    title: room,
    description:
      'While teams are waiting, new teams still join the waitlist, so promote to fill the places.',
  };
}
