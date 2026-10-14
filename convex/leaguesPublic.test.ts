/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [
        { name: 'Alpha Field', address: '1 Alpha St' },
        { name: 'Beta Courts', address: '2 Beta St' },
      ],
      leagues: [
        { name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Beta Courts', 'Alpha Field'] },
        { name: 'Draft League', sport: 'soccer', locations: ['Alpha Field'], status: 'draft' },
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] },
      ],
    });
    await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Sand 2s', sport: 'beachVolleyball', locations: ['B Field'] }],
    });
  });
  return t;
}

const get = (t: Awaited<ReturnType<typeof setup>>, orgSlug: string, leagueSlug: string) =>
  t.query(api.leagues.getPublicPage, { orgSlug, leagueSlug });

describe('leagues.getPublicPage', () => {
  test('returns the organization, the league, its sport name, and its location names in the league’s own order, and nothing else', async () => {
    const t = await setup();
    const page = await get(t, 'org-a', 'sand-2s');
    expect(page).toEqual({
      organization: { name: 'Org A', slug: 'org-a' },
      name: 'Sand 2s',
      slug: 'sand-2s',
      sportName: 'Beach volleyball',
      locationNames: ['Beta Courts', 'Alpha Field'],
    });
    expect(JSON.stringify(page)).not.toMatch(/_id|_creationTime|Id"|status|Count/);
  });

  test('is null for a draft league, a league stored without a status, an unknown league, and an unknown organization', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'draft-league')).toBeNull();
    await t.run(async (ctx) => {
      const orgA = (await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'org-a'))
        .unique())!;
      const league = (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', orgA._id).eq('slug', 'coed-7v7'),
        )
        .unique())!;
      await ctx.db.replace('leagues', league._id, {
        organizationId: league.organizationId,
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        locationIds: league.locationIds,
        sortName: league.sortName,
      });
    });
    expect(await get(t, 'org-a', 'coed-7v7')).toBeNull();
    expect(await get(t, 'org-a', 'no-such-league')).toBeNull();
    expect(await get(t, 'no-such-org', 'sand-2s')).toBeNull();
    expect(await get(t, 'Not A Slug', 'x')).toBeNull();
  });

  test("a league slug is read in its own organization: org-b's pair gives org-b's league, and a slug only org-a has is unknown under org-b", async () => {
    const t = await setup();
    expect(await get(t, 'org-b', 'sand-2s')).toMatchObject({
      organization: { slug: 'org-b' },
      locationNames: ['B Field'],
    });
    expect(await get(t, 'org-b', 'coed-7v7')).toBeNull();
    expect(await get(t, 'org-b', 'draft-league')).toBeNull();
  });

  test("leaves out the name of a location of another organization that the league's locationIds hold", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const orgA = (await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'org-a'))
        .unique())!;
      const orgB = (await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'org-b'))
        .unique())!;
      const foreign = (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', orgB._id).eq('name', 'B Field'),
        )
        .unique())!;
      const league = (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', orgA._id).eq('slug', 'sand-2s'),
        )
        .unique())!;
      await ctx.db.patch('leagues', league._id, {
        locationIds: [...league.locationIds, foreign._id],
      });
    });
    const page = await get(t, 'org-a', 'sand-2s');
    expect(page?.locationNames).toEqual(['Beta Courts', 'Alpha Field']);
    expect(JSON.stringify(page)).not.toContain('B Field');
  });

  test('is public: an anonymous caller reads it', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'coed-7v7')).toMatchObject({ name: 'Coed 7v7' });
  });
});
