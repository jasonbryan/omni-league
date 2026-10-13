/// <reference types="vite/client" />
// `testing:assignForeignLeague` (#141), against the real schema: it seeds the case `listMine`
// must drop, a membership whose assigned leagues include a league of another organization.
// Throws without IS_TEST before touching data.
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

const TENANT = {
  organization: { name: 'E2E Org a1b2', slug: 'e2e-org-a1b2' },
  locations: [{ name: 'Field One', address: '1 Test Road' }],
  leagues: [{ name: 'Coed 7v7', sport: 'soccer' as const, locations: ['Field One'] }],
};
const OTHER = {
  organization: { name: 'Other Org', slug: 'other-org' },
  locations: [{ name: 'Field One', address: '2 Test Road' }],
  leagues: [{ name: 'Other League', sport: 'soccer' as const, locations: ['Field One'] }],
};
const USER = {
  name: 'League Organizer',
  email: 'organizer.a1b2@example.test',
  password: 'a random per-run passphrase',
};
const ARGS = {
  organizationSlug: TENANT.organization.slug,
  email: USER.email,
  leagueOrganizationSlug: OTHER.organization.slug,
  leagueSlug: 'other-league',
};

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

async function seeded() {
  vi.stubEnv('IS_TEST', 'true');
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  await t.action(internal.testing.seedLeague, { ...TENANT, users: [USER] });
  await t.action(internal.testing.seedLeague, OTHER);
  await t.mutation(internal.testing.addLeagueOrganizer, {
    organizationSlug: TENANT.organization.slug,
    email: USER.email,
    leagueSlugs: ['coed-7v7'],
  });
  return t;
}

type T = Awaited<ReturnType<typeof seeded>>;

const membership = async (t: T) =>
  t.run(async (ctx) => (await ctx.db.query('memberships').collect())[0]);

describe('testing:assignForeignLeague', () => {
  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])(
    'throws with IS_TEST %s and changes nothing',
    async (_, value) => {
      const t = await seeded();
      const before = await membership(t);
      vi.stubEnv('IS_TEST', value);
      await expect(t.mutation(internal.testing.assignForeignLeague, ARGS)).rejects.toThrow(
        /IS_TEST/,
      );
      expect(await membership(t)).toEqual(before);
    },
    30_000,
  );

  test("adds the other organization's league to the membership, keeping the assigned ones", async () => {
    const t = await seeded();
    await t.mutation(internal.testing.assignForeignLeague, {
      ...ARGS,
      email: USER.email.toUpperCase(),
    });
    const leagues = await t.run((ctx) => ctx.db.query('leagues').collect());
    const coed = leagues.find((league) => league.slug === 'coed-7v7');
    const foreign = leagues.find((league) => league.slug === 'other-league');
    expect((await membership(t))?.leagueIds).toEqual([coed?._id, foreign?._id]);
    expect(foreign?.organizationId).not.toBe(coed?.organizationId);
  }, 30_000);

  test('throws, writing nothing, for an unknown organization, account, or league, a missing membership, and a league of the same organization', async () => {
    const t = await seeded();
    const before = await membership(t);
    for (const [change, error] of [
      [{ organizationSlug: 'nope' }, /No organization/],
      [{ leagueOrganizationSlug: 'nope' }, /No organization/],
      [{ email: 'nobody@example.test' }, /No account/],
      [{ leagueSlug: 'nope' }, /No league/],
      [{ leagueOrganizationSlug: TENANT.organization.slug }, /another organization/],
      [{ organizationSlug: OTHER.organization.slug }, /no membership/],
    ] as const) {
      await expect(
        t.mutation(internal.testing.assignForeignLeague, { ...ARGS, ...change }),
      ).rejects.toThrow(error);
    }
    expect(await membership(t)).toEqual(before);
  }, 30_000);
});
