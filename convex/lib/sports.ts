import { v, type Infer } from 'convex/values';

/**
 * The sports at launch (requirements, Sports) with their display names. Display names only: the
 * sport configuration (scoring, team sizes, standings) arrives with the features that use it.
 */
export const SPORT_NAMES = {
  beachVolleyball: 'Beach volleyball',
  soccer: 'Soccer',
  softball: 'Softball',
} as const;

/** A sport key as stored on a league. */
export const sportValidator = v.union(
  v.literal('beachVolleyball'),
  v.literal('soccer'),
  v.literal('softball'),
);

export type Sport = Infer<typeof sportValidator>;

/** The display name of a sport, for public pages. */
export function sportName(sport: Sport): string {
  return SPORT_NAMES[sport];
}
