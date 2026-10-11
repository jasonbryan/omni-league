import { v, type Infer } from 'convex/values';

/**
 * Where a league stands (#66, glossary: Draft, Published). A new league is a `draft`, seen only by
 * its organization's staff; #69 publishes it, which puts it on the public pages and in their
 * counters. A stored league without a status was written before #66: `seed:demo` sets `published`
 * on it once, and no reader treats a missing status as published.
 */
export const leagueStatusValidator = v.union(v.literal('draft'), v.literal('published'));

export type LeagueStatus = Infer<typeof leagueStatusValidator>;
