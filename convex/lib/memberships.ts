// Writes of `memberships` rows (#64). Authorization reads them in convex/lib/access.ts.
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/** Makes `userId` an org admin of `organizationId`: the creator of a new organization. */
export async function insertOrgAdminMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
): Promise<Id<'memberships'>> {
  return ctx.db.insert('memberships', {
    userId,
    organizationId,
    role: 'orgAdmin',
    leagueIds: [],
  });
}
