/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

const TENANT = {
  organization: { name: 'E2E Org t1u2', slug: 'e2e-org-t1u2' },
  locations: [{ name: 'Field One', address: '1 Test Road' }],
  leagues: [],
};

const TOURNAMENT = {
  organizationSlug: 'e2e-org-t1u2',
  name: 'Gulf Coast Beach Open',
  slug: 'gulf-coast-beach-open',
  sport: 'beachVolleyball' as const,
  locationNames: ['Field One'],
  startDate: '2026-12-12',
  endDate: '2026-12-13',
  registrationDeadline: '2026-12-05',
  maximumTeams: 16,
};

async function seeded() {
  vi.stubEnv('IS_TEST', 'true');
  const t = convexTest(schema, modules);
  await t.mutation(internal.testing.seedTenant, TENANT);
  return t;
}

const programs = (t: Awaited<ReturnType<typeof seeded>>) =>
  t.run((ctx) => ctx.db.query('programs').collect());

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => vi.unstubAllEnvs());

describe('testing:seedTournament', () => {
  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await seeded();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedTournament, TOURNAMENT)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await programs(t)).toEqual([]);
  });

  test('inserts a draft tournament that skips the create rules, so a deadline may be past', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedTournament, {
        ...TOURNAMENT,
        registrationDeadline: '2020-01-01',
      }),
    ).resolves.toEqual({ slug: 'gulf-coast-beach-open' });
    expect(await programs(t)).toEqual([
      expect.objectContaining({
        type: 'tournament',
        name: 'Gulf Coast Beach Open',
        status: 'draft',
        gender: 'coed',
        playersPerSide: 2,
        level: 'rec',
        ageGroup: 'adult',
      }),
    ]);
  });

  test('a published tournament answers its public page, with the division it was given', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, {
      ...TOURNAMENT,
      status: 'published',
      division: { gender: 'womens', playersPerSide: 4, level: 'open', ageGroup: 'over40' },
    });
    const page = await t.query(api.tournaments.getPublicPage, {
      orgSlug: 'e2e-org-t1u2',
      tournamentSlug: 'gulf-coast-beach-open',
    });
    expect(page?.divisionLabel).toContain('4v4');
    expect(page).toMatchObject({
      name: 'Gulf Coast Beach Open',
      locations: [{ name: 'Field One', address: '1 Test Road' }],
      minimumRosterSize: 4,
    });
  });

  test('holds a double-elimination bracket type and a grand final when given, and single elimination otherwise', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    await t.mutation(internal.testing.seedTournament, {
      ...TOURNAMENT,
      slug: 'double-open',
      name: 'Double Open',
      bracketType: 'double',
      grandFinal: 'single',
    });
    const rows = await t.run((ctx) => ctx.db.query('tournaments').collect());
    expect(rows.map(({ bracketType, grandFinal }) => ({ bracketType, grandFinal }))).toEqual([
      { bracketType: 'single' },
      { bracketType: 'double', grandFinal: 'single' },
    ]);
  });

  test('refuses an unknown organization, a location it does not have, and a taken web address', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedTournament, { ...TOURNAMENT, organizationSlug: 'nowhere' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedTournament, { ...TOURNAMENT, locationNames: ['Nowhere'] }),
    ).rejects.toThrow(/No location/);
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    await expect(t.mutation(internal.testing.seedTournament, TOURNAMENT)).rejects.toThrow(
      /web address/,
    );
  });
});

describe('testing:seedTournamentTeam', () => {
  const TEAM = {
    organizationSlug: 'e2e-org-t1u2',
    tournamentSlug: 'gulf-coast-beach-open',
    name: 'Sand Crabs',
    captainEmail: 'captain@example.test',
  };

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedTournamentTeam, TEAM)).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('teams').collect())).toEqual([]);
  });

  test('refuses an unknown organization and an unknown tournament', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedTournamentTeam, { ...TEAM, organizationSlug: 'nowhere' }),
    ).rejects.toThrow(/No organization/);
    await expect(t.mutation(internal.testing.seedTournamentTeam, TEAM)).rejects.toThrow(
      /No tournament/,
    );
  });
});

describe('testing:seedTournamentRosters', () => {
  const ROSTERS = {
    organizationSlug: 'e2e-org-t1u2',
    tournamentSlug: 'gulf-coast-beach-open',
    teams: [{ name: 'Sand Crabs' }, { name: 'Short Handed', players: 1 }],
  };

  test('throws with IS_TEST unset and writes nothing', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    vi.stubEnv('IS_TEST', undefined);
    await expect(t.mutation(internal.testing.seedTournamentRosters, ROSTERS)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await t.run((ctx) => ctx.db.query('teams').collect())).toEqual([]);
  });

  test('inserts each team with the minimum roster size, or the players asked for, through the roster writer', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    const { teamIds } = await t.mutation(internal.testing.seedTournamentRosters, ROSTERS);
    expect(teamIds).toHaveLength(2);
    const teams = await t.run((ctx) => ctx.db.query('teams').collect());
    expect(teams.map((team) => [team.name, team.rosterCount])).toEqual([
      ['Sand Crabs', 2],
      ['Short Handed', 1],
    ]);
    const tournament = await t.run((ctx) => ctx.db.query('tournaments').first());
    expect(tournament?.teamCount).toBe(2);
    const entries = await t.run((ctx) => ctx.db.query('rosterEntries').collect());
    expect(entries.filter((entry) => entry.status === 'rostered')).toHaveLength(3);
  });

  test('can be called again for more teams', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    await t.mutation(internal.testing.seedTournamentRosters, ROSTERS);
    await t.mutation(internal.testing.seedTournamentRosters, {
      ...ROSTERS,
      teams: [{ name: 'Net Results' }],
    });
    expect(await t.run((ctx) => ctx.db.query('teams').collect())).toHaveLength(3);
  });

  test('refuses an unknown organization and an unknown tournament', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedTournamentRosters, {
        ...ROSTERS,
        organizationSlug: 'nowhere',
      }),
    ).rejects.toThrow(/No organization/);
    await expect(t.mutation(internal.testing.seedTournamentRosters, ROSTERS)).rejects.toThrow(
      /No tournament/,
    );
  });
});

describe('testing:seedTournamentRosters with a captain account', () => {
  const CAPTAIN = {
    name: 'Team Captain',
    email: 'captain.t1u2@example.test',
    password: 'a random per-run passphrase',
  };

  async function withCaptain() {
    vi.stubEnv('IS_TEST', 'true');
    vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
    vi.stubEnv('SITE_URL', 'http://localhost:4000');
    const t = convexTest(schema, modules);
    betterAuthTest.register(t, 'betterAuth');
    await t.action(internal.testing.seedLeague, { ...TENANT, users: [CAPTAIN] });
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    return t;
  }

  test('makes the account the captain of the team that names it, and the other teams keep a seeded captain', async () => {
    const t = await withCaptain();
    await t.mutation(internal.testing.seedTournamentRosters, {
      organizationSlug: TENANT.organization.slug,
      tournamentSlug: TOURNAMENT.slug,
      teams: [{ name: 'Sand Crabs', captainEmail: CAPTAIN.email }, { name: 'Net Results' }],
    });
    const account = await t.query(internal.testing.accountByEmail, { email: CAPTAIN.email });
    expect(account).not.toBeNull();
    const [crabs, results] = await t.run(async (ctx) => {
      const teams = await ctx.db.query('teams').collect();
      const captain = await Promise.all(
        teams.map((team) => ctx.db.get('users', team.captainUserId)),
      );
      return teams.map((team, index) => ({
        name: team.name,
        rosterCount: team.rosterCount,
        captainName: captain[index]!.name,
      }));
    });
    expect(crabs).toEqual({ name: 'Sand Crabs', rosterCount: 2, captainName: CAPTAIN.name });
    expect(results.captainName).not.toBe(CAPTAIN.name);
  });

  test('refuses an email that has no account', async () => {
    const t = await withCaptain();
    await expect(
      t.mutation(internal.testing.seedTournamentRosters, {
        organizationSlug: TENANT.organization.slug,
        tournamentSlug: TOURNAMENT.slug,
        teams: [{ name: 'Sand Crabs', captainEmail: 'nobody@example.test' }],
      }),
    ).rejects.toThrow(/No account has the email/);
  });
});

describe('testing:seedTournamentBracket', () => {
  const ARGS = { organizationSlug: 'e2e-org-t1u2', tournamentSlug: 'gulf-coast-beach-open' };

  async function withTeams(names: string[]) {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, { ...TOURNAMENT, status: 'published' });
    await t.mutation(internal.testing.seedTournamentRosters, {
      ...ARGS,
      teams: names.map((name) => ({ name })),
    });
    return t;
  }

  test('throws with IS_TEST unset and writes nothing', async () => {
    const t = await withTeams(['Alpha', 'Bravo']);
    vi.stubEnv('IS_TEST', undefined);
    await expect(t.mutation(internal.testing.seedTournamentBracket, ARGS)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await t.run((ctx) => ctx.db.query('tournamentGames').collect())).toEqual([]);
  });

  test('creates the bracket of the confirmed teams, which the public page then shows', async () => {
    const t = await withTeams(['Alpha', 'Bravo', 'Charlie']);
    await expect(t.mutation(internal.testing.seedTournamentBracket, ARGS)).resolves.toEqual({
      gameCount: 3,
    });
    const page = await t.query(api.tournaments.getPublicPage, {
      orgSlug: ARGS.organizationSlug,
      tournamentSlug: ARGS.tournamentSlug,
    });
    expect(page?.bracket?.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);
  });

  test('refuses a second bracket, an unknown organization, and an unknown tournament', async () => {
    const t = await withTeams(['Alpha', 'Bravo']);
    await t.mutation(internal.testing.seedTournamentBracket, ARGS);
    await expect(t.mutation(internal.testing.seedTournamentBracket, ARGS)).rejects.toThrow(
      /has a bracket already/,
    );
    await expect(
      t.mutation(internal.testing.seedTournamentBracket, { ...ARGS, organizationSlug: 'nowhere' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedTournamentBracket, { ...ARGS, tournamentSlug: 'nowhere' }),
    ).rejects.toThrow(/No tournament/);
  });
});

describe('testing:setTournamentSetsPerGame', () => {
  const ARGS = { organizationSlug: 'e2e-org-t1u2', tournamentSlug: 'gulf-coast-beach-open' };
  const setsPerGameOf = async (t: Awaited<ReturnType<typeof seeded>>) =>
    (await t.run((ctx) => ctx.db.query('tournaments').first()))?.setsPerGame;

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    vi.stubEnv('IS_TEST', value);
    await expect(
      t.mutation(internal.testing.setTournamentSetsPerGame, { ...ARGS, setsPerGame: 3 }),
    ).rejects.toThrow(/IS_TEST/);
    expect(await setsPerGameOf(t)).toBeUndefined();
  });

  test('sets the sets per game the tournament plays', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    expect(await setsPerGameOf(t)).toBeUndefined();
    await t.mutation(internal.testing.setTournamentSetsPerGame, { ...ARGS, setsPerGame: 3 });
    expect(await setsPerGameOf(t)).toBe(3);
  });

  test('refuses an unknown organization and an unknown tournament', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.setTournamentSetsPerGame, {
        ...ARGS,
        organizationSlug: 'nowhere',
        setsPerGame: 3,
      }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.setTournamentSetsPerGame, { ...ARGS, setsPerGame: 3 }),
    ).rejects.toThrow(/No tournament/);
  });
});

describe('testing:seedTournamentResult', () => {
  const ARGS = { organizationSlug: 'e2e-org-t1u2', tournamentSlug: 'gulf-coast-beach-open' };
  const GAME = { ...ARGS, round: 1, slot: 2 };
  const ONE_SET = { kind: 'sets' as const, sets: [{ a: 21, b: 15 }] };

  async function withBracket(options: { setsPerGame?: 1 | 3; sport?: 'soccer' } = {}) {
    const { setsPerGame, ...tournament } = options;
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, {
      ...TOURNAMENT,
      status: 'published',
      ...tournament,
    });
    if (setsPerGame) {
      await t.mutation(internal.testing.setTournamentSetsPerGame, { ...ARGS, setsPerGame });
    }
    await t.mutation(internal.testing.seedTournamentRosters, {
      ...ARGS,
      teams: ['Alpha', 'Bravo', 'Charlie'].map((name) => ({ name })),
    });
    await t.mutation(internal.testing.seedTournamentBracket, ARGS);
    return t;
  }

  const games = (t: Awaited<ReturnType<typeof seeded>>) =>
    t.run((ctx) => ctx.db.query('tournamentGames').collect());

  const publicGame = async (t: Awaited<ReturnType<typeof seeded>>, round: number, slot: number) =>
    (
      await t.query(api.tournaments.getPublicPage, {
        orgSlug: ARGS.organizationSlug,
        tournamentSlug: ARGS.tournamentSlug,
      })
    )?.bracket?.rounds[round - 1].games[slot - 1];

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await withBracket();
    const users = (await t.run((ctx) => ctx.db.query('users').collect())).length;
    vi.stubEnv('IS_TEST', value);
    await expect(
      t.mutation(internal.testing.seedTournamentResult, { ...GAME, score: ONE_SET }),
    ).rejects.toThrow(/IS_TEST/);
    expect((await games(t)).filter((game) => game.winnerTeamId && game.score)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('users').collect())).toHaveLength(users);
  });

  test('writes the result through the result writer: the winner moves on and the public page shows the score', async () => {
    const t = await withBracket();
    await t.mutation(internal.testing.seedTournamentResult, { ...GAME, score: ONE_SET });
    const all = await games(t);
    const played = all.find((game) => game.round === 1 && game.slot === 2)!;
    const final = all.find((game) => game.round === 2)!;
    expect(played.score).toEqual(ONE_SET);
    expect(played.resultEnteredAt).toBeGreaterThan(0);
    expect(played.winnerTeamId).toBe(played.teamIds[0]);
    expect(final.teamIds).toContain(played.winnerTeamId);
    expect(await publicGame(t, 1, 2)).toMatchObject({ winner: 0, score: ONE_SET });
  });

  test('takes the winner from the score, whichever team it names first', async () => {
    const t = await withBracket();
    const score = { kind: 'sets' as const, sets: [{ a: 12, b: 21 }] };
    await t.mutation(internal.testing.seedTournamentResult, { ...GAME, score });
    expect(await publicGame(t, 1, 2)).toMatchObject({ winner: 1, score });
  });

  test('takes a best-of-3 score when the tournament is best of 3', async () => {
    const t = await withBracket({ setsPerGame: 3 });
    const score = {
      kind: 'sets' as const,
      sets: [
        { a: 21, b: 15 },
        { a: 18, b: 21 },
        { a: 15, b: 10 },
      ],
    };
    await t.mutation(internal.testing.seedTournamentResult, { ...GAME, score });
    expect(await publicGame(t, 1, 2)).toMatchObject({ winner: 0, score });
  });

  test('writes a forfeit as the sport forfeit score and the forfeiting team, which the public page gives as a place', async () => {
    const t = await withBracket();
    await t.mutation(internal.testing.seedTournamentResult, { ...GAME, forfeitSide: 0 });
    const played = (await games(t)).find((game) => game.round === 1 && game.slot === 2)!;
    expect(played.forfeitTeamId).toBe(played.teamIds[0]);
    expect(played.winnerTeamId).toBe(played.teamIds[1]);
    expect(played.score).toEqual({ kind: 'sets', sets: [{ a: 0, b: 21 }] });
    const shown = await publicGame(t, 1, 2);
    expect(shown).toMatchObject({ forfeit: 0, winner: 1 });
    expect(shown).not.toHaveProperty('score');
  });

  test('writes a losers bracket result through the same writer when the stage is named', async () => {
    const t = await withBracket();
    await t.run(async (ctx) => {
      const [tournament] = await ctx.db.query('tournaments').collect();
      await ctx.db.patch('tournaments', tournament._id, { bracketType: 'double' });
      for (const game of await ctx.db.query('tournamentGames').collect()) {
        await ctx.db.delete('tournamentGames', game._id);
      }
    });
    await t.mutation(internal.testing.seedTournamentBracket, ARGS);
    await t.mutation(internal.testing.seedTournamentResult, { ...GAME, score: ONE_SET });
    await t.mutation(internal.testing.seedTournamentResult, {
      ...ARGS,
      round: 2,
      slot: 1,
      score: ONE_SET,
    });
    await t.mutation(internal.testing.seedTournamentResult, {
      ...ARGS,
      stage: 'losers',
      round: 1,
      slot: 1,
      score: ONE_SET,
    });
    const all = await games(t);
    const losers = all.find((game) => game.stage === 'losers')!;
    const grandFinal = all.find((game) => game.stage === 'grandFinal')!;
    expect(losers.score).toEqual(ONE_SET);
    expect(grandFinal.teamIds[1]).toBe(losers.winnerTeamId);
  });

  test('refuses a score the product refuses, and writes nothing', async () => {
    const t = await withBracket();
    const refused = async (change: object, message: RegExp) => {
      await expect(
        t.mutation(internal.testing.seedTournamentResult, { ...GAME, ...change }),
      ).rejects.toThrow(message);
      expect((await games(t)).filter((game) => game.score)).toEqual([]);
    };
    await refused({ score: { kind: 'sets', sets: [{ a: 15, b: 15 }] } }, /Set 1 is tied/);
    await refused({ score: { kind: 'goals', a: 3, b: 1 } }, /does not fit/);
    await refused(
      {
        score: {
          kind: 'sets',
          sets: [
            { a: 21, b: 15 },
            { a: 18, b: 21 },
            { a: 15, b: 10 },
          ],
        },
      },
      /Set 2 is not played/,
    );
  });

  test('refuses a tied soccer score', async () => {
    const t = await withBracket({ sport: 'soccer' });
    await expect(
      t.mutation(internal.testing.seedTournamentResult, {
        ...GAME,
        score: { kind: 'goals', a: 2, b: 2 },
      }),
    ).rejects.toThrow(/cannot be tied/);
    await t.mutation(internal.testing.seedTournamentResult, {
      ...GAME,
      score: { kind: 'goals', a: 3, b: 1 },
    });
    expect(await publicGame(t, 1, 2)).toMatchObject({
      winner: 0,
      score: { kind: 'goals', a: 3, b: 1 },
    });
  });

  test('refuses both a score and a forfeit, and neither', async () => {
    const t = await withBracket();
    await expect(
      t.mutation(internal.testing.seedTournamentResult, {
        ...GAME,
        score: ONE_SET,
        forfeitSide: 0,
      }),
    ).rejects.toThrow(/score or a forfeitSide/);
    await expect(t.mutation(internal.testing.seedTournamentResult, GAME)).rejects.toThrow(
      /score or a forfeitSide/,
    );
  });

  test('refuses an unknown game, a game that is not ready, and a game that has a result', async () => {
    const t = await withBracket();
    const write = (change: object) =>
      t.mutation(internal.testing.seedTournamentResult, {
        ...GAME,
        score: ONE_SET,
        ...change,
      });
    await expect(write({ slot: 9 })).rejects.toThrow(/No game/);
    await expect(write({ slot: 1 })).rejects.toThrow(/not ready/);
    await expect(write({ round: 2, slot: 1 })).rejects.toThrow(/not ready/);
    await write({});
    await expect(write({})).rejects.toThrow(/has a result/);
  });

  test('refuses an unknown organization and an unknown tournament', async () => {
    const t = await withBracket();
    await expect(
      t.mutation(internal.testing.seedTournamentResult, {
        ...GAME,
        organizationSlug: 'nowhere',
        score: ONE_SET,
      }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedTournamentResult, {
        ...GAME,
        tournamentSlug: 'nowhere',
        score: ONE_SET,
      }),
    ).rejects.toThrow(/No tournament/);
  });
});

describe('testing:seedTournamentWaitlistEntry', () => {
  const ENTRY = {
    organizationSlug: 'e2e-org-t1u2',
    tournamentSlug: 'gulf-coast-beach-open',
    teamName: 'Late Lobsters',
    captainEmail: 'captain@example.test',
  };

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedTournamentWaitlistEntry, ENTRY)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await t.run((ctx) => ctx.db.query('waitlistEntries').collect())).toEqual([]);
  });

  test('refuses an unknown organization and an unknown tournament', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedTournamentWaitlistEntry, {
        ...ENTRY,
        organizationSlug: 'nowhere',
      }),
    ).rejects.toThrow(/No organization/);
    await expect(t.mutation(internal.testing.seedTournamentWaitlistEntry, ENTRY)).rejects.toThrow(
      /No tournament/,
    );
  });
});

describe('testing:seedTournamentPools and testing:seedPoolResult', () => {
  const ARGS = { organizationSlug: 'e2e-org-t1u2', tournamentSlug: 'gulf-coast-beach-open' };
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
  const publicPools = async (t: Awaited<ReturnType<typeof seeded>>) =>
    (
      await t.query(api.tournaments.getPublicPage, {
        orgSlug: ARGS.organizationSlug,
        tournamentSlug: ARGS.tournamentSlug,
      })
    )?.pools;

  async function withTeams(sport?: 'soccer') {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, {
      ...TOURNAMENT,
      status: 'published',
      ...(sport && { sport }),
    });
    await t.mutation(internal.testing.setTournamentStructure, { ...ARGS, structure: 'pools' });
    await t.mutation(internal.testing.seedTournamentRosters, {
      ...ARGS,
      teams: names.map((name) => ({ name })),
    });
    return t;
  }

  test('throws with IS_TEST unset and writes nothing', async () => {
    const t = await withTeams();
    vi.stubEnv('IS_TEST', undefined);
    await expect(
      t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 }),
    ).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('tournamentGames').collect())).toEqual([]);
  });

  test('splits the teams into pools and creates their games, which the public page then shows', async () => {
    const t = await withTeams();
    await expect(
      t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 }),
    ).resolves.toEqual({ gameCount: 6 });
    expect((await publicPools(t))?.map((pool) => pool.standings.length)).toEqual([3, 3]);
  });

  test('refuses a second split, an unknown organization, and an unknown tournament', async () => {
    const t = await withTeams();
    await t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    await expect(
      t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 }),
    ).rejects.toThrow(/has pool games already/);
    await expect(
      t.mutation(internal.testing.seedTournamentPools, {
        ...ARGS,
        organizationSlug: 'nowhere',
        poolCount: 2,
      }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedTournamentPools, {
        ...ARGS,
        tournamentSlug: 'nowhere',
        poolCount: 2,
      }),
    ).rejects.toThrow(/No tournament/);
  });

  test('writes a result for the named pair with the first name’s score first, whichever team the game lists first', async () => {
    const t = await withTeams();
    await t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    const score = { kind: 'sets' as const, sets: [{ a: 21, b: 15 }] };
    await t.mutation(internal.testing.seedPoolResult, {
      ...ARGS,
      teams: ['Delta', 'Alpha'],
      score,
    });
    const [a] = (await publicPools(t))!;
    expect(a.standings[0]).toMatchObject({ name: 'Delta', place: 1 });
    expect(a.standings[0].cells[1]).toBe('1');
    await expect(
      t.mutation(internal.testing.seedPoolResult, { ...ARGS, teams: ['Alpha', 'Delta'], score }),
    ).rejects.toThrow(/has a result already/);
  });

  test('writes a forfeit and a tie, and refuses a tie where the sport does not allow it', async () => {
    const t = await withTeams();
    await t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    await t.mutation(internal.testing.seedPoolResult, {
      ...ARGS,
      teams: ['Alpha', 'Delta'],
      forfeitTeamName: 'Alpha',
    });
    const [a] = (await publicPools(t))!;
    expect(a.games.find((game) => game.forfeit !== undefined)).toBeDefined();
    await expect(
      t.mutation(internal.testing.seedPoolResult, {
        ...ARGS,
        teams: ['Alpha', 'Echo'],
        score: { kind: 'sets', sets: [{ a: 21, b: 21 }] },
      }),
    ).rejects.toThrow(/tied/);
    const soccer = await withTeams('soccer');
    await soccer.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    await soccer.mutation(internal.testing.seedPoolResult, {
      ...ARGS,
      teams: ['Alpha', 'Delta'],
      score: { kind: 'goals', a: 1, b: 1 },
    });
    const tied = (await publicPools(soccer))![0].games.find((game) => game.score !== undefined);
    expect(tied).toMatchObject({ score: { kind: 'goals', a: 1, b: 1 } });
    expect(tied?.winner).toBeUndefined();
  });

  test('seeds the forfeit on the side of the team that forfeits, whichever team of the game it is', async () => {
    const t = await withTeams();
    await t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    for (const [teams, forfeitTeamName] of [
      [['Alpha', 'Delta'], 'Alpha'],
      [['Alpha', 'Echo'], 'Echo'],
    ] as const) {
      await t.mutation(internal.testing.seedPoolResult, {
        ...ARGS,
        teams: [...teams],
        forfeitTeamName,
      });
    }
    const forfeits = (await publicPools(t))![0].games.filter((game) => game.forfeit !== undefined);
    expect(forfeits.map((game) => game.teams[game.forfeit!]).sort()).toEqual(['Alpha', 'Echo']);
  });

  test('throws for a forfeit by a team that is not in the game, and writes nothing', async () => {
    const t = await withTeams();
    await t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    const games = () => t.run((ctx) => ctx.db.query('tournamentGames').collect());
    const users = () => t.run((ctx) => ctx.db.query('users').collect());
    const [gamesBefore, usersBefore] = [await games(), await users()];
    for (const forfeitTeamName of ['Bravo', 'Echo']) {
      await expect(
        t.mutation(internal.testing.seedPoolResult, {
          ...ARGS,
          teams: ['Alpha', 'Delta'],
          forfeitTeamName,
        }),
      ).rejects.toThrow(`"${forfeitTeamName}" is not in Alpha v Delta`);
    }
    expect(await games()).toEqual(gamesBefore);
    expect(await users()).toEqual(usersBefore);
  });

  test('refuses a pair that does not play each other, a missing score, and an unknown team', async () => {
    const t = await withTeams();
    await t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    const score = { kind: 'sets' as const, sets: [{ a: 21, b: 15 }] };
    await expect(
      t.mutation(internal.testing.seedPoolResult, { ...ARGS, teams: ['Alpha', 'Bravo'], score }),
    ).rejects.toThrow(/do not play each other/);
    await expect(
      t.mutation(internal.testing.seedPoolResult, { ...ARGS, teams: ['Alpha', 'Delta'] }),
    ).rejects.toThrow(/either a score or a forfeitTeamName/);
    await expect(
      t.mutation(internal.testing.seedPoolResult, { ...ARGS, teams: ['Alpha', 'Nobody'], score }),
    ).rejects.toThrow(/No team is named/);
  });
});

describe('testing:seedPoolBracket', () => {
  const ARGS = { organizationSlug: 'e2e-org-t1u2', tournamentSlug: 'gulf-coast-beach-open' };
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
  const score = { kind: 'sets' as const, sets: [{ a: 21, b: 15 }] };

  async function played(complete: boolean) {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, { ...TOURNAMENT, status: 'published' });
    await t.mutation(internal.testing.setTournamentStructure, { ...ARGS, structure: 'pools' });
    await t.mutation(internal.testing.seedTournamentRosters, {
      ...ARGS,
      teams: names.map((name) => ({ name })),
    });
    await t.mutation(internal.testing.seedTournamentPools, { ...ARGS, poolCount: 2 });
    const pairs = [
      ['Alpha', 'Delta'],
      ['Alpha', 'Echo'],
      ['Delta', 'Echo'],
      ['Bravo', 'Charlie'],
      ['Bravo', 'Foxtrot'],
      ['Charlie', 'Foxtrot'],
    ];
    for (const teams of complete ? pairs : pairs.slice(1)) {
      await t.mutation(internal.testing.seedPoolResult, { ...ARGS, teams, score });
    }
    return t;
  }

  test('throws with IS_TEST unset and writes nothing', async () => {
    const t = await played(true);
    vi.stubEnv('IS_TEST', undefined);
    await expect(
      t.mutation(internal.testing.seedPoolBracket, { ...ARGS, advancePerPool: 2 }),
    ).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('tournamentGames').collect())).toHaveLength(6);
  });

  test('creates the bracket from the pool finish, which the public page then shows with the pools', async () => {
    const t = await played(true);
    await expect(
      t.mutation(internal.testing.seedPoolBracket, { ...ARGS, advancePerPool: 2 }),
    ).resolves.toEqual({ gameCount: 3 });
    const page = await t.query(api.tournaments.getPublicPage, {
      orgSlug: ARGS.organizationSlug,
      tournamentSlug: ARGS.tournamentSlug,
    });
    expect(page?.pools).toHaveLength(2);
    expect(page?.bracket?.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);
  });

  test('refuses while a pool game has no result, a second bracket, and an advance above the smallest pool', async () => {
    const open = await played(false);
    await expect(
      open.mutation(internal.testing.seedPoolBracket, { ...ARGS, advancePerPool: 2 }),
    ).rejects.toThrow(/Every pool game needs a result/);
    const t = await played(true);
    await expect(
      t.mutation(internal.testing.seedPoolBracket, { ...ARGS, advancePerPool: 4 }),
    ).rejects.toThrow(/Choose 1 to 3 teams/);
    await t.mutation(internal.testing.seedPoolBracket, { ...ARGS, advancePerPool: 2 });
    await expect(
      t.mutation(internal.testing.seedPoolBracket, { ...ARGS, advancePerPool: 2 }),
    ).rejects.toThrow(/has a bracket already/);
  });

  test('refuses an unknown organization and an unknown tournament', async () => {
    const t = await played(true);
    await expect(
      t.mutation(internal.testing.seedPoolBracket, {
        ...ARGS,
        organizationSlug: 'nowhere',
        advancePerPool: 2,
      }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedPoolBracket, {
        ...ARGS,
        tournamentSlug: 'nowhere',
        advancePerPool: 2,
      }),
    ).rejects.toThrow(/No tournament/);
  });
});
