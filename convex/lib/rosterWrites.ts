// The only writer of `teams`, `rosterEntries`, `teamInvites`, `freeAgents`, `waitlistEntries`, `teams.rosterCount`,
// `teams.pendingInviteCount`, `seasons.teamCount`, `seasons.waitlistCount`, `seasons.maxTeams`, and `seasons.maxRosterSize`
// once the season exists, so the counters, the team and roster limits, the one-place-per-season rule, and one
// pending invite per address hold for every way onto a roster.
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  MAX_MINORS_PER_GUARDIAN_IN_SEASON,
  MINOR_MESSAGES,
  minorNameKey,
  type MinorInSeasonRefusal,
  type MinorLimitRefusal,
  type NothingChosenRefusal,
} from './minorName';
import type { RosterEntrySource } from './rosterEntry';
import { WAITLIST_READ_LIMIT } from './waitlist';
import {
  checkMaxRosterSizeFor,
  SEASON_MESSAGES,
  seasonHasRoom,
  seasonIsFull,
  teamIsFull,
  type SeasonInputError,
} from './seasonInput';
import { TEAM_INVITE_MESSAGES, type TeamInviteInputError } from './teamInviteInput';
import {
  TEAM_MESSAGES,
  teamSortName,
  type AlreadyFreeAgentRefusal,
  type AlreadyPlacedRefusal,
  type AlreadyPromotedRefusal,
  type NoRoomRefusal,
  type OnWaitlistRefusal,
  type RosterRefusal,
  type SeasonFullRefusal,
  type TeamFullRefusal,
  type TeamNameError,
  type WaitingFreeAgentRefusal,
} from './teamInput';

type ReadCtx = Pick<QueryCtx, 'db'>;

export const BACKFILL_TEAM_COUNT_SCAN_LIMIT = 1000;

export function isMinorEntry(entry: Doc<'rosterEntries'>): boolean {
  return entry.minorName !== undefined;
}

/** A minor's entry carries the guardian's user id, so only an entry without `minorName` places the person themself. */
export async function adultEntryInSeason(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
): Promise<Doc<'rosterEntries'> | null> {
  return ctx.db
    .query('rosterEntries')
    .withIndex('by_seasonId_and_userId_and_minorName_and_status', (q) =>
      q
        .eq('seasonId', seasonId)
        .eq('userId', userId)
        .eq('minorName', undefined)
        .eq('status', 'rostered'),
    )
    .first();
}

/** Removed ones included; `addMinorEntry` keeps them within `MAX_MINORS_PER_GUARDIAN_IN_SEASON`. */
async function minorEntriesInSeason(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  guardianUserId: Id<'users'>,
): Promise<Doc<'rosterEntries'>[]> {
  return ctx.db
    .query('rosterEntries')
    .withIndex('by_seasonId_and_userId_and_minorName_and_status', (q) =>
      q.eq('seasonId', seasonId).eq('userId', guardianUserId).gte('minorName', ''),
    )
    .take(MAX_MINORS_PER_GUARDIAN_IN_SEASON);
}

export async function rosteredEntriesInSeason(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
): Promise<Doc<'rosterEntries'>[]> {
  const adult = await adultEntryInSeason(ctx, seasonId, userId);
  const minors = await minorEntriesInSeason(ctx, seasonId, userId);
  const rosteredMinors = minors.filter((entry) => entry.status === 'rostered');
  return adult ? [adult, ...rosteredMinors] : rosteredMinors;
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

/** Every way onto a roster or a waitlist refuses a waiting captain, so a waiting entry, when there is one, is the caller's newest. */
export async function waitingEntryInSeason(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
): Promise<Doc<'waitlistEntries'> | null> {
  const newest = await ctx.db
    .query('waitlistEntries')
    .withIndex('by_seasonId_and_userId', (q) => q.eq('seasonId', seasonId).eq('userId', userId))
    .order('desc')
    .first();
  return newest?.status === 'waiting' ? newest : null;
}

/** 1 plus the waiting entries requested before this one; past the read limit it is the limit plus 1. */
export async function waitlistPosition(
  ctx: ReadCtx,
  entry: Doc<'waitlistEntries'>,
): Promise<number> {
  const upTo = await ctx.db
    .query('waitlistEntries')
    .withIndex('by_seasonId_and_status_and_requestedAt', (q) =>
      q
        .eq('seasonId', entry.seasonId)
        .eq('status', 'waiting')
        .lte('requestedAt', entry.requestedAt),
    )
    .take(WAITLIST_READ_LIMIT);
  const index = upTo.findIndex((row) => row._id === entry._id);
  return index === -1 ? upTo.length + 1 : index + 1;
}

async function waitingEntryWithSortName(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  name: string,
): Promise<Doc<'waitlistEntries'> | null> {
  const same = await ctx.db
    .query('waitlistEntries')
    .withIndex('by_seasonId_and_sortName', (q) =>
      q.eq('seasonId', seasonId).eq('sortName', teamSortName(name)),
    )
    .order('desc')
    .first();
  return same?.status === 'waiting' ? same : null;
}

type Refusal =
  | SeasonFullRefusal
  | TeamFullRefusal
  | SeasonInputError
  | RosterRefusal
  | TeamNameError
  | TeamInviteInputError
  | WaitingFreeAgentRefusal
  | AlreadyFreeAgentRefusal
  | AlreadyPlacedRefusal
  | OnWaitlistRefusal
  | NoRoomRefusal
  | AlreadyPromotedRefusal
  | MinorInSeasonRefusal
  | MinorLimitRefusal
  | NothingChosenRefusal;

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
  const existing = await adultEntryInSeason(ctx, seasonId, userId);
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

/** Only the promotion of the entry passes, because it marks the entry promoted first; so a waiting entry never belongs to someone on a team. */
async function assertNotWaitlisted(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  userId: Id<'users'>,
): Promise<void> {
  const entry = await waitingEntryInSeason(ctx, seasonId, userId);
  if (!entry) return;
  refuse({
    code: 'onWaitlist',
    teamName: entry.teamName,
    position: await waitlistPosition(ctx, entry),
    message: TEAM_MESSAGES.onWaitlist(entry.teamName),
  });
}

/** Read fresh: within one mutation an earlier entry has already raised the count, and concurrent writers conflict on this read and retry. */
async function assertTeamHasRoom(ctx: ReadCtx, teamId: Id<'teams'>): Promise<void> {
  const team = await ctx.db.get('teams', teamId);
  if (!team) throw new Error('No team has this id');
  const season = await ctx.db.get('seasons', team.seasonId);
  if (!season) throw new Error('No season has this id');
  if (teamIsFull(team.rosterCount, season.maxRosterSize)) {
    refuse({ code: 'teamFull', message: TEAM_MESSAGES.teamFull });
  }
}

export interface NewTeam {
  /** Already checked with `checkTeamName`. */
  name: string;
  captainUserId: Id<'users'>;
}

/** `promotedEntryId` is the waiting entry being promoted, whose own name does not refuse it. */
async function assertTeamNameFree(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  name: string,
  promotedEntryId: Id<'waitlistEntries'> | null,
): Promise<void> {
  const team = await teamWithSortName(ctx, seasonId, name);
  const entry = await waitingEntryWithSortName(ctx, seasonId, name);
  const taken = team?.name ?? (entry && entry._id !== promotedEntryId ? entry.teamName : null);
  if (taken !== null) {
    refuse({ field: 'name', code: 'nameTaken', message: TEAM_MESSAGES.nameTaken(taken) });
  }
}

/** The checks a captain's own entry gets, run before a team or a waiting entry is written so a refusal writes nothing. */
async function assertCaptainHasNoPlace(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
  captainUserId: Id<'users'>,
): Promise<void> {
  await assertNotRostered(ctx, seasonId, captainUserId, null);
  await assertNotWaitingFreeAgent(ctx, seasonId, captainUserId);
  await assertNotWaitlisted(ctx, seasonId, captainUserId);
}

// Read fresh: a caller's `Doc` may predate teams and waiting entries inserted since. Concurrent writers conflict on this read and retry.
async function currentSeason(ctx: ReadCtx, seasonId: Id<'seasons'>): Promise<Doc<'seasons'>> {
  const season = await ctx.db.get('seasons', seasonId);
  if (!season) throw new Error('No season has this id');
  return season;
}

async function insertTeam(
  ctx: MutationCtx,
  season: Doc<'seasons'>,
  { name, captainUserId }: NewTeam,
): Promise<Id<'teams'>> {
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

/** A full season refuses; `registerTeamOrJoinWaitlist` puts the team on the waitlist instead. */
export async function insertTeamWithCaptain(
  ctx: MutationCtx,
  season: Doc<'seasons'>,
  newTeam: NewTeam,
): Promise<Id<'teams'>> {
  const current = await currentSeason(ctx, season._id);
  if (seasonIsFull(current)) refuse({ code: 'seasonFull', message: TEAM_MESSAGES.seasonFull });
  await assertTeamNameFree(ctx, season._id, newTeam.name, null);
  await assertCaptainHasNoPlace(ctx, season._id, newTeam.captainUserId);
  return insertTeam(ctx, current, newTeam);
}

export type Registration =
  { status: 'registered'; teamId: Id<'teams'> } | { status: 'waitlisted'; position: number };

export async function registerTeamOrJoinWaitlist(
  ctx: MutationCtx,
  season: Doc<'seasons'>,
  newTeam: NewTeam,
): Promise<Registration> {
  const current = await currentSeason(ctx, season._id);
  await assertTeamNameFree(ctx, season._id, newTeam.name, null);
  await assertCaptainHasNoPlace(ctx, season._id, newTeam.captainUserId);
  if (!seasonIsFull(current)) {
    return { status: 'registered', teamId: await insertTeam(ctx, current, newTeam) };
  }
  const entryId = await ctx.db.insert('waitlistEntries', {
    organizationId: current.organizationId,
    seasonId: current._id,
    userId: newTeam.captainUserId,
    teamName: newTeam.name,
    sortName: teamSortName(newTeam.name),
    status: 'waiting',
    requestedAt: Date.now(),
  });
  await changeWaitlistCount(ctx, current._id, 1);
  const entry = await ctx.db.get('waitlistEntries', entryId);
  if (!entry) throw new Error('No waitlist entry has this id');
  return { status: 'waitlisted', position: await waitlistPosition(ctx, entry) };
}

/** The registration deadline does not apply: promotion is an organizer's action. */
export async function promoteWaitlistEntry(
  ctx: MutationCtx,
  entryId: Id<'waitlistEntries'>,
  promotedByUserId: Id<'users'>,
): Promise<{ teamId: Id<'teams'>; teamCount: number; maxTeams: number | undefined }> {
  const entry = await ctx.db.get('waitlistEntries', entryId);
  if (!entry) throw new Error('No waitlist entry has this id');
  if (entry.status !== 'waiting') {
    refuse({ code: 'alreadyPromoted', message: TEAM_MESSAGES.alreadyPromoted });
  }
  const season = await currentSeason(ctx, entry.seasonId);
  if (!seasonHasRoom(season)) refuse({ code: 'noRoom', message: TEAM_MESSAGES.noRoom });
  await assertTeamNameFree(ctx, season._id, entry.teamName, entry._id);
  await assertNotRostered(ctx, season._id, entry.userId, null);
  const promotedAt = Date.now();
  // Promoted before the team is written, so the writer's waitlist check passes for this entry only.
  await ctx.db.patch('waitlistEntries', entry._id, {
    status: 'promoted',
    promotedAt,
    promotedByUserId,
  });
  await changeWaitlistCount(ctx, season._id, -1);
  const teamId = await insertTeam(ctx, season, {
    name: entry.teamName,
    captainUserId: entry.userId,
  });
  await ctx.db.patch('waitlistEntries', entry._id, { promotedTeamId: teamId });
  const after = await currentSeason(ctx, season._id);
  return { teamId, teamCount: after.teamCount ?? 0, maxTeams: after.maxTeams };
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
  await assertNotWaitlisted(ctx, team.seasonId, entry.userId);
  await assertTeamHasRoom(ctx, team._id);
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

export interface NewMinorEntry {
  guardianUserId: Id<'users'>;
  /** Already checked with `checkMinorName`. */
  minorName: string;
  source: RosterEntrySource;
  addedByUserId: Id<'users'>;
}

// A minor has no identity beyond its guardian and name, so the check cannot match minors across guardians.
async function assertMinorNotInSeason(
  ctx: ReadCtx,
  minors: Doc<'rosterEntries'>[],
  minorName: string,
  renamedEntryId: Id<'rosterEntries'> | null,
): Promise<void> {
  const key = minorNameKey(minorName);
  const same = minors.find(
    (entry) =>
      entry._id !== renamedEntryId &&
      entry.status === 'rostered' &&
      entry.minorName !== undefined &&
      minorNameKey(entry.minorName) === key,
  );
  if (!same?.minorName) return;
  const team = await ctx.db.get('teams', same.teamId);
  const teamName = team?.name ?? '';
  refuse({
    field: 'minorName',
    code: 'minorInSeason',
    minorName: same.minorName,
    teamName,
    message: MINOR_MESSAGES.minorInSeason(same.minorName, teamName),
  });
}

/** The one-team and free-agent rules cover the guardian's own entry only, so neither applies here; a waiting captain adds no minor, so the waiting entry stays promotable. */
export async function addMinorEntry(
  ctx: MutationCtx,
  team: Doc<'teams'>,
  entry: NewMinorEntry,
): Promise<Id<'rosterEntries'>> {
  await assertNotWaitlisted(ctx, team.seasonId, entry.guardianUserId);
  const minors = await minorEntriesInSeason(ctx, team.seasonId, entry.guardianUserId);
  await assertMinorNotInSeason(ctx, minors, entry.minorName, null);
  // Removed entries count too, so adding and removing cannot grow a guardian's entries past the read window.
  if (minors.length >= MAX_MINORS_PER_GUARDIAN_IN_SEASON) {
    refuse({ field: 'minorName', code: 'minorLimit', message: MINOR_MESSAGES.minorLimit });
  }
  await assertTeamHasRoom(ctx, team._id);
  const entryId = await ctx.db.insert('rosterEntries', {
    organizationId: team.organizationId,
    seasonId: team.seasonId,
    teamId: team._id,
    userId: entry.guardianUserId,
    minorName: entry.minorName,
    status: 'rostered',
    source: entry.source,
    addedAt: Date.now(),
    addedByUserId: entry.addedByUserId,
  });
  await changeRosterCount(ctx, team._id, 1);
  return entryId;
}

export async function renameMinorEntry(
  ctx: MutationCtx,
  entry: Doc<'rosterEntries'>,
  /** Already checked with `checkMinorName`. */
  minorName: string,
): Promise<void> {
  if (!isMinorEntry(entry) || entry.status !== 'rostered') {
    throw new Error('Only a rostered minor can be renamed');
  }
  const minors = await minorEntriesInSeason(ctx, entry.seasonId, entry.userId);
  await assertMinorNotInSeason(ctx, minors, minorName, entry._id);
  await ctx.db.patch('rosterEntries', entry._id, { minorName });
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
  await assertNotWaitlisted(ctx, season._id, userId);
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

export async function placeFreeAgent(
  ctx: MutationCtx,
  freeAgent: Doc<'freeAgents'>,
  team: Doc<'teams'>,
  placedByUserId: Id<'users'>,
): Promise<void> {
  if (team.seasonId !== freeAgent.seasonId) throw new Error('The team is not in this season');
  if (freeAgent.status !== 'waiting') {
    refuse({ code: 'alreadyPlaced', message: TEAM_MESSAGES.alreadyPlaced });
  }
  await addRosterEntry(ctx, team, {
    userId: freeAgent.userId,
    source: 'placement',
    addedByUserId: placedByUserId,
  });
  await ctx.db.patch('freeAgents', freeAgent._id, {
    status: 'placed',
    placedTeamId: team._id,
    placedAt: Date.now(),
  });
}

/** A free agent placed on the entry's team waits again, so an organizer can place them on another. */
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
  // A minor's entry carries the guardian's id, and the guardian's own placement is not the minor's.
  if (isMinorEntry(entry)) return;
  const freeAgent = await freeAgentInSeason(ctx, entry.seasonId, entry.userId);
  if (freeAgent?.status === 'placed' && freeAgent.placedTeamId === entry.teamId) {
    await ctx.db.patch('freeAgents', freeAgent._id, {
      status: 'waiting',
      placedTeamId: undefined,
      placedAt: undefined,
    });
  }
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

/** An expired invite still counts as pending, so it blocks the address until it is revoked. Pending invites take no place on a full team's roster, so accepting one can still be refused. */
export async function insertTeamInvite(
  ctx: MutationCtx,
  team: Doc<'teams'>,
  invite: NewTeamInvite,
): Promise<Id<'teamInvites'>> {
  await assertTeamHasRoom(ctx, team._id);
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

export interface InviteChoices {
  joinSelf: boolean;
  /** Already checked with `checkMinorName`. */
  minorName: string | null;
}

/** A refused roster entry throws, and a mutation that throws writes nothing, so the invite stays pending. */
export async function acceptTeamInvite(
  ctx: MutationCtx,
  inviteId: Id<'teamInvites'>,
  userId: Id<'users'>,
  { joinSelf, minorName }: InviteChoices = { joinSelf: true, minorName: null },
): Promise<void> {
  if (!joinSelf && minorName === null) {
    refuse({ code: 'nothingChosen', message: MINOR_MESSAGES.nothingChosen });
  }
  const invite = await ctx.db.get('teamInvites', inviteId);
  if (invite?.status !== 'pending') throw new Error('Only a pending invite can be accepted');
  const team = await ctx.db.get('teams', invite.teamId);
  if (!team) throw new Error('No team has this id');
  if (joinSelf) {
    await addRosterEntry(ctx, team, {
      userId,
      source: 'invite',
      addedByUserId: invite.invitedByUserId,
    });
  }
  if (minorName !== null) {
    await addMinorEntry(ctx, team, {
      guardianUserId: userId,
      minorName,
      source: 'invite',
      addedByUserId: invite.invitedByUserId,
    });
  }
  await ctx.db.patch('teamInvites', inviteId, { status: 'accepted' });
  await changePendingInviteCount(ctx, team._id, -1);
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

// An unset counter is recounted, which already includes the change.
async function changeWaitlistCount(
  ctx: MutationCtx,
  seasonId: Id<'seasons'>,
  change: 1 | -1,
): Promise<void> {
  const season = await currentSeason(ctx, seasonId);
  const waitlistCount =
    season.waitlistCount === undefined
      ? await recountWaiting(ctx, seasonId)
      : season.waitlistCount + change;
  await ctx.db.patch('seasons', seasonId, { waitlistCount });
}

/** `null` removes the limit. The range is checked by the caller; a limit below the registered teams is refused here. */
export async function setSeasonMaxTeams(
  ctx: MutationCtx,
  seasonId: Id<'seasons'>,
  maxTeams: number | null,
): Promise<void> {
  const season = await ctx.db.get('seasons', seasonId);
  if (!season) throw new Error('No season has this id');
  const teamCount = season.teamCount ?? (await recountTeams(ctx, seasonId));
  if (maxTeams !== null && maxTeams < teamCount) {
    refuse({
      field: 'maxTeams',
      code: 'maxTeamsBelowCount',
      message: SEASON_MESSAGES.maxTeamsBelowCount(teamCount),
    });
  }
  await ctx.db.patch('seasons', seasonId, { maxTeams: maxTeams ?? undefined });
}

/** `null` removes the limit. */
export async function setSeasonMaxRosterSize(
  ctx: MutationCtx,
  season: Doc<'seasons'>,
  maxRosterSize: number | null,
): Promise<void> {
  if (maxRosterSize !== null) {
    const largest = await largestRoster(ctx, season._id);
    const refusal = checkMaxRosterSizeFor(
      maxRosterSize,
      season.minimumRosterSize,
      largest && { name: largest.name, rosterCount: largest.rosterCount },
    );
    if (refusal) refuse(refusal);
  }
  await ctx.db.patch('seasons', season._id, { maxRosterSize: maxRosterSize ?? undefined });
}

export async function largestRoster(
  ctx: ReadCtx,
  seasonId: Id<'seasons'>,
): Promise<Doc<'teams'> | null> {
  return ctx.db
    .query('teams')
    .withIndex('by_seasonId_and_rosterCount', (q) => q.eq('seasonId', seasonId))
    .order('desc')
    .first();
}

async function recountTeams(ctx: ReadCtx, seasonId: Id<'seasons'>): Promise<number> {
  const teams = await ctx.db
    .query('teams')
    .withIndex('by_seasonId_and_sortName', (q) => q.eq('seasonId', seasonId))
    .take(BACKFILL_TEAM_COUNT_SCAN_LIMIT);
  return teams.length;
}

async function recountWaiting(ctx: ReadCtx, seasonId: Id<'seasons'>): Promise<number> {
  const waiting = await ctx.db
    .query('waitlistEntries')
    .withIndex('by_seasonId_and_status_and_requestedAt', (q) =>
      q.eq('seasonId', seasonId).eq('status', 'waiting'),
    )
    .take(BACKFILL_TEAM_COUNT_SCAN_LIMIT);
  return waiting.length;
}

export async function backfillSeasonWaitlistCounts(ctx: MutationCtx): Promise<number> {
  let backfilled = 0;
  for (const season of await ctx.db.query('seasons').take(BACKFILL_TEAM_COUNT_SCAN_LIMIT)) {
    if (season.waitlistCount !== undefined) continue;
    await ctx.db.patch('seasons', season._id, {
      waitlistCount: await recountWaiting(ctx, season._id),
    });
    backfilled++;
  }
  return backfilled;
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
