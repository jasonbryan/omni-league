/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import * as seed from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

/** What one run on an empty deployment inserts. */
const FULL = { organizations: 5, locations: 10, leagues: 15 };
const NONE = { organizations: 0, locations: 0, leagues: 0 };

async function counts(t: T) {
  return t.run(async (ctx) => ({
    organizations: (await ctx.db.query('organizations').collect()).length,
    locations: (await ctx.db.query('locations').collect()).length,
    leagues: (await ctx.db.query('leagues').collect()).length,
  }));
}

/** Every row of the three tables, to prove a run changed nothing. */
async function snapshot(t: T) {
  return t.run(async (ctx) => ({
    organizations: await ctx.db.query('organizations').collect(),
    locations: await ctx.db.query('locations').collect(),
    leagues: await ctx.db.query('leagues').collect(),
  }));
}

async function organizationId(t: T, slug: string) {
  return t.run(async (ctx) => {
    const organization = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique();
    if (!organization) throw new Error(`no organization ${slug}`);
    return organization._id;
  });
}

beforeEach(() => {
  // Every preview and staging deployment has this Convex default preview variable (hosting.md).
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo', () => {
  test('on an empty deployment, creates every demo organization and returns the inserted counts', async () => {
    const t = setup();
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual(FULL);
    expect(await counts(t)).toEqual(FULL);
  });

  test('keeps the two mockup organizations (#73) exactly as the mockup shows them', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});

    const gulf = await t.query(api.organizations.getPublicPage, {
      slug: 'gulf-coast-sport-social',
    });
    expect(gulf?.name).toBe('Gulf Coast Sport & Social');
    expect(gulf?.locations).toEqual([
      { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
      { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
      { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
    ]);
    expect(
      gulf?.leagues.map((league) => [league.name, league.sportName, league.locationNames]),
    ).toEqual([
      ['Coed 7v7 Rec', 'Soccer', ['Bayside Athletic Complex']],
      ["Men's Over-30 11v11", 'Soccer', ['Bayside Athletic Complex']],
      ['Sunday Reverse Coed 4s', 'Beach volleyball', ['North Beach Sand Courts']],
      ['Thursday Night Coed 2s', 'Beach volleyball', ['North Beach Sand Courts']],
      [
        'Wednesday Coed Slow-Pitch',
        'Softball',
        ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      ],
    ]);

    expect(
      await t.query(api.organizations.getPublicPage, {
        slug: 'port-aransas-beach-volleyball-club',
      }),
    ).toEqual({
      name: 'Port Aransas Beach Volleyball Club',
      slug: 'port-aransas-beach-volleyball-club',
      locations: [],
      leagues: [],
    });
  });

  test('covers every sport in at least 2 organizations, one multi-sport and one empty organization', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const { organizations, locations, leagues } = await snapshot(t);

    expect(organizations.length).toBeGreaterThanOrEqual(4);
    expect(locations.length).toBeGreaterThanOrEqual(8);
    expect(leagues.length).toBeGreaterThanOrEqual(12);

    const sportsByOrganization = new Map(
      organizations.map((organization) => [
        organization._id,
        new Set(
          leagues
            .filter((league) => league.organizationId === organization._id)
            .map((league) => league.sport),
        ),
      ]),
    );
    for (const sport of ['beachVolleyball', 'soccer', 'softball'] as const) {
      const holders = [...sportsByOrganization.values()].filter((sports) => sports.has(sport));
      expect({ sport, organizations: holders.length >= 2 }).toEqual({
        sport,
        organizations: true,
      });
    }
    expect([...sportsByOrganization.values()].some((sports) => sports.size > 1)).toBe(true);

    const empty = organizations.filter(
      (organization) =>
        !locations.some((location) => location.organizationId === organization._id) &&
        !leagues.some((league) => league.organizationId === organization._id),
    );
    expect(empty.map((organization) => organization.slug)).toEqual([
      'port-aransas-beach-volleyball-club',
    ]);

    // Every league is held at locations of its own organization.
    for (const league of leagues) {
      expect(league.locationIds.length).toBeGreaterThan(0);
      for (const locationId of league.locationIds) {
        const location = locations.find((candidate) => candidate._id === locationId);
        expect(location?.organizationId).toBe(league.organizationId);
      }
    }
  });

  test('every demo organization has a public page', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const { organizations } = await snapshot(t);
    for (const { slug } of organizations) {
      const page = await t.query(api.organizations.getPublicPage, { slug });
      expect(page?.slug).toBe(slug);
    }
  });

  test('a second run inserts nothing, returns zero counts, and changes no row', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const before = await snapshot(t);
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual(NONE);
    expect(await snapshot(t)).toEqual(before);
  });

  test('inserts exactly a missing demo location and a missing demo league, with its links', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const gulfId = await organizationId(t, 'gulf-coast-sport-social');
    // The softball league is the only one held at Flour Bluff Softball Park.
    await t.run(async (ctx) => {
      const league = await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', gulfId).eq('name', 'Wednesday Coed Slow-Pitch'),
        )
        .unique();
      const location = await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', gulfId).eq('name', 'Flour Bluff Softball Park'),
        )
        .unique();
      await ctx.db.delete('leagues', league!._id);
      await ctx.db.delete('locations', location!._id);
    });
    const before = await snapshot(t);

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      organizations: 0,
      locations: 1,
      leagues: 1,
    });

    const after = await snapshot(t);
    // Every earlier row is unchanged.
    expect(after.organizations).toEqual(before.organizations);
    expect(after.locations.slice(0, before.locations.length)).toEqual(before.locations);
    expect(after.leagues.slice(0, before.leagues.length)).toEqual(before.leagues);
    expect(after.locations.length).toBe(before.locations.length + 1);
    expect(after.leagues.length).toBe(before.leagues.length + 1);

    const gulf = await t.query(api.organizations.getPublicPage, {
      slug: 'gulf-coast-sport-social',
    });
    expect(gulf?.leagues.find((league) => league.name === 'Wednesday Coed Slow-Pitch')).toEqual(
      expect.objectContaining({
        sportName: 'Softball',
        locationNames: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      }),
    );
  });

  test('leaves a non-demo organization, its locations, and its leagues unchanged', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', {
        name: 'Existing Club',
        slug: 'existing-club',
      });
      const locationId = await ctx.db.insert('locations', {
        organizationId,
        name: 'Bayside Athletic Complex',
        address: '1 Existing Way, Springfield, IL 62701',
      });
      await ctx.db.insert('leagues', {
        organizationId,
        name: 'Coed 7v7 Rec',
        slug: 'coed-7v7-rec',
        sport: 'soccer',
        locationIds: [locationId],
      });
    });
    const before = await snapshot(t);

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual(FULL);

    const after = await snapshot(t);
    expect(after.organizations[0]).toEqual(before.organizations[0]);
    expect(after.locations[0]).toEqual(before.locations[0]);
    expect(after.leagues[0]).toEqual(before.leagues[0]);
    expect(await counts(t)).toEqual({
      organizations: FULL.organizations + 1,
      locations: FULL.locations + 1,
      leagues: FULL.leagues + 1,
    });
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['another string', '^https://.*\\.netlify\\.app$'],
    ['the pattern with a trailing space', `${PREVIEW_ORIGIN_PATTERN} `],
  ])('throws and writes nothing when PREVIEW_ORIGIN_PATTERN is %s', async (_, value) => {
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', value);
    const t = setup();
    await expect(t.mutation(internal.seed.demo, {})).rejects.toThrow(/PREVIEW_ORIGIN_PATTERN/);
    expect(await counts(t)).toEqual(NONE);
  });

  test('runs without IS_TEST (previews and staging never set it)', async () => {
    vi.stubEnv('IS_TEST', undefined);
    const t = setup();
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual(FULL);
  });

  test('every export is an internal function, so no client can call it', () => {
    const exports = Object.entries(seed);
    expect(exports.map(([name]) => name)).toEqual(['demo']);
    for (const [name, fn] of exports) {
      const markers = fn as Partial<Record<'isInternal' | 'isPublic', boolean>>;
      expect({ name, isInternal: markers.isInternal }).toEqual({ name, isInternal: true });
      expect({ name, isPublic: markers.isPublic }).toEqual({ name, isPublic: undefined });
    }
  });
});
