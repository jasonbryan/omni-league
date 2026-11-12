/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
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
    return Object.fromEntries(leagues.map((league) => [league.slug, league.searchText]));
  });

describe('seed:demo search text', () => {
  test('gives every demo league its text on an empty deployment', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const texts = await textsOf(t);
    expect(Object.keys(texts).length).toBeGreaterThan(10);
    expect(Object.values(texts).every((text) => text !== '')).toBe(true);
    expect(texts['sunday-reverse-coed-4s']).toBe(
      'Sunday Reverse Coed 4s Beach volleyball Coed 4v4 BB Gulf Coast Sport & Social North Beach Sand Courts Corpus Christi, TX',
    );
    expect(texts['monday-coed-4s']).toBe(
      'Monday Coed 4s Beach volleyball Coed 4v4 BB Confluence Sport & Social American River Sand Courts Sacramento, CA',
    );
  });
});
