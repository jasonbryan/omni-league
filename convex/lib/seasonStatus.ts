import { v, type Infer } from 'convex/values';

/**
 * Where a season stands (#125, glossary: Draft, Published). A new season is a `draft`, seen only
 * by its organization's staff; #126 publishes it, which puts it on the league's public page.
 */
export const seasonStatusValidator = v.union(v.literal('draft'), v.literal('published'));

export type SeasonStatus = Infer<typeof seasonStatusValidator>;
