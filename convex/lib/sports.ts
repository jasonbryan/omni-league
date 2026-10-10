import { v, type Infer } from 'convex/values';

/**
 * The sports at launch (requirements, Sports) with their display names. The sport configuration
 * lives in this file: each sport's formats and their minimum roster sizes are configured below.
 * Scoring and standings arrive with the features that use them.
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

/**
 * A format key as stored on a season. It must list exactly the format keys in `SPORT_FORMATS`;
 * a unit test checks that.
 */
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

/** One way a sport is played: the players on the field set the minimum roster size. */
export interface SportFormat {
  readonly key: Format;
  /** Placeholder display name; the season mockup (#125) may change the wording. */
  readonly name: string;
  /** The fewest roster entries a team needs. An organization may raise it, never lower it. */
  readonly minimumRosterSize: number;
}

/**
 * The formats of each sport and their minimum roster sizes (requirements, Payments, rule 3: the
 * number of players on the field; an organization may raise it but not lower it).
 */
export const SPORT_FORMATS: Readonly<Record<Sport, readonly SportFormat[]>> = {
  beachVolleyball: [
    { key: '2v2', name: '2 v 2', minimumRosterSize: 2 },
    { key: '4v4', name: '4 v 4', minimumRosterSize: 4 },
    { key: '6v6', name: '6 v 6', minimumRosterSize: 6 },
  ],
  soccer: [
    { key: '5v5', name: '5 v 5', minimumRosterSize: 5 },
    { key: '7v7', name: '7 v 7', minimumRosterSize: 7 },
    { key: '11v11', name: '11 v 11', minimumRosterSize: 11 },
  ],
  softball: [{ key: '10v10', name: '10 v 10', minimumRosterSize: 10 }],
};

/**
 * The largest number either roster-size field accepts: the organizer's raised minimum (#125) and
 * the maximum roster size (#144). It is an input bound, not a product limit.
 */
export const ROSTER_SIZE_INPUT_MAX = 99;

function findFormat(sport: Sport, format: Format): SportFormat | undefined {
  return SPORT_FORMATS[sport].find((candidate) => candidate.key === format);
}

/** Whether the format is one of the sport's formats. */
export function isFormatOfSport(sport: Sport, format: Format): boolean {
  return findFormat(sport, format) !== undefined;
}

/** The minimum roster size of a format. Throws for a format of another sport. */
export function formatMinimumRosterSize(sport: Sport, format: Format): number {
  const found = findFormat(sport, format);
  if (found === undefined) {
    throw new Error(`Format ${format} is not a format of ${sport}`);
  }
  return found.minimumRosterSize;
}

/** The display name of a format. Throws for a format of another sport. */
export function formatName(sport: Sport, format: Format): string {
  const found = findFormat(sport, format);
  if (found === undefined) {
    throw new Error(`Format ${format} is not a format of ${sport}`);
  }
  return found.name;
}
