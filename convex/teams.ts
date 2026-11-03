import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  canManageTeam,
  requireSeasonMemberOrOrganizer,
  requireUser,
  type TeamReader,
} from './lib/access';
import { pageOf, pageRows, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import { publicTeamsValidator, type PublicTeams } from './lib/publicPage';
import { registrationIsOpen } from './lib/registration';
import { insertTeamWithCaptain } from './lib/rosterWrites';
import { findSeasonBySlugs, seasonSlugsValidator } from './lib/seasonLookup';
import {
  checkTeamName,
  SEASON_NOT_FOUND_CODE,
  TEAM_MESSAGES,
  type RegistrationClosedError,
} from './lib/teamInput';
import { getCurrentUser } from './lib/users';

/** More than a roster holds, so the page always lists the whole roster. */
export const ROSTER_READ_LIMIT = 200;

/** A season list longer than this shows its first teams by name and the whole total. */
export const SEASON_TEAMS_LIMIT = 200;

/** A user on more teams than this sees the teams of their most recently added entries. */
export const TEAMS_LIST_MINE_LIMIT = 50;

export const register = mutation({
  args: { ...seasonSlugsValidator.fields, name: v.string() },
  returns: v.object({ status: v.literal('registered'), teamId: v.id('teams') }),
  handler: async (ctx, { name, ...slugs }) => {
    const user = await requireUser(ctx);
    const found = await findSeasonBySlugs(ctx, slugs);
    // A draft answers like an unknown season, as the register page's query does.
    if (found?.league.status !== 'published' || found.season.status !== 'published') {
      throw new ConvexError({ code: SEASON_NOT_FOUND_CODE });
    }
    const { season } = found;
    if (!registrationIsOpen(season, Date.now())) {
      throw new ConvexError({
        code: 'registrationClosed',
        message: TEAM_MESSAGES.registrationClosed,
      } satisfies RegistrationClosedError);
    }
    const checked = checkTeamName(name);
    if (!checked.ok) throw new ConvexError({ ...checked.error });
    const teamId = await insertTeamWithCaptain(ctx, season, {
      name: checked.name,
      captainUserId: user._id,
    });
    return { status: 'registered' as const, teamId };
  },
});

const EMPTY_LIST = { rows: [], page: 1, pageCount: 0, total: 0 };

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only the names of a published season's teams.
export const listPublic = query({
  args: { ...seasonSlugsValidator.fields, page: v.number() },
  returns: publicTeamsValidator,
  handler: async (ctx, { page: requested, ...slugs }): Promise<PublicTeams> => {
    const found = await findSeasonBySlugs(ctx, slugs);
    // A draft answers like an unknown season, as the season page's query does.
    if (found?.league.status !== 'published' || found.season.status !== 'published') {
      return EMPTY_LIST;
    }
    const { season } = found;
    const total = season.teamCount ?? 0;
    const { page, pageCount } = pageOf(total, requested);
    if (pageCount === 0) return EMPTY_LIST;
    const read = await ctx.db
      .query('teams')
      .withIndex('by_seasonId_and_sortName', (q) => q.eq('seasonId', season._id))
      .take(page * PUBLIC_LIST_PAGE_SIZE);
    return {
      rows: pageRows(read, page).map((team) => ({ name: team.name })),
      page,
      pageCount,
      total,
    };
  },
});

const myTeamValidator = v.object({
  teamId: v.id('teams'),
  teamName: v.string(),
  seasonName: v.string(),
  leagueName: v.string(),
  organizationName: v.string(),
  role: v.union(v.literal('captain'), v.literal('player')),
});

// eslint-disable-next-line @convex-dev/require-access-control -- the caller's own roster entries only, found from ctx.auth (getCurrentUser); no argument names a user, and an anonymous caller gets [].
export const listMine = query({
  args: {},
  returns: v.array(myTeamValidator),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const entries = await ctx.db
      .query('rosterEntries')
      .withIndex('by_userId_and_status', (q) => q.eq('userId', user._id).eq('status', 'rostered'))
      .order('desc')
      .take(TEAMS_LIST_MINE_LIMIT);
    const rows = [];
    for (const entry of entries) {
      const team = await ctx.db.get('teams', entry.teamId);
      if (!team) continue;
      const [season, league, organization] = await Promise.all([
        ctx.db.get('seasons', team.seasonId),
        ctx.db.get('leagues', team.leagueId),
        ctx.db.get('organizations', team.organizationId),
      ]);
      if (!season || !league || !organization) continue;
      rows.push({
        startDate: season.startDate,
        row: {
          teamId: team._id,
          teamName: team.name,
          seasonName: season.name,
          leagueName: league.name,
          organizationName: organization.name,
          role: team.captainUserId === user._id ? ('captain' as const) : ('player' as const),
        },
      });
    }
    return rows.sort(newestSeasonFirst).map(({ row }) => row);
  },
});

function newestSeasonFirst(a: { startDate: string }, b: { startDate: string }): number {
  return a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0;
}

const rosterRowValidator = v.object({
  rosterEntryId: v.id('rosterEntries'),
  name: v.string(),
  isCaptain: v.boolean(),
  isViewer: v.boolean(),
});

const teamForMemberValidator = v.object({
  name: v.string(),
  organization: v.object({ name: v.string(), slug: v.string() }),
  league: v.object({ name: v.string(), slug: v.string() }),
  season: v.object({ name: v.string(), slug: v.string() }),
  minimumRosterSize: v.number(),
  rosterCount: v.number(),
  roster: v.array(rosterRowValidator),
  viewerIsCaptain: v.boolean(),
  viewerCanManage: v.boolean(),
  viewerTeamName: v.union(v.null(), v.string()),
});

async function teamAndLeague(ctx: Pick<QueryCtx, 'db'>, rawTeamId: string) {
  const teamId = ctx.db.normalizeId('teams', rawTeamId);
  const team = teamId ? await ctx.db.get('teams', teamId) : null;
  const league = team ? await ctx.db.get('leagues', team.leagueId) : null;
  return team && league ? { team, league } : null;
}

async function ownTeamName(ctx: Pick<QueryCtx, 'db'>, reader: TeamReader) {
  const own = reader.ownTeamId ? await ctx.db.get('teams', reader.ownTeamId) : null;
  return own?.name ?? null;
}

/** `teamId` is a string so a malformed id answers `null`, as an unknown one does, never a validator error. */
export const getForMember = query({
  args: { teamId: v.string() },
  returns: v.union(v.null(), teamForMemberValidator),
  handler: async (ctx, args) => {
    const found = await teamAndLeague(ctx, args.teamId);
    if (!found) return null;
    const { team, league } = found;
    const reader = await requireSeasonMemberOrOrganizer(ctx, team, league);
    const { user } = reader;
    const season = await ctx.db.get('seasons', team.seasonId);
    const organization = await ctx.db.get('organizations', team.organizationId);
    if (!season || !organization) return null;
    return {
      name: team.name,
      organization: { name: organization.name, slug: organization.slug },
      league: { name: league.name, slug: league.slug },
      season: { name: season.name, slug: season.slug },
      minimumRosterSize: season.minimumRosterSize,
      rosterCount: team.rosterCount,
      roster: await rosterOf(ctx, team, user),
      viewerIsCaptain: team.captainUserId === user._id,
      viewerCanManage: await canManageTeam(ctx, user._id, team, league),
      viewerTeamName: await ownTeamName(ctx, reader),
    };
  },
});

const seasonTeamsValidator = v.object({
  rows: v.array(v.object({ teamId: v.id('teams'), name: v.string(), isViewerTeam: v.boolean() })),
  total: v.number(),
});

export const listForSeasonMember = query({
  args: { teamId: v.string() },
  returns: v.union(v.null(), seasonTeamsValidator),
  handler: async (ctx, args) => {
    const found = await teamAndLeague(ctx, args.teamId);
    if (!found) return null;
    const { team, league } = found;
    const { ownTeamId } = await requireSeasonMemberOrOrganizer(ctx, team, league);
    const season = await ctx.db.get('seasons', team.seasonId);
    if (!season) return null;
    const teams = await ctx.db
      .query('teams')
      .withIndex('by_seasonId_and_sortName', (q) => q.eq('seasonId', season._id))
      .take(SEASON_TEAMS_LIMIT);
    return {
      rows: teams.map((row) => ({
        teamId: row._id,
        name: row.name,
        isViewerTeam: row._id === ownTeamId,
      })),
      total: season.teamCount ?? teams.length,
    };
  },
});

async function rosterOf(ctx: Pick<QueryCtx, 'db'>, team: Doc<'teams'>, viewer: Doc<'users'>) {
  const entries = await ctx.db
    .query('rosterEntries')
    .withIndex('by_teamId_and_status', (q) => q.eq('teamId', team._id).eq('status', 'rostered'))
    .take(ROSTER_READ_LIMIT);
  const rows = [];
  for (const entry of entries) {
    const player = await ctx.db.get('users', entry.userId);
    rows.push({
      rosterEntryId: entry._id,
      name: player?.name ?? '',
      isCaptain: entry.userId === team.captainUserId,
      isViewer: entry.userId === viewer._id,
    });
  }
  return rows.sort(captainFirst);
}

function captainFirst(a: { isCaptain: boolean }, b: { isCaptain: boolean }): number {
  return Number(b.isCaptain) - Number(a.isCaptain);
}
