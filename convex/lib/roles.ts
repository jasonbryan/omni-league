import { v, type Infer } from 'convex/values';

/**
 * A staff role in one organization (glossary: Membership). An `orgAdmin` manages everything in the
 * organization; a `leagueOrganizer` runs only the leagues assigned to them.
 */
export const roleValidator = v.union(v.literal('orgAdmin'), v.literal('leagueOrganizer'));

export type Role = Infer<typeof roleValidator>;
