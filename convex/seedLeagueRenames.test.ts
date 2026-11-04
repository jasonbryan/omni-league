/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { DEMO } from './seed';
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

const GULF = DEMO.find((tenant) => tenant.organization.slug === 'gulf-coast-sport-social')!;

const gulfLeagues = (t: T) =>
  t.run(async (ctx) => {
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', GULF.organization.slug))
      .unique())!;
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organization._id))
      .collect();
    return leagues.map(({ name, slug, sortName, searchText, gender }) => ({
      name,
      slug,
      sortName,
      searchText,
      gender,
    }));
  });

/** A reused staging seeded before the rename: Gulf Coast's leagues under their earlier names. */
async function seedEarlierGulf(t: T, rename: (name: string) => string) {
  await t.run((ctx) =>
    insertTenant(ctx, {
      ...GULF,
      leagues: GULF.leagues.map((league) => ({ ...league, name: rename(league.name) })),
    }),
  );
}

const possessive = (name: string) => name.replace(/\b(?:Wo)?[Mm]en\b/, "$&'s");

describe('seed:demo league renames', () => {
  test('renames none on an empty deployment', async () => {
    const t = setup();
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.updated.leagues).toBe(0);
    expect((await gulfLeagues(t)).map((league) => league.name)).toContain('Men Over-30 11v11');
  });

  test('renames a demo league held under its earlier name in place, keeps its slug, and a second run renames none', async () => {
    const t = setup();
    await seedEarlierGulf(t, possessive);
    const before = await gulfLeagues(t);
    expect(before.map((league) => league.name)).toContain("Men's Over-30 11v11");

    const first = await t.mutation(internal.seed.insertDemoData, {});
    expect(first.updated.leagues).toBe(1);
    expect(first.leagues).toBeGreaterThan(0);
    const after = await gulfLeagues(t);
    expect(after).toHaveLength(before.length);
    const renamed = after.find((league) => league.name === 'Men Over-30 11v11');
    expect(renamed).toMatchObject({
      slug: before.find((league) => league.name === "Men's Over-30 11v11")?.slug,
      sortName: 'men over-30 11v11',
      gender: 'mens',
    });
    expect(renamed?.searchText).toMatch(/^Men Over-30 11v11 Soccer Men 11v11 Rec 30\+ mens /);
    expect(after.some((league) => /men's/i.test(league.name))).toBe(false);

    const second = await t.mutation(internal.seed.insertDemoData, {});
    expect(second.updated.leagues).toBe(0);
    expect(second.leagues).toBe(0);
    expect(await gulfLeagues(t)).toEqual(after);
  });

  test('leaves a league alone when the new name is already taken', async () => {
    const t = setup();
    await seedEarlierGulf(t, (name) => name);
    await t.run(async (ctx) => {
      const leagues = await ctx.db.query('leagues').collect();
      const league = leagues.find((row) => row.slug === 'coed-7v7-rec')!;
      await ctx.db.patch('leagues', league._id, { name: "Men's Over-30 11v11" });
    });

    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.updated.leagues).toBe(0);
    const names = (await gulfLeagues(t)).map((league) => league.name);
    expect(names).toContain("Men's Over-30 11v11");
    expect(names.filter((name) => name === 'Men Over-30 11v11')).toHaveLength(1);
  });
});
