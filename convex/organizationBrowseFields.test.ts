/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import {
  insertLeague,
  insertLocation,
  insertOrganization,
  insertTenant,
  publishLeague,
} from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

describe('the fields the organizations list reads', () => {
  test('insertOrganization sets sortName to the lowercased name and hasPublishedLeague to false', async () => {
    const t = setup();
    const row = await t.run(async (ctx) => {
      const id = await insertOrganization(ctx, { name: 'Gulf Coast Sport & Social', slug: 'gulf' });
      return ctx.db.get('organizations', id);
    });
    expect(row).toMatchObject({
      sortName: 'gulf coast sport & social',
      hasPublishedLeague: false,
    });
  });

  test('a league inserted published sets hasPublishedLeague to true', async () => {
    const t = setup();
    const row = await t.run(async (ctx) => {
      const id = await insertOrganization(ctx, { name: 'Gulf', slug: 'gulf' });
      await insertLocation(ctx, id, { name: 'Courts', address: '1 Rd' });
      await insertLeague(ctx, id, { name: 'Coed 4s', sport: 'soccer', locations: ['Courts'] });
      return ctx.db.get('organizations', id);
    });
    expect(row?.hasPublishedLeague).toBe(true);
  });

  test('a league inserted as a draft leaves it false until the league is published', async () => {
    const t = setup();
    const { id, draft } = await t.run(async (ctx) => {
      const id = await insertTenant(ctx, {
        organization: { name: 'Gulf', slug: 'gulf' },
        locations: [{ name: 'Courts', address: '1 Rd' }],
        leagues: [{ name: 'Coed 4s', sport: 'soccer', locations: ['Courts'], status: 'draft' }],
      });
      const draft = await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', id))
        .unique();
      return { id, draft: draft! };
    });
    expect((await t.run((ctx) => ctx.db.get('organizations', id)))?.hasPublishedLeague).toBe(false);

    await t.run((ctx) => publishLeague(ctx, draft));
    expect((await t.run((ctx) => ctx.db.get('organizations', id)))?.hasPublishedLeague).toBe(true);
  });
});
