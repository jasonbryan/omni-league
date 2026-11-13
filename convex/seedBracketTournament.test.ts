/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { registrationIsOpen } from './lib/registration';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { DEMO_ACCOUNTS, DEMO_BRACKET_TEAMS, DEMO_BRACKET_TOURNAMENT } from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const EMAILS = DEMO_BRACKET_TEAMS.flatMap((team) => [team.captainEmail, team.partnerEmail]);

const PEOPLE = EMAILS.map((email, index) => ({ email, authUserId: `auth-person-${index}` }));

const ADMIN = { email: DEMO_ACCOUNTS.admin.email, authUserId: 'auth-admin' };

const WITH_ADMIN = [...PEOPLE, ADMIN];

async function seedDemo(t: T, people = PEOPLE): Promise<number> {
  await t.run(async (ctx) => {
    for (const { authUserId } of people) {
      await ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    }
  });
  await t.mutation(internal.seed.insertDemoData, {});
  return t.mutation(internal.seed.insertDemoTeams, { captains: people });
}

async function laborDay(t: T) {
  return t.run(async (ctx) => {
    const program = (await ctx.db.query('programs').collect()).find(
      (row) => row.slug === DEMO_BRACKET_TOURNAMENT.tournamentSlug,
    )!;
    const tournament = (await ctx.db
      .query('tournaments')
      .withIndex('by_programId', (q) => q.eq('programId', program._id))
      .unique())!;
    const teams = (await ctx.db.query('teams').collect()).filter(
      (team) => team.tournamentId === tournament._id,
    );
    const games = await ctx.db
      .query('tournamentGames')
      .withIndex('by_tournamentId_and_stage_and_round_and_slot', (q) =>
        q.eq('tournamentId', tournament._id).eq('stage', 'bracket'),
      )
      .collect();
    return { program, tournament, teams, games };
  });
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo: the Labor Day Sand Slam, a published tournament with its bracket', () => {
  test('is published with registration closed and play still ahead', async () => {
    const t = setup();
    await seedDemo(t);
    const { program, tournament } = await laborDay(t);
    expect(program).toMatchObject({ name: 'Labor Day Sand Slam', status: 'published' });
    expect(registrationIsOpen(tournament, Date.now())).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    expect(tournament.startDate > today).toBe(true);
    expect(tournament.registrationDeadline < today).toBe(true);
  });

  test('has 6 confirmed teams, each with the minimum roster, and counters equal to a recount', async () => {
    const t = setup();
    await seedDemo(t);
    const { tournament, teams } = await laborDay(t);
    expect(teams.map((team) => [team.name, team.rosterCount]).sort()).toEqual(
      DEMO_BRACKET_TEAMS.map((team) => [team.name, tournament.minimumRosterSize]).sort(),
    );
    expect(tournament.teamCount).toBe(6);
  });

  test('has its bracket: 8 slots, with the top two seeds on byes, seeded in registration order', async () => {
    const t = setup();
    await seedDemo(t);
    const { teams, games } = await laborDay(t);
    expect(games).toHaveLength(7);
    const idOf = (seed: number) => teams.find((team) => team.seed === seed)!._id;
    expect(games.filter((game) => game.round === 1).map((game) => game.teamIds)).toEqual([
      [idOf(1), null],
      [idOf(4), idOf(5)],
      [idOf(2), null],
      [idOf(3), idOf(6)],
    ]);
    expect(teams.map((team) => team.seed).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const order = [...teams].sort((a, b) => a.seed! - b.seed!).map((team) => team.name);
    expect(order).toEqual(DEMO_BRACKET_TEAMS.map((team) => team.name));
  });

  test('is inserted once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t);
    const first = await laborDay(t);
    expect((await t.mutation(internal.seed.insertDemoData, {})).tournaments).toBe(0);
    expect(await t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE })).toBe(0);
    expect(await laborDay(t)).toEqual(first);
  });

  test('makes no bracket while a team lacks its partner, and makes it once the partner exists', async () => {
    const t = setup();
    const withoutLast = PEOPLE.slice(0, -1);
    await seedDemo(t, withoutLast);
    expect((await laborDay(t)).games).toEqual([]);
    await t.run((ctx) =>
      ctx.db.insert('users', {
        authUserId: PEOPLE.at(-1)!.authUserId,
        name: 'late partner',
        adultConfirmedAt: 1,
      }),
    );
    await t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE });
    expect((await laborDay(t)).games).toHaveLength(7);
  });
});

describe('seed:demo: the Labor Day Sand Slam first round has results', () => {
  const byGame = (games: Awaited<ReturnType<typeof laborDay>>['games']) =>
    games.map((game) => [game.round, game.slot, game.teamIds, game.winnerTeamId ?? null] as const);

  test('has the two played games of round 1 settled, entered by the demo admin, and the semifinals filled', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const { teams, games } = await laborDay(t);
    const idOf = (seed: number) => teams.find((team) => team.seed === seed)!._id;
    const admin = await t.run(async (ctx) =>
      (await ctx.db.query('users').collect()).find((user) => user.authUserId === ADMIN.authUserId)!,
    );
    const at = (round: number, slot: number) =>
      games.find((game) => game.round === round && game.slot === slot)!;
    expect(at(1, 2)).toMatchObject({ winnerTeamId: idOf(4), resultEnteredBy: admin._id });
    expect(at(1, 4)).toMatchObject({ winnerTeamId: idOf(6), resultEnteredBy: admin._id });
    expect(at(1, 2).score).toEqual({ kind: 'sets', sets: [{ a: 21, b: 15 }] });
    expect(at(2, 1).teamIds).toEqual([idOf(1), idOf(4)]);
    expect(at(2, 2).teamIds).toEqual([idOf(2), idOf(6)]);
    expect(at(2, 1).winnerTeamId).toBeUndefined();
    expect(at(3, 1).teamIds).toEqual([null, null]);
  });

  test('is entered once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const first = await laborDay(t);
    await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN });
    expect(await laborDay(t)).toEqual(first);
  });

  test('settles a bracket that exists without results, as on a deployment seeded before results', async () => {
    const t = setup();
    await seedDemo(t);
    const before = await laborDay(t);
    expect(before.games.every((game) => game.score === undefined)).toBe(true);
    await t.run((ctx) =>
      ctx.db.insert('users', { authUserId: ADMIN.authUserId, name: 'admin', adultConfirmedAt: 1 }),
    );
    await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN });
    const after = await laborDay(t);
    expect(after.games.filter((game) => game.score !== undefined)).toHaveLength(2);
    expect(byGame(after.games).map(([round, slot]) => [round, slot])).toEqual(
      byGame(before.games).map(([round, slot]) => [round, slot]),
    );
  });

  test('keeps a result an organizer entered, and leaves the bracket alone', async () => {
    const t = setup();
    await seedDemo(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        authUserId: ADMIN.authUserId,
        name: 'a',
        adultConfirmedAt: 1,
      });
    });
    const { games } = await laborDay(t);
    const played = games.find((game) => game.round === 1 && game.slot === 4)!;
    await t.run((ctx) =>
      ctx.db.patch('tournamentGames', played._id, {
        winnerTeamId: played.teamIds[0]!,
        score: { kind: 'sets', sets: [{ a: 21, b: 5 }] },
      }),
    );
    await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN });
    const after = await laborDay(t);
    expect(after.games.filter((game) => game.score !== undefined)).toHaveLength(1);
  });

  test('enters no result while no admin account exists', async () => {
    const t = setup();
    await seedDemo(t);
    expect((await laborDay(t)).games.every((game) => game.score === undefined)).toBe(true);
  });
});
