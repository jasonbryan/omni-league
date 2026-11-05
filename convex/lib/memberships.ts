import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Role } from './roles';
import { BACKFILL_SCAN_LIMIT } from './tenantWrites';

// Every writer of `memberships` rows goes through here, so `organizations.staffCount` stays equal to their count; a new writer does too.

const USER_MEMBERSHIPS_BATCH = 100;

export async function recountMemberships(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
): Promise<number> {
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
    .take(BACKFILL_SCAN_LIMIT);
  return rows.length;
}

// Called after the row changed, so an unset counter's recount already includes the change.
async function changeStaffCount(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
  change: 1 | -1,
): Promise<void> {
  const organization = await ctx.db.get('organizations', organizationId);
  if (!organization) throw new Error('No organization has this id');
  const staffCount =
    organization.staffCount === undefined
      ? await recountMemberships(ctx, organizationId)
      : Math.max(0, organization.staffCount + change);
  await ctx.db.patch('organizations', organizationId, { staffCount });
}

export async function insertMembership(
  ctx: Pick<MutationCtx, 'db'>,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
  role: Role,
  leagueIds: Id<'leagues'>[] = [],
): Promise<Id<'memberships'>> {
  const membershipId = await ctx.db.insert('memberships', {
    userId,
    organizationId,
    role,
    leagueIds,
  });
  await changeStaffCount(ctx, organizationId, 1);
  return membershipId;
}

export async function insertOrgAdminMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
): Promise<Id<'memberships'>> {
  return insertMembership(ctx, userId, organizationId, 'orgAdmin');
}

export async function deleteMembership(
  ctx: Pick<MutationCtx, 'db'>,
  membership: Doc<'memberships'>,
): Promise<void> {
  await ctx.db.delete('memberships', membership._id);
  await changeStaffCount(ctx, membership.organizationId, -1);
}

export async function deleteUserMemberships(
  ctx: Pick<MutationCtx, 'db'>,
  userId: Id<'users'>,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', userId))
      .take(USER_MEMBERSHIPS_BATCH);
    for (const membership of batch) await deleteMembership(ctx, membership);
    if (batch.length < USER_MEMBERSHIPS_BATCH) return;
  }
}

export async function backfillStaffCounts(ctx: Pick<MutationCtx, 'db'>): Promise<number> {
  let backfilled = 0;
  for (const organization of await ctx.db.query('organizations').take(BACKFILL_SCAN_LIMIT)) {
    if (organization.staffCount !== undefined) continue;
    await ctx.db.patch('organizations', organization._id, {
      staffCount: await recountMemberships(ctx, organization._id),
    });
    backfilled++;
  }
  return backfilled;
}
