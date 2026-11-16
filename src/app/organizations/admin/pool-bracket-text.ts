import type { Pool } from '../../../../convex/lib/pools';
import type { ChipOption } from './chip-radio-group';

const ordinals = new Intl.PluralRules('en-US', { type: 'ordinal' });
const SUFFIXES: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };

export function placeText(pool: Pool, place: number): string {
  return `Pool ${pool}, ${place}${SUFFIXES[ordinals.select(place)]}`;
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
