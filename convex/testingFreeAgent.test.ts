/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { components, internal } from './_generated/api';
import { ACCOUNTS_PER_SEED_CALL } from './lib/seedCallLimits';
import { insertTeamWithCaptain } from './lib/rosterWrites';
import { insertSeason, insertTenant, defaultDivision } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

afterEach(() => {
  vi.unstubAllEnvs();
});

const SEASON_SLUGS = {
  organizationSlug: 'org-a',
  leagueSlug: 'coed-4s',
  seasonSlug: 'summer-2030',
};
const EMAIL = 'placed@example.test';

async function setup() {
  vi.stubEnv('IS_TEST', 'true');
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const teamId = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Coed 4s',
          sport: 'beachVolleyball',
          locations: ['Alpha Beach'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const league = (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', 'coed-4s'),
      )
      .unique())!;
    const seasonId = await insertSeason(
      ctx,
      league,
      {
        name: 'Summer 2030',
        slug: 'summer-2030',
        startDate: '2030-06-01',
        endDate: '2030-08-30',
        registrationDeadline: '2030-05-20',
        playersPerSide: 4,
        minimumRosterSize: 4,
      },
      'published',
    );
    const authUser = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'user',
        data: {
          name: 'Placed Player',
          email: EMAIL,
          emailVerified: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    } as never)) as { _id: string };
    await ctx.db.insert('users', {
      authUserId: authUser._id,
      name: 'Placed Player',
      adultConfirmedAt: 1,
    });
    const captainUserId = await ctx.db.insert('users', {
      authUserId: 'captain',
      name: 'Captain',
      adultConfirmedAt: 1,
    });
    const season = (await ctx.db.get('seasons', seasonId))!;
    return insertTeamWithCaptain(ctx, season, { name: 'Sand Sharks', captainUserId });
  });
  return { t, teamId };
}

describe('testing:seedFreeAgent', () => {
  test('a second call for a placed free agent is refused and writes no second row', async () => {
    const { t, teamId } = await setup();
    const args = { ...SEASON_SLUGS, email: EMAIL, placedTeamId: teamId };
    await t.mutation(internal.testing.seedFreeAgent, args);
    await expect(t.mutation(internal.testing.seedFreeAgent, args)).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query('freeAgents').collect()).toEqual([
        expect.objectContaining({ status: 'placed', placedTeamId: teamId }),
      ]);
      const entries = await ctx.db.query('rosterEntries').collect();
      expect(entries.filter((entry) => entry.source === 'placement')).toHaveLength(1);
    });
  });
});

describe('testing:seedWaitingFreeAgents', () => {
  test('writes the given number of waiting free agents, each with an account and its email', async () => {
    const { t } = await setup();
    await t.mutation(internal.testing.seedWaitingFreeAgents, {
      ...SEASON_SLUGS,
      count: 3,
      emailPrefix: 'many',
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('freeAgents').collect();
      expect(rows.map((row) => row.status)).toEqual(['waiting', 'waiting', 'waiting']);
      const names = [];
      for (const row of rows) {
        const user = (await ctx.db.get('users', row.userId))!;
        const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'user',
          where: [{ field: '_id', value: user.authUserId }],
        } as never)) as { email: string };
        names.push([user.name, account.email]);
      }
      expect(names).toEqual([
        ['Free Agent 001', 'many-001@example.test'],
        ['Free Agent 002', 'many-002@example.test'],
        ['Free Agent 003', 'many-003@example.test'],
      ]);
    });
  });

  async function waitingNames(t: Awaited<ReturnType<typeof setup>>['t']) {
    return t.run(async (ctx) => {
      const season = (await ctx.db.query('seasons').first())!;
      const rows = await ctx.db
        .query('freeAgents')
        .withIndex('by_seasonId_and_status_and_registeredAt', (q) =>
          q.eq('seasonId', season._id).eq('status', 'waiting'),
        )
        .collect();
      return Promise.all(rows.map(async (row) => (await ctx.db.get('users', row.userId))!.name));
    });
  }

  test('a count above the per-call limit throws and writes nothing, and the limit itself succeeds', async () => {
    const { t } = await setup();
    await expect(
      t.mutation(internal.testing.seedWaitingFreeAgents, {
        ...SEASON_SLUGS,
        count: ACCOUNTS_PER_SEED_CALL + 1,
        emailPrefix: 'many',
      }),
    ).rejects.toThrow(/at most 25/);
    expect(await waitingNames(t)).toEqual([]);
    await t.mutation(internal.testing.seedWaitingFreeAgents, {
      ...SEASON_SLUGS,
      count: ACCOUNTS_PER_SEED_CALL,
      emailPrefix: 'many',
    });
    expect(await waitingNames(t)).toHaveLength(ACCOUNTS_PER_SEED_CALL);
  }, 30_000);

  test.each([
    ['from 0', { from: 0, count: 1 }],
    ['from 1.5', { from: 1.5, count: 1 }],
    ['from -1', { from: -1, count: 1 }],
    ['count 0', { count: 0 }],
    ['count 1.5', { count: 1.5 }],
  ])('%s throws and writes nothing', async (_, extra) => {
    const { t } = await setup();
    await expect(
      t.mutation(internal.testing.seedWaitingFreeAgents, {
        ...SEASON_SLUGS,
        emailPrefix: 'many',
        ...extra,
      }),
    ).rejects.toThrow(/positive integer/);
    expect(await waitingNames(t)).toEqual([]);
  });

  test('two calls number the free agents on from one another and list them in insertion order', async () => {
    const { t } = await setup();
    for (const from of [1, 3]) {
      await t.mutation(internal.testing.seedWaitingFreeAgents, {
        ...SEASON_SLUGS,
        from,
        count: 2,
        emailPrefix: 'many',
      });
    }
    expect(await waitingNames(t)).toEqual([
      'Free Agent 001',
      'Free Agent 002',
      'Free Agent 003',
      'Free Agent 004',
    ]);
  });

  test('every seeded user is an account with no credential', async () => {
    const { t } = await setup();
    await t.mutation(internal.testing.seedWaitingFreeAgents, {
      ...SEASON_SLUGS,
      count: 2,
      emailPrefix: 'many',
    });
    const accounts = await t.run(
      async (ctx) =>
        (
          (await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'account',
            paginationOpts: { numItems: 100, cursor: null },
          })) as { page: unknown[] }
        ).page,
    );
    expect(accounts).toEqual([]);
  });

  test('refuses outside a test deployment', async () => {
    const { t } = await setup();
    vi.stubEnv('IS_TEST', undefined);
    await expect(
      t.mutation(internal.testing.seedWaitingFreeAgents, {
        ...SEASON_SLUGS,
        count: 1,
        emailPrefix: 'many',
      }),
    ).rejects.toThrow();
  });
});
