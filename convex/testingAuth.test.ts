/// <reference types="vite/client" />
// The auth parts of `convex/testing.ts` (#62; ADR 0005 "#7 (auth)", ADR 0008 "Testing"): password
// users seeded through Better Auth's own sign-up, and `testing:reset` clearing the component's
// tables, including `jwks`. Each throws without IS_TEST before touching data.
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { components, internal } from './_generated/api';
import schema from './schema';
import { AUTH_COMPONENT_TABLES } from './lib/testOnly';
import { modules } from './test.setup';

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

const TENANT = {
  organization: { name: 'E2E Org c3d4', slug: 'e2e-org-c3d4' },
  locations: [],
  leagues: [],
};
const USER = {
  name: 'Seeded Player',
  email: 'seeded.c3d4@example.test',
  password: 'a random per-run passphrase',
};

async function authDocs(t: T, model: (typeof AUTH_COMPONENT_TABLES)[number]) {
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

async function appCounts(t: T) {
  return t.run(async (ctx) => ({
    users: (await ctx.db.query('users').collect()).length,
    organizations: (await ctx.db.query('organizations').collect()).length,
  }));
}

/** A failure row of the per-address sign-in throttle (#63), which `reset` clears too. */
const seedSignInFailure = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert('signInFailures', {
      email: 'locked@example.test',
      failures: 100,
      blockedUntil: 0,
    }),
  );
const signInFailureCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query('signInFailures').collect()).length);

/** One document in each of the auth tables a run leaves behind, `jwks` among them. */
async function seedAuthDocs(t: T) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const create = (input: Record<string, unknown>) =>
      ctx.runMutation(components.betterAuth.adapter.create, { input } as never);
    await create({ model: 'jwks', data: { publicKey: '{}', privateKey: 'enc', createdAt: now } });
    await create({
      model: 'user',
      data: {
        name: 'Old',
        email: 'old@example.test',
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    await create({
      model: 'verification',
      data: { identifier: 'x', value: 'y', expiresAt: now + 1, createdAt: now, updatedAt: now },
    });
    await create({ model: 'rateLimit', data: { key: 'k', count: 1, lastRequest: now } });
  });
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

test('AUTH_COMPONENT_TABLES lists every table of the Better Auth component', () => {
  expect([...AUTH_COMPONENT_TABLES].sort()).toEqual(
    Object.keys(betterAuthTest.schema.tables).sort(),
  );
  expect(AUTH_COMPONENT_TABLES).toContain('jwks');
});

describe('IS_TEST guard on the auth additions', () => {
  const refused: [string, string | undefined][] = [
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ];

  test.each(refused)(
    'testing:seedLeague with users throws with IS_TEST %s and writes nothing',
    async (_, value) => {
      vi.stubEnv('IS_TEST', value);
      const t = setup();
      await expect(
        t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] }),
      ).rejects.toThrow(/IS_TEST/);
      expect(await authDocs(t, 'user')).toEqual([]);
      expect(await authDocs(t, 'account')).toEqual([]);
      expect(await appCounts(t)).toEqual({ users: 0, organizations: 0 });
    },
  );

  test.each(refused)(
    'testing:reset throws with IS_TEST %s and leaves the auth tables, jwks included',
    async (_, value) => {
      vi.stubEnv('IS_TEST', value);
      const t = setup();
      await seedAuthDocs(t);
      await seedSignInFailure(t);
      await expect(t.mutation(internal.testing.reset, {})).rejects.toThrow(/IS_TEST/);
      expect(await authDocs(t, 'jwks')).toHaveLength(1);
      expect(await authDocs(t, 'user')).toHaveLength(1);
      // The signInFailures step throws before touching data too (#63).
      expect(await signInFailureCount(t)).toBe(1);
    },
  );
});

describe('testing:seedLeague with users', () => {
  test('signs each user up through Better Auth, with a real hash and a users row', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await expect(
      t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] }),
    ).resolves.toEqual({ slug: TENANT.organization.slug });

    const [authUser, ...others] = await authDocs(t, 'user');
    expect(others).toEqual([]);
    expect(authUser).toMatchObject({ email: USER.email, name: USER.name });
    const [account] = await authDocs(t, 'account');
    expect(account).toMatchObject({ providerId: 'credential', userId: authUser?.['_id'] });
    expect(account?.['password']).toMatch(/^scrypt\$15\$8\$3\$/);
    const users = await t.run((ctx) => ctx.db.query('users').collect());
    expect(users).toEqual([
      expect.objectContaining({ authUserId: authUser?.['_id'], name: USER.name }),
    ]);
    expect(await appCounts(t)).toEqual({ users: 1, organizations: 1 });
  }, 30_000);

  test('without users, creates only the tenant', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, TENANT);
    expect(await authDocs(t, 'user')).toEqual([]);
    expect(await appCounts(t)).toEqual({ users: 0, organizations: 1 });
  });
});

describe('testing:reset and the auth component', () => {
  test('clears every auth table, jwks included, and the users rows', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
    await seedAuthDocs(t);
    await seedSignInFailure(t);
    // The sign-up's JWT already created a signing key; seedAuthDocs added another.
    expect((await authDocs(t, 'jwks')).length).toBeGreaterThanOrEqual(2);
    let before = 0;
    for (const model of AUTH_COMPONENT_TABLES) before += (await authDocs(t, model)).length;
    // At least: 2 users, 1 account, 1 session, 2 jwks, 1 verification, 1 rateLimit.
    expect(before).toBeGreaterThanOrEqual(8);

    const result = await t.mutation(internal.testing.reset, {});
    // The app documents are the users row, the organization, and the sign-in failure row (#63).
    expect(result).toMatchObject({ documents: 3, authDocuments: before });
    expect(await signInFailureCount(t)).toBe(0);
    for (const model of AUTH_COMPONENT_TABLES) expect(await authDocs(t, model), model).toEqual([]);
    expect(await appCounts(t)).toEqual({ users: 0, organizations: 0 });

    // The same address can be seeded again afterwards.
    await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
    expect(await authDocs(t, 'user')).toHaveLength(1);
  }, 30_000);
});

describe('testing:seedSignInFailures (#63 e2e: reach the hard limit without 100 attempts)', () => {
  const failureRows = (t: T) => t.run((ctx) => ctx.db.query('signInFailures').collect());

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    vi.stubEnv('IS_TEST', value);
    const t = setup();
    await expect(
      t.mutation(internal.testing.seedSignInFailures, { email: 'a@example.test', failures: 100 }),
    ).rejects.toThrow(/IS_TEST/);
    expect(await failureRows(t)).toEqual([]);
  });

  test('sets the row of the lowercase address, none waiting, and replaces it on a second call', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.mutation(internal.testing.seedSignInFailures, {
      email: 'Locked.User@Example.test',
      failures: 100,
    });
    expect(await failureRows(t)).toMatchObject([
      { email: 'locked.user@example.test', failures: 100, blockedUntil: 0 },
    ]);
    await t.mutation(internal.testing.seedSignInFailures, {
      email: 'locked.user@example.test',
      failures: 7,
    });
    expect(await failureRows(t)).toMatchObject([
      { email: 'locked.user@example.test', failures: 7, blockedUntil: 0 },
    ]);
  });
});

describe('testing:accountByEmail', () => {
  test('throws without IS_TEST', async () => {
    vi.stubEnv('IS_TEST', undefined);
    const t = setup();
    await expect(t.query(internal.testing.accountByEmail, { email: USER.email })).rejects.toThrow(
      /IS_TEST/,
    );
  });

  test("returns the users row's name and adultConfirmedAt, and the live session count", async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await expect(
      t.query(internal.testing.accountByEmail, { email: USER.email }),
    ).resolves.toBeNull();
    const before = Date.now();
    await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
    const account = await t.query(internal.testing.accountByEmail, {
      email: USER.email.toUpperCase(),
    });
    expect(account).toEqual({
      name: USER.name,
      adultConfirmedAt: expect.any(Number) as number,
      sessions: 1,
    });
    expect(account?.adultConfirmedAt).toBeGreaterThanOrEqual(before);
  }, 30_000);
});

describe('testing:addMembership (#65)', () => {
  const MEMBER = { organizationSlug: TENANT.organization.slug, email: USER.email };

  test('throws without IS_TEST', async () => {
    vi.stubEnv('IS_TEST', undefined);
    const t = setup();
    await expect(
      t.mutation(internal.testing.addMembership, { ...MEMBER, role: 'orgAdmin' }),
    ).rejects.toThrow(/IS_TEST/);
  });

  test.each([
    ['"false"', 'false'],
    ['empty', ''],
    ['"TRUE"', 'TRUE'],
  ])(
    'refuses with IS_TEST %s even for a real organization and account, and adds no membership',
    async (_, value) => {
      vi.stubEnv('IS_TEST', 'true');
      const t = setup();
      await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
      vi.stubEnv('IS_TEST', value);
      await expect(
        t.mutation(internal.testing.addMembership, { ...MEMBER, role: 'orgAdmin' }),
      ).rejects.toThrow(/IS_TEST/);
      expect(await t.run((ctx) => ctx.db.query('memberships').collect())).toEqual([]);
    },
    30_000,
  );

  test('makes the seeded user a league organizer of the seeded organization, once', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
    await t.mutation(internal.testing.addMembership, {
      ...MEMBER,
      email: USER.email.toUpperCase(),
      role: 'leagueOrganizer',
    });
    const memberships = await t.run((ctx) => ctx.db.query('memberships').collect());
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: 'leagueOrganizer', leagueIds: [] });
    // A second membership for the same user and organization is refused: at most one exists.
    await expect(
      t.mutation(internal.testing.addMembership, { ...MEMBER, role: 'orgAdmin' }),
    ).rejects.toThrow(/already/);
  }, 30_000);

  test('makes the seeded user an org admin', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
    await t.mutation(internal.testing.addMembership, { ...MEMBER, role: 'orgAdmin' });
    const memberships = await t.run((ctx) => ctx.db.query('memberships').collect());
    expect(memberships.map((m) => m.role)).toEqual(['orgAdmin']);
  }, 30_000);

  test('throws for an unknown organization or user', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
    await expect(
      t.mutation(internal.testing.addMembership, {
        ...MEMBER,
        organizationSlug: 'no-such-org',
        role: 'orgAdmin',
      }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.addMembership, {
        ...MEMBER,
        email: 'nobody@example.test',
        role: 'orgAdmin',
      }),
    ).rejects.toThrow(/No account/);
  }, 30_000);
});
