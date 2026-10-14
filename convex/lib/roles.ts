import { v, type Infer } from 'convex/values';

export const roleValidator = v.union(v.literal('orgAdmin'), v.literal('leagueOrganizer'));

export type Role = Infer<typeof roleValidator>;
