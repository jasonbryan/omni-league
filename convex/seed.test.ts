/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import * as seed from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

async function counts(t: T) {
  return t.run(async (ctx) => ({
    organizations: (await ctx.db.query('organizations').collect()).length,
    locations: (await ctx.db.query('locations').collect()).length,
    leagues: (await ctx.db.query('leagues').collect()).length,
  }));
}

describe('seed:demo', () => {
  test('on an empty deployment, creates the mockup organizations (#73) and reports their slugs', async () => {
    const t = setup();
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      created: true,
      slugs: ['gulf-coast-sport-social', 'port-aransas-beach-volleyball-club'],
    });
    expect(await counts(t)).toEqual({ organizations: 2, locations: 3, leagues: 5 });

    const gulf = await t.query(api.organizations.getPublicPage, {
      slug: 'gulf-coast-sport-social',
    });
    expect(gulf?.name).toBe('Gulf Coast Sport & Social');
    expect(gulf?.locations.map((location) => location.name)).toEqual([
      'Bayside Athletic Complex',
      'Flour Bluff Softball Park',
      'North Beach Sand Courts',
    ]);
    expect(gulf?.leagues.map((league) => [league.name, league.sportName])).toEqual([
      ['Coed 7v7 Rec', 'Soccer'],
      ["Men's Over-30 11v11", 'Soccer'],
      ['Sunday Reverse Coed 4s', 'Beach volleyball'],
      ['Thursday Night Coed 2s', 'Beach volleyball'],
      ['Wednesday Coed Slow-Pitch', 'Softball'],
    ]);
    expect(gulf?.leagues.at(-1)?.locationNames).toEqual([
      'Flour Bluff Softball Park',
      'Bayside Athletic Complex',
    ]);

    expect(
      await t.query(api.organizations.getPublicPage, {
        slug: 'port-aransas-beach-volleyball-club',
      }),
    ).toEqual({
      name: 'Port Aransas Beach Volleyball Club',
      slug: 'port-aransas-beach-volleyball-club',
      locations: [],
      leagues: [],
    });
  });

  test('writes nothing when any organization already exists', async () => {
    const t = setup();
    await t.run((ctx) => ctx.db.insert('organizations', { name: 'Existing', slug: 'existing' }));
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      created: false,
      slugs: [],
    });
    expect(await counts(t)).toEqual({ organizations: 1, locations: 0, leagues: 0 });
  });

  test('a second run writes nothing', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      created: false,
      slugs: [],
    });
    expect(await counts(t)).toEqual({ organizations: 2, locations: 3, leagues: 5 });
  });

  test('runs without IS_TEST (previews and staging never set it)', async () => {
    const t = setup();
    await expect(t.mutation(internal.seed.demo, {})).resolves.toMatchObject({ created: true });
  });

  test('every export is an internal function, so no client can call it', () => {
    const exports = Object.entries(seed);
    expect(exports.map(([name]) => name)).toEqual(['demo']);
    for (const [name, fn] of exports) {
      const markers = fn as Partial<Record<'isInternal' | 'isPublic', boolean>>;
      expect({ name, isInternal: markers.isInternal }).toEqual({ name, isInternal: true });
      expect({ name, isPublic: markers.isPublic }).toEqual({ name, isPublic: undefined });
    }
  });
});
