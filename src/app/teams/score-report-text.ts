import { scoreText, type Score } from '../../../convex/lib/sports';
import type { AlertText } from '../organizations/admin/alert-text';

const CHECK_CONNECTION = 'Check your connection and try again.';

export const NO_GAME_TITLE = 'No game to report right now.';

export const NO_GAME_TEXT = 'Your next game shows here once both teams are set.';

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

export const REPORTED_NOTE =
  'The organizer confirms it before the winner advances. Report again to change it until then.';

export const REPORTED_STATUS: AlertText = {
  title: 'Score reported',
  description: 'The organizer confirms it before the winner advances.',
};

export function reportFailedText(refusal: string | null): AlertText {
  return {
    title: 'The score could not be reported.',
    description: refusal ?? CHECK_CONNECTION,
  };
}
