import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  requireProgramOrganizerOrForbidden,
  requireStaffOrForbidden,
  requireTournamentOrganizer,
} from './lib/access';
import { BRACKET_MESSAGES, MIN_BRACKET_TEAMS, roundName } from './lib/bracket';
import { registrationIsOpen } from './lib/registration';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { findTournamentBySlugs, tournamentSlugsValidator } from './lib/tournamentLookup';
import {
  bracketGames,
  bracketHasResult,
  refuseBracket,
  replaceBracket,
  saveSeeds,
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
            }),
          ),
        }),
      ),
    }),
  ),
});

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
  const rounds = games.reduce((most, game) => Math.max(most, game.round), 0);
  return {
    hasResult: bracketHasResult(games),
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
