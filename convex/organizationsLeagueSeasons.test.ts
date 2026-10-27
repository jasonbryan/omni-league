/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function season(slug: string, startDate: string, overrides: Partial<NewSeason> = {}): NewSeason {
  return {
    name: slug.toUpperCase(),
    slug,
    startDate,
    endDate: '2031-12-31',
    registrationDeadline: '2029-12-01',
    playersPerSide: 7,
    minimumRosterSize: 7,
    ...overrides,
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        { name: 'Alpha', sport: 'soccer', locations: ['Alpha Field'] },
        { name: 'Beta', sport: 'soccer', locations: ['Alpha Field'] },
        { name: 'Gamma', sport: 'softball', locations: ['Alpha Field'] },
      ],
    });
  });
  return t;
}

type T = Awaited<ReturnType<typeof setup>>;

async function add(
  t: T,
  leagueSlug: string,
  seasons: NewSeason[],
  status: 'draft' | 'published' = 'published',
): Promise<void> {
  await t.run(async (ctx) => {
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'org-a'))
      .unique())!;
    const league = (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', leagueSlug),
      )
      .unique())!;
    for (const next of seasons) {
      const current = (await ctx.db.get('leagues', league._id))!;
      await insertSeason(ctx, current, next, status);
    }
  });
}

const rows = async (t: T, sport?: 'soccer' | 'softball') =>
  (
    await t.query(api.organizations.listPublicLeagues, {
      slug: 'org-a',
      page: 1,
      ...(sport && { sport }),
    })
  ).rows;

describe('organizations.listPublicLeagues seasons', () => {
  test('lists the three newest published seasons of each league by start date, newest first', async () => {
    const t = await setup();
    await add(t, 'alpha', [
      season('s1', '2030-01-01'),
      season('s2', '2030-04-01'),
      season('s3', '2030-07-01'),
      season('s4', '2030-10-01'),
    ]);
    const [alpha, beta] = await rows(t);
    expect(alpha?.seasons?.map((s) => s.slug)).toEqual(['s4', 's3', 's2']);
    expect(beta?.seasons).toEqual([]);
  });

  test('holds the dates the page needs for the status and none of the roster fields', async () => {
    const t = await setup();
    await add(t, 'alpha', [
      season('s1', '2030-01-01', { endDate: '2030-03-01', registrationDeadline: '2029-12-15' }),
    ]);
    const [alpha] = await rows(t);
    expect(alpha?.seasons).toEqual([
      {
        name: 'S1',
        slug: 's1',
        startDate: '2030-01-01',
        endDate: '2030-03-01',
        registrationDeadline: '2029-12-15',
      },
    ]);
  });

  test('leaves out draft seasons', async () => {
    const t = await setup();
    await add(t, 'alpha', [season('draft', '2030-09-01')], 'draft');
    await add(t, 'alpha', [season('live', '2030-05-01')]);
    const [alpha] = await rows(t);
    expect(alpha?.seasons?.map((s) => s.slug)).toEqual(['live']);
  });

  test("keeps each league's seasons with that league, in a sport view too", async () => {
    const t = await setup();
    await add(t, 'alpha', [season('a1', '2030-01-01')]);
    await add(t, 'gamma', [season('g1', '2030-02-01')]);
    const softball = await rows(t, 'softball');
    expect(softball.map((row) => [row.slug, row.seasons?.map((s) => s.slug)])).toEqual([
      ['gamma', ['g1']],
    ]);
  });
});
