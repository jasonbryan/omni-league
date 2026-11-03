// The only writer of `teams`, `rosterEntries`, `teamInvites`, `freeAgents`, `teams.rosterCount`,
// `teams.pendingInviteCount`, and `seasons.teamCount`, so the counters, the one-place-per-season rule,
// and one pending invite per address hold for every way onto a roster.
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { RosterEntrySource } from './rosterEntry';
import { TEAM_INVITE_MESSAGES, type TeamInviteInputError } from './teamInviteInput';
import {
  TEAM_MESSAGES,
  teamSortName,
  type AlreadyFreeAgentRefusal,
  type RosterRefusal,
  type TeamNameError,
  type WaitingFreeAgentRefusal,
} from './teamInput';

type ReadCtx = Pick<QueryCtx, 'db'>;

/** More entries than one person has in one season, removed ones included. */
const ENTRIES_PER_USER_IN_SEASON_LIMIT = 100;

export const BACKFILL_TEAM_COUNT_SCAN_LIMIT = 1000;

export async function rosteredEntryInSeason(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
): Promise<Doc<'rosterEntries'> | null> {
  const entries = await ctx.db
    .query('rosterEntries')
    .withIndex('by_seasonId_and_userId', (q) => q.eq('seasonId', seasonId).eq('userId', userId))
    .take(ENTRIES_PER_USER_IN_SEASON_LIMIT);
  return entries.find((entry) => entry.status === 'rostered') ?? null;
}

export async function teamWithSortName(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  name: string,
): Promise<Doc<'teams'> | null> {
  return ctx.db
    .query('teams')
    .withIndex('by_seasonId_and_sortName', (q) =>
      q.eq('seasonId', seasonId).eq('sortName', teamSortName(name)),
    )
    .first();
}

export async function freeAgentInSeason(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
): Promise<Doc<'freeAgents'> | null> {
  return ctx.db
    .query('freeAgents')
    .withIndex('by_seasonId_and_userId', (q) => q.eq('seasonId', seasonId).eq('userId', userId))
    .unique();
}

type Refusal =
  | RosterRefusal
  | TeamNameError
  | TeamInviteInputError
  | WaitingFreeAgentRefusal
  | AlreadyFreeAgentRefusal;

function refuse(refusal: Refusal): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...refusal });
}

async function assertNotRostered(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
  teamId: Id<'teams'> | null,
): Promise<void> {
  const existing = await rosteredEntryInSeason(ctx, seasonId, userId);
  if (!existing) return;
  const team = await ctx.db.get('teams', existing.teamId);
  const teamName = team?.name ?? '';
  if (existing.teamId === teamId) {
    refuse({ code: 'alreadyOnTeam', teamName, message: TEAM_MESSAGES.alreadyOnTeam });
  }
  refuse({
    code: 'alreadyOnAnotherTeam',
    teamName,
    message: TEAM_MESSAGES.alreadyOnAnotherTeam(teamName),
  });
}

async function assertNotWaitingFreeAgent(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
): Promise<void> {
  const freeAgent = await freeAgentInSeason(ctx, seasonId, userId);
  if (freeAgent?.status !== 'waiting') return;
  refuse({ code: 'waitingFreeAgent', message: TEAM_MESSAGES.waitingFreeAgent });
}

export interface NewTeam {
  /** Already checked with `checkTeamName`. */
  name: string;
  captainUserId: Id<'users'>;
}

export async function insertTeamWithCaptain(
  ctx: MutationCtx,
  season: Doc<'seasons'>,
  { name, captainUserId }: NewTeam,
): Promise<Id<'teams'>> {
  const taken = await teamWithSortName(ctx, season._id, name);
  if (taken) {
    refuse({ field: 'name', code: 'nameTaken', message: TEAM_MESSAGES.nameTaken(taken.name) });
  }
  await assertNotRostered(ctx, season._id, captainUserId, null);
  await assertNotWaitingFreeAgent(ctx, season._id, captainUserId);
  const teamId = await ctx.db.insert('teams', {
    organizationId: season.organizationId,
    leagueId: season.leagueId,
    seasonId: season._id,
    name,
    sortName: teamSortName(name),
    captainUserId,
    rosterCount: 0,
    pendingInviteCount: 0,
    createdAt: Date.now(),
  });
  await countTeam(ctx, season._id);
  const team = await ctx.db.get('teams', teamId);
  if (!team) throw new Error('No team has this id');
  await addRosterEntry(ctx, team, {
    userId: captainUserId,
    source: 'captain',
    addedByUserId: captainUserId,
  });
  return teamId;
}

export interface NewRosterEntry {
  userId: Id<'users'>;
  source: RosterEntrySource;
  addedByUserId: Id<'users'>;
}

export async function addRosterEntry(
  ctx: MutationCtx,
  team: Doc<'teams'>,
  entry: NewRosterEntry,
): Promise<Id<'rosterEntries'>> {
  await assertNotRostered(ctx, team.seasonId, entry.userId, team._id);
  // Placement is how a waiting free agent gets onto a roster.
  if (entry.source !== 'placement') {
    await assertNotWaitingFreeAgent(ctx, team.seasonId, entry.userId);
  }
  const entryId = await ctx.db.insert('rosterEntries', {
    organizationId: team.organizationId,
    seasonId: team.seasonId,
    teamId: team._id,
    userId: entry.userId,
    status: 'rostered',
    source: entry.source,
    addedAt: Date.now(),
    addedByUserId: entry.addedByUserId,
  });
  await changeRosterCount(ctx, team._id, 1);
  return entryId;
}

export async function insertFreeAgent(
  ctx: MutationCtx,
  season: Doc<'seasons'>,
  userId: Id<'users'>,
): Promise<Doc<'freeAgents'>> {
  if (await freeAgentInSeason(ctx, season._id, userId)) {
    refuse({ code: 'alreadyFreeAgent', message: TEAM_MESSAGES.alreadyFreeAgent });
  }
  await assertNotRostered(ctx, season._id, userId, null);
  const freeAgentId = await ctx.db.insert('freeAgents', {
    organizationId: season.organizationId,
    seasonId: season._id,
    userId,
    status: 'waiting',
    registeredAt: Date.now(),
  });
  const freeAgent = await ctx.db.get('freeAgents', freeAgentId);
  if (!freeAgent) throw new Error('No free agent has this id');
  return freeAgent;
}

/** A free agent already placed on `team`: the roster entry is written first, because the writer refuses a waiting free agent any other. */
export async function insertPlacedFreeAgent(
  ctx: MutationCtx,
  team: Doc<'teams'>,
  userId: Id<'users'>,
): Promise<void> {
  if (await freeAgentInSeason(ctx, team.seasonId, userId)) {
    refuse({ code: 'alreadyFreeAgent', message: TEAM_MESSAGES.alreadyFreeAgent });
  }
  await addRosterEntry(ctx, team, {
    userId,
    source: 'placement',
    addedByUserId: team.captainUserId,
  });
  const placedAt = Date.now();
  await ctx.db.insert('freeAgents', {
    organizationId: team.organizationId,
    seasonId: team.seasonId,
    userId,
    status: 'placed',
    registeredAt: placedAt,
    placedTeamId: team._id,
    placedAt,
  });
}

export async function removeRosterEntry(
  ctx: MutationCtx,
  entry: Doc<'rosterEntries'>,
  removedByUserId: Id<'users'>,
): Promise<void> {
  const current = await ctx.db.get('rosterEntries', entry._id);
  if (current?.status !== 'rostered') return;
  await ctx.db.patch('rosterEntries', entry._id, {
    status: 'removed',
    removedAt: Date.now(),
    removedByUserId,
  });
  await changeRosterCount(ctx, entry.teamId, -1);
}

/** At most one invite to an address is pending, and it is the newest, since no other could be made after it. */
export async function pendingTeamInvite(
  ctx: ReadCtx,
  teamId: Id<'teams'>,
  email: string,
): Promise<Doc<'teamInvites'> | null> {
  const newest = await ctx.db
    .query('teamInvites')
    .withIndex('by_teamId_and_email', (q) => q.eq('teamId', teamId).eq('email', email))
    .order('desc')
    .first();
  return newest?.status === 'pending' ? newest : null;
}

export interface NewTeamInvite {
  /** Already checked with `checkTeamInviteEmail`. */
  email: string;
  tokenHash: string;
  expiresAt: number;
  invitedByUserId: Id<'users'>;
}

/** An expired invite still counts as pending, so it blocks the address until it is revoked. */
export async function insertTeamInvite(
  ctx: MutationCtx,
  team: Doc<'teams'>,
  invite: NewTeamInvite,
): Promise<Id<'teamInvites'>> {
  if (await pendingTeamInvite(ctx, team._id, invite.email)) {
    refuse({
      field: 'email',
      code: 'alreadyInvited',
      message: TEAM_INVITE_MESSAGES.alreadyInvited(invite.email),
    });
  }
  const inviteId = await ctx.db.insert('teamInvites', {
    organizationId: team.organizationId,
    seasonId: team.seasonId,
    teamId: team._id,
    email: invite.email,
    tokenHash: invite.tokenHash,
    expiresAt: invite.expiresAt,
    status: 'pending',
    invitedByUserId: invite.invitedByUserId,
    createdAt: Date.now(),
  });
  await changePendingInviteCount(ctx, team._id, 1);
  return inviteId;
}

export async function revokeTeamInvite(
  ctx: MutationCtx,
  inviteId: Id<'teamInvites'>,
): Promise<void> {
  const invite = await ctx.db.get('teamInvites', inviteId);
  if (invite?.status !== 'pending') throw new Error('Only a pending invite can be revoked');
  await ctx.db.patch('teamInvites', inviteId, { status: 'revoked' });
  await changePendingInviteCount(ctx, invite.teamId, -1);
}

/** A refused roster entry throws before anything is written, so the invite stays pending. */
export async function acceptTeamInvite(
  ctx: MutationCtx,
  inviteId: Id<'teamInvites'>,
  userId: Id<'users'>,
): Promise<Id<'rosterEntries'>> {
  const invite = await ctx.db.get('teamInvites', inviteId);
  if (invite?.status !== 'pending') throw new Error('Only a pending invite can be accepted');
  const team = await ctx.db.get('teams', invite.teamId);
  if (!team) throw new Error('No team has this id');
  const entryId = await addRosterEntry(ctx, team, {
    userId,
    source: 'invite',
    addedByUserId: invite.invitedByUserId,
  });
  await ctx.db.patch('teamInvites', inviteId, { status: 'accepted' });
  await changePendingInviteCount(ctx, team._id, -1);
  return entryId;
}

// Read fresh so a stale `Doc` cannot lose a count.
async function changePendingInviteCount(
  ctx: MutationCtx,
  teamId: Id<'teams'>,
  change: 1 | -1,
): Promise<void> {
  const team = await ctx.db.get('teams', teamId);
  if (!team) throw new Error('No team has this id');
  await ctx.db.patch('teams', teamId, {
    pendingInviteCount: (team.pendingInviteCount ?? 0) + change,
  });
}

// Read fresh so a stale `Doc` cannot lose a count.
async function changeRosterCount(
  ctx: MutationCtx,
  teamId: Id<'teams'>,
  change: 1 | -1,
): Promise<void> {
  const team = await ctx.db.get('teams', teamId);
  if (!team) throw new Error('No team has this id');
  await ctx.db.patch('teams', teamId, { rosterCount: team.rosterCount + change });
}

// An unset counter is recounted, which already includes the new team.
async function countTeam(ctx: MutationCtx, seasonId: Id<'seasons'>): Promise<void> {
  const season = await ctx.db.get('seasons', seasonId);
  if (!season) throw new Error('No season has this id');
  const teamCount =
    season.teamCount === undefined ? await recountTeams(ctx, seasonId) : season.teamCount + 1;
  await ctx.db.patch('seasons', seasonId, { teamCount });
}

async function recountTeams(ctx: ReadCtx, seasonId: Id<'seasons'>): Promise<number> {
  const teams = await ctx.db
    .query('teams')
    .withIndex('by_seasonId_and_sortName', (q) => q.eq('seasonId', seasonId))
    .take(BACKFILL_TEAM_COUNT_SCAN_LIMIT);
  return teams.length;
}

export async function backfillSeasonTeamCounts(ctx: MutationCtx): Promise<number> {
  let backfilled = 0;
  for (const season of await ctx.db.query('seasons').take(BACKFILL_TEAM_COUNT_SCAN_LIMIT)) {
    if (season.teamCount !== undefined) continue;
    await ctx.db.patch('seasons', season._id, { teamCount: await recountTeams(ctx, season._id) });
    backfilled++;
  }
  return backfilled;
}

/** A team written before invites existed has none, so its count is 0. */
export async function backfillTeamPendingInviteCounts(ctx: MutationCtx): Promise<number> {
  let backfilled = 0;
  for (const team of await ctx.db.query('teams').take(BACKFILL_TEAM_COUNT_SCAN_LIMIT)) {
    if (team.pendingInviteCount !== undefined) continue;
    await ctx.db.patch('teams', team._id, { pendingInviteCount: 0 });
    backfilled++;
  }
  return backfilled;
}
