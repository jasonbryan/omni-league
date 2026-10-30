/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { detectLogoType, LOGO_MAX_BYTES } from './lib/logoFile';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { DEMO_LOGO_ORGANIZATION_SLUG, demoLogoBytes } from './seedAssets';
import { modules } from './test.setup';

const GULF_COAST = 'gulf-coast-sport-social';

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

const logos = (t: T) =>
  t.run(async (ctx) => {
    const rows = await ctx.db.query('organizations').collect();
    return Object.fromEntries(rows.map((row) => [row.slug, row.logoStorageId ?? null]));
  });

const fileCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.system.query('_storage').collect()).length);

describe('the demo logo asset', () => {
  test('is a PNG under 2 KB, well inside the logo size limit', () => {
    const bytes = demoLogoBytes();
    expect(detectLogoType(bytes)).toBe('image/png');
    expect(bytes.length).toBeLessThan(2048);
    expect(bytes.length).toBeLessThan(LOGO_MAX_BYTES);
  });

  test('names the organization that shows it', () => {
    expect(DEMO_LOGO_ORGANIZATION_SLUG).toBe(GULF_COAST);
  });
});

describe('seed:demo logo', () => {
  test('stores the logo and sets it on gulf-coast-sport-social only, and counts it', async () => {
    const t = setup();
    const result = await t.action(internal.seed.demo, {});
    expect(result.logos).toBe(1);
    const stored = await logos(t);
    expect(stored[GULF_COAST]).not.toBeNull();
    for (const [slug, id] of Object.entries(stored)) {
      if (slug !== GULF_COAST) expect(id, slug).toBeNull();
    }
    expect(await fileCount(t)).toBe(1);
    const needed = await t.query(internal.seed.demoLogoNeeded, {});
    expect(needed).toBe(false);
  });

  test('a second run stores no second file and changes nothing', async () => {
    const t = setup();
    await t.action(internal.seed.demo, {});
    const before = await logos(t);
    const second = await t.action(internal.seed.demo, {});
    expect(second.logos).toBe(0);
    expect(await logos(t)).toEqual(before);
    expect(await fileCount(t)).toBe(1);
  });

  test('keeps a logo the organization already has', async () => {
    const t = setup();
    await t.action(internal.seed.demo, {});
    const own = await t.run(async (ctx) => {
      const id = await ctx.storage.store(
        new Blob([demoLogoBytes().slice()], { type: 'image/png' }),
      );
      const organization = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', GULF_COAST))
        .unique();
      await ctx.db.patch('organizations', organization!._id, { logoStorageId: id });
      return id;
    });
    const again = await t.action(internal.seed.demo, {});
    expect(again.logos).toBe(0);
    expect((await logos(t))[GULF_COAST]).toBe(own);
  });

  test('deletes the file it stored when the organization gained a logo in the meantime', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const held = await t.run(async (ctx) => {
      const id = await ctx.storage.store(
        new Blob([demoLogoBytes().slice()], { type: 'image/png' }),
      );
      const organization = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', GULF_COAST))
        .unique();
      await ctx.db.patch('organizations', organization!._id, { logoStorageId: id });
      return id;
    });
    const late = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([demoLogoBytes().slice()], { type: 'image/png' })),
    );
    await expect(t.mutation(internal.seed.setDemoLogo, { storageId: late })).resolves.toBe(0);
    expect((await logos(t))[GULF_COAST]).toBe(held);
    expect(await t.run(async (ctx) => ctx.db.system.get('_storage', late))).toBeNull();
  });

  test('is refused on a deployment that is not a preview', async () => {
    const t = setup();
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', 'something else');
    await expect(t.query(internal.seed.demoLogoNeeded, {})).rejects.toThrow(/seed:demo refused/);
  });
});
