/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { BRACKET_MESSAGES } from './lib/bracket';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { POOL_MESSAGES } from './lib/pools';
import type { Score } from './lib/sports';
import {
  TOURNAMENT_SLUGS,
  tournamentWorld,
  type Person,
  type TournamentWorld,
} from './tournamentWorld.setup';

afterEach(() => {
  vi.useRealTimers();
});

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

const set = (a: number, b: number): Score => ({ kind: 'sets', sets: [{ a, b }] });

let registeredAt = 1_000;

/**
 * Six teams in 2 pools of 3, with the pool games created and no result entered: Pool A holds Team 01, Team 04,
 * and Team 05, and Pool B holds Team 02, Team 03, and Team 06.
 */
async function world() {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { structure: 'pools' }));
  const teamIds: Id<'teams'>[] = [];
  for (let number = 1; number <= 6; number++) {
    registeredAt += 1;
    teamIds.push(
      await s.t.run((ctx) =>
        ctx.db.insert('teams', {
          organizationId: s.a,
          tournamentId: s.gulf,
          name: `Team ${String(number).padStart(2, '0')}`,
          sortName: `team ${number}`,
          captainUserId: s.captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        }),
      ),
    );
  }
  await s
    .as(s.admin)
    .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 });
  await s.as(s.admin).mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf });
  return { s, teamIds };
}

const poolGames = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'pool'))
      .collect(),
  );

const bracketGames = (s: TournamentWorld) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'bracket'))
      .collect(),
  );

/** The lower-numbered team of each game wins 21 to 15, for the first `count` games, or every game. */
async function playPoolGames(
  s: TournamentWorld,
  teamIds: readonly Id<'teams'>[],
  count = Infinity,
): Promise<void> {
  const number = (teamId: Id<'teams'> | null) => teamIds.indexOf(teamId!) + 1;
  for (const game of (await poolGames(s)).slice(0, count)) {
    const firstWins = number(game.teamIds[0]) < number(game.teamIds[1]);
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: game._id,
      score: firstWins ? set(21, 15) : set(15, 21),
    });
  }
}

const create = (
  s: TournamentWorld,
  args: { advancePerPool: number; seedOrder?: Id<'teams'>[]; replace?: boolean },
  who: Pick<Person, 'authUserId' | 'name'> = s.admin,
) =>
  s.as(who).mutation(api.tournamentGames.createBracketFromPools, { tournamentId: s.gulf, ...args });

const view = (s: TournamentWorld, who: Pick<Person, 'authUserId' | 'name'> = s.admin) =>
  s.as(who).query(api.tournamentGames.getPoolBracket, TOURNAMENT_SLUGS);

const teamNames = async (s: TournamentWorld, teamIds: readonly (Id<'teams'> | null)[]) =>
  Promise.all(
    teamIds.map(async (teamId) =>
      teamId ? (await s.t.run((ctx) => ctx.db.get('teams', teamId)))!.name : null,
    ),
  );

describe('tournamentGames.getPoolBracket', () => {
  test('counts the pool games without a confirmed result and offers no seeds until none is left', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds, 3);
    expect(await view(s)).toMatchObject({
      poolCount: 2,
      smallestPool: 3,
      gamesCreated: true,
      gamesWithoutResult: 3,
      ranked: [],
      bracket: null,
    });
  });

  test('lists the seeds from the pool results once every pool game has a confirmed result', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    const shown = (await view(s))!;
    expect(shown.gamesWithoutResult).toBe(0);
    expect(shown.ranked.map((team) => [team.name, team.pool, team.place])).toEqual([
      ['Team 01', 'A', 1],
      ['Team 02', 'B', 1],
      ['Team 04', 'A', 2],
      ['Team 03', 'B', 2],
      ['Team 05', 'A', 3],
      ['Team 06', 'B', 3],
    ]);
  });

  test('has no games to wait for before the pool games are created', async () => {
    const { s } = await world();
    await s.t.run(async (ctx) => {
      for (const game of await ctx.db.query('tournamentGames').collect()) {
        await ctx.db.delete('tournamentGames', game._id);
      }
    });
    expect(await view(s)).toMatchObject({ gamesCreated: false, gamesWithoutResult: 0, ranked: [] });
  });
});

describe('tournamentGames.createBracketFromPools', () => {
  test('seeds the winners and then the runners-up, and pairs seed 1 against seed 4', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    const created = await create(s, { advancePerPool: 2 });
    expect(created).toEqual({ gameCount: 3, replaced: false, teamCount: 4 });
    const first = (await bracketGames(s)).filter((game) => game.round === 1);
    expect(await Promise.all(first.map((game) => teamNames(s, game.teamIds)))).toEqual([
      ['Team 01', 'Team 03'],
      ['Team 02', 'Team 04'],
    ]);
  });

  test('saves the bracket seeds, then the teams that did not advance in order after them', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    await create(s, { advancePerPool: 2 });
    const seeds = await s.t.run(async (ctx) =>
      (await ctx.db.query('teams').collect()).map((team) => [team.name, team.seed]),
    );
    expect(seeds.sort()).toEqual([
      ['Team 01', 1],
      ['Team 02', 2],
      ['Team 03', 4],
      ['Team 04', 3],
      ['Team 05', 5],
      ['Team 06', 6],
    ]);
  });

  test('uses the order the organizer chose when it holds the same teams', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    await create(s, {
      advancePerPool: 2,
      seedOrder: [teamIds[1], teamIds[0], teamIds[2], teamIds[3]],
    });
    const first = (await bracketGames(s)).filter((game) => game.round === 1);
    expect(await Promise.all(first.map((game) => teamNames(s, game.teamIds)))).toEqual([
      ['Team 02', 'Team 04'],
      ['Team 01', 'Team 03'],
    ]);
  });

  test.each([
    ['a team that did not advance', (ids: Id<'teams'>[]) => [ids[0], ids[1], ids[2], ids[4]]],
    ['a team missing', (ids: Id<'teams'>[]) => [ids[0], ids[1], ids[2]]],
    ['a team twice', (ids: Id<'teams'>[]) => [ids[0], ids[1], ids[2], ids[2]]],
  ])('refuses an order with %s', async (_label, order) => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    expect(
      await create(s, { advancePerPool: 2, seedOrder: order(teamIds) }).catch(refusalOf),
    ).toEqual({
      code: 'seedsChanged',
      message: POOL_MESSAGES.seedsChanged,
    });
    expect(await bracketGames(s)).toEqual([]);
  });

  test('refuses an advance above the smallest pool, none, and a part of a team', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    for (const advancePerPool of [4, 0, 1.5]) {
      expect(await create(s, { advancePerPool }).catch(refusalOf)).toEqual({
        code: 'advanceCount',
        message: POOL_MESSAGES.advanceCount(3),
      });
    }
    expect(await bracketGames(s)).toEqual([]);
  });

  test('advances 1 from each pool into a 2-team bracket', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    expect(await create(s, { advancePerPool: 1 })).toMatchObject({ gameCount: 1, teamCount: 2 });
  });

  test('refuses while pool games lack a confirmed result, naming how many', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds, 3);
    expect(await create(s, { advancePerPool: 2 }).catch(refusalOf)).toEqual({
      code: 'poolGamesPending',
      message: '3 pool games still need a confirmed result.',
    });
    expect(await bracketGames(s)).toEqual([]);
  });

  test('refuses before the pool games are created', async () => {
    const { s } = await world();
    await s.t.run(async (ctx) => {
      for (const game of await ctx.db.query('tournamentGames').collect()) {
        await ctx.db.delete('tournamentGames', game._id);
      }
    });
    expect(await create(s, { advancePerPool: 2 }).catch(refusalOf)).toMatchObject({
      code: 'noPoolGames',
    });
  });

  test('refuses a Bracket only tournament', async () => {
    const { s } = await world();
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { structure: 'bracket' }));
    expect(await create(s, { advancePerPool: 2 }).catch(refusalOf)).toMatchObject({
      code: 'notPools',
    });
  });

  test('replaces a bracket only when told to, and not once a bracket game has a result', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    await create(s, { advancePerPool: 2 });
    expect(await create(s, { advancePerPool: 2 }).catch(refusalOf)).toMatchObject({
      code: 'bracketExists',
    });
    expect(await create(s, { advancePerPool: 1, replace: true })).toEqual({
      gameCount: 1,
      replaced: true,
      teamCount: 2,
    });
    expect(await bracketGames(s)).toHaveLength(1);
    const [final] = await bracketGames(s);
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: final._id,
      score: set(21, 10),
    });
    expect(await create(s, { advancePerPool: 1, replace: true }).catch(refusalOf)).toMatchObject({
      code: 'resultEntered',
      message: BRACKET_MESSAGES.resultEntered,
    });
  });

  test('shows the bracket with the Pools section on the public page', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    await create(s, { advancePerPool: 2 });
    const page = (await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS))!;
    expect(page.pools).toHaveLength(2);
    expect(page.bracket?.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);
    expect(page.bracket?.rounds[0].games[0].teams).toEqual([
      { name: 'Team 01', seed: 1 },
      { name: 'Team 03', seed: 4 },
    ]);
  });

  test('shows the bracket with its games in the view', async () => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    await create(s, { advancePerPool: 2 });
    const shown = (await view(s))!;
    expect(shown.bracket?.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);
  });
});

describe('pool results once the bracket exists', () => {
  async function withBracket() {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    await create(s, { advancePerPool: 2 });
    const [game] = await poolGames(s);
    return { s, teamIds, game };
  }

  const frozen = { code: 'poolsFrozen', message: POOL_MESSAGES.poolsFrozen };

  test('refuses correcting a pool result', async () => {
    const { s, game } = await withBracket();
    expect(
      await s
        .as(s.admin)
        .mutation(api.tournamentGames.correctResult, { gameId: game._id, score: set(21, 19) })
        .catch(refusalOf),
    ).toMatchObject(frozen);
  });

  test('refuses entering a pool result again, and undoing one', async () => {
    const { s, game } = await withBracket();
    expect(
      await s
        .as(s.admin)
        .mutation(api.tournamentGames.enterResult, { gameId: game._id, score: set(21, 19) })
        .catch(refusalOf),
    ).toMatchObject(frozen);
    expect(
      await s
        .as(s.admin)
        .mutation(api.tournamentGames.undoResult, { gameId: game._id })
        .catch(refusalOf),
    ).toMatchObject(frozen);
  });

  test('refuses confirming a captain report on a pool game', async () => {
    const { s, game } = await withBracket();
    const reportId = await s.t.run((ctx) =>
      ctx.db.insert('scoreReports', {
        gameId: game._id,
        teamId: game.teamIds[0]!,
        reportedByUserId: s.captain.userId,
        score: set(21, 19),
        reportedAt: 5,
      }),
    );
    expect(
      await s
        .as(s.admin)
        .mutation(api.scoreReports.confirm, { reportId, expected: 5 })
        .catch(refusalOf),
    ).toMatchObject(frozen);
  });

  test('leaves the pool results as they were', async () => {
    const { s, game } = await withBracket();
    await s
      .as(s.admin)
      .mutation(api.tournamentGames.correctResult, { gameId: game._id, score: set(21, 19) })
      .catch(() => undefined);
    const stored = (await s.t.run((ctx) => ctx.db.get('tournamentGames', game._id)))!;
    expect(stored.score).toEqual(set(21, 15));
  });

  test('still takes a bracket result', async () => {
    const { s } = await withBracket();
    const [semi] = await bracketGames(s);
    await s
      .as(s.admin)
      .mutation(api.tournamentGames.enterResult, { gameId: semi._id, score: set(21, 10) });
    const stored = (await s.t.run((ctx) => ctx.db.get('tournamentGames', semi._id)))!;
    expect(stored.winnerTeamId).toBe(semi.teamIds[0]);
  });
});

describe('access to the pool bracket functions', () => {
  const NOT_ALLOWED = ['stranger', 'foreignAdmin', 'otherOrganizer', 'leagueOrganizer'] as const;

  test.each(NOT_ALLOWED)('%s is refused by both functions', async (who) => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    expect(await view(s, s[who]).catch(refusalOf)).toEqual({ code: FORBIDDEN_CODE });
    await expect(create(s, { advancePerPool: 2 }, s[who])).rejects.toThrow(/Not allowed/);
    expect(await bracketGames(s)).toEqual([]);
  });

  test('a signed-out caller is refused by both functions', async () => {
    const { s } = await world();
    expect(
      await s.t.query(api.tournamentGames.getPoolBracket, TOURNAMENT_SLUGS).catch(refusalOf),
    ).toEqual({ code: FORBIDDEN_CODE });
    await expect(
      s.t.mutation(api.tournamentGames.createBracketFromPools, {
        tournamentId: s.gulf,
        advancePerPool: 2,
      }),
    ).rejects.toThrow(/Sign in required/);
  });

  test.each(['admin', 'assignedOrganizer'] as const)('%s may create the bracket', async (who) => {
    const { s, teamIds } = await world();
    await playPoolGames(s, teamIds);
    await create(s, { advancePerPool: 2 }, s[who]);
    expect(await bracketGames(s)).toHaveLength(3);
  });
});
