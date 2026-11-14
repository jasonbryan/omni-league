import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireGameOrganizer, requireUser } from './lib/access';
import { BRACKET_MESSAGES, roundName } from './lib/bracket';
import { refuseInvalidScore, saveFor, savedValidator, setsPerGameOf } from './lib/gameResults';
import { currentGameOf } from './lib/scoreReports';
import { scoreValidator, sportValidator } from './lib/sports';
import { bracketGames, refuseBracket } from './lib/tournamentBracket';

const reportedValidator = v.object({ score: scoreValidator, reportedAt: v.number() });

const teamReportValidator = v.object({
  sport: sportValidator,
  setsPerGame: v.number(),
  game: v.union(
    v.null(),
    v.object({
      gameId: v.id('tournamentGames'),
      roundName: v.string(),
      teams: v.array(v.object({ teamId: v.id('teams'), name: v.string() })),
      /** The team's own report; the other team's stays with the organizer. */
      report: v.union(v.null(), reportedValidator),
    }),
  ),
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
    const games = await bracketGames(ctx, tournament._id);
    const current = currentGameOf(games, team._id);
    const base = { sport: tournament.sport, setsPerGame: setsPerGameOf(tournament) };
    if (!current) return { ...base, game: null };
    const rounds = games.reduce((most, row) => Math.max(most, row.round), 0);
    const reported = await ctx.db
      .query('scoreReports')
      .withIndex('by_gameId_and_teamId', (q) => q.eq('gameId', current._id).eq('teamId', team._id))
      .unique();
    const teams = [];
    for (const placed of current.teamIds) {
      const row = placed && (await ctx.db.get('teams', placed));
      if (row) teams.push({ teamId: row._id, name: row.name });
    }
    return {
      ...base,
      game: {
        gameId: current._id,
        roundName: roundName(current.round, rounds),
        teams,
        report: reported && { score: reported.score, reportedAt: reported.reportedAt },
      },
    };
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
    if (game.winnerTeamId !== undefined) {
      refuseBracket({ code: 'reportsClosed', message: BRACKET_MESSAGES.reportsClosed });
    }
    if (game.teamIds.includes(null)) {
      refuseBracket({ code: 'gameNotReady', message: BRACKET_MESSAGES.gameNotReady });
    }
    const tournament = await ctx.db.get('tournaments', game.tournamentId);
    if (!tournament) throw new Error('Not allowed');
    refuseInvalidScore(tournament, tournament.sport, score);
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

/** Saves through the writer an organizer's entry uses, so the winner advances and the locks follow. */
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
