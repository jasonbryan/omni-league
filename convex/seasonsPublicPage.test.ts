/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const seasonsSource = readFileSync(new URL('./seasons.ts', import.meta.url), 'utf8');

const SUMMER: NewSeason = {
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-30',
  playersPerSide: 4,
  minimumRosterSize: 5,
};

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
        { name: 'Sand 4s', sport: 'beachVolleyball', locations: ['Beta Courts', 'Alpha Field'] },
        { name: 'Draft League', sport: 'soccer', locations: ['Alpha Field'], status: 'draft' },
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] },
      ],
    });
    await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Sand 4s', sport: 'beachVolleyball', locations: ['B Field'] }],
    });
    const orgIds = new Map(
      (await ctx.db.query('organizations').collect()).map((o) => [o.slug, o._id]),
    );
    const leagues = await ctx.db.query('leagues').collect();
    const league = (slug: string, org: string) => {
      const found = leagues.find(
        (candidate) => candidate.slug === slug && candidate.organizationId === orgIds.get(org),
      );
      if (!found) throw new Error(`no league ${org}/${slug}`);
      return found;
    };
    await insertSeason(ctx, league('sand-4s', 'org-a'), SUMMER, 'published');
    await insertSeason(
      ctx,
      league('sand-4s', 'org-a'),
      { ...SUMMER, name: 'Draft Season', slug: 'draft-season' },
      'draft',
    );
    await insertSeason(ctx, league('draft-league', 'org-a'), SUMMER, 'published');
    await insertSeason(
      ctx,
      league('coed-7v7', 'org-a'),
      {
        ...SUMMER,
        name: 'Coed Summer',
        slug: 'coed-summer',
        playersPerSide: 7,
        minimumRosterSize: 7,
      },
      'published',
    );
    await insertSeason(
      ctx,
      league('sand-4s', 'org-b'),
      { ...SUMMER, name: 'B Season', slug: 'b-season' },
      'published',
    );
  });
  return t;
}

type T = Awaited<ReturnType<typeof setup>>;

const get = (t: T, orgSlug: string, leagueSlug: string, seasonSlug: string) =>
  t.query(api.seasons.getPublicPage, { orgSlug, leagueSlug, seasonSlug });

describe('seasons.getPublicPage', () => {
  test('returns the organization, the league with its sport name, location names in its own order with their addresses, and the season’s dates, deadline, format name, and minimum roster size', async () => {
    const t = await setup();
    const page = await get(t, 'org-a', 'sand-4s', 'summer-2027');
    expect(page).toEqual({
      organization: { name: 'Org A', slug: 'org-a' },
      league: {
        name: 'Sand 4s',
        slug: 'sand-4s',
        sportName: 'Beach volleyball',
        locationNames: ['Beta Courts', 'Alpha Field'],
        locations: [
          { name: 'Beta Courts', address: '2 Beta St' },
          { name: 'Alpha Field', address: '1 Alpha St' },
        ],
        upcomingSeasons: [
          {
            name: 'Summer 2027',
            slug: 'summer-2027',
            startDate: '2027-06-06',
            registrationDeadline: '2027-05-30',
          },
        ],
      },
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-06',
      endDate: '2027-08-29',
      registrationDeadline: '2027-05-30',
      formatName: '4v4',
      minimumRosterSize: 5,
    });
  });

  test('holds no id, creation time, status, or counter', async () => {
    const t = await setup();
    const page = await get(t, 'org-a', 'sand-4s', 'summer-2027');
    expect(JSON.stringify(page)).not.toMatch(/_id|_creationTime|Id"|status|Count/i);
  });

  test('carries the league division label once the league has a division', async () => {
    const t = await setup();
    expect((await get(t, 'org-a', 'sand-4s', 'summer-2027'))?.league.divisionLabel).toBeUndefined();
    await t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').collect()).find(
        (candidate) => candidate.slug === 'sand-4s' && candidate.name === 'Sand 4s',
      )!;
      await ctx.db.patch('leagues', league._id, {
        gender: 'coed',
        playersPerSide: 4,
        level: 'rec',
      });
    });
    expect((await get(t, 'org-a', 'sand-4s', 'summer-2027'))?.league.divisionLabel).toBe(
      'Coed · 4v4 · Rec',
    );
  });

  test('is null for a draft season, even when the league is published', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'sand-4s', 'draft-season')).toBeNull();
  });

  test('is null for a published season of a draft league', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'draft-league', 'summer-2027')).toBeNull();
  });

  test('is null for a league stored without a status', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').collect()).find(
        (candidate) => candidate.slug === 'coed-7v7',
      )!;
      await ctx.db.replace('leagues', league._id, {
        organizationId: league.organizationId,
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        locationIds: league.locationIds,
        sortName: league.sortName,
      });
    });
    expect(await get(t, 'org-a', 'coed-7v7', 'coed-summer')).toBeNull();
  });

  test('is null for an unknown season, league, and organization, and for text that is not a slug', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'sand-4s', 'no-such-season')).toBeNull();
    expect(await get(t, 'org-a', 'no-such-league', 'summer-2027')).toBeNull();
    expect(await get(t, 'no-such-org', 'sand-4s', 'summer-2027')).toBeNull();
    expect(await get(t, 'Not A Slug', 'sand-4s', 'summer-2027')).toBeNull();
    expect(await get(t, 'org-a', 'sand-4s', 'Not A Slug')).toBeNull();
    expect(await get(t, 'org-a', 'sand-4s', '')).toBeNull();
  });

  test('is null for a season slug of another league, and for a league slug of another organization', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'sand-4s', 'coed-summer')).toBeNull();
    expect(await get(t, 'org-a', 'sand-4s', 'b-season')).toBeNull();
    expect(await get(t, 'org-b', 'sand-4s', 'summer-2027')).toBeNull();
    expect(await get(t, 'org-b', 'coed-7v7', 'coed-summer')).toBeNull();
  });

  test('the same season slug in two leagues answers each league’s own season', async () => {
    const t = await setup();
    const sand = await get(t, 'org-a', 'sand-4s', 'summer-2027');
    expect(sand?.formatName).toBe('4v4');
    expect(await get(t, 'org-a', 'coed-7v7', 'summer-2027')).toBeNull();
    const coed = await get(t, 'org-a', 'coed-7v7', 'coed-summer');
    expect(coed).toMatchObject({
      league: { sportName: 'Soccer' },
      formatName: '7v7',
      minimumRosterSize: 7,
    });
  });

  test('a location of another organization is left out of the names', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const foreign = (await ctx.db.query('locations').collect()).find(
        (location) => location.name === 'B Field',
      )!;
      const league = (await ctx.db.query('leagues').collect()).find(
        (candidate) => candidate.slug === 'coed-7v7',
      )!;
      await ctx.db.patch('leagues', league._id, {
        locationIds: [...league.locationIds, foreign._id],
      });
    });
    const page = await get(t, 'org-a', 'coed-7v7', 'coed-summer');
    expect(page?.league.locationNames).toEqual(['Alpha Field']);
  });

  test('upcomingSeasons holds at most three published seasons of the league, newest deadline first, with no draft', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').collect()).find(
        (candidate) => candidate.slug === 'coed-7v7',
      )!;
      const deadlines: [string, string][] = [
        ['s1', '2026-01-10'],
        ['s2', '2026-02-10'],
        ['s3', '2026-03-10'],
        ['s4', '2026-04-10'],
        ['s5', '2026-05-10'],
      ];
      for (const [slug, registrationDeadline] of deadlines) {
        await insertSeason(
          ctx,
          league,
          { ...SUMMER, name: slug.toUpperCase(), slug, registrationDeadline },
          'published',
        );
      }
      await insertSeason(
        ctx,
        league,
        { ...SUMMER, name: 'Hidden', slug: 'hidden', registrationDeadline: '2030-01-01' },
        'draft',
      );
    });
    const page = await get(t, 'org-a', 'coed-7v7', 'coed-summer');
    expect(page?.league.upcomingSeasons?.map((season) => season.slug)).toEqual([
      'coed-summer',
      's5',
      's4',
    ]);
  });

  test('upcomingSeasons never holds a draft season or a season of another league or organization', async () => {
    const t = await setup();
    const page = await get(t, 'org-a', 'sand-4s', 'summer-2027');
    expect(page?.league.upcomingSeasons?.map((season) => season.slug)).toEqual(['summer-2027']);
    expect(JSON.stringify(page)).not.toMatch(/draft-season|b-season|coed-summer/);
  });

  test('answers the same page before the deadline and after the season ends', async () => {
    const t = await setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.UTC(2027, 0, 1));
      const beforeDeadline = await get(t, 'org-a', 'sand-4s', 'summer-2027');
      vi.setSystemTime(Date.UTC(2028, 0, 1));
      const afterSeasonEnds = await get(t, 'org-a', 'sand-4s', 'summer-2027');
      expect(beforeDeadline).not.toBeNull();
      expect(afterSeasonEnds).toEqual(beforeDeadline);
    } finally {
      vi.useRealTimers();
    }
  });

  test('is public: an anonymous caller reads it, and no argument names an id', async () => {
    const t = await setup();
    expect(await get(t, 'org-a', 'sand-4s', 'summer-2027')).not.toBeNull();
  });

  test('looks the season up through findSeasonBySlugs and declares the shared returns validator', () => {
    expect(seasonsSource).toContain('findSeasonBySlugs');
    expect(seasonsSource).toContain('getSeasonPublicPageReturns');
    expect(seasonsSource).not.toMatch(/\.filter\(/);
  });
});
