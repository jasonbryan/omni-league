import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { Role } from './roles';

export async function insertMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
  role: Role,
  leagueIds: Id<'leagues'>[] = [],
): Promise<Id<'memberships'>> {
  return ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
}

export async function insertOrgAdminMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
): Promise<Id<'memberships'>> {
  return insertMembership(ctx, userId, organizationId, 'orgAdmin');
}
