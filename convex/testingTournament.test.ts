/// <reference types="vite/client" />
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

  test('keeps the default of one set per game, or takes the sets it is given', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, TOURNAMENT);
    await t.mutation(internal.testing.seedTournament, {
      ...TOURNAMENT,
      slug: 'best-of-three',
      setsPerGame: 3,
    });
    const tournaments = await t.run((ctx) => ctx.db.query('tournaments').collect());
    expect(tournaments.map((tournament) => tournament.setsPerGame)).toEqual([undefined, 3]);
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

describe('testing:seedTournamentResult', () => {
  const ARGS = { organizationSlug: 'e2e-org-t1u2', tournamentSlug: 'gulf-coast-beach-open' };
  const GAME = { ...ARGS, round: 1, slot: 2 };
  const ONE_SET = { kind: 'sets' as const, sets: [{ a: 21, b: 15 }] };

  async function withBracket(options: { setsPerGame?: 1 | 3; sport?: 'soccer' } = {}) {
    const t = await seeded();
    await t.mutation(internal.testing.seedTournament, {
      ...TOURNAMENT,
      status: 'published',
      ...options,
    });
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
