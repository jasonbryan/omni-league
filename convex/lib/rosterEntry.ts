import { v, type Infer } from 'convex/values';

export const rosterEntryStatusValidator = v.union(v.literal('rostered'), v.literal('removed'));

export type RosterEntryStatus = Infer<typeof rosterEntryStatusValidator>;

export const rosterEntrySourceValidator = v.union(
  v.literal('captain'),
  v.literal('invite'),
  v.literal('placement'),
);

export type RosterEntrySource = Infer<typeof rosterEntrySourceValidator>;
