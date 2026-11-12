/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo organizations list fields', () => {
  test('the demo organizations with a published league are listed, and the ones with none are not', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const page = await t.query(api.search.organizations, { page: 1 });
    expect(page.pageCount).toBe(2);
    expect(page.rows.map((row) => row.slug)).toEqual([
      'confluence-sport-social',
      'front-range-rec-sports',
      'gulf-coast-sport-social',
      'lakeshore-sand-league',
      'rockport-sand-volleyball',
    ]);
    expect(
      (await t.query(api.search.organizations, { page: 2 })).rows.map((row) => row.slug),
    ).toEqual(['saguaro-valley-softball']);
    expect(page.rows.find((row) => row.slug === 'gulf-coast-sport-social')).toEqual({
      name: 'Gulf Coast Sport & Social',
      slug: 'gulf-coast-sport-social',
      sportNames: ['Beach volleyball', 'Soccer', 'Softball'],
      cityState: 'Corpus Christi, TX',
    });
  });
});
