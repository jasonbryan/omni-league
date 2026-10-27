/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
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
      locations: [
        { name: 'Beta Courts', address: '2 Beta St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      seasons: [],
    });
    expect(JSON.stringify(page)).not.toMatch(/_id|_creationTime|Id"|status|Count/);
  });

  test('returns the division label of a league that has a division', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await insertTenant(ctx, {
        organization: { name: 'Org D', slug: 'org-d' },
        locations: [{ name: 'D Field', address: '4 D St' }],
        leagues: [
          {
            name: 'Sunday Reverse Coed 4s',
            sport: 'beachVolleyball',
            locations: ['D Field'],
            division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
          },
        ],
      });
    });
    expect(await get(t, 'org-d', 'sunday-reverse-coed-4s')).toMatchObject({
      divisionLabel: 'Coed · 4v4 · BB',
    });
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

  test('leaves the location of another organization out of the locations with addresses, as out of the names', async () => {
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
    expect(page?.locations?.map((location) => location.name)).toEqual([
      'Beta Courts',
      'Alpha Field',
    ]);
    expect(JSON.stringify(page)).not.toContain('9 B St');
  });

  test('is public: an anonymous caller reads it', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'coed-7v7')).toMatchObject({ name: 'Coed 7v7' });
  });
});

function season(n: number, overrides: Partial<NewSeason> = {}): NewSeason {
  const month = String(n).padStart(2, '0');
  return {
    name: `Season ${month}`,
    slug: `season-${month}`,
    startDate: `2027-${month}-01`,
    endDate: `2027-${month}-28`,
    registrationDeadline: `2027-${month}-01`,
    playersPerSide: 4,
    minimumRosterSize: 5,
    ...overrides,
  };
}

async function addSeason(
  t: Awaited<ReturnType<typeof setup>>,
  leagueSlug: string,
  next: NewSeason,
  status: 'draft' | 'published' = 'published',
): Promise<void> {
  await t.run(async (ctx) => {
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'org-a'))
      .unique())!;
    const league = (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', leagueSlug),
      )
      .unique())!;
    await insertSeason(ctx, league, next, status);
  });
}

describe('leagues.getPublicPage seasons', () => {
  test('holds the three newest published seasons by start date, with the deadline and the minimum roster size, and never a draft', async () => {
    const t = await setup();
    for (const n of [1, 2, 3, 4, 5]) await addSeason(t, 'sand-2s', season(n));
    await addSeason(t, 'sand-2s', season(12, { name: 'Draft Season', slug: 'draft' }), 'draft');
    const page = await get(t, 'org-a', 'sand-2s');
    expect(page?.seasons).toEqual([
      {
        name: 'Season 05',
        slug: 'season-05',
        startDate: '2027-05-01',
        endDate: '2027-05-28',
        registrationDeadline: '2027-05-01',
        minimumRosterSize: 5,
      },
      expect.objectContaining({ slug: 'season-04' }),
      expect.objectContaining({ slug: 'season-03' }),
    ]);
    expect(JSON.stringify(page)).not.toContain('Draft Season');
  });

  test('is empty for a league whose only seasons are drafts', async () => {
    const t = await setup();
    await addSeason(t, 'sand-2s', season(1), 'draft');
    expect((await get(t, 'org-a', 'sand-2s'))?.seasons).toEqual([]);
  });

  test('holds only the seasons of its own league', async () => {
    const t = await setup();
    await addSeason(t, 'coed-7v7', season(1));
    expect((await get(t, 'org-a', 'sand-2s'))?.seasons).toEqual([]);
    expect((await get(t, 'org-a', 'coed-7v7'))?.seasons).toHaveLength(1);
  });
});
