import { v, type Infer } from 'convex/values';

// Expiry is a time, not a status: an expired invite stays `pending` until it is revoked.
export const inviteStatusValidator = v.union(
  v.literal('pending'),
  v.literal('revoked'),
  v.literal('accepted'),
);

export type InviteStatus = Infer<typeof inviteStatusValidator>;
