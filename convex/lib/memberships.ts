// Writes of `memberships` rows (#64). Authorization reads them in convex/lib/access.ts.
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { Role } from './roles';

/**
 * Gives `userId` a role in `organizationId`, with `leagueIds` assigned (none by default, and none
 * for an org admin). The caller makes sure the user has no membership there yet: at most one
 * exists per user and organization.
 */
export async function insertMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
  role: Role,
  leagueIds: Id<'leagues'>[] = [],
): Promise<Id<'memberships'>> {
  return ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
}

/** Makes `userId` an org admin of `organizationId`: the creator of a new organization. */
export async function insertOrgAdminMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
): Promise<Id<'memberships'>> {
  return insertMembership(ctx, userId, organizationId, 'orgAdmin');
}
