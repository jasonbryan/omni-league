/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

const TENANT = {
  organization: { name: 'E2E Org e5f6', slug: 'e2e-org-e5f6' },
  locations: [{ name: 'Field One', address: '1 Test Road' }],
  leagues: [
    { name: 'Coed 7v7', sport: 'soccer' as const, locations: ['Field One'] },
    { name: 'Sand 2s', sport: 'beachVolleyball' as const, locations: ['Field One'] },
  ],
};
const OTHER = {
  organization: { name: 'Other Org', slug: 'other-org' },
  locations: [{ name: 'Field One', address: '2 Test Road' }],
  leagues: [{ name: 'Other League', sport: 'soccer' as const, locations: ['Field One'] }],
};
const USER = {
  name: 'League Organizer',
  email: 'organizer.e5f6@example.test',
  password: 'a random per-run passphrase',
};

const SEASON = {
  organizationSlug: TENANT.organization.slug,
  leagueSlug: 'coed-7v7',
  name: 'Fall 2026',
  slug: 'fall-2026',
  startDate: '2026-09-01',
  endDate: '2026-11-15',
  registrationDeadline: '2026-08-25',
  playersPerSide: 7,
  minimumRosterSize: 7,
};

const seasons = (t: T) => t.run((ctx) => ctx.db.query('seasons').collect());
const memberships = (t: T) => t.run((ctx) => ctx.db.query('memberships').collect());

async function seeded(): Promise<T> {
  vi.stubEnv('IS_TEST', 'true');
  const t = setup();
  await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
  await t.action(internal.testing.seedLeague, OTHER);
  return t;
}

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('SITE_URL', 'http://localhost:4000');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  // No outside call even if the breached-password check were on.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in tests')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('testing:seedSeason', () => {
  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['"TRUE"', 'TRUE'],
    ['empty', ''],
  ])(
    'throws with IS_TEST %s and writes nothing',
    async (_, value) => {
      const t = await seeded();
      vi.stubEnv('IS_TEST', value);
      await expect(t.mutation(internal.testing.seedSeason, SEASON)).rejects.toThrow(/IS_TEST/);
      expect(await seasons(t)).toEqual([]);
    },
    30_000,
  );

  test('inserts a draft season of the named league, through insertSeason', async () => {
    const t = await seeded();
    await expect(t.mutation(internal.testing.seedSeason, SEASON)).resolves.toEqual({
      slug: 'fall-2026',
    });
    expect(await seasons(t)).toEqual([
      expect.objectContaining({
        name: 'Fall 2026',
        slug: 'fall-2026',
        startDate: '2026-09-01',
        endDate: '2026-11-15',
        registrationDeadline: '2026-08-25',
        playersPerSide: 7,
        minimumRosterSize: 7,
        status: 'draft',
      }),
    ]);
  }, 30_000);

  test('a season without players per side takes its league’s, else the smallest of its sport', async () => {
    const t = await seeded();
    const withoutPlayers = { ...SEASON, playersPerSide: undefined };
    await t.mutation(internal.testing.seedSeason, { ...withoutPlayers, slug: 'sport-default' });
    const league = (await t.run((ctx) => ctx.db.query('leagues').collect())).find(
      (row) => row.slug === 'coed-7v7',
    )!;
    await t.run((ctx) => ctx.db.patch('leagues', league._id, { playersPerSide: 5 }));
    await t.mutation(internal.testing.seedSeason, { ...withoutPlayers, slug: 'league-default' });
    const stored = await seasons(t);
    expect(stored.map((row) => [row.slug, row.playersPerSide])).toEqual([
      ['sport-default', 4],
      ['league-default', 5],
    ]);
  });

  test('inserts a published season when asked', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedSeason, { ...SEASON, status: 'published' });
    expect((await seasons(t))[0]?.status).toBe('published');
  }, 30_000);

  test('keeps a deadline on or after the start date, which seasons.create would refuse', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.seedSeason, {
      ...SEASON,
      registrationDeadline: '2026-09-01',
    });
    await t.mutation(internal.testing.seedSeason, {
      ...SEASON,
      slug: 'later',
      registrationDeadline: '2026-10-01',
    });
    expect((await seasons(t)).map((s) => s.registrationDeadline)).toEqual([
      '2026-09-01',
      '2026-10-01',
    ]);
  }, 30_000);

  test('throws for an unknown organization or league, and for a league of another organization', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedSeason, { ...SEASON, organizationSlug: 'nope' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedSeason, { ...SEASON, leagueSlug: 'nope' }),
    ).rejects.toThrow(/No league/);
    await expect(
      t.mutation(internal.testing.seedSeason, { ...SEASON, leagueSlug: 'other-league' }),
    ).rejects.toThrow(/No league/);
    expect(await seasons(t)).toEqual([]);
  }, 30_000);
});

describe('testing:addLeagueOrganizer', () => {
  const ARGS = {
    organizationSlug: TENANT.organization.slug,
    email: USER.email,
    leagueSlugs: ['coed-7v7'],
  };

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])(
    'throws with IS_TEST %s and adds no membership',
    async (_, value) => {
      const t = await seeded();
      vi.stubEnv('IS_TEST', value);
      await expect(t.mutation(internal.testing.addLeagueOrganizer, ARGS)).rejects.toThrow(
        /IS_TEST/,
      );
      expect(await memberships(t)).toEqual([]);
    },
    30_000,
  );

  test('makes the seeded user a league organizer of the named leagues only', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.addLeagueOrganizer, {
      ...ARGS,
      email: USER.email.toUpperCase(),
    });
    const [membership, ...rest] = await memberships(t);
    expect(rest).toEqual([]);
    expect(membership).toMatchObject({ role: 'leagueOrganizer' });
    const leagues = await t.run((ctx) => ctx.db.query('leagues').collect());
    const coed = leagues.find((league) => league.slug === 'coed-7v7');
    expect(membership?.leagueIds).toEqual([coed?._id]);
    expect(membership?.organizationId).toBe(coed?.organizationId);
  }, 30_000);

  test('assigns several leagues', async () => {
    const t = await seeded();
    await t.mutation(internal.testing.addLeagueOrganizer, {
      ...ARGS,
      leagueSlugs: ['coed-7v7', 'sand-2s'],
    });
    expect((await memberships(t))[0]?.leagueIds).toHaveLength(2);
  }, 30_000);

  test('throws, writing nothing, for an unknown organization, account, or league, a league of another organization, and a second membership', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.addLeagueOrganizer, { ...ARGS, organizationSlug: 'nope' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.addLeagueOrganizer, { ...ARGS, email: 'nobody@example.test' }),
    ).rejects.toThrow(/No account/);
    await expect(
      t.mutation(internal.testing.addLeagueOrganizer, { ...ARGS, leagueSlugs: ['nope'] }),
    ).rejects.toThrow(/No league/);
    await expect(
      t.mutation(internal.testing.addLeagueOrganizer, { ...ARGS, leagueSlugs: ['other-league'] }),
    ).rejects.toThrow(/No league/);
    expect(await memberships(t)).toEqual([]);

    await t.mutation(internal.testing.addLeagueOrganizer, ARGS);
    await expect(t.mutation(internal.testing.addLeagueOrganizer, ARGS)).rejects.toThrow(/already/);
    expect(await memberships(t)).toHaveLength(1);
  }, 30_000);
});

describe('testing:seedSeasons', () => {
  const batch = (n: number, status?: 'draft' | 'published') =>
    Array.from({ length: n }, (_, i) => ({
      name: `Season ${i + 1}`,
      slug: `season-${i + 1}`,
      startDate: `2026-${String(i + 1).padStart(2, '0')}-01`,
      endDate: '2026-12-28',
      registrationDeadline: '2025-12-01',
      playersPerSide: 7,
      minimumRosterSize: 7,
      status,
    }));
  const args = (list: ReturnType<typeof batch>) => ({
    organizationSlug: TENANT.organization.slug,
    leagueSlug: 'coed-7v7',
    seasons: list,
  });

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])(
    'throws with IS_TEST %s and writes nothing',
    async (_, value) => {
      const t = await seeded();
      vi.stubEnv('IS_TEST', value);
      await expect(t.mutation(internal.testing.seedSeasons, args(batch(2)))).rejects.toThrow(
        /IS_TEST/,
      );
      expect(await seasons(t)).toEqual([]);
    },
    30_000,
  );

  test('inserts every season in one call, and the league counter equals a recount', async () => {
    const t = await seeded();
    const list = [...batch(7, 'published'), { ...batch(1)[0], slug: 'draft', name: 'Draft' }];
    await expect(t.mutation(internal.testing.seedSeasons, args(list))).resolves.toEqual({
      count: 8,
    });
    const rows = await seasons(t);
    expect(rows).toHaveLength(8);
    const counter = await t.run(async (ctx) => {
      const leagues = await ctx.db.query('leagues').collect();
      return leagues.find((league) => league.slug === 'coed-7v7')?.publishedSeasonCount;
    });
    expect(counter).toBe(rows.filter((row) => row.status === 'published').length);
    expect(counter).toBe(7);
  }, 30_000);

  test('throws, writing nothing, for an unknown league', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedSeasons, { ...args(batch(2)), leagueSlug: 'nope' }),
    ).rejects.toThrow(/No league/);
    expect(await seasons(t)).toEqual([]);
  }, 30_000);
});
