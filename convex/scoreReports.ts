import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireGameOrganizer, requireUser } from './lib/access';
import { BRACKET_MESSAGES } from './lib/bracket';
import { playoffRoundName } from './lib/doubleBracket';
import {
  refuseInvalidScore,
  saveFor,
  savedValidator,
  setsPerGameOf,
  tiesAllowedIn,
} from './lib/gameResults';
import { reportableGamesOf } from './lib/scoreReports';
import { scoreValidator, sportValidator } from './lib/sports';
import {
  allPlayoffGames,
  gameIsDecided,
  playoffGames,
  playoffRoundsOf,
  refuseBracket,
} from './lib/tournamentBracket';
import { poolGames } from './lib/tournamentPools';

const reportedValidator = v.object({ score: scoreValidator, reportedAt: v.number() });

const reportableGameValidator = v.object({
  gameId: v.id('tournamentGames'),
  stage: v.union(v.literal('bracket'), v.literal('pool')),
  roundName: v.string(),
  teams: v.array(v.object({ teamId: v.id('teams'), name: v.string() })),
  /** The team's own report; the other team's stays with the organizer. */
  report: v.union(v.null(), reportedValidator),
});

const teamReportValidator = v.object({
  sport: sportValidator,
  setsPerGame: v.number(),
  games: v.array(reportableGameValidator),
  /** What the previous frontend reads: the current bracket game, never a pool game. */
  game: v.union(v.null(), reportableGameValidator),
});

export const forTeam = query({
  args: { teamId: v.id('teams') },
  returns: v.union(v.null(), teamReportValidator),
  handler: async (ctx, { teamId }) => {
    const user = await requireUser(ctx);
    const team = await ctx.db.get('teams', teamId);
    if (team?.tournamentId === undefined || team.captainUserId !== user._id) return null;
    const tournament = await ctx.db.get('tournaments', team.tournamentId);
    if (!tournament) return null;
    const playoff = await playoffGames(ctx, tournament._id);
    const open = reportableGamesOf(
      [...(await poolGames(ctx, tournament._id)), ...allPlayoffGames(playoff)],
      team._id,
    );
    const rounds = playoffRoundsOf(playoff);
    const games = [];
    for (const game of open) {
      const reported = await ctx.db
        .query('scoreReports')
        .withIndex('by_gameId_and_teamId', (q) => q.eq('gameId', game._id).eq('teamId', team._id))
        .unique();
      const teams = [];
      for (const placed of game.teamIds) {
        const row = placed && (await ctx.db.get('teams', placed));
        if (row) teams.push({ teamId: row._id, name: row.name });
      }
      games.push({
        gameId: game._id,
        // The losers' bracket and the grand final are bracket games to a captain, as the previous frontend reads them.
        stage: game.stage === 'pool' ? ('pool' as const) : ('bracket' as const),
        roundName: playoffRoundName(game, rounds),
        teams,
        report: reported && { score: reported.score, reportedAt: reported.reportedAt },
      });
    }
    const game = games.find((row) => row.stage === 'bracket') ?? null;
    return { sport: tournament.sport, setsPerGame: setsPerGameOf(tournament), games, game };
  },
});

export const report = mutation({
  args: { gameId: v.id('tournamentGames'), teamId: v.id('teams'), score: scoreValidator },
  returns: v.object({ reportedAt: v.number() }),
  handler: async (ctx, { gameId, teamId, score }) => {
    const user = await requireUser(ctx);
    const game = await ctx.db.get('tournamentGames', gameId);
    const team = await ctx.db.get('teams', teamId);
    if (!game || team?.captainUserId !== user._id || !game.teamIds.includes(team._id)) {
      throw new Error('Not allowed');
    }
    if (gameIsDecided(game)) {
      refuseBracket({ code: 'reportsClosed', message: BRACKET_MESSAGES.reportsClosed });
    }
    if (game.teamIds.includes(null)) {
      refuseBracket({ code: 'gameNotReady', message: BRACKET_MESSAGES.gameNotReady });
    }
    const tournament = await ctx.db.get('tournaments', game.tournamentId);
    if (!tournament) throw new Error('Not allowed');
    refuseInvalidScore(tournament, tournament.sport, score, tiesAllowedIn(game, tournament.sport));
    const existing = await ctx.db
      .query('scoreReports')
      .withIndex('by_gameId_and_teamId', (q) => q.eq('gameId', gameId).eq('teamId', teamId))
      .unique();
    // Later than the report it replaces, even within one millisecond, so a Confirm shown the earlier one is refused.
    const reportedAt = Math.max(Date.now(), (existing?.reportedAt ?? 0) + 1);
    const row = { score, reportedAt, reportedByUserId: user._id };
    if (existing) await ctx.db.patch('scoreReports', existing._id, row);
    else await ctx.db.insert('scoreReports', { gameId, teamId, ...row });
    return { reportedAt };
  },
});

/** Saves through the writer an organizer's entry uses, so the winner advances, the pools lock, and the standings follow. */
export const confirm = mutation({
  args: {
    reportId: v.id('scoreReports'),
    // The `reportedAt` the organizer was shown, so a score the team sent since is not confirmed unseen.
    expected: v.number(),
  },
  returns: savedValidator,
  handler: async (ctx, { reportId, expected }) => {
    await requireUser(ctx);
    const reported = await ctx.db.get('scoreReports', reportId);
    if (!reported) throw new Error('Not allowed');
    const access = await requireGameOrganizer(ctx, reported.gameId);
    if (reported.reportedAt !== expected || !access.game.teamIds.includes(reported.teamId)) {
      refuseBracket({ code: 'reportChanged', message: BRACKET_MESSAGES.reportChanged });
    }
    return saveFor(ctx, access, { score: reported.score }, false);
  },
});
