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

// Must list exactly the format keys in `SPORT_FORMATS`; a unit test checks that.
export const formatValidator = v.union(
  v.literal('2v2'),
  v.literal('4v4'),
  v.literal('6v6'),
  v.literal('5v5'),
  v.literal('7v7'),
  v.literal('11v11'),
  v.literal('10v10'),
);

export type Format = Infer<typeof formatValidator>;

export interface SportFormat {
  readonly key: Format;
  readonly name: string;
  readonly minimumRosterSize: number;
}

export const SPORT_FORMATS: Readonly<Record<Sport, readonly SportFormat[]>> = {
  beachVolleyball: [
    { key: '2v2', name: '2v2', minimumRosterSize: 2 },
    { key: '4v4', name: '4v4', minimumRosterSize: 4 },
    { key: '6v6', name: '6v6', minimumRosterSize: 6 },
  ],
  soccer: [
    { key: '5v5', name: '5v5', minimumRosterSize: 5 },
    { key: '7v7', name: '7v7', minimumRosterSize: 7 },
    { key: '11v11', name: '11v11', minimumRosterSize: 11 },
  ],
  softball: [{ key: '10v10', name: '10v10', minimumRosterSize: 10 }],
};

export const ROSTER_SIZE_INPUT_MAX = 99;

function findFormat(sport: Sport, format: Format): SportFormat | undefined {
  return SPORT_FORMATS[sport].find((candidate) => candidate.key === format);
}

export function isFormatOfSport(sport: Sport, format: Format): boolean {
  return findFormat(sport, format) !== undefined;
}

export function formatMinimumRosterSize(sport: Sport, format: Format): number {
  const found = findFormat(sport, format);
  if (found === undefined) {
    throw new Error(`Format ${format} is not a format of ${sport}`);
  }
  return found.minimumRosterSize;
}

export function formatName(sport: Sport, format: Format): string {
  const found = findFormat(sport, format);
  if (found === undefined) {
    throw new Error(`Format ${format} is not a format of ${sport}`);
  }
  return found.name;
}
