/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { BRACKET_MESSAGES } from './lib/bracket';
import type { Score } from './lib/sports';
import { TOURNAMENT_SLUGS, tournamentWorld, type TournamentWorld } from './tournamentWorld.setup';
import widenedSchema from './widenedSchema.setup';

// The release that adds double elimination widens the schema first, so this release's code has to hold up on the rows that release writes.

afterEach(() => {
  vi.useRealTimers();
});

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

const ONE_SET: Score = { kind: 'sets', sets: [{ a: 21, b: 15 }] };

let registeredAt = 1_000;

/** Six teams and a double-elimination tournament; `bracket` also creates the winners' bracket and puts a losers' bracket game and a grand final game beside it, as the next release writes them. */
async function world({
  bracket = true,
  structure = 'bracket',
}: { bracket?: boolean; structure?: 'bracket' | 'pools' } = {}) {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld(widenedSchema);
  const teamIds: Id<'teams'>[] = [];
  for (let number = 1; number <= 6; number++) {
    registeredAt += 1;
    teamIds.push(
      await s.t.run((ctx) =>
        ctx.db.insert('teams', {
          organizationId: s.a,
          tournamentId: s.gulf,
          name: `Team ${number}`,
          sortName: `team ${number}`,
          captainUserId: s.captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        }),
      ),
    );
  }
  await s.t.run((ctx) =>
    ctx.db.patch('tournaments', s.gulf, {
      bracketType: 'double',
      grandFinal: 'single',
      structure,
    } as never),
  );
  if (bracket)
    await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
  if (bracket) await addDoubleRows(s);
  return { s, teamIds };
}

async function addDoubleRows(s: TournamentWorld) {
  await s.t.run(async (ctx) => {
    for (const stage of ['losers', 'grandFinal'] as const) {
      await ctx.db.insert('tournamentGames', {
        tournamentId: s.gulf,
        stage,
        round: 1,
        slot: 1,
        teamIds: [null, null],
      } as never);
    }
  });
}

/** Six teams in 2 pools of 3, every pool game played, and a way to create the bracket from the pool finish. */
async function poolsWorld() {
  const { s, teamIds } = await world({ bracket: false, structure: 'pools' });
  await s
    .as(s.admin)
    .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 });
  await s.as(s.admin).mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf });
  const pool = await gamesAt(s, 'pool');
  for (const game of pool) {
    const firstWins = teamIds.indexOf(game.teamIds[0]!) < teamIds.indexOf(game.teamIds[1]!);
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: game._id,
      score: firstWins ? ONE_SET : { kind: 'sets', sets: [{ a: 15, b: 21 }] },
    });
  }
  const createFromPools = async () => {
    const { ranked } = (await s
      .as(s.admin)
      .query(api.tournamentGames.getPoolBracket, TOURNAMENT_SLUGS))!;
    return s.as(s.admin).mutation(api.tournamentGames.createBracketFromPools, {
      tournamentId: s.gulf,
      advancePerPool: 2,
      expectedRanking: ranked.map((team) => team.teamId),
      replace: true,
    });
  };
  return { s, teamIds, pool, createFromPools };
}

const gamesAt = (s: TournamentWorld, stage: string) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', stage as never))
      .collect(),
  );

const winnersGame = async (s: TournamentWorld, round: number, slot: number) =>
  (await gamesAt(s, 'bracket')).find((game) => game.round === round && game.slot === slot)!;

describe('getForCopy on a double-elimination tournament', () => {
  test('answers with the bracket type and the grand final', async () => {
    const { s } = await world({ bracket: false });
    const copy = await s.as(s.admin).query(api.tournaments.getForCopy, {
      organizationSlug: 'org-a',
      slug: TOURNAMENT_SLUGS.tournamentSlug,
    });
    expect(copy).toMatchObject({ bracketType: 'double', grandFinal: 'single' });
  });
});

describe('scoreReports.forTeam on a double-elimination tournament', () => {
  test('reports a bracket game as a bracket game and a pool game as a pool game', async () => {
    const { s, teamIds } = await world();
    const view = await s.as(s.captain).query(api.scoreReports.forTeam, { teamId: teamIds[3] });
    expect(view!.games.map((game) => game.stage)).toEqual(['bracket']);
  });
});

describe('recreating a double-elimination bracket', () => {
  test('replaces the losers’ bracket and the grand final as well', async () => {
    const { s } = await world();
    await s
      .as(s.admin)
      .mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf, replace: true });
    expect(await gamesAt(s, 'losers')).toEqual([]);
    expect(await gamesAt(s, 'grandFinal')).toEqual([]);
    expect(await gamesAt(s, 'bracket')).toHaveLength(7);
  });

  test('is refused once a losers’ bracket game has a result, and writes nothing', async () => {
    const { s, teamIds } = await world();
    const [loserGame] = await gamesAt(s, 'losers');
    await s.t.run((ctx) =>
      ctx.db.patch('tournamentGames', loserGame._id, {
        teamIds: [teamIds[0], teamIds[1]],
        winnerTeamId: teamIds[0],
        score: ONE_SET,
      }),
    );
    const before = await s.t.run((ctx) => ctx.db.query('tournamentGames').collect());
    expect(
      await s
        .as(s.admin)
        .mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf, replace: true })
        .catch(refusalOf),
    ).toMatchObject({ code: 'resultEntered' });
    expect(await s.t.run((ctx) => ctx.db.query('tournamentGames').collect())).toEqual(before);
  });

  test('from the pool finish replaces them too, and keeps the pool games', async () => {
    const { s, pool, createFromPools } = await poolsWorld();
    await createFromPools();
    await addDoubleRows(s);
    await createFromPools();
    expect(await gamesAt(s, 'losers')).toEqual([]);
    expect(await gamesAt(s, 'grandFinal')).toEqual([]);
    expect(await gamesAt(s, 'pool')).toHaveLength(pool.length);
  });
});

describe('a double-elimination tournament before the release that plays it', () => {
  const refusal = {
    code: 'bracketTypeUnsupported',
    message: BRACKET_MESSAGES.bracketTypeUnsupported,
  };

  async function played() {
    const { s, teamIds } = await world();
    const game = await winnersGame(s, 1, 2);
    return { s, teamIds, game };
  }

  test('refuses a result, a correction, and an undo, and writes nothing', async () => {
    const { s, game } = await played();
    const before = await s.t.run((ctx) => ctx.db.query('tournamentGames').collect());
    const as = s.as(s.admin);
    for (const run of [
      () => as.mutation(api.tournamentGames.enterResult, { gameId: game._id, score: ONE_SET }),
      () => as.mutation(api.tournamentGames.correctResult, { gameId: game._id, score: ONE_SET }),
      () => as.mutation(api.tournamentGames.undoResult, { gameId: game._id }),
    ]) {
      expect(await run().catch(refusalOf)).toMatchObject(refusal);
    }
    expect(await s.t.run((ctx) => ctx.db.query('tournamentGames').collect())).toEqual(before);
  });

  test('refuses to confirm a captain’s report, and keeps the report', async () => {
    const { s, teamIds, game } = await played();
    await s.as(s.captain).mutation(api.scoreReports.report, {
      gameId: game._id,
      teamId: game.teamIds[0]!,
      score: ONE_SET,
    });
    const [report] = await s.t.run((ctx) => ctx.db.query('scoreReports').collect());
    expect(teamIds).toContain(report.teamId);
    expect(
      await s
        .as(s.admin)
        .mutation(api.scoreReports.confirm, { reportId: report._id, expected: report.reportedAt })
        .catch(refusalOf),
    ).toMatchObject(refusal);
    expect((await winnersGame(s, 1, 2)).winnerTeamId).toBeUndefined();
    expect(await s.t.run((ctx) => ctx.db.query('scoreReports').collect())).toHaveLength(1);
  });

  test('still takes the results of its pool games', async () => {
    const { s } = await world({ bracket: false, structure: 'pools' });
    await s
      .as(s.admin)
      .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 });
    await s.as(s.admin).mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf });
    const [pool] = await gamesAt(s, 'pool');
    await s
      .as(s.admin)
      .mutation(api.tournamentGames.enterResult, { gameId: pool._id, score: ONE_SET });
    expect((await gamesAt(s, 'pool')).filter((game) => game.winnerTeamId)).toHaveLength(1);
  });

  test('names no winner on the organizer’s page and the public page when the winners’ final has a result', async () => {
    const { s, teamIds } = await world();
    const final = await winnersGame(s, 3, 1);
    await s.t.run((ctx) =>
      ctx.db.patch('tournamentGames', final._id, {
        teamIds: [teamIds[0], teamIds[1]],
        winnerTeamId: teamIds[0],
        score: ONE_SET,
      } as Partial<Doc<'tournamentGames'>>),
    );
    const setup = await s.as(s.admin).query(api.tournamentGames.getSetup, TOURNAMENT_SLUGS);
    expect(setup!.bracket!.winner).toBeNull();
    const page = await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS);
    expect(page!.bracket!.winner).toBeUndefined();
  });

  test('names no winner on the pool page either, when the final of the bracket from the pools has a result', async () => {
    const { s, teamIds, createFromPools } = await poolsWorld();
    await createFromPools();
    const final = await winnersGame(s, 2, 1);
    await s.t.run((ctx) =>
      ctx.db.patch('tournamentGames', final._id, {
        teamIds: [teamIds[0], teamIds[1]],
        winnerTeamId: teamIds[0],
        score: ONE_SET,
      }),
    );
    const view = await s.as(s.admin).query(api.tournamentGames.getPoolBracket, TOURNAMENT_SLUGS);
    expect(view!.bracket!.winner).toBeNull();
  });

  test('names the winner of a single-elimination tournament as before', async () => {
    const { s, teamIds } = await world();
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { bracketType: 'single' } as never));
    const final = await winnersGame(s, 3, 1);
    await s.t.run((ctx) =>
      ctx.db.patch('tournamentGames', final._id, {
        teamIds: [teamIds[0], teamIds[1]],
        winnerTeamId: teamIds[0],
        score: ONE_SET,
      }),
    );
    const page = await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS);
    expect(page!.bracket!.winner).toBe('Team 1');
  });
});
