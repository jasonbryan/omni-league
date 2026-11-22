// The loaded season page and its skeleton share these, so a wrapped name takes the same height in both.

import { CRUMB_BOX } from './public-league-header-classes';

export const SEASON_CRUMB_LINK = `${CRUMB_BOX} hover:underline`;

export const SEASON_CRUMB_CURRENT = `${CRUMB_BOX} text-foreground`;

export const SEASON_HEADING = 'mt-3 text-3xl font-semibold tracking-tight text-balance md:text-5xl';

const REGISTRATION_CARD = 'p-5 md:p-6 lg:sticky lg:top-24 lg:min-h-0';

/**
 * Below 1024px the card sits above the details, and the team card replaces the server's signed-out card after hydration. The signed-out card
 * stays in the card behind the team card, so the card is never shorter than it; these floors cover the team card when it is the taller one.
 * A full season is still open for registration, so a captain below the minimum gets the open team card.
 */
export const REGISTRATION_CARD_CLASS = {
  open: `min-h-66 sm:min-h-58 ${REGISTRATION_CARD}`,
  full: `min-h-66 sm:min-h-58 ${REGISTRATION_CARD}`,
  closed: `min-h-47 md:min-h-49 ${REGISTRATION_CARD}`,
} as const;

/** `visibility` animates, so a button's `transition-all` would keep it visible for 150 ms; `**:transition-none` hides the buttons in the frame of the swap. */
export const SIGNED_OUT_CARD_BEHIND_TEAM = 'invisible **:transition-none';
