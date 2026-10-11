import { v, type Infer } from 'convex/values';

/**
 * Where a staff invite stands (#67, glossary: Invite). `pending` until an org admin revokes it or
 * the invited person accepts it (#70); the other two are final. An invite whose expiry has passed
 * stays `pending`: expiry is a time, not a status, so it keeps blocking a new invite to the same
 * address until it is revoked.
 */
export const inviteStatusValidator = v.union(
  v.literal('pending'),
  v.literal('revoked'),
  v.literal('accepted'),
);

export type InviteStatus = Infer<typeof inviteStatusValidator>;
