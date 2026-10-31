/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  addRosterEntry,
  backfillSeasonTeamCounts,
  insertTeam,
  removeRosterEntry,
} from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const SEASON: NewSeason = {
  name: 'Summer 2030',
  slug: 'summer-2030',
  startDate: '2030-06-01',
  endDate: '2030-08-30',
  registrationDeadline: '2030-05-20',
  playersPerSide: 4,
  minimumRosterSize: 4,
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
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
    const summer = await insertSeason(ctx, league, SEASON, 'published');
    const fall = await insertSeason(
      ctx,
      league,
      { ...SEASON, name: 'Fall 2030', slug: 'fall-2030' },
      'published',
    );
    const user = (name: string) =>
      ctx.db.insert('users', { authUserId: name, name, adultConfirmedAt: 1 });
    return {
      summer,
      fall,
      ana: await user('ana'),
      ben: await user('ben'),
      cy: await user('cy'),
    };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const seasonOf = async (ctx: MutationCtx, id: Id<'seasons'>) => (await ctx.db.get('seasons', id))!;
const teamOf = async (ctx: MutationCtx, id: Id<'teams'>) => (await ctx.db.get('teams', id))!;

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

async function expectCountersMatchRecount({ t }: Setup): Promise<void> {
  await t.run(async (ctx) => {
    const entries = await ctx.db.query('rosterEntries').collect();
    for (const team of await ctx.db.query('teams').collect()) {
      const rostered = entries.filter((e) => e.teamId === team._id && e.status === 'rostered');
      expect(team.rosterCount).toBe(rostered.length);
    }
    const teams = await ctx.db.query('teams').collect();
    for (const season of await ctx.db.query('seasons').collect()) {
      expect(season.teamCount).toBe(teams.filter((team) => team.seasonId === season._id).length);
    }
  });
}

describe('rosterWrites, called directly', () => {
  test('a team starts with its captain as its only rostered entry, and the counters move by one', async () => {
    const s = await setup();
    const teamId = await s.t.run(async (ctx) =>
      insertTeam(ctx, await seasonOf(ctx, s.summer), { name: 'Sand Sharks', captainUserId: s.ana }),
    );
    await s.t.run(async (ctx) => {
      const team = await teamOf(ctx, teamId);
      expect(team).toMatchObject({ name: 'Sand Sharks', sortName: 'sand sharks', rosterCount: 1 });
      const entries = await ctx.db.query('rosterEntries').collect();
      expect(entries).toEqual([
        expect.objectContaining({
          teamId,
          userId: s.ana,
          status: 'rostered',
          source: 'captain',
          addedByUserId: s.ana,
        }),
      ]);
      expect((await seasonOf(ctx, s.summer)).teamCount).toBe(1);
    });
    await expectCountersMatchRecount(s);
  });

  test('refuses a second rostered entry for the same user on the same team', async () => {
    const s = await setup();
    const failure = await s.t
      .run(async (ctx) => {
        const teamId = await insertTeam(ctx, await seasonOf(ctx, s.summer), {
          name: 'Sand Sharks',
          captainUserId: s.ana,
        });
        await addRosterEntry(ctx, await teamOf(ctx, teamId), {
          userId: s.ana,
          source: 'invite',
          addedByUserId: s.ana,
        });
      })
      .catch(refusalOf);
    expect(failure).toEqual({
      code: 'alreadyOnTeam',
      teamName: 'Sand Sharks',
      message: 'Already on the team.',
    });
    await s.t.run(async (ctx) => {
      expect(await ctx.db.query('rosterEntries').collect()).toEqual([]);
    });
  });

  test('refuses a rostered entry on another team of the same season, naming the first team', async () => {
    const s = await setup();
    const teamId = await s.t.run(async (ctx) =>
      insertTeam(ctx, await seasonOf(ctx, s.summer), { name: 'Sand Sharks', captainUserId: s.ana }),
    );
    const other = await s.t.run(async (ctx) =>
      insertTeam(ctx, await seasonOf(ctx, s.summer), { name: 'Net Results', captainUserId: s.ben }),
    );
    await s.t.run(async (ctx) =>
      addRosterEntry(ctx, await teamOf(ctx, teamId), {
        userId: s.cy,
        source: 'invite',
        addedByUserId: s.ana,
      }),
    );
    const failure = await s.t
      .run(async (ctx) =>
        addRosterEntry(ctx, await teamOf(ctx, other), {
          userId: s.cy,
          source: 'placement',
          addedByUserId: s.ben,
        }),
      )
      .catch(refusalOf);
    expect(failure).toEqual({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Sand Sharks',
      message: 'Already on Sand Sharks in this season.',
    });
    await expectCountersMatchRecount(s);
  });

  test('adds the same user to a team of another season', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await insertTeam(ctx, await seasonOf(ctx, s.summer), {
        name: 'Sand Sharks',
        captainUserId: s.ana,
      });
      await insertTeam(ctx, await seasonOf(ctx, s.fall), {
        name: 'Sand Sharks',
        captainUserId: s.ana,
      });
    });
    await s.t.run(async (ctx) => {
      expect(await ctx.db.query('teams').collect()).toHaveLength(2);
      expect((await seasonOf(ctx, s.fall)).teamCount).toBe(1);
    });
    await expectCountersMatchRecount(s);
  });

  test('a removed entry keeps its row, lowers the count, and no longer blocks another team', async () => {
    const s = await setup();
    const teamId = await s.t.run(async (ctx) =>
      insertTeam(ctx, await seasonOf(ctx, s.summer), { name: 'Sand Sharks', captainUserId: s.ana }),
    );
    await s.t.run(async (ctx) => {
      await addRosterEntry(ctx, await teamOf(ctx, teamId), {
        userId: s.cy,
        source: 'invite',
        addedByUserId: s.ana,
      });
      const entry = (await ctx.db.query('rosterEntries').collect()).find((e) => e.userId === s.cy)!;
      await removeRosterEntry(ctx, entry, s.ana);
      await removeRosterEntry(ctx, entry, s.ana);
    });
    await s.t.run(async (ctx) => {
      const removed = (await ctx.db.query('rosterEntries').collect()).find(
        (e) => e.userId === s.cy,
      );
      expect(removed).toMatchObject({ status: 'removed', removedByUserId: s.ana });
      expect(removed?.removedAt).toBeGreaterThan(0);
      expect((await teamOf(ctx, teamId)).rosterCount).toBe(1);
      await insertTeam(ctx, await seasonOf(ctx, s.summer), {
        name: 'Net Results',
        captainUserId: s.cy,
      });
    });
    await expectCountersMatchRecount(s);
  });

  test('a season with no team count is recounted when a team registers, and the backfill sets the rest', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('seasons', s.summer, { teamCount: undefined });
      await ctx.db.patch('seasons', s.fall, { teamCount: undefined });
      await insertTeam(ctx, await seasonOf(ctx, s.summer), {
        name: 'Sand Sharks',
        captainUserId: s.ana,
      });
    });
    expect(await s.t.run((ctx) => backfillSeasonTeamCounts(ctx))).toBe(1);
    expect(await s.t.run((ctx) => backfillSeasonTeamCounts(ctx))).toBe(0);
    await expectCountersMatchRecount(s);
  });
});
