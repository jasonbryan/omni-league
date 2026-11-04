import { v, type Infer } from 'convex/values';

export const waitlistEntryStatusValidator = v.union(v.literal('waiting'), v.literal('promoted'));

export type WaitlistEntryStatus = Infer<typeof waitlistEntryStatusValidator>;

/** Positions and the organizer's list read at most this many waiting entries. */
export const WAITLIST_READ_LIMIT = 200;
