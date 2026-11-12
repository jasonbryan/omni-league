import { v, type Infer } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalAction, internalMutation, type MutationCtx } from './_generated/server';
import { recountPendingInvites } from './lib/inviteWrites';
import { recountMemberships } from './lib/memberships';
import { BACKFILL_TEAM_COUNT_SCAN_LIMIT, recountTeams, recountWaiting } from './lib/rosterWrites';
import {
  BACKFILL_SCAN_LIMIT,
  backfillOrganizationTenantFields,
  ensureProgramOfLeague,
  recountDraftLeagues,
  recountPublishedSeasons,
  sortName,
} from './lib/tenantWrites';

// Unguarded by environment, unlike `seed:demo`, because it runs on production.

const phaseValidator = v.union(
  v.literal('locations'),
  v.literal('leagues'),
  v.literal('programs'),
  v.literal('organizations'),
  v.literal('seasons'),
  v.literal('teams'),
);
type Phase = Infer<typeof phaseValidator>;

// Leagues run before programs and organizations, because a program copies a league's status and an organization's counts read it.
const PHASES: readonly Phase[] = [
  'locations',
  'leagues',
  'programs',
  'organizations',
  'seasons',
  'teams',
];

// A batch is one transaction, which may read 16,384 documents. A row's recount reads up to `BACKFILL_SCAN_LIMIT - 1` rows of each table it counts: an organization six, a season two, a league one. A program reads one row, the one that may hold its slug.
export const BATCH_SIZE: Record<Phase, number> = {
  locations: 100,
  leagues: 10,
  programs: 100,
  organizations: 2,
  seasons: 5,
  teams: 100,
};

const backfilledValidator = v.object({
  locations: v.number(),
  leagues: v.number(),
  programs: v.number(),
  organizations: v.number(),
  staffCounts: v.number(),
  staffInviteCounts: v.number(),
  draftLeagueCounts: v.number(),
  teamCounts: v.number(),
  waitlistCounts: v.number(),
  pendingInviteCounts: v.number(),
});
type Backfilled = Infer<typeof backfilledValidator>;

function noneBackfilled(): Backfilled {
  return {
    locations: 0,
    leagues: 0,
    programs: 0,
    organizations: 0,
    staffCounts: 0,
    staffInviteCounts: 0,
    draftLeagueCounts: 0,
    teamCounts: 0,
    waitlistCounts: 0,
    pendingInviteCounts: 0,
  };
}

/** A recount that stops at the scan limit is short, so the run fails and the row keeps no counter. */
function exactCount(counted: number, scanLimit: number, what: string): number {
  if (counted >= scanLimit) {
    throw new Error(`${what} reaches the scan limit of ${scanLimit}, so its count would be short`);
  }
  return counted;
}

async function backfillOrganization(
  ctx: MutationCtx,
  organization: Doc<'organizations'>,
  backfilled: Backfilled,
): Promise<void> {
  const { _id: organizationId } = organization;
  if (await backfillOrganizationTenantFields(ctx, organization)) backfilled.organizations++;
  if (organization.staffCount === undefined) {
    const staffCount = exactCount(
      await recountMemberships(ctx, organizationId),
      BACKFILL_SCAN_LIMIT,
      `Memberships of organization ${organization.slug}`,
    );
    await ctx.db.patch('organizations', organizationId, { staffCount });
    backfilled.staffCounts++;
  }
  if (organization.pendingInviteCount === undefined) {
    const pendingInviteCount = exactCount(
      await recountPendingInvites(ctx, organizationId),
      BACKFILL_SCAN_LIMIT,
      `Pending invites of organization ${organization.slug}`,
    );
    await ctx.db.patch('organizations', organizationId, { pendingInviteCount });
    backfilled.staffInviteCounts++;
  }
  if (organization.draftLeagueCount === undefined) {
    const draftLeagueCount = exactCount(
      await recountDraftLeagues(ctx, organizationId),
      BACKFILL_SCAN_LIMIT,
      `Draft leagues of organization ${organization.slug}`,
    );
    await ctx.db.patch('organizations', organizationId, { draftLeagueCount });
    backfilled.draftLeagueCounts++;
  }
}

async function backfillLeague(
  ctx: MutationCtx,
  league: Doc<'leagues'>,
  backfilled: Backfilled,
): Promise<void> {
  if (
    league.sortName !== undefined &&
    league.status !== undefined &&
    league.publishedSeasonCount !== undefined
  ) {
    return;
  }
  // A league stored before drafts existed was published.
  await ctx.db.patch('leagues', league._id, {
    sortName: league.sortName ?? sortName(league.name),
    status: league.status ?? 'published',
    publishedSeasonCount:
      league.publishedSeasonCount ??
      exactCount(
        await recountPublishedSeasons(ctx, league._id),
        BACKFILL_SCAN_LIMIT,
        `Published seasons of league ${league.slug}`,
      ),
  });
  backfilled.leagues++;
}

async function backfillSeason(
  ctx: MutationCtx,
  season: Doc<'seasons'>,
  backfilled: Backfilled,
): Promise<void> {
  if (season.teamCount === undefined) {
    const teamCount = exactCount(
      await recountTeams(ctx, season._id),
      BACKFILL_TEAM_COUNT_SCAN_LIMIT,
      `Teams of season ${season.slug}`,
    );
    await ctx.db.patch('seasons', season._id, { teamCount });
    backfilled.teamCounts++;
  }
  if (season.waitlistCount === undefined) {
    const waitlistCount = exactCount(
      await recountWaiting(ctx, season._id),
      BACKFILL_TEAM_COUNT_SCAN_LIMIT,
      `Waiting entries of season ${season.slug}`,
    );
    await ctx.db.patch('seasons', season._id, { waitlistCount });
    backfilled.waitlistCounts++;
  }
}

const batchResultValidator = v.object({
  backfilled: backfilledValidator,
  continueCursor: v.string(),
  isDone: v.boolean(),
});
type BatchResult = Infer<typeof batchResultValidator>;

async function backfillPhase(
  ctx: MutationCtx,
  phase: Phase,
  cursor: string | null,
  backfilled: Backfilled,
): Promise<{ continueCursor: string; isDone: boolean }> {
  const paginationOpts = { numItems: BATCH_SIZE[phase], cursor };
  switch (phase) {
    case 'locations': {
      const { page, continueCursor, isDone } = await ctx.db
        .query('locations')
        .paginate(paginationOpts);
      for (const location of page) {
        if (location.sortName !== undefined) continue;
        await ctx.db.patch('locations', location._id, { sortName: sortName(location.name) });
        backfilled.locations++;
      }
      return { continueCursor, isDone };
    }
    case 'leagues': {
      const { page, continueCursor, isDone } = await ctx.db
        .query('leagues')
        .paginate(paginationOpts);
      for (const league of page) await backfillLeague(ctx, league, backfilled);
      return { continueCursor, isDone };
    }
    case 'programs': {
      const { page, continueCursor, isDone } = await ctx.db
        .query('leagues')
        .paginate(paginationOpts);
      for (const league of page) {
        if (await ensureProgramOfLeague(ctx, league)) backfilled.programs++;
      }
      return { continueCursor, isDone };
    }
    case 'organizations': {
      const { page, continueCursor, isDone } = await ctx.db
        .query('organizations')
        .paginate(paginationOpts);
      for (const organization of page) await backfillOrganization(ctx, organization, backfilled);
      return { continueCursor, isDone };
    }
    case 'seasons': {
      const { page, continueCursor, isDone } = await ctx.db
        .query('seasons')
        .paginate(paginationOpts);
      for (const season of page) await backfillSeason(ctx, season, backfilled);
      return { continueCursor, isDone };
    }
    case 'teams': {
      const { page, continueCursor, isDone } = await ctx.db.query('teams').paginate(paginationOpts);
      for (const team of page) {
        if (team.pendingInviteCount !== undefined) continue;
        // A team stored before team invites existed has none.
        await ctx.db.patch('teams', team._id, { pendingInviteCount: 0 });
        backfilled.pendingInviteCounts++;
      }
      return { continueCursor, isDone };
    }
  }
}

export const backfillBatch = internalMutation({
  args: { phase: phaseValidator, cursor: v.union(v.string(), v.null()) },
  returns: batchResultValidator,
  handler: async (ctx, { phase, cursor }): Promise<BatchResult> => {
    const backfilled = noneBackfilled();
    const { continueCursor, isDone } = await backfillPhase(ctx, phase, cursor, backfilled);
    return { backfilled, continueCursor, isDone };
  },
});

// Each batch commits on its own, so a run that stops partway keeps its progress and the next run continues from the rows still unset.
export const run = internalAction({
  args: {},
  returns: v.object({ batches: v.number(), backfilled: backfilledValidator }),
  handler: async (ctx): Promise<{ batches: number; backfilled: Backfilled }> => {
    const total = noneBackfilled();
    let batches = 0;
    for (const phase of PHASES) {
      let cursor: string | null = null;
      for (;;) {
        const batch: BatchResult = await ctx.runMutation(internal.releaseBackfill.backfillBatch, {
          phase,
          cursor,
        });
        batches++;
        for (const key of Object.keys(total) as (keyof Backfilled)[]) {
          total[key] += batch.backfilled[key];
        }
        if (batch.isDone) break;
        cursor = batch.continueCursor;
      }
    }
    return { batches, backfilled: total };
  },
});
