/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { components, internal } from './_generated/api';
import { insertTeamWithCaptain } from './lib/rosterWrites';
import { insertSeason, insertTenant } from './lib/tenantWrites';
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
      leagues: [{ name: 'Coed 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'] }],
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
