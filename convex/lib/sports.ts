import { v, type Infer } from 'convex/values';

export const SPORT_NAMES = {
  beachVolleyball: 'Beach volleyball',
  soccer: 'Soccer',
  softball: 'Softball',
} as const;

export const sportValidator = v.union(
  v.literal('beachVolleyball'),
  v.literal('soccer'),
  v.literal('softball'),
);

export type Sport = Infer<typeof sportValidator>;

export function sportName(sport: Sport): string {
  return SPORT_NAMES[sport];
}

export const SPORT_SEGMENTS: Readonly<Record<Sport, string>> = {
  beachVolleyball: 'beach-volleyball',
  soccer: 'soccer',
  softball: 'softball',
};

export function sportSegment(sport: Sport): string {
  return SPORT_SEGMENTS[sport];
}

export function sportFromSegment(segment: string): Sport | undefined {
  return (Object.keys(SPORT_SEGMENTS) as Sport[]).find(
    (sport) => SPORT_SEGMENTS[sport] === segment,
  );
}

export const sportCountsValidator = v.object({
  beachVolleyball: v.optional(v.number()),
  soccer: v.optional(v.number()),
  softball: v.optional(v.number()),
});

export type SportCounts = Infer<typeof sportCountsValidator>;

export const ROSTER_SIZE_INPUT_MAX = 99;
