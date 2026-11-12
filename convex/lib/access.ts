import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { forbidden, forbiddenTournamentTeam } from './forbidden';
import { adultEntryInTournament, isMinorEntry, rosteredEntriesInSeason } from './rosterWrites';
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

export async function hasOrgAdminRole(
  ctx: Ctx,
  organizationId: Id<'organizations'>,
): Promise<boolean> {
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

export async function organizesLeague(
  ctx: Ctx,
  userId: Id<'users'>,
  league: Doc<'leagues'>,
): Promise<boolean> {
  const membership = await membershipOf(ctx, userId, league.organizationId);
  return membership !== null && mayOrganizeLeague(membership, league._id);
}

export interface TeamReader {
  user: Doc<'users'>;
  /** The team the caller plays on in the season, null for a guardian or organizer on no roster. */
  ownTeamId: Id<'teams'> | null;
  /** Every team of the season with the caller's own entry or a minor's entry under them. */
  rosteredTeamIds: ReadonlySet<Id<'teams'>>;
  organizes: boolean;
}

/** Teams in a season see each other's rosters (requirements, Payments, rule 6), as do the league's organizers. A guardian of a minor is on the minor's team. */
export async function requireSeasonMemberOrOrganizer(
  ctx: Ctx,
  team: Doc<'teams'>,
  league: Doc<'leagues'>,
): Promise<TeamReader> {
  const user = await getCurrentUser(ctx);
  if (!user || team.seasonId === undefined) throw forbidden();
  const entries = await rosteredEntriesInSeason(ctx, team.seasonId, user._id);
  const organizes = await organizesLeague(ctx, user._id, league);
  if (entries.length === 0 && !organizes) throw forbidden();
  return {
    user,
    ownTeamId: entries.find((entry) => !isMinorEntry(entry))?.teamId ?? null,
    rosteredTeamIds: new Set(entries.map((entry) => entry.teamId)),
    organizes,
  };
}

/** A tournament team is seen by the people on it and the organization's admins; other teams in the tournament do not see its roster. */
export async function requireTournamentTeamMemberOrAdmin(
  ctx: Ctx,
  team: Doc<'teams'>,
): Promise<TeamReader> {
  const user = await getCurrentUser(ctx);
  if (!user || team.tournamentId === undefined) throw forbidden();
  const own = await adultEntryInTournament(ctx, team.tournamentId, user._id);
  const ownTeamId = own?.teamId === team._id ? team._id : null;
  const organizes = await isOrgAdmin(ctx, user._id, team.organizationId);
  if (ownTeamId === null && !organizes) throw forbiddenTournamentTeam();
  return {
    user,
    ownTeamId,
    rosteredTeamIds: new Set(ownTeamId ? [ownTeamId] : []),
    organizes,
  };
}

async function isOrgAdmin(
  ctx: Ctx,
  userId: Id<'users'>,
  organizationId: Id<'organizations'>,
): Promise<boolean> {
  const membership = await membershipOf(ctx, userId, organizationId);
  return membership?.role === 'orgAdmin';
}

export async function canManageTournamentTeam(
  ctx: Ctx,
  userId: Id<'users'>,
  team: Doc<'teams'>,
): Promise<boolean> {
  return team.captainUserId === userId || (await isOrgAdmin(ctx, userId, team.organizationId));
}

export async function canManageTeam(
  ctx: Ctx,
  userId: Id<'users'>,
  team: Doc<'teams'>,
  league: Doc<'leagues'>,
): Promise<boolean> {
  return team.captainUserId === userId || (await organizesLeague(ctx, userId, league));
}

export async function requireTeamManager(ctx: Ctx, team: Doc<'teams'>): Promise<Doc<'users'>> {
  const user = await requireUser(ctx);
  const league = team.leagueId ? await ctx.db.get('leagues', team.leagueId) : null;
  if (!league || !(await canManageTeam(ctx, user._id, team, league)))
    throw new Error('Not allowed');
  return user;
}

async function organizerOrForbidden(
  ctx: Ctx,
  league: Doc<'leagues'>,
  isDraft: boolean,
): Promise<Authorized | null> {
  const user = await getCurrentUser(ctx);
  const membership = user ? await membershipOf(ctx, user._id, league.organizationId) : null;
  // A draft answers null to anyone outside the staff, so nobody learns that its slug exists.
  if (isDraft && !membership) return null;
  if (!user || !membership || !mayOrganizeLeague(membership, league._id)) throw forbidden();
  return { user, membership };
}

export async function requireLeagueOrganizerOrForbidden(
  ctx: Ctx,
  league: Doc<'leagues'>,
): Promise<Authorized | null> {
  return organizerOrForbidden(ctx, league, league.status !== 'published');
}

/** As `requireLeagueOrganizerOrForbidden`, with a draft season of a published league kept from outsiders too. */
export async function requireSeasonOrganizerOrForbidden(
  ctx: Ctx,
  league: Doc<'leagues'>,
  season: Doc<'seasons'>,
): Promise<Authorized | null> {
  return organizerOrForbidden(
    ctx,
    league,
    league.status !== 'published' || season.status !== 'published',
  );
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
