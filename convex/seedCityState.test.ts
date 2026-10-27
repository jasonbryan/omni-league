/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { modules } from './test.setup';

const DEMO_CITY_STATES: Readonly<Record<string, string>> = {
  'gulf-coast-sport-social': 'Corpus Christi, TX',
  'port-aransas-beach-volleyball-club': 'Port Aransas, TX',
  'front-range-rec-sports': 'Denver, CO',
  'lakeshore-sand-league': 'Chicago, IL',
  'saguaro-valley-softball': 'Phoenix, AZ',
};

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

const cityStates = (t: T) =>
  t.run(async (ctx) => {
    const rows = await ctx.db.query('organizations').collect();
    return Object.fromEntries(rows.map((row) => [row.slug, row.cityState ?? null]));
  });

const insertBare = (t: T, slug: string, cityState?: string) =>
  t.run((ctx) =>
    ctx.db.insert('organizations', {
      name: slug,
      slug,
      leagueCount: 0,
      locationCount: 0,
      sportLeagueCounts: {},
      sportLocationCounts: {},
      ...(cityState !== undefined && { cityState }),
    }),
  );

describe('seed:demo City, state', () => {
  test('inserts each demo organization with its value, and counts no update', async () => {
    const t = setup();
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.updated).toEqual({ organizations: 0 });
    expect(await cityStates(t)).toEqual({ ...DEMO_CITY_STATES, 'rockport-sand-volleyball': null });
  });

  test('sets it on existing demo organizations that have none, counts them, and a second run updates none', async () => {
    const t = setup();
    for (const slug of Object.keys(DEMO_CITY_STATES)) await insertBare(t, slug);

    const first = await t.mutation(internal.seed.insertDemoData, {});
    expect(first.updated).toEqual({ organizations: 5 });
    expect((await cityStates(t))['lakeshore-sand-league']).toBe('Chicago, IL');
    expect(await cityStates(t)).toMatchObject(DEMO_CITY_STATES);

    const second = await t.mutation(internal.seed.insertDemoData, {});
    expect(second.updated).toEqual({ organizations: 0 });
  });

  test('keeps a value an admin already set', async () => {
    const t = setup();
    await insertBare(t, 'front-range-rec-sports', 'Boulder, CO');
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.updated).toEqual({ organizations: 0 });
    expect((await cityStates(t))['front-range-rec-sports']).toBe('Boulder, CO');
  });

  test('leaves a non-demo organization untouched', async () => {
    const t = setup();
    await insertBare(t, 'old-club');
    await t.mutation(internal.seed.insertDemoData, {});
    expect((await cityStates(t))['old-club']).toBeNull();
  });

  test('a wrong guard writes nothing', async () => {
    const t = setup();
    await insertBare(t, 'front-range-rec-sports');
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', 'https://example.test');
    await expect(t.mutation(internal.seed.insertDemoData, {})).rejects.toThrow('seed:demo refused');
    expect(await cityStates(t)).toEqual({ 'front-range-rec-sports': null });
  });
});
