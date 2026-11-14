import type { Pool } from '../../../../convex/lib/pools';
import type { AlertText } from './alert-text';

const CHECK_CONNECTION = 'Check your connection and try again.';

const teamsText = (count: number) => `${count} ${count === 1 ? 'team' : 'teams'}`;

export function movedToPoolText(teamName: string, pool: Pool, poolTeamCount: number): string {
  return `${teamName} moved to Pool ${pool}. Pool ${pool} has ${teamsText(poolTeamCount)}.`;
}

export function moveToPoolFailedText(teamName: string, refusal: string | null): AlertText {
  return {
    title: `${teamName} could not be moved.`,
    description: refusal ?? CHECK_CONNECTION,
  };
}

export function moveToPoolOfflineText(teamName: string): string {
  return `${teamName} keeps its pool. Try again when you’re connected.`;
}

export function splitFailedText(refusal: string | null): AlertText {
  return {
    title: 'The teams could not be split into pools.',
    description: refusal ?? CHECK_CONNECTION,
  };
}

export function splitOfflineText(): string {
  return 'The pools are unchanged. Try again when you’re connected.';
}

export function splitDoneText(poolCount: number, teamCount: number): AlertText {
  return {
    title: 'Teams split into pools',
    description: `${teamsText(teamCount)} in ${poolCount} pools, in snake order of the seeds. Move a team to change its pool, then create the pool games.`,
  };
}

export function gamesFailedText(recreating: boolean, refusal: string | null): AlertText {
  return {
    title: `The pool games could not be ${recreating ? 'recreated' : 'created'}.`,
    description: refusal ?? CHECK_CONNECTION,
  };
}

export function gamesOfflineText(recreating: boolean): string {
  return recreating
    ? 'The pool games are unchanged. Try again when you’re connected.'
    : 'No pool games were created. Try again when you’re connected.';
}

export function gamesCreatedText(
  recreated: boolean,
  gameCount: number,
  poolCount: number,
): AlertText {
  return {
    title: recreated ? 'Pool games recreated' : 'Pool games created',
    description: `${gameCount} ${gameCount === 1 ? 'game' : 'games'} in ${poolCount} pools. Structure and Sets per game are closed now. A moved team changes the games when you recreate them.`,
  };
}

export function unassignedNote(count: number): string {
  return `${count} confirmed ${count === 1 ? 'team is' : 'teams are'} in no pool. Split the teams again to place ${count === 1 ? 'it' : 'them'}.`;
}

export function unconfirmedPoolNote(count: number, minimumRosterSize: number): string {
  return `${count} ${count === 1 ? 'team has' : 'teams have'} fewer than ${minimumRosterSize} players, so ${count === 1 ? 'it is' : 'they are'} in no pool.`;
}

export const STALE_GAMES_NOTE =
  'The pools changed after the games were created. Recreate the games to use the pools as they are.';
