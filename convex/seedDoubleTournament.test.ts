/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { registrationIsOpen } from './lib/registration';
import schema from './schema';
import { DEMO_ACCOUNTS, DEMO_DOUBLE_TEAMS, DEMO_DOUBLE_TOURNAMENT } from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const EMAILS = [
  ...new Set(DEMO_DOUBLE_TEAMS.flatMap((team) => [team.captainEmail, team.partnerEmail])),
];

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

async function doubleTrouble(t: T) {
  return t.run(async (ctx) => {
    const program = (await ctx.db.query('programs').collect()).find(
      (row) => row.slug === DEMO_DOUBLE_TOURNAMENT.tournamentSlug,
    )!;
    const tournament = (await ctx.db
      .query('tournaments')
      .withIndex('by_programId', (q) => q.eq('programId', program._id))
      .unique())!;
    const teams = (await ctx.db.query('teams').collect()).filter(
      (team) => team.tournamentId === tournament._id,
    );
    const games = (await ctx.db.query('tournamentGames').collect()).filter(
      (game) => game.tournamentId === tournament._id,
    );
    return { program, tournament, teams, games };
  });
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo: Double Trouble Doubles, a published double-elimination tournament', () => {
  test('is published, double elimination, with registration closed and play still ahead', async () => {
    const t = setup();
    await seedDemo(t);
    const { program, tournament } = await doubleTrouble(t);
    expect(program).toMatchObject({ name: 'Double Trouble Doubles', status: 'published' });
    expect(tournament.bracketType).toBe('double');
    expect(registrationIsOpen(tournament, Date.now())).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    expect(tournament.startDate > today).toBe(true);
  });

  test('has 6 confirmed teams of the minimum roster, and a recount equal to the counter', async () => {
    const t = setup();
    await seedDemo(t);
    const { tournament, teams } = await doubleTrouble(t);
    expect(teams.map((team) => [team.name, team.rosterCount]).sort()).toEqual(
      DEMO_DOUBLE_TEAMS.map((team) => [team.name, tournament.minimumRosterSize]).sort(),
    );
    expect(tournament.teamCount).toBe(6);
  });

  test('has a bracket of 7 winners games, 4 losers games, and the grand final, seeded in registration order', async () => {
    const t = setup();
    await seedDemo(t);
    const { teams, games } = await doubleTrouble(t);
    const count = (stage: string) => games.filter((game) => game.stage === stage).length;
    expect([count('bracket'), count('losers'), count('grandFinal')]).toEqual([7, 4, 1]);
    const order = [...teams].sort((a, b) => a.seed! - b.seed!).map((team) => team.name);
    expect(order).toEqual(DEMO_DOUBLE_TEAMS.map((team) => team.name));
  });

  test('is made once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const first = await doubleTrouble(t);
    expect((await t.mutation(internal.seed.insertDemoData, {})).tournaments).toBe(0);
    expect(await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN })).toBe(0);
    expect(await doubleTrouble(t)).toEqual(first);
  });

  test('makes no bracket while a team lacks its partner, and makes it once the partner exists', async () => {
    const t = setup();
    await seedDemo(t, PEOPLE.slice(0, -1));
    expect((await doubleTrouble(t)).games).toEqual([]);
    await t.run((ctx) =>
      ctx.db.insert('users', {
        authUserId: PEOPLE.at(-1)!.authUserId,
        name: 'late partner',
        adultConfirmedAt: 1,
      }),
    );
    await t.mutation(internal.seed.insertDemoTeams, { captains: PEOPLE });
    expect((await doubleTrouble(t)).games).toHaveLength(12);
  });
});

describe('seed:demo: Double Trouble Doubles has first-round results, so a team is in the losers bracket', () => {
  test('has the two played games of winners round 1 settled by the demo admin, and their losers in losers round 1', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const { teams, games } = await doubleTrouble(t);
    const idOf = (seed: number) => teams.find((team) => team.seed === seed)!._id;
    const admin = await t.run(async (ctx) =>
      (await ctx.db.query('users').collect()).find((user) => user.authUserId === ADMIN.authUserId)!,
    );
    const at = (stage: string, round: number, slot: number) =>
      games.find((game) => game.stage === stage && game.round === round && game.slot === slot)!;
    expect(at('bracket', 1, 2)).toMatchObject({
      winnerTeamId: idOf(4),
      resultEnteredBy: admin._id,
    });
    expect(at('bracket', 1, 4)).toMatchObject({
      winnerTeamId: idOf(6),
      resultEnteredBy: admin._id,
    });
    expect(at('losers', 1, 1).teamIds).toEqual([idOf(5), idOf(3)]);
    expect(at('bracket', 2, 1).teamIds).toEqual([idOf(1), idOf(4)]);
    expect(games.filter((game) => game.score !== undefined)).toHaveLength(2);
  });

  test('is entered once, so a second run changes nothing', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    const first = await doubleTrouble(t);
    await t.mutation(internal.seed.insertDemoTeams, { captains: WITH_ADMIN });
    expect(await doubleTrouble(t)).toEqual(first);
  });

  test('enters no result while no admin account exists', async () => {
    const t = setup();
    await seedDemo(t);
    const { games } = await doubleTrouble(t);
    expect(games.every((game) => game.score === undefined)).toBe(true);
  });

  test('shows admin@ the bracket with a team in the losers bracket', async () => {
    const t = setup();
    await seedDemo(t, WITH_ADMIN);
    await t.run(async (ctx) => {
      const user = (await ctx.db.query('users').collect()).find(
        (row) => row.authUserId === ADMIN.authUserId,
      )!;
      const organization = (await ctx.db.query('organizations').collect()).find(
        (row) => row.slug === DEMO_DOUBLE_TOURNAMENT.orgSlug,
      )!;
      await ctx.db.insert('memberships', {
        userId: user._id,
        organizationId: organization._id,
        role: 'orgAdmin',
        leagueIds: [],
      });
    });
    const view = await t
      .withIdentity({
        subject: ADMIN.authUserId,
        issuer: 'http://127.0.0.1:3211',
        name: 'admin',
        sessionId: 's1',
      })
      .query(api.tournamentGames.getSetup, DEMO_DOUBLE_TOURNAMENT);
    const losers = view!.bracket!.losersRounds!;
    expect(losers[0].games[0].teams.map((team) => team?.name)).toEqual([
      DEMO_DOUBLE_TEAMS[4].name,
      DEMO_DOUBLE_TEAMS[2].name,
    ]);
  });
});
