import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { modules } from './test.setup';

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seeded() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.insertDemoData, {});
  return t;
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

describe('the demo data shows the division filters', () => {
  test("Lakeshore Sand League shows 2 of 5 leagues for coed 4v4, and none for men's 6v6", async () => {
    const t = await seeded();
    const coedFours = await t.query(api.organizations.listPublicLeagues, {
      slug: 'lakeshore-sand-league',
      page: 1,
      gender: ['coed'],
      playersPerSide: [4],
    });
    expect(coedFours.total).toBe(2);
    expect(coedFours.rows.map((row) => [row.name, row.divisionLabel, row.locationNames])).toEqual([
      ['Monday Coed 4s', 'Coed · 4v4 · BB', ['Driftwood Beach Courts']],
      ['Wednesday Reverse Coed 4s', 'Coed · 4v4 · B', ['Harbor Point Sand Courts']],
    ]);
    const all = await t.query(api.organizations.listPublicLeagues, {
      slug: 'lakeshore-sand-league',
      page: 1,
    });
    expect(all.total).toBe(5);
    const mensSixes = await t.query(api.organizations.listPublicLeagues, {
      slug: 'lakeshore-sand-league',
      page: 1,
      gender: ['mens'],
      playersPerSide: [6],
    });
    expect(mensSixes.total).toBe(0);
  });

  test('Confluence Sport & Social reads 12 of 26 coed leagues on 3 pages, and 6 of 12 in beach volleyball', async () => {
    const t = await seeded();
    const coed = await t.query(api.organizations.listPublicLeagues, {
      slug: 'confluence-sport-social',
      page: 3,
      gender: ['coed'],
    });
    expect(coed).toMatchObject({ page: 3, pageCount: 3, total: 12 });
    const unfiltered = await t.query(api.organizations.listPublicLeagues, {
      slug: 'confluence-sport-social',
      page: 1,
    });
    expect(unfiltered.total).toBe(26);
    const beach = await t.query(api.organizations.listPublicLeagues, {
      slug: 'confluence-sport-social',
      page: 2,
      sport: 'beachVolleyball',
      gender: ['coed'],
    });
    expect(beach).toMatchObject({ page: 2, pageCount: 2, total: 6 });
    expect(names(beach.rows)).toHaveLength(1);
  });
});
