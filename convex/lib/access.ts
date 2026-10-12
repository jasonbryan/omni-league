// Shared authorization for staff functions (#64, convex.md, Functions). Every function that
// manages an organization or a league calls one of these first and uses the `Doc`s it returns;
// nothing trusts an id or a role passed in `args`.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { forbidden } from './forbidden';
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
 * Like `requireOrgAdmin`, for a query the admin area asks first (#65): every caller who is not an
 * org admin of `organizationId`, signed in or not, gets the same `FORBIDDEN` `ConvexError` (see
 * `forbidden.ts`), which the app tells apart from a failed query to show the no-access view.
 */
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

/**
 * Passes an org admin of the location's organization and returns the stored location (#65). The
 * organization comes from the location, never from `args`, so an id of another organization's
 * location is refused to this organization's admin. Throws `Sign in required` for a caller who is
 * not signed in, and `Not allowed` for anyone else, also when the location does not exist.
 */
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

/**
 * Whether a membership in the league's organization may organize the league: an org admin, or a
 * league organizer to whom the league is assigned.
 */
function mayOrganizeLeague(membership: Doc<'memberships'>, leagueId: Id<'leagues'>): boolean {
  return membership.role === 'orgAdmin' || membership.leagueIds.includes(leagueId);
}

/**
 * For the query a league page asks first (#125, `leagues.getOrganizerContext`): passes an org
 * admin of the league's organization and a league organizer to whom the league is assigned, as
 * `requireLeagueOrganizer` does, but answers by who is asking:
 *
 * - `null` when the league is a draft (or has no status) and the caller is not staff of its
 *   organization, whether signed in or not, so nobody outside the staff learns that a draft's
 *   slug exists. The caller answers `null` as for an unknown league.
 * - A `FORBIDDEN` `ConvexError` (`forbidden.ts`) for every other caller who may not organize the
 *   league: not signed in, a member of none, an org admin of another organization, or a league
 *   organizer of another league (also of a draft, because they are staff of the organization).
 */
export async function requireLeagueOrganizerOrForbidden(
  ctx: Ctx,
  league: Doc<'leagues'>,
): Promise<Authorized | null> {
  const user = await getCurrentUser(ctx);
  const membership = user ? await membershipOf(ctx, user._id, league.organizationId) : null;
  if (league.status !== 'published' && !membership) return null;
  if (!user || !membership || !mayOrganizeLeague(membership, league._id)) throw forbidden();
  return { user, membership };
}

/**
 * Passes an org admin of the league's organization, and a league organizer to whom the league is
 * assigned. It loads the league and looks up the caller's membership in that league's
 * organization, so a membership elsewhere never counts. Throws `Sign in required` for a caller who
 * is not signed in, and `Not allowed` for anyone else, also when the league does not exist. It
 * returns the stored league, so the caller need not read it again.
 */
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
