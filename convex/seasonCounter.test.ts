/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertSeason, insertTenant, publishSeason, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

const season = (n: number): NewSeason => ({
  name: `Season ${n}`,
  slug: `season-${n}`,
  startDate: `2027-0${n}-01`,
  endDate: '2027-12-31',
  registrationDeadline: '2026-12-01',
  playersPerSide: 7,
  minimumRosterSize: 7,
});

async function counters(
  t: T,
): Promise<Record<string, { stored: number | undefined; recount: number }>> {
  return t.run(async (ctx) => {
    const result: Record<string, { stored: number | undefined; recount: number }> = {};
    for (const league of await ctx.db.query('leagues').collect()) {
      const organization = (await ctx.db.get('organizations', league.organizationId))!;
      const published = await ctx.db
        .query('seasons')
        .withIndex('by_leagueId_and_status_and_startDate', (q) =>
          q.eq('leagueId', league._id).eq('status', 'published'),
        )
        .collect();
      result[`${organization.slug}/${league.slug}`] = {
        stored: league.publishedSeasonCount,
        recount: published.length,
      };
    }
    return result;
  });
}

async function expectCountersMatch(t: T): Promise<void> {
  const all = await counters(t);
  expect(Object.keys(all).length).toBeGreaterThan(0);
  for (const [league, { stored, recount }] of Object.entries(all)) {
    expect(stored, league).toBe(recount);
  }
}

async function tenant(t: T): Promise<Doc<'leagues'>> {
  return t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'org-a'))
      .unique())!;
    return (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', 'coed-7v7'),
      )
      .unique())!;
  });
}

// `t.run` returns a missing value as `null`.
const stored = async (t: T, id: Id<'leagues'>): Promise<number | undefined> =>
  (await t.run(async (ctx) => (await ctx.db.get('leagues', id))?.publishedSeasonCount)) ??
  undefined;

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('leagues.publishedSeasonCount: the writers', () => {
  test('a league starts at 0, a draft season changes nothing, and a season inserted as published adds 1', async () => {
    const t = setup();
    const league = await tenant(t);
    expect(await stored(t, league._id)).toBe(0);

    await t.run(async (ctx) => {
      await insertSeason(ctx, league, season(1));
    });
    expect(await stored(t, league._id)).toBe(0);

    await t.run(async (ctx) => {
      await insertSeason(ctx, league, season(2), 'published');
      await insertSeason(ctx, league, season(3), 'published');
    });
    expect(await stored(t, league._id)).toBe(2);
    await expectCountersMatch(t);
  });

  test('publishing a draft adds 1 and a repeat publish leaves the counter unchanged', async () => {
    const t = setup();
    const league = await tenant(t);
    const seasonId = await t.run((ctx) => insertSeason(ctx, league, season(1)));

    const publish = () =>
      t.run(async (ctx) => {
        await publishSeason(ctx, (await ctx.db.get('seasons', seasonId))!);
      });
    await publish();
    expect(await stored(t, league._id)).toBe(1);
    await publish();
    await publish();
    expect(await stored(t, league._id)).toBe(1);
    await expectCountersMatch(t);
  });

  test('a league without a counter reads as 0, and the writers start it from 0', async () => {
    const t = setup();
    const league = await tenant(t);
    await t.run(async (ctx) => {
      await ctx.db.replace('leagues', league._id, {
        organizationId: league.organizationId,
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        locationIds: league.locationIds,
        sortName: league.sortName,
        status: league.status,
      });
    });
    expect(await stored(t, league._id)).toBeUndefined();

    const draftId = await t.run(async (ctx) => {
      const current = (await ctx.db.get('leagues', league._id))!;
      return insertSeason(ctx, current, season(1));
    });
    expect(await stored(t, league._id)).toBeUndefined();

    await t.run(async (ctx) => {
      await publishSeason(ctx, (await ctx.db.get('seasons', draftId))!);
    });
    expect(await stored(t, league._id)).toBe(1);
    await t.run(async (ctx) => {
      const current = (await ctx.db.get('leagues', league._id))!;
      await insertSeason(ctx, current, season(2), 'published');
    });
    expect(await stored(t, league._id)).toBe(2);
    await expectCountersMatch(t);
  });
});

describe('leagues.publishedSeasonCount: seasons.publish', () => {
  test('the mutation counts the season once, and a repeat call counts nothing', async () => {
    const t = setup();
    const league = await tenant(t);
    const seasonId = await t.run((ctx) => insertSeason(ctx, league, season(1)));
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        authUserId: 'admin-a',
        name: 'admin-a',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId: league.organizationId,
        role: 'orgAdmin',
        leagueIds: [],
      });
    });
    const admin = t.withIdentity({
      subject: 'admin-a',
      issuer: 'http://127.0.0.1:3211',
      email: 'admin-a@example.test',
      emailVerified: false,
      name: 'admin-a',
      sessionId: 's1',
    });
    await admin.mutation(api.seasons.publish, { seasonId });
    expect(await stored(t, league._id)).toBe(1);
    await admin.mutation(api.seasons.publish, { seasonId });
    expect(await stored(t, league._id)).toBe(1);
    await expectCountersMatch(t);
  });
});

describe('leagues.publishedSeasonCount: testing:seedSeason', () => {
  test('a published season it inserts is counted, and a draft is not', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    const league = await tenant(t);
    const base = {
      organizationSlug: 'org-a',
      leagueSlug: 'coed-7v7',
      endDate: '2027-12-31',
      registrationDeadline: '2026-12-01',
      playersPerSide: 7,
      minimumRosterSize: 7,
    };
    await t.mutation(internal.testing.seedSeason, {
      ...base,
      name: 'Draft',
      slug: 'draft',
      startDate: '2027-01-01',
    });
    expect(await stored(t, league._id)).toBe(0);
    await t.mutation(internal.testing.seedSeason, {
      ...base,
      name: 'Published',
      slug: 'published',
      startDate: '2027-02-01',
      status: 'published',
    });
    expect(await stored(t, league._id)).toBe(1);
    await expectCountersMatch(t);
  });
});

describe('leagues.publishedSeasonCount: seed:demo', () => {
  test('after a run on an empty deployment, and again after a second run, every league’s counter equals a recount', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    await expectCountersMatch(t);
    const all = await counters(t);
    expect(all['gulf-coast-sport-social/sunday-reverse-coed-4s']).toEqual({
      stored: 1,
      recount: 1,
    });
    expect(all['gulf-coast-sport-social/coed-7v7-rec']).toEqual({ stored: 1, recount: 1 });
    expect(all['gulf-coast-sport-social/thursday-night-coed-2s']).toEqual({
      stored: 0,
      recount: 0,
    });

    await t.mutation(internal.seed.demo, {});
    await expectCountersMatch(t);
    expect(await counters(t)).toEqual(all);
  });

  test('the backfill sets the counter of a league without one from a recount of its published seasons, and a second run changes nothing', async () => {
    const t = setup();
    const league = await tenant(t);
    await t.run(async (ctx) => {
      await insertSeason(ctx, league, season(1), 'published');
      await insertSeason(ctx, league, season(2), 'published');
      await insertSeason(ctx, league, season(3));
      await ctx.db.replace('leagues', league._id, {
        organizationId: league.organizationId,
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        locationIds: league.locationIds,
        sortName: league.sortName,
        status: league.status,
      });
    });
    expect(await stored(t, league._id)).toBeUndefined();

    const first = await t.mutation(internal.seed.demo, {});
    expect(first.backfilled.leagues).toBeGreaterThanOrEqual(1);
    expect(await stored(t, league._id)).toBe(2);
    await expectCountersMatch(t);

    const second = await t.mutation(internal.seed.demo, {});
    expect(second.backfilled).toEqual({
      organizations: 0,
      locations: 0,
      leagues: 0,
      seasons: 0,
      leagueDivisions: 0,
    });
    expect(await stored(t, league._id)).toBe(2);
  });

  test('the backfill leaves a counter that is already set alone', async () => {
    const t = setup();
    const league = await tenant(t);
    await t.run(async (ctx) => {
      await insertSeason(ctx, league, season(1), 'published');
      await ctx.db.patch('leagues', league._id, { publishedSeasonCount: 5 });
    });
    await t.mutation(internal.seed.demo, {});
    expect(await stored(t, league._id)).toBe(5);
  });

  test('with a wrong PREVIEW_ORIGIN_PATTERN it writes nothing', async () => {
    const t = setup();
    const league = await tenant(t);
    await t.run(async (ctx) => {
      await insertSeason(ctx, league, season(1), 'published');
      await ctx.db.replace('leagues', league._id, {
        organizationId: league.organizationId,
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        locationIds: league.locationIds,
        sortName: league.sortName,
        status: league.status,
      });
    });
    const before = await t.run(async (ctx) => ({
      leagues: await ctx.db.query('leagues').collect(),
      seasons: await ctx.db.query('seasons').collect(),
      organizations: await ctx.db.query('organizations').collect(),
    }));
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', 'https://wrong.example');
    await expect(t.mutation(internal.seed.demo, {})).rejects.toThrow(/seed:demo refused/);
    const after = await t.run(async (ctx) => ({
      leagues: await ctx.db.query('leagues').collect(),
      seasons: await ctx.db.query('seasons').collect(),
      organizations: await ctx.db.query('organizations').collect(),
    }));
    expect(after).toEqual(before);
    expect(await stored(t, league._id)).toBeUndefined();
  });
});
