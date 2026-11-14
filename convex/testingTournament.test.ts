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
