import { ConvexError } from 'convex/values';
import {
  forfeitScore,
  isScoreField,
  scoreText,
  scoreKindOf,
  type Score,
  type ScoreField,
  type Sport,
} from '../../../../convex/lib/sports';
import type { AlertText } from './alert-text';

const CHECK_CONNECTION = 'Check your connection and try again.';

/** Only the field and words the server gave for a score it refused; any other failure's message is server detail. */
export function scoreRefusalOf(error: unknown): { field: ScoreField; message: string } | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return null;
  const { code, field, message } = data as { code?: unknown; field?: unknown; message?: unknown };
  if (code !== 'invalidScore' || typeof message !== 'string') return null;
  if (!isScoreField(field)) return null;
  return { field, message };
}

export function pointsLabel(sport: Sport, teamName: string): string {
  const unit = { sets: 'points', goals: 'goals', runs: 'runs' }[scoreKindOf(sport)];
  return `${teamName} ${unit}`;
}

export function forfeitNote(sport: Sport, setsPerGame: number): string {
  // Side 1 forfeits, so the first team's side of the score is the winner's.
  return `The other team wins ${scoreText(forfeitScore(sport, setsPerGame, 1))}.`;
}

export interface PlayedGame {
  teams: readonly [string, string];
  score: Score;
  winnerName: string;
  forfeitName: string | null;
}

export function playedText({ teams, score, winnerName, forfeitName }: PlayedGame): string {
  const forfeited = forfeitName === null ? '' : ` ${forfeitName} forfeited.`;
  return `${teams[0]} ${scoreText(score)} ${teams[1]}.${forfeited} ${winnerName} won.`;
}

export function savedText(
  winnerName: string,
  advancesTo: string | null,
  corrected: boolean,
): AlertText {
  return {
    title: corrected ? 'Result corrected' : 'Result saved',
    description:
      advancesTo === null
        ? `${winnerName} wins the tournament.`
        : `${winnerName} advances to the ${advancesTo}.`,
  };
}

export function undoneText(restored: boolean): AlertText {
  return restored
    ? { title: 'Earlier result restored', description: 'The game has its earlier result again.' }
    : { title: 'Result undone', description: 'The game is waiting for a result again.' };
}

export function saveFailedText(corrected: boolean, refusal: string | null): AlertText {
  return {
    title: `The result could not be ${corrected ? 'corrected' : 'saved'}.`,
    description: refusal ?? CHECK_CONNECTION,
  };
}

export function undoFailedText(refusal: string | null): AlertText {
  return { title: 'The result could not be undone.', description: refusal ?? CHECK_CONNECTION };
}

export const SAVE_OFFLINE = 'Your scores are still here. Try again when you’re connected.';

export const UNDO_OFFLINE = 'The result is unchanged. Try again when you’re connected.';

export const FORFEIT_CHOICE_ERROR = 'Choose the team that forfeits.';
