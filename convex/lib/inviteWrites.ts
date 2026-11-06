import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { InviteStatus } from './inviteStatus';
import { BACKFILL_SCAN_LIMIT } from './tenantWrites';

// Every writer of `invites` rows goes through here, so `organizations.pendingInviteCount` stays equal to their `pending` ones, expired included; a new writer does too.

export type PendingInviteFields = Omit<
  Doc<'invites'>,
  '_id' | '_creationTime' | 'status' | 'revokedAt'
>;

export interface InviteStatusPatch {
  status: InviteStatus;
  revokedAt?: number | undefined;
}

export async function recountPendingInvites(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
): Promise<number> {
  const rows = await ctx.db
    .query('invites')
    .withIndex('by_organizationId_and_status', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'pending'),
    )
    .take(BACKFILL_SCAN_LIMIT);
  return rows.length;
}

// Called after the row changed, so an unset counter's recount already includes the change.
async function changePendingInviteCount(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
  change: 1 | -1,
): Promise<void> {
  const organization = await ctx.db.get('organizations', organizationId);
  // A gone organization has no counter, and a throw would roll back the write that reached here.
  if (!organization) return;
  const pendingInviteCount =
    organization.pendingInviteCount === undefined
      ? await recountPendingInvites(ctx, organizationId)
      : Math.max(0, organization.pendingInviteCount + change);
  await ctx.db.patch('organizations', organizationId, { pendingInviteCount });
}

export async function insertPendingInvite(
  ctx: Pick<MutationCtx, 'db'>,
  fields: PendingInviteFields,
): Promise<Id<'invites'>> {
  const inviteId = await ctx.db.insert('invites', { ...fields, status: 'pending' });
  await changePendingInviteCount(ctx, fields.organizationId, 1);
  return inviteId;
}

// The invite is read here, not taken from the caller, so a stale read cannot move the count twice.
export async function setInviteStatus(
  ctx: Pick<MutationCtx, 'db'>,
  inviteId: Id<'invites'>,
  patch: InviteStatusPatch,
): Promise<void> {
  const invite = await ctx.db.get('invites', inviteId);
  if (!invite) throw new Error('No invite has this id');
  await ctx.db.patch('invites', inviteId, patch);
  const wasPending = invite.status === 'pending';
  const isPending = patch.status === 'pending';
  if (wasPending !== isPending) {
    await changePendingInviteCount(ctx, invite.organizationId, isPending ? 1 : -1);
  }
}

export async function backfillPendingInviteCounts(ctx: Pick<MutationCtx, 'db'>): Promise<number> {
  let backfilled = 0;
  for (const organization of await ctx.db.query('organizations').take(BACKFILL_SCAN_LIMIT)) {
    if (organization.pendingInviteCount !== undefined) continue;
    await ctx.db.patch('organizations', organization._id, {
      pendingInviteCount: await recountPendingInvites(ctx, organization._id),
    });
    backfilled++;
  }
  return backfilled;
}
