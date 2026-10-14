/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from '../schema';
import { modules } from '../test.setup';
import { findLeagueBySlugs, findSeasonBySlugs } from './seasonLookup';
import { insertSeason, insertTenant } from './tenantWrites';

const SEASON = {
  name: 'Fall 2026',
  slug: 'fall-2026',
  startDate: '2026-09-01',
  endDate: '2026-11-15',
  registrationDeadline: '2026-08-25',
  format: '7v7' as const,
  minimumRosterSize: 7,
};

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Field', address: '1 Field St' }],
      leagues: [
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Field'] },
        { name: 'Draft League', sport: 'soccer', locations: ['Field'], status: 'draft' },
        { name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Field'] },
      ],
    });
    await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '2 B St' }],
      leagues: [{ name: 'Sand 2s', sport: 'beachVolleyball', locations: ['B Field'] }],
    });
    const league = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', a).eq('slug', 'coed-7v7'),
      )
      .unique();
    await insertSeason(ctx, league!, SEASON);
    const draftLeague = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', a).eq('slug', 'draft-league'),
      )
      .unique();
    await insertSeason(ctx, draftLeague!, { ...SEASON, name: 'Prep 2027', slug: 'prep-2027' });
  });
  return t;
}

describe('findSeasonBySlugs', () => {
  test('returns the season with its league and organization', async () => {
    const t = await setup();
    const found = await t.run((ctx) =>
      findSeasonBySlugs(ctx, { orgSlug: 'org-a', leagueSlug: 'coed-7v7', seasonSlug: 'fall-2026' }),
    );
    expect(found?.organization.slug).toBe('org-a');
    expect(found?.league.slug).toBe('coed-7v7');
    expect(found?.season).toMatchObject({ slug: 'fall-2026', name: 'Fall 2026', status: 'draft' });
    expect(found?.season.leagueId).toBe(found?.league._id);
    expect(found?.league.organizationId).toBe(found?.organization._id);
  });

  test.each([
    [
      'an unknown organization',
      { orgSlug: 'nope', leagueSlug: 'coed-7v7', seasonSlug: 'fall-2026' },
    ],
    ['an unknown league', { orgSlug: 'org-a', leagueSlug: 'nope', seasonSlug: 'fall-2026' }],
    ['an unknown season', { orgSlug: 'org-a', leagueSlug: 'coed-7v7', seasonSlug: 'nope' }],
    [
      'a season slug of another league of the same organization',
      { orgSlug: 'org-a', leagueSlug: 'sand-2s', seasonSlug: 'fall-2026' },
    ],
    [
      'a league of another organization',
      { orgSlug: 'org-b', leagueSlug: 'coed-7v7', seasonSlug: 'fall-2026' },
    ],
    ['a malformed slug', { orgSlug: 'Org A', leagueSlug: 'coed-7v7', seasonSlug: 'fall-2026' }],
  ])('returns null for %s', async (_, slugs) => {
    const t = await setup();
    expect(await t.run((ctx) => findSeasonBySlugs(ctx, slugs))).toBeNull();
  });

  test('applies no status rule: a draft season of a draft league is found', async () => {
    const t = await setup();
    const found = await t.run((ctx) =>
      findSeasonBySlugs(ctx, {
        orgSlug: 'org-a',
        leagueSlug: 'draft-league',
        seasonSlug: 'prep-2027',
      }),
    );
    expect(found?.league.status).toBe('draft');
    expect(found?.season.status).toBe('draft');
  });
});

describe('findLeagueBySlugs', () => {
  test('returns the league and its organization, whatever its status', async () => {
    const t = await setup();
    const published = await t.run((ctx) =>
      findLeagueBySlugs(ctx, { orgSlug: 'org-a', leagueSlug: 'coed-7v7' }),
    );
    expect(published?.league.status).toBe('published');
    const draft = await t.run((ctx) =>
      findLeagueBySlugs(ctx, { orgSlug: 'org-a', leagueSlug: 'draft-league' }),
    );
    expect(draft?.league.status).toBe('draft');
    expect(draft?.organization.slug).toBe('org-a');
  });

  test('returns null for a league slug of another organization and for unknown slugs', async () => {
    const t = await setup();
    const find = (slugs: { orgSlug: string; leagueSlug: string }) =>
      t.run((ctx) => findLeagueBySlugs(ctx, slugs));
    expect(await find({ orgSlug: 'org-b', leagueSlug: 'coed-7v7' })).toBeNull();
    expect(await find({ orgSlug: 'org-b', leagueSlug: 'draft-league' })).toBeNull();
    expect(await find({ orgSlug: 'nope', leagueSlug: 'coed-7v7' })).toBeNull();
    expect(await find({ orgSlug: 'org-a', leagueSlug: 'nope' })).toBeNull();
  });

  test('keeps a league slug that two organizations share apart', async () => {
    const t = await setup();
    const a = await t.run((ctx) =>
      findLeagueBySlugs(ctx, { orgSlug: 'org-a', leagueSlug: 'sand-2s' }),
    );
    const b = await t.run((ctx) =>
      findLeagueBySlugs(ctx, { orgSlug: 'org-b', leagueSlug: 'sand-2s' }),
    );
    expect(a?.league._id).not.toBe(b?.league._id);
    expect(a?.organization.slug).toBe('org-a');
    expect(b?.organization.slug).toBe('org-b');
  });
});
