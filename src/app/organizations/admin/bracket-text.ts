import { ConvexError } from 'convex/values';
import { BRACKET_REFUSAL_CODES } from '../../../../convex/lib/bracket';
import type { AlertText } from './alert-text';

export type SeedDirection = 'up' | 'down';

const CHECK_CONNECTION = 'Check your connection and try again.';

/** Only a refusal the server words for the organizer is shown; any other failure's message is server detail. */
export function bracketRefusalMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  const known = (BRACKET_REFUSAL_CODES as readonly unknown[]).includes(code);
  return known && typeof message === 'string' ? message : null;
}

export function movedText(
  teamName: string,
  direction: SeedDirection,
  seed: number,
  seedCount: number,
): string {
  return `${teamName} moved ${direction} to seed ${seed} of ${seedCount}.`;
}

export function moveFailedText(teamName: string, refusal: string | null): AlertText {
  return {
    title: `${teamName} could not be moved.`,
    description: refusal ?? CHECK_CONNECTION,
  };
}

export function moveOfflineText(teamName: string): string {
  return `${teamName} keeps its seed. Try again when you’re connected.`;
}

export function createFailedText(recreating: boolean, refusal: string | null): AlertText {
  return {
    title: `The bracket could not be ${recreating ? 'recreated' : 'created'}.`,
    description: refusal ?? CHECK_CONNECTION,
  };
}

export function createOfflineText(recreating: boolean): string {
  return recreating
    ? 'The bracket is unchanged. Try again when you’re connected.'
    : 'No bracket was created. Try again when you’re connected.';
}

export function createdText(recreated: boolean, gameCount: number, roundCount: number): AlertText {
  return {
    title: recreated ? 'Bracket recreated' : 'Bracket created',
    description: `${gameCount} ${gameCount === 1 ? 'game' : 'games'} in ${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}. Registration, the waitlist, and Sets per game are closed now. A moved seed changes the bracket when you recreate it.`,
  };
}

export function unconfirmedNote(count: number, minimumRosterSize: number): string {
  return `${count} ${count === 1 ? 'team has' : 'teams have'} fewer than ${minimumRosterSize} players, so ${count === 1 ? 'it is' : 'they are'} not seeded.`;
}

export function emptySeedsText(minimumRosterSize: number): string {
  return `A team is confirmed once ${minimumRosterSize} players are on its roster. Confirmed teams appear here as seeds.`;
}

export function playersText(rosterCount: number): string {
  return `${rosterCount} ${rosterCount === 1 ? 'player' : 'players'}`;
}
