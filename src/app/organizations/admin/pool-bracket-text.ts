import type { Pool } from '../../../../convex/lib/pools';
import type { Sport } from '../../../../convex/lib/sports';
import { SCORE_WORDS } from '../../../../convex/lib/standings';
import type { ChipOption } from './chip-radio-group';

const ordinals = new Intl.PluralRules('en-US', { type: 'ordinal' });
const SUFFIXES: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };

const ordinal = (place: number) => `${place}${SUFFIXES[ordinals.select(place)]}`;

export function placeText(pool: Pool, place: number, tie: { place: number } | null): string {
  return tie ? `Pool ${pool}, ${ordinal(tie.place)}, tied` : `Pool ${pool}, ${ordinal(place)}`;
}

export type TieDeciding = 'headToHead' | 'seedOrder' | 'organizer';

const names = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' });

/** One line for a pool whose tie sits on the advance line, saying what decided who advances. */
export function tieNote(
  pool: Pool,
  tieNames: readonly string[],
  place: number,
  deciding: TieDeciding,
  sport: Sport,
): string {
  const lead = `Pool ${pool} is tied for ${ordinal(place)} between ${names.format(tieNames)}.`;
  const scored = SCORE_WORDS[sport];
  switch (deciding) {
    case 'headToHead':
      return `${lead} The team that scored more ${scored} in the games between them advances.`;
    case 'seedOrder':
      return `${lead} They scored the same number of ${scored} against each other, or did not all play each other, so seed order decides.`;
    case 'organizer':
      return `${lead} Your choice decides who advances.`;
  }
}

export const ADVANCING_HEADING = 'Who advances';

export const ADVANCING_HINT =
  'The pool results choose the teams. Check or clear a team to choose who advances instead.';

export function advancingToggledText(teamName: string, advancing: boolean): string {
  return `${teamName} ${advancing ? 'advances' : 'does not advance'}.`;
}

export function advanceOptions(smallestPool: number): ChipOption[] {
  return Array.from({ length: smallestPool }, (_, index) => ({
    key: `${index + 1}`,
    label: index === 0 ? '1 team' : `${index + 1} teams`,
  }));
}

export function advanceDescription(smallestPool: number): string {
  return `The smallest pool has ${smallestPool} teams, so up to ${smallestPool} can advance from each pool. The winners of the pools take the first seeds, then the runners-up.`;
}

export const SEEDS_HINT =
  'Seed 1 meets the lowest seed first. Move a team up or down to set the order before you create the bracket.';

export const SEEDS_NOT_SAVED_NOTE = 'The order is saved when you create the bracket.';

export const BRACKET_KEEPS_SEEDS_NOTE =
  'The bracket keeps the seeds it was created with. Recreate it to use this order.';

export const SEEDS_RESET_TEXT = 'The pool results changed, so the seeds start again from them.';

export function poolCountText(pool: Pool, advance: number, chosen: number): string {
  return `Choose ${advance} ${advance === 1 ? 'team' : 'teams'} from Pool ${pool}. ${chosen} ${chosen === 1 ? 'is' : 'are'} chosen.`;
}
