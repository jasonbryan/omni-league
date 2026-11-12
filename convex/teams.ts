import { ConvexError, v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  canManageTeam,
  canManageTournamentTeam,
  requireSeasonMemberOrOrganizer,
  requireTournamentTeamMemberOrAdmin,
  requireUser,
  type TeamReader,
} from './lib/access';
import { shortMinorName } from './lib/minorName';
import { pageOf, pageRows, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import { publicTeamsValidator, type PublicTeams } from './lib/publicPage';
import { registrationIsOpen } from './lib/registration';
import {
  insertTournamentTeamWithCaptain,
  isMinorEntry,
  registerTeamOrJoinWaitlist,
} from './lib/rosterWrites';
import {
  findOrganizationBySlug,
  findSeasonBySlugs,
  seasonSlugsValidator,
} from './lib/seasonLookup';
import {
  checkTeamName,
  SEASON_NOT_FOUND_CODE,
  TEAM_MESSAGES,
  TOURNAMENT_NOT_FOUND_CODE,
  type RegistrationClosedError,
} from './lib/teamInput';
import { findTournamentBySlugs, tournamentSlugsValidator } from './lib/tournamentLookup';
import { getCurrentUser } from './lib/users';

/** More than a roster holds, so the page always lists the whole roster. */
export const ROSTER_READ_LIMIT = 200;

/** A season list longer than this shows its first teams by name and the whole total. */
export const SEASON_TEAMS_LIMIT = 200;

/** A user on more teams than this sees the teams of their most recently added entries. */
export const TEAMS_LIST_MINE_LIMIT = 50;

/** A full season puts the team on its waitlist instead (`seasonIsFull`). */
export const register = mutation({
  args: { ...seasonSlugsValidator.fields, name: v.string() },
  returns: v.union(
    v.object({ status: v.literal('registered'), teamId: v.id('teams') }),
    v.object({ status: v.literal('waitlisted'), position: v.number() }),
  ),
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
    return registerTeamOrJoinWaitlist(ctx, season, {
      name: checked.name,
      captainUserId: user._id,
    });
  },
});

/** A tournament has no waitlist, so a full one refuses (`tournamentIsFull`). */
export const registerForTournament = mutation({
  args: { ...tournamentSlugsValidator.fields, name: v.string() },
  returns: v.object({ teamId: v.id('teams') }),
  handler: async (ctx, { name, orgSlug, tournamentSlug }) => {
    const user = await requireUser(ctx);
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    const found = organization && (await findTournamentBySlugs(ctx, organization, tournamentSlug));
    // A draft answers like an unknown tournament, as the register page's query does.
    if (found?.program.status !== 'published') {
      throw new ConvexError({ code: TOURNAMENT_NOT_FOUND_CODE });
    }
    const { tournament } = found;
    if (!registrationIsOpen(tournament, Date.now())) {
      throw new ConvexError({
        code: 'registrationClosed',
        message: TEAM_MESSAGES.tournamentRegistrationClosed,
      } satisfies RegistrationClosedError);
    }
    const checked = checkTeamName(name);
    if (!checked.ok) throw new ConvexError({ ...checked.error });
    const teamId = await insertTournamentTeamWithCaptain(ctx, tournament, {
      name: checked.name,
      captainUserId: user._id,
    });
    return { teamId };
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
  role: v.union(v.literal('captain'), v.literal('player'), v.literal('guardian')),
  seasonStartDate: v.string(),
  seasonEndDate: v.string(),
  registrationDeadline: v.string(),
  minimumRosterSize: v.number(),
  rosterCount: v.number(),
  /** Set for a tournament team, whose `seasonName` and `leagueName` hold the tournament's name and the organization's, as the season fields of the previous frontend read them. */
  tournamentName: v.optional(v.string()),
});

type MyTeamRole = 'captain' | 'player' | 'guardian';

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
    const roles = new Map<Id<'teams'>, MyTeamRole>();
    for (const entry of entries) {
      if (!isMinorEntry(entry)) roles.set(entry.teamId, 'player');
      else if (!roles.has(entry.teamId)) roles.set(entry.teamId, 'guardian');
    }
    const rows = [];
    for (const [teamId, entryRole] of roles) {
      const team = await ctx.db.get('teams', teamId);
      if (!team) continue;
      const role =
        entryRole === 'player' && team.captainUserId === user._id ? 'captain' : entryRole;
      const organization = await ctx.db.get('organizations', team.organizationId);
      if (!organization) continue;
      if (team.tournamentId !== undefined) {
        const tournament = await ctx.db.get('tournaments', team.tournamentId);
        const program = tournament && (await ctx.db.get('programs', tournament.programId));
        if (!tournament || !program) continue;
        rows.push({
          startDate: tournament.startDate,
          row: {
            teamId: team._id,
            teamName: team.name,
            tournamentName: program.name,
            seasonName: program.name,
            leagueName: organization.name,
            organizationName: organization.name,
            role,
            seasonStartDate: tournament.startDate,
            seasonEndDate: tournament.endDate,
            registrationDeadline: tournament.registrationDeadline,
            minimumRosterSize: tournament.minimumRosterSize,
            rosterCount: team.rosterCount,
          },
        });
        continue;
      }
      const [season, league] = await Promise.all([
        team.seasonId && ctx.db.get('seasons', team.seasonId),
        team.leagueId && ctx.db.get('leagues', team.leagueId),
      ]);
      if (!season || !league) continue;
      rows.push({
        startDate: season.startDate,
        row: {
          teamId: team._id,
          teamName: team.name,
          seasonName: season.name,
          leagueName: league.name,
          organizationName: organization.name,
          role,
          seasonStartDate: season.startDate,
          seasonEndDate: season.endDate,
          registrationDeadline: season.registrationDeadline,
          minimumRosterSize: season.minimumRosterSize,
          rosterCount: team.rosterCount,
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
  /** A minor's name reaches players on other teams only shortened, and their row is not marked as a minor's. */
  name: v.string(),
  isCaptain: v.boolean(),
  isViewer: v.boolean(),
  minor: v.union(v.null(), v.object({ guardianName: v.string() })),
  viewerCanRename: v.boolean(),
  viewerCanRemove: v.boolean(),
});

const teamForMemberValidator = v.object({
  name: v.string(),
  organization: v.object({ name: v.string(), slug: v.string() }),
  /** A tournament team's `season` and `league` are stand-ins for the previous frontend; `tournament` marks the team. */
  league: v.optional(v.object({ name: v.string(), slug: v.string() })),
  season: v.optional(v.object({ name: v.string(), slug: v.string() })),
  tournament: v.optional(v.object({ name: v.string(), slug: v.string() })),
  minimumRosterSize: v.number(),
  maxRosterSize: v.optional(v.number()),
  rosterCount: v.number(),
  roster: v.array(rosterRowValidator),
  viewerIsCaptain: v.boolean(),
  viewerCanManage: v.boolean(),
  /** The caller has their own entry or a minor's entry on this team. */
  viewerOnTeam: v.boolean(),
  viewerTeamName: v.union(v.null(), v.string()),
});

async function teamById(ctx: Pick<QueryCtx, 'db'>, rawTeamId: string) {
  const teamId = ctx.db.normalizeId('teams', rawTeamId);
  return teamId ? ctx.db.get('teams', teamId) : null;
}

/** A tournament team has no league, so it answers null. */
async function teamAndLeague(ctx: Pick<QueryCtx, 'db'>, rawTeamId: string) {
  const team = await teamById(ctx, rawTeamId);
  const league = team?.leagueId ? await ctx.db.get('leagues', team.leagueId) : null;
  return team && league ? { team, league } : null;
}

async function ownTeamName(ctx: Pick<QueryCtx, 'db'>, reader: TeamReader) {
  const own = reader.ownTeamId ? await ctx.db.get('teams', reader.ownTeamId) : null;
  return own?.name ?? null;
}

type TeamForMember = Infer<typeof teamForMemberValidator>;

async function tournamentTeamForMember(
  ctx: Pick<QueryCtx, 'db' | 'auth'>,
  team: Doc<'teams'>,
): Promise<TeamForMember | null> {
  const reader = await requireTournamentTeamMemberOrAdmin(ctx, team);
  const tournament = team.tournamentId && (await ctx.db.get('tournaments', team.tournamentId));
  const program = tournament && (await ctx.db.get('programs', tournament.programId));
  const organization = await ctx.db.get('organizations', team.organizationId);
  if (!tournament || !program || !organization) return null;
  const viewerCanManage = await canManageTournamentTeam(ctx, reader.user._id, team);
  return {
    name: team.name,
    organization: { name: organization.name, slug: organization.slug },
    tournament: { name: program.name, slug: program.slug },
    // The previous frontend reads `season` and `league` without a check, so a tournament team answers with stand-ins.
    season: { name: program.name, slug: program.slug },
    league: { name: organization.name, slug: organization.slug },
    minimumRosterSize: tournament.minimumRosterSize,
    rosterCount: team.rosterCount,
    roster: await rosterOf(ctx, team, reader, viewerCanManage),
    viewerIsCaptain: team.captainUserId === reader.user._id,
    viewerCanManage,
    viewerOnTeam: reader.rosteredTeamIds.has(team._id),
    viewerTeamName: await ownTeamName(ctx, reader),
  };
}

/** `teamId` is a string so a malformed id answers `null`, as an unknown one does, never a validator error. */
export const getForMember = query({
  args: { teamId: v.string() },
  returns: v.union(v.null(), teamForMemberValidator),
  handler: async (ctx, args): Promise<TeamForMember | null> => {
    const team = await teamById(ctx, args.teamId);
    if (team?.tournamentId !== undefined) return tournamentTeamForMember(ctx, team);
    const found = await teamAndLeague(ctx, args.teamId);
    if (!found) return null;
    const { team: seasonTeam, league } = found;
    const reader = await requireSeasonMemberOrOrganizer(ctx, seasonTeam, league);
    const { user } = reader;
    const season = seasonTeam.seasonId && (await ctx.db.get('seasons', seasonTeam.seasonId));
    const organization = await ctx.db.get('organizations', seasonTeam.organizationId);
    if (!season || !organization) return null;
    const viewerCanManage = await canManageTeam(ctx, user._id, seasonTeam, league);
    return {
      name: seasonTeam.name,
      organization: { name: organization.name, slug: organization.slug },
      league: { name: league.name, slug: league.slug },
      season: { name: season.name, slug: season.slug },
      minimumRosterSize: season.minimumRosterSize,
      ...(season.maxRosterSize !== undefined && { maxRosterSize: season.maxRosterSize }),
      rosterCount: seasonTeam.rosterCount,
      roster: await rosterOf(ctx, seasonTeam, reader, viewerCanManage),
      viewerIsCaptain: seasonTeam.captainUserId === user._id,
      viewerCanManage,
      viewerOnTeam: reader.rosteredTeamIds.has(seasonTeam._id),
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
    const { rosteredTeamIds } = await requireSeasonMemberOrOrganizer(ctx, team, league);
    const season = team.seasonId && (await ctx.db.get('seasons', team.seasonId));
    if (!season) return null;
    const teams = await ctx.db
      .query('teams')
      .withIndex('by_seasonId_and_sortName', (q) => q.eq('seasonId', season._id))
      .take(SEASON_TEAMS_LIMIT);
    return {
      rows: teams.map((row) => ({
        teamId: row._id,
        name: row.name,
        isViewerTeam: rosteredTeamIds.has(row._id),
      })),
      total: season.teamCount ?? teams.length,
    };
  },
});

async function rosterOf(
  ctx: Pick<QueryCtx, 'db'>,
  team: Doc<'teams'>,
  reader: TeamReader,
  viewerCanManage: boolean,
) {
  const viewerId = reader.user._id;
  // Requirements, Accounts: players on other teams see a minor's first name and last initial.
  const seesMinors = reader.organizes || reader.rosteredTeamIds.has(team._id);
  const entries = await ctx.db
    .query('rosterEntries')
    .withIndex('by_teamId_and_status', (q) => q.eq('teamId', team._id).eq('status', 'rostered'))
    .take(ROSTER_READ_LIMIT);
  const rows = [];
  for (const entry of entries) {
    if (entry.minorName !== undefined) {
      const isGuardian = entry.userId === viewerId;
      const guardian = seesMinors ? await ctx.db.get('users', entry.userId) : null;
      rows.push({
        rosterEntryId: entry._id,
        name: seesMinors ? entry.minorName : shortMinorName(entry.minorName),
        isCaptain: false,
        isViewer: false,
        minor: seesMinors ? { guardianName: guardian?.name ?? '' } : null,
        viewerCanRename: isGuardian || reader.organizes,
        viewerCanRemove: isGuardian || viewerCanManage,
      });
      continue;
    }
    const player = await ctx.db.get('users', entry.userId);
    const isCaptain = entry.userId === team.captainUserId;
    rows.push({
      rosterEntryId: entry._id,
      name: player?.name ?? '',
      isCaptain,
      isViewer: entry.userId === viewerId,
      minor: null,
      viewerCanRename: false,
      viewerCanRemove: viewerCanManage && !isCaptain,
    });
  }
  return rows.sort(captainFirst);
}

function captainFirst(a: { isCaptain: boolean }, b: { isCaptain: boolean }): number {
  return Number(b.isCaptain) - Number(a.isCaptain);
}
