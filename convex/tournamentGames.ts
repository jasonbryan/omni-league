import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  requireGameOrganizer,
  requireProgramOrganizerOrForbidden,
  requireStaffOrForbidden,
  requireTournamentOrganizer,
} from './lib/access';
import { BRACKET_MESSAGES, MIN_BRACKET_TEAMS, roundName } from './lib/bracket';
import {
  checkedResult,
  resultFrom,
  refuseUnlessReady,
  saveFor,
  savedValidator,
  storedResultValidator,
} from './lib/gameResults';
import { registrationIsOpen } from './lib/registration';
import { reportsInPlaceOrder, reportViewValidator } from './lib/scoreReports';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { scoreValidator } from './lib/sports';
import { findTournamentBySlugs, tournamentSlugsValidator } from './lib/tournamentLookup';
import {
  bracketGames,
  bracketHasResult,
  clearResult,
  gameHasResult,
  refuseBracket,
  replaceBracket,
  saveResult,
  saveSeeds,
  storedResultOf,
  tournamentTeams,
} from './lib/tournamentBracket';

const gameTeamValidator = v.union(v.null(), v.object({ teamId: v.id('teams'), name: v.string() }));

const setupValidator = v.object({
  seeds: v.array(v.object({ teamId: v.id('teams'), name: v.string(), rosterCount: v.number() })),
  unconfirmedCount: v.number(),
  bracket: v.union(
    v.null(),
    v.object({
      hasResult: v.boolean(),
      winner: v.union(v.null(), gameTeamValidator),
      rounds: v.array(
        v.object({
          round: v.number(),
          name: v.string(),
          games: v.array(
            v.object({
              gameId: v.id('tournamentGames'),
              slot: v.number(),
              teams: v.array(gameTeamValidator),
              winnerTeamId: v.union(v.null(), v.id('teams')),
              result: v.union(
                v.null(),
                v.object({
                  score: scoreValidator,
                  forfeitTeamId: v.union(v.null(), v.id('teams')),
                  /** What an Undo or a Clear sends back as `expected`, so it acts only on this result. */
                  resultEnteredAt: v.number(),
                }),
              ),
              /** The next game has a result, so Undo, Clear, and Correct are refused. */
              locked: v.boolean(),
              reports: v.array(reportViewValidator),
            }),
          ),
        }),
      ),
    }),
  ),
});

function resultViewOf(game: Doc<'tournamentGames'>) {
  const stored = storedResultOf(game);
  return (
    stored && {
      score: stored.score,
      forfeitTeamId: stored.forfeitTeamId ?? null,
      // The one writer sets the time with the score, so 0 only satisfies the optional field's type.
      resultEnteredAt: game.resultEnteredAt ?? 0,
    }
  );
}

function nextHasResult(
  game: Doc<'tournamentGames'>,
  byId: ReadonlyMap<Id<'tournamentGames'>, Doc<'tournamentGames'>>,
): boolean {
  const next = game.nextGameId && byId.get(game.nextGameId);
  return next ? gameHasResult(next) : false;
}

async function bracketView(
  ctx: QueryCtx,
  games: readonly Doc<'tournamentGames'>[],
  teamNames: ReadonlyMap<Id<'teams'>, string>,
) {
  const names = new Map(teamNames);
  for (const teamId of games.flatMap((game) => game.teamIds)) {
    if (teamId === null || names.has(teamId)) continue;
    names.set(teamId, (await ctx.db.get('teams', teamId))?.name ?? '');
  }
  const reports = new Map<Id<'tournamentGames'>, Doc<'scoreReports'>[]>();
  for (const game of games) {
    const open = !gameHasResult(game) && game.teamIds.every((teamId) => teamId !== null);
    reports.set(game._id, open ? await reportsInPlaceOrder(ctx, game) : []);
  }
  const rounds = games.reduce((most, game) => Math.max(most, game.round), 0);
  const byId = new Map(games.map((game) => [game._id, game]));
  const final = games.find((game) => game.round === rounds);
  const winnerTeamId = final && gameHasResult(final) ? final.winnerTeamId : undefined;
  return {
    hasResult: bracketHasResult(games),
    winner: winnerTeamId ? { teamId: winnerTeamId, name: names.get(winnerTeamId) ?? '' } : null,
    rounds: Array.from({ length: rounds }, (_, index) => ({
      round: index + 1,
      name: roundName(index + 1, rounds),
      games: games
        .filter((game) => game.round === index + 1)
        .map((game) => ({
          gameId: game._id,
          slot: game.slot,
          teams: game.teamIds.map((teamId) =>
            teamId === null ? null : { teamId, name: names.get(teamId) ?? '' },
          ),
          winnerTeamId: game.winnerTeamId ?? null,
          result: gameHasResult(game) ? resultViewOf(game) : null,
          locked: nextHasResult(game, byId),
          reports: (reports.get(game._id) ?? []).map((reported) => ({
            reportId: reported._id,
            teamId: reported.teamId,
            teamName: names.get(reported.teamId) ?? '',
            score: reported.score,
            reportedAt: reported.reportedAt,
          })),
        })),
    })),
  };
}

export const getSetup = query({
  args: tournamentSlugsValidator.fields,
  returns: v.union(v.null(), setupValidator),
  handler: async (ctx, { orgSlug, tournamentSlug }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    // Null for any caller: the public page already shows whether the organization exists.
    if (!organization) return null;
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) {
      // Only staff learn that a web address is unused.
      await requireStaffOrForbidden(ctx, organization._id);
      return null;
    }
    await requireProgramOrganizerOrForbidden(ctx, found.program);
    const { tournament } = found;
    const { seeds, unconfirmedCount } = await tournamentTeams(ctx, tournament);
    const games = await bracketGames(ctx, tournament._id);
    return {
      seeds: seeds.map((team) => ({
        teamId: team._id,
        name: team.name,
        rosterCount: team.rosterCount,
      })),
      unconfirmedCount,
      bracket:
        games.length === 0
          ? null
          : await bracketView(ctx, games, new Map(seeds.map((team) => [team._id, team.name]))),
    };
  },
});

/** The answer names the new place, so the page can announce it. */
export const moveSeed = mutation({
  args: {
    tournamentId: v.id('tournaments'),
    teamId: v.id('teams'),
    direction: v.union(v.literal('up'), v.literal('down')),
  },
  returns: v.object({ seed: v.number(), seedCount: v.number() }),
  handler: async (ctx, { tournamentId, teamId, direction }) => {
    const { tournament } = await requireTournamentOrganizer(ctx, tournamentId);
    const team = await ctx.db.get('teams', teamId);
    if (team?.tournamentId !== tournament._id) throw new Error('Not allowed');
    if (bracketHasResult(await bracketGames(ctx, tournament._id))) {
      refuseBracket({ code: 'seedsLocked', message: BRACKET_MESSAGES.seedsLocked });
    }
    const { seeds } = await tournamentTeams(ctx, tournament);
    const index = seeds.findIndex((seeded) => seeded._id === teamId);
    if (index === -1) {
      refuseBracket({ code: 'notSeeded', message: BRACKET_MESSAGES.notSeeded(team.name) });
    }
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0) {
      refuseBracket({ code: 'firstSeed', message: BRACKET_MESSAGES.firstSeed(team.name) });
    }
    if (target >= seeds.length) {
      refuseBracket({ code: 'lastSeed', message: BRACKET_MESSAGES.lastSeed(team.name) });
    }
    const moved = [...seeds];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    await saveSeeds(ctx, moved);
    return { seed: target + 1, seedCount: moved.length };
  },
});

/** An existing bracket is replaced only when the caller says so, after the page has asked the organizer to confirm. */
export const createBracket = mutation({
  args: { tournamentId: v.id('tournaments'), replace: v.optional(v.boolean()) },
  returns: v.object({ gameCount: v.number(), replaced: v.boolean() }),
  handler: async (ctx, { tournamentId, replace }) => {
    const { tournament } = await requireTournamentOrganizer(ctx, tournamentId);
    const { seeds } = await tournamentTeams(ctx, tournament);
    if (seeds.length < MIN_BRACKET_TEAMS) {
      refuseBracket({ code: 'tooFewTeams', message: BRACKET_MESSAGES.tooFewTeams });
    }
    if (registrationIsOpen(tournament, Date.now())) {
      refuseBracket({
        code: 'registrationOpen',
        message: BRACKET_MESSAGES.registrationOpen(tournament.registrationDeadline),
      });
    }
    const existing = await bracketGames(ctx, tournament._id);
    if (bracketHasResult(existing)) {
      refuseBracket({ code: 'resultEntered', message: BRACKET_MESSAGES.resultEntered });
    }
    if (existing.length > 0 && replace !== true) {
      refuseBracket({ code: 'bracketExists', message: BRACKET_MESSAGES.bracketExists });
    }
    const gameCount = await replaceBracket(ctx, tournament._id, seeds, existing);
    return { gameCount, replaced: existing.length > 0 };
  },
});

const resultArgs = {
  gameId: v.id('tournamentGames'),
  score: v.optional(scoreValidator),
  forfeitTeamId: v.optional(v.id('teams')),
};

export const enterResult = mutation({
  args: resultArgs,
  returns: savedValidator,
  handler: async (ctx, { gameId, score, forfeitTeamId }) => {
    const access = await requireGameOrganizer(ctx, gameId);
    return saveFor(ctx, access, { score, forfeitTeamId }, false);
  },
});

export const correctResult = mutation({
  args: resultArgs,
  returns: savedValidator,
  handler: async (ctx, { gameId, score, forfeitTeamId }) => {
    const access = await requireGameOrganizer(ctx, gameId);
    return saveFor(ctx, access, { score, forfeitTeamId }, true);
  },
});

export const undoResult = mutation({
  args: {
    gameId: v.id('tournamentGames'),
    restore: v.optional(storedResultValidator),
    // The `resultEnteredAt` the page was shown. Absent from the previous release's frontend, which acts on whatever the game holds.
    expected: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { gameId, restore, expected }) => {
    const { game, tournament, program, user } = await requireGameOrganizer(ctx, gameId);
    await refuseUnlessReady(ctx, game, true);
    if (expected !== undefined && game.resultEnteredAt !== expected) {
      refuseBracket({ code: 'resultChanged', message: BRACKET_MESSAGES.resultChanged });
    }
    if (restore) {
      // The score of a forfeit is rebuilt, so a restore cannot store a forfeit with a score the sport does not give.
      const result =
        restore.forfeitTeamId === undefined
          ? checkedResult(game, tournament, program.sport, restore)
          : resultFrom(game, tournament, program.sport, { forfeitTeamId: restore.forfeitTeamId });
      await saveResult(ctx, game, { ...result, enteredBy: user._id });
    } else {
      await clearResult(ctx, game);
    }
    return null;
  },
});
