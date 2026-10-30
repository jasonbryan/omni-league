/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const textsOf = (t: T) =>
  t.run(async (ctx) => {
    const leagues = await ctx.db.query('leagues').collect();
    return Object.fromEntries(leagues.map((league) => [league.slug, league.searchText ?? null]));
  });

describe('seed:demo search text', () => {
  test('gives every demo league its text on an empty deployment', async () => {
    const t = setup();
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.backfilled.leagues).toBe(0);
    const texts = await textsOf(t);
    expect(Object.keys(texts).length).toBeGreaterThan(10);
    expect(Object.values(texts).every((text) => text !== null && text !== '')).toBe(true);
    expect(texts['sunday-reverse-coed-4s']).toBe(
      'Sunday Reverse Coed 4s Beach volleyball Coed 4v4 BB Gulf Coast Sport & Social North Beach Sand Courts Corpus Christi, TX',
    );
    expect(texts['monday-coed-4s']).toBe(
      'Monday Coed 4s Beach volleyball Coed 4v4 BB Confluence Sport & Social American River Sand Courts Sacramento, CA',
    );
  });

  test('fills the text of leagues written without one, counts them, and a second run changes none', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await insertTenant(ctx, {
        organization: { name: 'Older Org', slug: 'older-org', cityState: 'Austin, TX' },
        locations: [{ name: 'Old Field', address: '1 Old St' }],
        leagues: [
          { name: 'Old Sand', sport: 'beachVolleyball', locations: ['Old Field'] },
          { name: 'Old Draft', sport: 'soccer', locations: ['Old Field'], status: 'draft' },
        ],
      });
      for (const league of await ctx.db.query('leagues').collect()) {
        await ctx.db.patch('leagues', league._id, { searchText: undefined });
      }
    });
    expect(Object.values(await textsOf(t))).toEqual([null, null]);

    const first = await t.mutation(internal.seed.insertDemoData, {});
    expect(first.backfilled.leagues).toBe(2);
    const filled = await textsOf(t);
    expect(filled['old-sand']).toBe(
      'Old Sand Beach volleyball Coed 2v2 Rec Older Org Old Field Austin, TX',
    );
    expect(filled['old-draft']).toBe(
      'Old Draft Soccer Coed 4v4 Rec Older Org Old Field Austin, TX',
    );

    const second = await t.mutation(internal.seed.insertDemoData, {});
    expect(second.backfilled.leagues).toBe(0);
    expect(await textsOf(t)).toEqual(filled);
  });

  test('rewrites a text built without the sport and division words, counts it, and a second run changes none', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await insertTenant(ctx, {
        organization: { name: 'Older Org', slug: 'older-org', cityState: 'Austin, TX' },
        locations: [{ name: 'Old Field', address: '1 Old St' }],
        leagues: [
          {
            name: 'Old Eleven',
            sport: 'soccer',
            locations: ['Old Field'],
            division: {
              gender: 'womens',
              playersPerSide: 11,
              level: 'intermediate',
              ageGroup: 'adult',
            },
          },
          { name: 'Old Draft', sport: 'softball', locations: ['Old Field'], status: 'draft' },
        ],
      });
      for (const league of await ctx.db.query('leagues').collect()) {
        await ctx.db.patch('leagues', league._id, {
          searchText: `${league.name} Older Org Old Field Austin, TX`,
        });
      }
    });

    const first = await t.mutation(internal.seed.insertDemoData, {});
    expect(first.backfilled.leagues).toBe(2);
    const rewritten = await textsOf(t);
    expect(rewritten['old-eleven']).toBe(
      "Old Eleven Soccer Women's 11v11 Intermediate womens Older Org Old Field Austin, TX",
    );
    expect(rewritten['old-draft']).toMatch(/^Old Draft Softball /);

    const second = await t.mutation(internal.seed.insertDemoData, {});
    expect(second.backfilled.leagues).toBe(0);
    expect(await textsOf(t)).toEqual(rewritten);
  });
});
