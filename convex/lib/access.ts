// Shared authorization for staff functions (#64, convex.md, Functions). Every function that
// manages an organization or a league calls one of these first and uses the `Doc`s it returns;
// nothing trusts an id or a role passed in `args`.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { getCurrentUser } from './users';

type Ctx = Pick<QueryCtx | MutationCtx, 'auth' | 'db'>;

/** A caller who is signed in, with their `users` row and the membership that let them pass. */
export interface Authorized {
  user: Doc<'users'>;
  membership: Doc<'memberships'>;
}

/** The caller's `users` row. Throws `Sign in required` with no identity or no row. */
export async function requireUser(ctx: Ctx): Promise<Doc<'users'>> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error('Sign in required');
  return user;
}

/** The user's membership in `organizationId`, or `null`. At most one exists per user and organization. */
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

/**
 * Passes only an org admin of `organizationId`. Throws `Sign in required` for a caller who is not
 * signed in, and `Not allowed` for anyone else: a non-member, a league organizer, or an org admin
 * of another organization.
 */
export async function requireOrgAdmin(
  ctx: Ctx,
  organizationId: Id<'organizations'>,
): Promise<Authorized> {
  const user = await requireUser(ctx);
  const membership = await membershipOf(ctx, user._id, organizationId);
  if (membership?.role !== 'orgAdmin') throw new Error('Not allowed');
  return { user, membership };
}

/**
 * Passes an org admin of the league's organization, and a league organizer to whom the league is
 * assigned. It loads the league and looks up the caller's membership in that league's
 * organization, so a membership elsewhere never counts. Throws `Sign in required` for a caller who
 * is not signed in, and `Not allowed` for anyone else, also when the league does not exist.
 */
export async function requireLeagueOrganizer(
  ctx: Ctx,
  leagueId: Id<'leagues'>,
): Promise<Authorized> {
  const user = await requireUser(ctx);
  const league = await ctx.db.get('leagues', leagueId);
  if (!league) throw new Error('Not allowed');
  const membership = await membershipOf(ctx, user._id, league.organizationId);
  if (
    !membership ||
    (membership.role === 'leagueOrganizer' && !membership.leagueIds.includes(leagueId))
  ) {
    throw new Error('Not allowed');
  }
  return { user, membership };
}
