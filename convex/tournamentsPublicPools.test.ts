/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { type Score, type Sport } from './lib/sports';
import { STANDINGS_TIEBREAKER_NOTES } from './lib/standings';
import { poolResults } from './lib/tournamentPoolBracket';
import { TOURNAMENT_SLUGS, tournamentWorld, type TournamentWorld } from './tournamentWorld.setup';

afterEach(() => {
  vi.useRealTimers();
});

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

let registeredAt = 1_000;

/**
 * Six teams in 2 pools of 3: Pool A holds Team 01, Team 04, and Team 05, Pool B Team 02, Team 03, and Team 06.
 * Eight teams make 2 pools of 4: Pool A holds Team 01, Team 04, Team 05, and Team 08.
 */
async function worldWithPools(sport: Sport = 'beachVolleyball', createGames = true, teamCount = 6) {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  await s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', s.gulf))!;
    await ctx.db.patch('tournaments', s.gulf, { structure: 'pools', sport });
    await ctx.db.patch('programs', tournament.programId, { sport });
  });
  const teamIds: Id<'teams'>[] = [];
  for (let number = 1; number <= teamCount; number++) {
    registeredAt += 1;
    teamIds.push(
      await s.t.run(async (ctx) => {
        const tournament = (await ctx.db.get('tournaments', s.gulf))!;
        return ctx.db.insert('teams', {
          organizationId: tournament.organizationId,
          tournamentId: s.gulf,
          name: `Team ${String(number).padStart(2, '0')}`,
          sortName: `team ${number}`,
          captainUserId: s.captain.userId,
          rosterCount: 2,
          createdAt: registeredAt,
        });
      }),
    );
  }
  await s
    .as(s.admin)
    .mutation(api.tournamentGames.splitPools, { tournamentId: s.gulf, poolCount: 2 });
  if (createGames) {
    await s.as(s.admin).mutation(api.tournamentGames.createPoolGames, { tournamentId: s.gulf });
  }
  return { s, teamIds };
}

const publicPage = (s: TournamentWorld) =>
  s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS);

const poolsOf = async (s: TournamentWorld) => (await publicPage(s))?.pools;

async function gameBetween(
  s: TournamentWorld,
  teamIds: readonly Id<'teams'>[],
  first: number,
  second: number,
) {
  const wanted = [teamIds[first - 1], teamIds[second - 1]];
  const games = await s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'pool'))
      .collect(),
  );
  return games.find((game) => wanted.every((teamId) => game.teamIds.includes(teamId)))!;
}

/** Enters a result, with `winnerPoints` for the team numbered `winner` and `loserPoints` for the other. */
async function play(
  s: TournamentWorld,
  teamIds: readonly Id<'teams'>[],
  [winner, loser]: [number, number],
  [winnerPoints, loserPoints]: [number, number],
  sport: Sport = 'beachVolleyball',
) {
  const game = await gameBetween(s, teamIds, winner, loser);
  const winnerFirst = game.teamIds[0] === teamIds[winner - 1];
  const a = winnerFirst ? winnerPoints : loserPoints;
  const b = winnerFirst ? loserPoints : winnerPoints;
  const score: Score =
    sport === 'beachVolleyball'
      ? { kind: 'sets', sets: [{ a, b }] }
      : { kind: sport === 'soccer' ? 'goals' : 'runs', a, b };
  await s.as(s.admin).mutation(api.tournamentGames.enterResult, { gameId: game._id, score });
}

describe('tournaments.getPublicPage: pools', () => {
  test('has no pools for a tournament with no pool games', async () => {
    const { s } = await worldWithPools('beachVolleyball', false);
    expect((await publicPage(s))!.pools).toBeUndefined();
  });

  test('has no pools for a bracket only tournament', async () => {
    vi.useFakeTimers({ now: AFTER_DEADLINE });
    const s = await tournamentWorld();
    expect((await publicPage(s))!.pools).toBeUndefined();
  });

  test('lists each pool with its teams in seed order and its games, before any result', async () => {
    const { s } = await worldWithPools();
    const pools = (await poolsOf(s))!;
    expect(pools.map((pool) => pool.pool)).toEqual(['A', 'B']);
    const [a, b] = pools;
    expect(a.standings.map((row) => row.name)).toEqual(['Team 01', 'Team 04', 'Team 05']);
    expect(b.standings.map((row) => row.name)).toEqual(['Team 02', 'Team 03', 'Team 06']);
    expect(a.standings.every((row) => row.place === 1)).toBe(true);
    expect(a.standings[0].cells).toEqual(['0', '0', '0', '0%', '0']);
    expect(a.games).toHaveLength(3);
    expect(a.games.every((game) => game.score === undefined && game.winner === undefined)).toBe(
      true,
    );
    expect(a.games.flatMap((game) => game.teams).sort()).toEqual([
      'Team 01',
      'Team 01',
      'Team 04',
      'Team 04',
      'Team 05',
      'Team 05',
    ]);
    expect(a.tiebreakers).toBe(STANDINGS_TIEBREAKER_NOTES.beachVolleyball);
    expect(a.columns.map((column) => column.short)).toEqual(['P', 'W', 'L', 'Win %', '+/-']);
  });

  test('orders each pool by the sport’s standings rules once results are in', async () => {
    const { s, teamIds } = await worldWithPools();
    await play(s, teamIds, [4, 1], [21, 15]);
    await play(s, teamIds, [4, 5], [21, 10]);
    await play(s, teamIds, [1, 5], [21, 19]);
    const [a, b] = (await poolsOf(s))!;
    expect(a.standings).toEqual([
      { place: 1, name: 'Team 04', cells: ['2', '2', '0', '100%', '+17'] },
      { place: 2, name: 'Team 01', cells: ['2', '1', '1', '50%', '-4'] },
      { place: 3, name: 'Team 05', cells: ['2', '0', '2', '0%', '-13'] },
    ]);
    expect(b.standings.every((row) => row.place === 1 && row.cells[0] === '0')).toBe(true);
  });

  test('shows a played game with its score and winner, and an unplayed one with neither', async () => {
    const { s, teamIds } = await worldWithPools();
    await play(s, teamIds, [4, 1], [21, 15]);
    const [a] = (await poolsOf(s))!;
    const played = a.games.find(
      (game) => game.teams.includes('Team 04') && game.teams.includes('Team 01'),
    )!;
    expect(played.winner).toBe(played.teams.indexOf('Team 04'));
    expect(played.score).toMatchObject({ kind: 'sets' });
    const unplayed = a.games.filter((game) => game !== played);
    expect(unplayed.every((game) => game.score === undefined && game.winner === undefined)).toBe(
      true,
    );
  });

  test('counts a tie in soccer as a point each, and shows the game with a score and no winner', async () => {
    const { s, teamIds } = await worldWithPools('soccer');
    const tied = await gameBetween(s, teamIds, 1, 4);
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: tied._id,
      score: { kind: 'goals', a: 2, b: 2 },
    });
    await play(s, teamIds, [1, 5], [1, 0], 'soccer');
    const [a] = (await poolsOf(s))!;
    expect(a.standings).toEqual([
      { place: 1, name: 'Team 01', cells: ['2', '1', '1', '0', '+1', '4'] },
      { place: 2, name: 'Team 04', cells: ['1', '0', '1', '0', '0', '1'] },
      { place: 3, name: 'Team 05', cells: ['1', '0', '0', '1', '-1', '0'] },
    ]);
    const shown = a.games.find(
      (game) => game.score?.kind === 'goals' && game.winner === undefined,
    )!;
    expect(shown.score).toEqual({ kind: 'goals', a: 2, b: 2 });
  });

  test('counts a forfeit as a loss at the forfeit score, and shows who forfeited instead of the score', async () => {
    const { s, teamIds } = await worldWithPools('softball');
    const game = await gameBetween(s, teamIds, 1, 4);
    await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
      gameId: game._id,
      forfeitTeamId: teamIds[0],
    });
    const [a] = (await poolsOf(s))!;
    expect(a.standings).toEqual([
      { place: 1, name: 'Team 04', cells: ['1', '1', '0', '0', '100%'] },
      { place: 2, name: 'Team 05', cells: ['0', '0', '0', '0', '0%'] },
      { place: 3, name: 'Team 01', cells: ['1', '0', '1', '0', '0%'] },
    ]);
    const shown = a.games.find((row) => row.forfeit !== undefined)!;
    expect(shown.teams[shown.forfeit!]).toBe('Team 01');
    expect(shown.score).toBeUndefined();
  });

  test('changes with a correction and with a cleared result', async () => {
    const { s, teamIds } = await worldWithPools();
    await play(s, teamIds, [4, 1], [21, 15]);
    const game = await gameBetween(s, teamIds, 1, 4);
    const winnerFirst = game.teamIds[0] === teamIds[0];
    await s.as(s.admin).mutation(api.tournamentGames.correctResult, {
      gameId: game._id,
      score: { kind: 'sets', sets: [winnerFirst ? { a: 21, b: 5 } : { a: 5, b: 21 }] },
    });
    expect((await poolsOf(s))![0].standings.map((row) => row.name).slice(0, 1)).toEqual([
      'Team 01',
    ]);
    await s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId: game._id });
    expect((await poolsOf(s))![0].standings.every((row) => row.place === 1)).toBe(true);
  });

  test('holds no id, because the page is cached and saved offline', async () => {
    const { s, teamIds } = await worldWithPools();
    await play(s, teamIds, [4, 1], [21, 15]);
    const text = JSON.stringify((await poolsOf(s))!);
    for (const teamId of teamIds) expect(text).not.toContain(teamId);
  });

  test('answers a signed-out caller, because a published tournament is public', async () => {
    const { s, teamIds } = await worldWithPools();
    await play(s, teamIds, [4, 1], [21, 15]);
    expect(await poolsOf(s)).toHaveLength(2);
  });

  test('does not show a draft tournament’s pools', async () => {
    const { s } = await worldWithPools();
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', s.gulf))!;
      await ctx.db.patch('programs', tournament.programId, { status: 'draft' });
    });
    expect(await publicPage(s)).toBeNull();
  });
});

describe('tournaments.getPublicPage: pool order follows the bracket', () => {
  test('lists teams level on everything but what they scored against each other by that score, at one shared place', async () => {
    // Each of Team 01, 04, and 05 beats one of the others by 6, so they score 45, 40, and 49 against each other.
    const { s, teamIds } = await worldWithPools();
    await play(s, teamIds, [1, 4], [21, 15]);
    await play(s, teamIds, [4, 5], [25, 19]);
    await play(s, teamIds, [5, 1], [30, 24]);
    const [a] = (await poolsOf(s))!;
    expect(a.standings.map((row) => [row.place, row.name])).toEqual([
      [1, 'Team 05'],
      [1, 'Team 01'],
      [1, 'Team 04'],
    ]);
  });

  test('keeps a team that has not played the level teams in the given order with them, in the soccer pool of 4', async () => {
    // Team 05 beat Team 04, and Team 01 played neither; Teams 01, 04, and 05 are level on points, goal difference, and goals scored.
    const { s, teamIds } = await worldWithPools('soccer', true, 8);
    await play(s, teamIds, [5, 4], [2, 0], 'soccer');
    await play(s, teamIds, [8, 5], [2, 1], 'soccer');
    await play(s, teamIds, [4, 8], [3, 0], 'soccer');
    await play(s, teamIds, [1, 8], [3, 2], 'soccer');
    const [a] = (await poolsOf(s))!;
    expect(a.standings.map((row) => [row.place, row.name])).toEqual([
      [1, 'Team 01'],
      [1, 'Team 04'],
      [1, 'Team 05'],
      [4, 'Team 08'],
    ]);
  });

  test('leaves a team that is no longer confirmed out of the table and the bracket’s results, and keeps its game', async () => {
    const { s, teamIds } = await worldWithPools();
    await play(s, teamIds, [4, 1], [21, 15]);
    await play(s, teamIds, [4, 5], [21, 10]);
    await s.t.run((ctx) => ctx.db.patch('teams', teamIds[3], { rosterCount: 0 }));
    const [a] = (await poolsOf(s))!;
    expect(a.standings.map((row) => row.name)).toEqual(['Team 01', 'Team 05']);
    expect(a.games).toHaveLength(3);
    expect(a.games.flatMap((game) => game.teams)).toContain('Team 04');
    const results = await s.t.run(async (ctx) =>
      poolResults(ctx, (await ctx.db.get('tournaments', s.gulf))!, 'beachVolleyball'),
    );
    expect(
      results.ranked.filter((seed) => seed.pool === 'A').map((seed) => seed.team.name),
    ).toEqual(['Team 01', 'Team 05']);
  });
});

/** A repeatable stream of numbers in [0, 1), so a failing case can be played again. */
function randoms(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('tournaments.getPublicPage: the rows are the order the bracket takes', () => {
  // Narrow ranges make level teams common, and a fixed margin makes a circle of wins level on everything but the points scored.
  const pick = (random: () => number, values: readonly number[]) =>
    values[Math.floor(random() * values.length)];
  const SCORES: Record<Sport, (random: () => number) => Score> = {
    beachVolleyball: (random) => {
      const winner = pick(random, [21, 23, 25]);
      const loser = winner - 6;
      return {
        kind: 'sets',
        sets: [random() < 0.5 ? { a: winner, b: loser } : { a: loser, b: winner }],
      };
    },
    soccer: (random) => ({ kind: 'goals', a: pick(random, [0, 1, 2]), b: pick(random, [0, 1, 2]) }),
    softball: (random) => ({
      kind: 'runs',
      a: pick(random, [0, 1, 3]),
      b: pick(random, [0, 1, 3]),
    }),
  };

  for (const sport of ['beachVolleyball', 'soccer', 'softball'] as const) {
    test(`matches each pool’s order in the pool results over part-played and finished ${sport} pools`, async () => {
      const { s } = await worldWithPools(sport);
      const random = randoms(746);
      const games = await s.t.run((ctx) =>
        ctx.db
          .query('tournamentGames')
          .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'pool'))
          .collect(),
      );
      let scoredAmongThem = 0;
      for (let trial = 0; trial < 30; trial++) {
        const share = trial % 2 === 0 ? 1 : 0.6;
        const entered: Id<'tournamentGames'>[] = [];
        for (const game of games) {
          if (random() >= share) continue;
          await s.as(s.admin).mutation(api.tournamentGames.enterResult, {
            gameId: game._id,
            score: SCORES[sport](random),
          });
          entered.push(game._id);
        }
        const results = await s.t.run(async (ctx) =>
          poolResults(ctx, (await ctx.db.get('tournaments', s.gulf))!, sport),
        );
        for (const pool of (await poolsOf(s))!) {
          const bracket = results.ranked.filter((seed) => seed.pool === pool.pool);
          expect(pool.standings.map((row) => row.name)).toEqual(
            bracket.map((seed) => seed.team.name),
          );
          expect(pool.standings.map((row) => row.place)).toEqual(
            bracket.map((seed) => seed.tie?.place ?? seed.place),
          );
          if (bracket.some((seed) => seed.tie && seed.tie.level >= seed.tie.place)) {
            scoredAmongThem++;
          }
        }
        for (const gameId of entered) {
          await s.as(s.admin).mutation(api.tournamentGames.undoResult, { gameId });
        }
      }
      if (sport === 'beachVolleyball') expect(scoredAmongThem).toBeGreaterThan(0);
    }, 60_000);
  }
});
