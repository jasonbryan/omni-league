/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { components, internal } from './_generated/api';
import { hashInviteToken } from './lib/inviteToken';
import { SCRYPT_LOG_N, SCRYPT_P, SCRYPT_R, verifyPassword } from './lib/password';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

const ORG = 'e2e-batch-a1b2';
const LEAGUE = 'sunday-coed-4s';
const OTHER_LEAGUE = 'thursday-coed-2s';
const TENANT = {
  organization: { name: 'E2E Batch a1b2', slug: ORG },
  locations: [{ name: 'Alpha Beach', address: '1 Alpha Road' }],
  leagues: [
    {
      name: 'Sunday Coed 4s',
      sport: 'beachVolleyball' as const,
      locations: ['Alpha Beach'],
      division: {
        gender: 'coed' as const,
        playersPerSide: 4,
        level: 'bb' as const,
        ageGroup: 'adult' as const,
      },
    },
    {
      name: 'Thursday Coed 2s',
      sport: 'beachVolleyball' as const,
      locations: ['Alpha Beach'],
      division: {
        gender: 'coed' as const,
        playersPerSide: 2,
        level: 'bb' as const,
        ageGroup: 'adult' as const,
      },
    },
  ],
};
const DATES = {
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-01',
};
const season = (leagueSlug: string, slug: string, extra: Record<string, unknown> = {}) => ({
  leagueSlug,
  name: slug,
  slug,
  ...DATES,
  playersPerSide: leagueSlug === LEAGUE ? 4 : 2,
  minimumRosterSize: leagueSlug === LEAGUE ? 4 : 2,
  status: 'published' as const,
  ...extra,
});
const person = (label: string) => ({ name: `Batch ${label}`, email: `${label}.a1b2@example.test` });
const ADMIN = { ...person('admin'), password: 'a random per-run passphrase' };
const ORGANIZER = { ...person('organizer'), password: 'another per-run passphrase' };
const [CAPTAIN, RIVAL, PLAYER, GUARDIAN, AGENT, LATE] = [
  'captain',
  'rival',
  'player',
  'guardian',
  'agent',
  'late',
].map(person) as [
  ReturnType<typeof person>,
  ReturnType<typeof person>,
  ReturnType<typeof person>,
  ReturnType<typeof person>,
  ReturnType<typeof person>,
  ReturnType<typeof person>,
];

const ROWS = {
  tenant: TENANT,
  accounts: [CAPTAIN, RIVAL, PLAYER, GUARDIAN, AGENT, LATE],
  memberships: [
    { email: ADMIN.email, role: 'orgAdmin' as const },
    { email: ORGANIZER.email, role: 'leagueOrganizer' as const, leagueSlugs: [OTHER_LEAGUE] },
  ],
  seasons: [season(LEAGUE, 'summer', { maxTeams: 2 }), season(OTHER_LEAGUE, 'thursday')],
  teams: [
    {
      leagueSlug: LEAGUE,
      seasonSlug: 'summer',
      name: 'Sand Sharks',
      captainEmail: CAPTAIN.email,
      playerEmails: [PLAYER.email],
      invites: [{ email: 'Pending@Example.com', expiresAt: 4_102_444_800_000, token: 'tok-a1b2' }],
      minors: [{ guardianEmail: GUARDIAN.email, minorName: 'Theo Bell' }],
    },
    { leagueSlug: LEAGUE, seasonSlug: 'summer', name: 'Block Party', captainEmail: RIVAL.email },
  ],
  waitlist: [
    {
      leagueSlug: LEAGUE,
      seasonSlug: 'summer',
      teamName: 'Late Lobsters',
      captainEmail: LATE.email,
    },
  ],
  freeAgents: [{ leagueSlug: OTHER_LEAGUE, seasonSlug: 'thursday', email: AGENT.email }],
};
const BATCH = { ...ROWS, users: [ADMIN, ORGANIZER] };

async function authDocs(t: T, model: 'user' | 'account') {
  return t.run(
    async (ctx) =>
      (
        (await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model,
          paginationOpts: { numItems: 100, cursor: null },
        })) as { page: Record<string, unknown>[] }
      ).page,
  );
}

const SCHEMA_TABLES = Object.keys(schema.tables) as (keyof typeof schema.tables)[];

async function rowCounts(t: T): Promise<number> {
  let total = 0;
  for (const table of SCHEMA_TABLES) {
    total += (await t.run((ctx) => ctx.db.query(table).collect())).length;
  }
  return total;
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

describe('testing:seedBatch outside a test deployment', () => {
  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['"TRUE"', 'TRUE'],
    ['empty', ''],
  ])(
    'seedBatch and seedBatchRows throw with IS_TEST %s and write nothing',
    async (_, value) => {
      vi.stubEnv('IS_TEST', value);
      const t = setup();
      await expect(t.action(internal.testing.seedBatch, BATCH)).rejects.toThrow(/IS_TEST/);
      await expect(t.mutation(internal.testing.seedBatchRows, ROWS)).rejects.toThrow(/IS_TEST/);
      expect(await authDocs(t, 'user')).toEqual([]);
      expect(await authDocs(t, 'account')).toEqual([]);
      expect(await rowCounts(t)).toBe(0);
    },
    30_000,
  );
});

describe('testing:seedBatch', () => {
  async function seeded(): Promise<{ t: T; teamIds: string[] }> {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    const { slug, teamIds } = await t.action(internal.testing.seedBatch, BATCH);
    expect(slug).toBe(ORG);
    return { t, teamIds };
  }

  test('a user with a password is signed up through Better Auth: the stored hash encodes scrypt N=2^15, r=8, p=3 and verifyPassword accepts it', async () => {
    const { t } = await seeded();
    const authUsers = await authDocs(t, 'user');
    const accounts = await authDocs(t, 'account');
    for (const user of [ADMIN, ORGANIZER]) {
      const authUser = authUsers.find((row) => row['email'] === user.email);
      const account = accounts.find((row) => row['userId'] === authUser?.['_id']);
      expect(account).toMatchObject({ providerId: 'credential' });
      const hash = String(account?.['password']);
      expect(hash.split('$').slice(0, 4)).toEqual([
        'scrypt',
        String(SCRYPT_LOG_N),
        String(SCRYPT_R),
        String(SCRYPT_P),
      ]);
      expect([SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P]).toEqual([15, 8, 3]);
      await expect(verifyPassword({ hash, password: user.password })).resolves.toBe(true);
      await expect(verifyPassword({ hash, password: `${user.password}x` })).resolves.toBe(false);
    }
    const hashes = accounts.map((row) => row['password']);
    expect(new Set(hashes).size).toBe(hashes.length);
  }, 60_000);

  test('an account has a users row and no credential, so it stores no password and cannot sign in', async () => {
    const { t } = await seeded();
    const authUsers = await authDocs(t, 'user');
    const accounts = await authDocs(t, 'account');
    const users = await t.run((ctx) => ctx.db.query('users').collect());
    expect(users.map((row) => row.name).sort()).toEqual(
      [ADMIN, ORGANIZER, CAPTAIN, RIVAL, PLAYER, GUARDIAN, AGENT, LATE].map((p) => p.name).sort(),
    );
    for (const account of [CAPTAIN, RIVAL, PLAYER, GUARDIAN, AGENT, LATE]) {
      const authUser = authUsers.find((row) => row['email'] === account.email);
      expect(authUser).toMatchObject({ name: account.name });
      expect(accounts.filter((row) => row['userId'] === authUser?.['_id'])).toEqual([]);
      expect(users.find((row) => row.authUserId === authUser?.['_id'])?.adultConfirmedAt).toEqual(
        expect.any(Number),
      );
    }
    expect(accounts).toHaveLength(2);
  }, 60_000);

  test('writes the tenant, memberships, seasons, teams with their players, invites, and minors, the waitlist, and the free agents', async () => {
    const { t, teamIds } = await seeded();
    const data = await t.run(async (ctx) => ({
      organizations: await ctx.db.query('organizations').collect(),
      leagues: await ctx.db.query('leagues').collect(),
      memberships: await ctx.db.query('memberships').collect(),
      seasons: await ctx.db.query('seasons').collect(),
      teams: await ctx.db.query('teams').collect(),
      rosterEntries: await ctx.db.query('rosterEntries').collect(),
      teamInvites: await ctx.db.query('teamInvites').collect(),
      waitlistEntries: await ctx.db.query('waitlistEntries').collect(),
      freeAgents: await ctx.db.query('freeAgents').collect(),
      users: await ctx.db.query('users').collect(),
    }));
    const userId = (p: { name: string }) => data.users.find((u) => u.name === p.name)?._id;
    const leagueId = (slug: string) => data.leagues.find((l) => l.slug === slug)?._id;
    const seasonId = (slug: string) => data.seasons.find((s) => s.slug === slug)?._id;

    expect(data.organizations.map((o) => o.slug)).toEqual([ORG]);
    expect(
      data.memberships
        .map((m) => [m.userId, m.role, m.leagueIds])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ).toEqual([
      [userId(ORGANIZER), 'leagueOrganizer', [leagueId(OTHER_LEAGUE)]],
      [userId(ADMIN), 'orgAdmin', []],
    ]);
    expect(data.seasons.map((s) => [s.slug, s.leagueId, s.maxTeams, s.status])).toEqual([
      ['summer', leagueId(LEAGUE), 2, 'published'],
      ['thursday', leagueId(OTHER_LEAGUE), undefined, 'published'],
    ]);
    expect(teamIds).toEqual(data.teams.map((team) => team._id));
    expect(data.teams.map((team) => [team.name, team.captainUserId, team.rosterCount])).toEqual([
      ['Sand Sharks', userId(CAPTAIN), 3],
      ['Block Party', userId(RIVAL), 1],
    ]);
    const sharks = data.rosterEntries.filter((entry) => entry.teamId === teamIds[0]);
    expect(sharks.map((entry) => [entry.userId, entry.minorName, entry.status])).toEqual([
      [userId(CAPTAIN), undefined, 'rostered'],
      [userId(PLAYER), undefined, 'rostered'],
      [userId(GUARDIAN), 'Theo Bell', 'rostered'],
    ]);
    expect(data.teamInvites).toEqual([
      expect.objectContaining({
        teamId: teamIds[0],
        email: 'pending@example.com',
        tokenHash: await hashInviteToken('tok-a1b2'),
        expiresAt: 4_102_444_800_000,
        status: 'pending',
      }),
    ]);
    expect(data.waitlistEntries).toEqual([
      expect.objectContaining({
        seasonId: seasonId('summer'),
        userId: userId(LATE),
        teamName: 'Late Lobsters',
        status: 'waiting',
      }),
    ]);
    expect(data.freeAgents).toEqual([
      expect.objectContaining({
        seasonId: seasonId('thursday'),
        userId: userId(AGENT),
        status: 'waiting',
      }),
    ]);
  }, 60_000);

  test('free agents keep the order they are listed in', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    const agents = ['first', 'second', 'third'].map(person);
    await t.action(internal.testing.seedBatch, {
      tenant: TENANT,
      accounts: agents,
      seasons: [season(LEAGUE, 'summer')],
      freeAgents: agents.map(({ email }) => ({ leagueSlug: LEAGUE, seasonSlug: 'summer', email })),
    });
    const names = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('freeAgents')
        .withIndex('by_seasonId_and_status_and_registeredAt')
        .collect();
      return Promise.all(rows.map(async (row) => (await ctx.db.get('users', row.userId))?.name));
    });
    expect(names).toEqual(agents.map((agent) => agent.name));
  }, 30_000);

  test('adds rows to an existing organization named by its slug', async () => {
    const { t } = await seeded();
    const { teamIds } = await t.action(internal.testing.seedBatch, {
      organizationSlug: ORG,
      accounts: [person('later')],
      teams: [
        {
          leagueSlug: OTHER_LEAGUE,
          seasonSlug: 'thursday',
          name: 'Later',
          captainEmail: person('later').email,
        },
      ],
    });
    const team = await t.run((ctx) => ctx.db.get('teams', teamIds[0] as never));
    expect(team).toMatchObject({ name: 'Later' });
  }, 60_000);

  test.each([
    ['neither a tenant nor an organization slug', {}],
    ['both a tenant and an organization slug', { tenant: TENANT, organizationSlug: ORG }],
  ])('refuses %s', async (_, args) => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await expect(t.action(internal.testing.seedBatch, args)).rejects.toThrow(
      /exactly one of tenant and organizationSlug/,
    );
    expect(await rowCounts(t)).toBe(0);
  });

  test('a waitlist entry for a season with room throws, and the batch writes nothing', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await expect(
      t.action(internal.testing.seedBatch, {
        tenant: TENANT,
        accounts: [LATE],
        seasons: [season(LEAGUE, 'summer')],
        waitlist: [
          {
            leagueSlug: LEAGUE,
            seasonSlug: 'summer',
            teamName: 'Late Lobsters',
            captainEmail: LATE.email,
          },
        ],
      }),
    ).rejects.toThrow(/not full/);
    expect(await rowCounts(t)).toBe(0);
    expect(await authDocs(t, 'user')).toEqual([]);
  });
});
