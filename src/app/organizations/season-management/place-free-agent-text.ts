import { ConvexError } from 'convex/values';
import type { AlertText, OfflineAlertText } from '../admin/alert-text';

export type PlaceFailure =
  | { kind: 'offline' }
  | { kind: 'onTeam'; teamName: string }
  | { kind: 'alreadyPlaced' }
  | { kind: 'failed' };

export type PlaceAlertView =
  ({ kind: 'offline' } & OfflineAlertText) | ({ kind: 'failed' } & AlertText);

const players = (count: number) => `${count} ${count === 1 ? 'player' : 'players'}`;

/** Only a refusal's code is read: any other failure's message is server detail the page never shows. */
export function placeFailureOf(error: unknown): PlaceFailure {
  if (!(error instanceof ConvexError)) return { kind: 'failed' };
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return { kind: 'failed' };
  const { code, teamName } = data as { code?: unknown; teamName?: unknown };
  if (
    (code === 'alreadyOnTeam' || code === 'alreadyOnAnotherTeam') &&
    typeof teamName === 'string'
  ) {
    return { kind: 'onTeam', teamName };
  }
  if (code === 'alreadyPlaced') return { kind: 'alreadyPlaced' };
  return { kind: 'failed' };
}

export function placeFailureText(failure: PlaceFailure, name: string): PlaceAlertView {
  const title = `${name} could not be placed.`;
  switch (failure.kind) {
    case 'offline':
      return {
        kind: 'offline',
        description: `${name} is still waiting. Try again when you’re connected.`,
      };
    case 'onTeam':
      return {
        kind: 'failed',
        title,
        description: `They’re already on ${failure.teamName} in this season.`,
      };
    case 'alreadyPlaced':
      return { kind: 'failed', title, description: 'They’ve already been placed on a team.' };
    case 'failed':
      return { kind: 'failed', title, description: 'Check your connection and try again.' };
  }
}

export function placedText(
  name: string,
  teamName: string,
  rosterCount: number,
  minimumRosterSize: number,
): AlertText {
  const roster =
    rosterCount <= minimumRosterSize
      ? `${rosterCount} of ${players(minimumRosterSize)}`
      : players(rosterCount);
  return { title: `${name} is on ${teamName} now.`, description: `${teamName} has ${roster}.` };
}
