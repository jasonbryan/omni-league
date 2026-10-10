/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertLeague, insertLocation, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import * as seed from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

/** What one run on an empty deployment inserts. */
const ROWS = { organizations: 5, locations: 10, leagues: 15 };
const NONE = { organizations: 0, locations: 0, leagues: 0 };
/** The result of a run that inserts every demo row and backfills nothing. */
const FULL = { ...ROWS, backfilled: NONE };

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

/** An organization with two locations and two leagues, inserted with none of #100's fields. */
async function insertRaw(t: T): Promise<void> {
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert('organizations', {
      name: 'Old Club',
      slug: 'old-club',
    });
    const field = await ctx.db.insert('locations', {
      organizationId,
      name: 'Old Field',
      address: '1 Old Road',
    });
    await ctx.db.insert('locations', { organizationId, name: 'Other Field', address: '2 Road' });
    await ctx.db.insert('leagues', {
      organizationId,
      name: 'Beta League',
      slug: 'beta-league',
      sport: 'softball',
      locationIds: [],
    });
    await ctx.db.insert('leagues', {
      organizationId,
      name: 'alpha League',
      slug: 'alpha-league',
      sport: 'soccer',
      locationIds: [field],
    });
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
    expect(await counts(t)).toEqual(ROWS);
  });

  test('keeps the two mockup organizations (#73) exactly as the mockup shows them', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});

    const gulf = await t.query(api.organizations.getPublicPage, {
      slug: 'gulf-coast-sport-social',
    });
    expect(gulf).toEqual({
      name: 'Gulf Coast Sport & Social',
      slug: 'gulf-coast-sport-social',
      leagueCount: 5,
      locationCount: 3,
      sportCount: 3,
    });
    const gulfLocations = await t.query(api.organizations.listPublicLocations, {
      slug: 'gulf-coast-sport-social',
      page: 1,
    });
    const gulfLeagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'gulf-coast-sport-social',
      page: 1,
    });
    expect(gulfLocations.rows).toEqual([
      { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
      { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
      { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
    ]);
    expect(
      gulfLeagues.rows.map((league) => [league.name, league.sportName, league.locationNames]),
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
      leagueCount: 0,
      locationCount: 0,
      sportCount: 0,
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
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NONE,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test('inserts exactly a missing demo location and a missing demo league, with its links', async () => {
    const t = setup();
    // The Gulf Coast organization holds part of its demo rows, written through the shared writers:
    // every location but Flour Bluff Softball Park, and every league but the softball one held there.
    const gulfId = await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
        locations: [
          { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
          {
            name: 'North Beach Sand Courts',
            address: '3500 Surfside Blvd, Corpus Christi, TX 78402',
          },
        ],
        leagues: [
          { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Bayside Athletic Complex'] },
          {
            name: "Men's Over-30 11v11",
            sport: 'soccer',
            locations: ['Bayside Athletic Complex'],
          },
          {
            name: 'Sunday Reverse Coed 4s',
            sport: 'beachVolleyball',
            locations: ['North Beach Sand Courts'],
          },
          {
            name: 'Thursday Night Coed 2s',
            sport: 'beachVolleyball',
            locations: ['North Beach Sand Courts'],
          },
        ],
      }),
    );
    const before = await snapshot(t);

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      organizations: ROWS.organizations - 1,
      locations: ROWS.locations - 2,
      leagues: ROWS.leagues - 4,
      backfilled: NONE,
    });

    const after = await snapshot(t);
    // Every earlier location and league is unchanged; the organization gained one of each.
    expect(after.locations.slice(0, before.locations.length)).toEqual(before.locations);
    expect(after.leagues.slice(0, before.leagues.length)).toEqual(before.leagues);
    const gulf = after.organizations.find((organization) => organization._id === gulfId);
    expect(gulf).toEqual({ ...before.organizations[0], leagueCount: 5, locationCount: 3 });

    const leagues = await t.query(api.organizations.listPublicLeagues, {
      slug: 'gulf-coast-sport-social',
      page: 1,
    });
    expect(leagues.rows.find((league) => league.name === 'Wednesday Coed Slow-Pitch')).toEqual(
      expect.objectContaining({
        sportName: 'Softball',
        locationNames: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      }),
    );
  });

  test('every counter equals a recount after the writers, testing:addLeague, and an incremental run', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    // A demo organization holding one of its locations and one league, written by insertTenant,
    // then a location and a league added by insertLocation and insertLeague.
    await t.run(async (ctx) => {
      const id = await insertTenant(ctx, {
        organization: { name: 'Front Range Rec Sports', slug: 'front-range-rec-sports' },
        locations: [
          { name: 'Larkspur Turf Center', address: '455 Larkspur Mesa Dr, Lakewood, CO 80228' },
        ],
        leagues: [
          { name: 'Coed 6v6 Indoor', sport: 'soccer', locations: ['Larkspur Turf Center'] },
        ],
      });
      await insertLocation(ctx, id, {
        name: 'Bluebird Softball Complex',
        address: '7720 Bluebird Ridge Rd, Aurora, CO 80016',
      });
      await insertLeague(ctx, id, {
        name: 'Monday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Bluebird Softball Complex'],
      });
    });
    // A league that is not a demo row, added by the e2e seed.
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'front-range-rec-sports',
      name: 'Extra League',
      sport: 'soccer',
      locations: ['Larkspur Turf Center'],
    });

    await t.mutation(internal.seed.demo, {});

    const { organizations, locations, leagues } = await snapshot(t);
    for (const organization of organizations) {
      expect([organization.slug, organization.leagueCount, organization.locationCount]).toEqual([
        organization.slug,
        leagues.filter((league) => league.organizationId === organization._id).length,
        locations.filter((location) => location.organizationId === organization._id).length,
      ]);
    }
    expect(organizations.find((o) => o.slug === 'front-range-rec-sports')).toMatchObject({
      leagueCount: 5,
      locationCount: 3,
    });
    for (const row of [...locations, ...leagues]) {
      expect(row.sortName, row.name).toBe(row.name.toLowerCase());
    }
  });

  test('leaves a non-demo organization, its locations, and its leagues unchanged', async () => {
    const t = setup();
    await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Existing Club', slug: 'existing-club' },
        locations: [
          { name: 'Bayside Athletic Complex', address: '1 Existing Way, Springfield, IL 62701' },
        ],
        leagues: [
          { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Bayside Athletic Complex'] },
        ],
      }),
    );
    const before = await snapshot(t);

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual(FULL);

    const after = await snapshot(t);
    expect(after.organizations[0]).toEqual(before.organizations[0]);
    expect(after.locations[0]).toEqual(before.locations[0]);
    expect(after.leagues[0]).toEqual(before.leagues[0]);
    expect(await counts(t)).toEqual({
      organizations: ROWS.organizations + 1,
      locations: ROWS.locations + 1,
      leagues: ROWS.leagues + 1,
    });
  });

  test('backfills sortName and the counters on rows written before #100, once', async () => {
    const t = setup();
    // As on a reused staging deployment: rows with none of the new fields, including a demo
    // organization that holds one of its locations.
    await insertRaw(t);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', {
        name: 'Lakeshore Sand League',
        slug: 'lakeshore-sand-league',
      });
      await ctx.db.insert('locations', {
        organizationId,
        name: 'Driftwood Beach Courts',
        address: '2600 Driftwood Shore Dr, Chicago, IL 60614',
      });
    });

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      organizations: ROWS.organizations - 1,
      locations: ROWS.locations - 1,
      leagues: ROWS.leagues,
      backfilled: { organizations: 2, locations: 3, leagues: 2 },
    });

    const { organizations, locations, leagues } = await snapshot(t);
    for (const row of [...locations, ...leagues]) {
      expect(row.sortName, row.name).toBe(row.name.toLowerCase());
    }
    for (const organization of organizations) {
      expect([organization.slug, organization.leagueCount, organization.locationCount]).toEqual([
        organization.slug,
        leagues.filter((league) => league.organizationId === organization._id).length,
        locations.filter((location) => location.organizationId === organization._id).length,
      ]);
    }
    expect(
      await t.query(api.organizations.listPublicLeagues, { slug: 'old-club', page: 1 }),
    ).toEqual({
      rows: [
        { name: 'alpha League', sportName: 'Soccer', locationNames: ['Old Field'] },
        { name: 'Beta League', sportName: 'Softball', locationNames: [] },
      ],
      page: 1,
      pageCount: 1,
      total: 2,
    });

    const before = await snapshot(t);
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NONE,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['another string', '^https://.*\\.netlify\\.app$'],
    ['the pattern with a trailing space', `${PREVIEW_ORIGIN_PATTERN} `],
  ])(
    'throws, writes nothing, and backfills nothing when PREVIEW_ORIGIN_PATTERN is %s',
    async (_, value) => {
      vi.stubEnv('PREVIEW_ORIGIN_PATTERN', value);
      const t = setup();
      await insertRaw(t);
      const before = await snapshot(t);
      await expect(t.mutation(internal.seed.demo, {})).rejects.toThrow(/PREVIEW_ORIGIN_PATTERN/);
      expect(await snapshot(t)).toEqual(before);
    },
  );

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
