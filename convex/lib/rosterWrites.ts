// The only writer of `teams`, `rosterEntries`, `teams.rosterCount`, and `seasons.teamCount`, so the
// counters and the one-team-per-season rule hold for every way onto a roster.
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { RosterEntrySource } from './rosterEntry';
import { TEAM_MESSAGES, teamSortName, type RosterRefusal, type TeamNameError } from './teamInput';

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

function refuse(refusal: RosterRefusal | TeamNameError): never {
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
  const teamId = await ctx.db.insert('teams', {
    organizationId: season.organizationId,
    leagueId: season.leagueId,
    seasonId: season._id,
    name,
    sortName: teamSortName(name),
    captainUserId,
    rosterCount: 0,
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
