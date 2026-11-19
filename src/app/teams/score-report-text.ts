import { scoreText, type Score } from '../../../convex/lib/sports';
import type { AlertText } from '../organizations/admin/alert-text';
import type { GameStage } from '../organizations/admin/game-result-text';

const CHECK_CONNECTION = 'Check your connection and try again.';

export const SET_THREE_NOTE = 'Only if each team won a set.';

export const NO_GAME_TITLE = 'No game to report right now.';

export const NO_GAME_TEXT = 'A game shows here once both of its teams are set.';

export const LOAD_FAILED: AlertText = {
  title: 'The game could not be loaded.',
  description: 'Check your connection and reload the page.',
};

export function gameLabel(roundName: string, names: readonly [string, string]): string {
  return `${roundName}: ${names[0]} v ${names[1]}`;
}

export function reportedLine(names: readonly [string, string], score: Score): string {
  return `${names[0]} ${scoreText(score)} ${names[1]}.`;
}

const WHEN_IT_COUNTS: Record<GameStage, string> = {
  bracket: 'before the winner advances',
  pool: 'before it counts in the standings',
};

export const reportedNote = (stage: GameStage) =>
  `The organizer confirms it ${WHEN_IT_COUNTS[stage]}. Report again to change it until then.`;

export const reportedStatus = (stage: GameStage): AlertText => ({
  title: 'Score reported',
  description: `The organizer confirms it ${WHEN_IT_COUNTS[stage]}.`,
});

export function reportFailedText(refusal: string | null): AlertText {
  return {
    title: 'The score could not be reported.',
    description: refusal ?? CHECK_CONNECTION,
  };
}
