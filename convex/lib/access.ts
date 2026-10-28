import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { forbidden } from './forbidden';
import { getCurrentUser } from './users';

type Ctx = Pick<QueryCtx | MutationCtx, 'auth' | 'db'>;

export interface Authorized {
  user: Doc<'users'>;
  membership: Doc<'memberships'>;
}

export async function requireUser(ctx: Ctx): Promise<Doc<'users'>> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error('Sign in required');
  return user;
}

async function membershipOf(
  ctx: Ctx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
): Promise<Doc<'memberships'> | null> {
  return ctx.db
    .query('memberships')
    .withIndex('by_userId_and_organizationId', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .unique();
}

export async function requireOrgAdmin(
  ctx: Ctx,
  organizationId: Id<'organizations'>,
): Promise<Authorized> {
  const user = await requireUser(ctx);
  const membership = await membershipOf(ctx, user._id, organizationId);
  if (membership?.role !== 'orgAdmin') throw new Error('Not allowed');
  return { user, membership };
}

export async function requireOrgAdminOrForbidden(
  ctx: Ctx,
  organizationId: Id<'organizations'>,
): Promise<Authorized> {
  const user = await getCurrentUser(ctx);
  if (!user) throw forbidden();
  const membership = await membershipOf(ctx, user._id, organizationId);
  if (membership?.role !== 'orgAdmin') throw forbidden();
  return { user, membership };
}

export async function isOrgAdmin(ctx: Ctx, organizationId: Id<'organizations'>): Promise<boolean> {
  const user = await getCurrentUser(ctx);
  if (!user) return false;
  const membership = await membershipOf(ctx, user._id, organizationId);
  return membership?.role === 'orgAdmin';
}

export async function requireLocationAdmin(
  ctx: Ctx,
  locationId: Id<'locations'>,
): Promise<Authorized & { location: Doc<'locations'> }> {
  const user = await requireUser(ctx);
  const location = await ctx.db.get('locations', locationId);
  if (!location) throw new Error('Not allowed');
  const membership = await membershipOf(ctx, user._id, location.organizationId);
  if (membership?.role !== 'orgAdmin') throw new Error('Not allowed');
  return { user, membership, location };
}

function mayOrganizeLeague(membership: Doc<'memberships'>, leagueId: Id<'leagues'>): boolean {
  return membership.role === 'orgAdmin' || membership.leagueIds.includes(leagueId);
}

export async function requireLeagueOrganizerOrForbidden(
  ctx: Ctx,
  league: Doc<'leagues'>,
): Promise<Authorized | null> {
  const user = await getCurrentUser(ctx);
  const membership = user ? await membershipOf(ctx, user._id, league.organizationId) : null;
  // A draft answers null to anyone outside the staff, so nobody learns that its slug exists.
  if (league.status !== 'published' && !membership) return null;
  if (!user || !membership || !mayOrganizeLeague(membership, league._id)) throw forbidden();
  return { user, membership };
}

export async function requireLeagueOrganizer(
  ctx: Ctx,
  leagueId: Id<'leagues'>,
): Promise<Authorized & { league: Doc<'leagues'> }> {
  const user = await requireUser(ctx);
  const league = await ctx.db.get('leagues', leagueId);
  if (!league) throw new Error('Not allowed');
  const membership = await membershipOf(ctx, user._id, league.organizationId);
  if (!membership || !mayOrganizeLeague(membership, leagueId)) throw new Error('Not allowed');
  return { user, membership, league };
}
