import { v, type Infer } from 'convex/values';

export const leagueStatusValidator = v.union(v.literal('draft'), v.literal('published'));

export type LeagueStatus = Infer<typeof leagueStatusValidator>;
