/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { formatLabel } from './lib/divisions';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { checkSeasonFields } from './lib/seasonInput';
import { DEMO_ORGANIZATION_SLUGS, isReservedSlug, isSlug } from './lib/slugs';
import { insertLeague, insertLocation, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import * as seed from './seed';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

/** What one run on an empty deployment inserts. */
const ROWS = { organizations: 5, locations: 10, customLevels: 1, leagues: 16, seasons: 4 };
/** What a run backfills when it changes no row. */
const NONE = { organizations: 0, locations: 0, leagues: 0, seasons: 0, leagueDivisions: 0 };
const NO_ROWS = { organizations: 0, locations: 0, customLevels: 0, leagues: 0, seasons: 0 };
/** The result of a run that inserts every demo row and backfills nothing. */
const FULL = { ...ROWS, backfilled: NONE };

async function counts(t: T) {
  return t.run(async (ctx) => ({
    organizations: (await ctx.db.query('organizations').collect()).length,
    locations: (await ctx.db.query('locations').collect()).length,
    customLevels: (await ctx.db.query('customLevels').collect()).length,
    leagues: (await ctx.db.query('leagues').collect()).length,
    seasons: (await ctx.db.query('seasons').collect()).length,
  }));
}

/** Every row of the three tables, to prove a run changed nothing. */
async function snapshot(t: T) {
  return t.run(async (ctx) => ({
    organizations: await ctx.db.query('organizations').collect(),
    locations: await ctx.db.query('locations').collect(),
    leagues: await ctx.db.query('leagues').collect(),
    seasons: await ctx.db.query('seasons').collect(),
  }));
}

/**
 * The sport counters and `sportLocations` rows a recount of the leagues gives, per organization
 * slug (#101): the leagues of each sport, the distinct locations of each sport, and the
 * leagues of each sport at each location (as `sport:location name`).
 */
async function sportRecount(t: T) {
  return t.run(async (ctx) => {
    const leagues = await ctx.db.query('leagues').collect();
    const locations = await ctx.db.query('locations').collect();
    const result: Record<
      string,
      { leagues: Record<string, number>; locations: Record<string, number>; rows: string[] }
    > = {};
    for (const organization of await ctx.db.query('organizations').collect()) {
      const own = leagues.filter((league) => league.organizationId === organization._id);
      const leagueCounts: Record<string, number> = {};
      const locationCounts: Record<string, number> = {};
      const rows: string[] = [];
      for (const sport of ['beachVolleyball', 'soccer', 'softball']) {
        const ofSport = own.filter((league) => league.sport === sport);
        if (ofSport.length === 0) continue;
        leagueCounts[sport] = ofSport.length;
        const perLocation = new Map<string, number>();
        for (const league of ofSport) {
          for (const id of new Set(league.locationIds)) {
            const name = locations.find((location) => location._id === id)?.name ?? '?';
            perLocation.set(name, (perLocation.get(name) ?? 0) + 1);
          }
        }
        locationCounts[sport] = perLocation.size;
        for (const [name, count] of perLocation) rows.push(`${sport}:${name}:${count}`);
      }
      result[organization.slug] = {
        leagues: leagueCounts,
        locations: Object.fromEntries(Object.entries(locationCounts).filter(([, n]) => n > 0)),
        rows: rows.sort(),
      };
    }
    return result;
  });
}

/** What the database holds for the same shape as `sportRecount`: the counters and the rows. */
async function sportStored(t: T) {
  return t.run(async (ctx) => {
    const locations = await ctx.db.query('locations').collect();
    const rows = await ctx.db.query('sportLocations').collect();
    const result: Record<
      string,
      { leagues: Record<string, number>; locations: Record<string, number>; rows: string[] }
    > = {};
    for (const organization of await ctx.db.query('organizations').collect()) {
      result[organization.slug] = {
        leagues: organization.sportLeagueCounts ?? {},
        locations: Object.fromEntries(
          Object.entries(organization.sportLocationCounts ?? {}).filter(([, n]) => n > 0),
        ),
        rows: rows
          .filter((row) => row.organizationId === organization._id)
          .map(
            (row) =>
              `${row.sport}:${locations.find((l) => l._id === row.locationId)?.name}:${row.leagueCount}`,
          )
          .sort(),
      };
    }
    return result;
  });
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

  test('adds the two demo draft seasons (#125) and the two published ones (#126) of Gulf Coast Sport & Social, as seasons.create would take them', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const rows = await t.run(async (ctx) => {
      const seasons = await ctx.db.query('seasons').collect();
      const result = [];
      for (const season of seasons) {
        const league = (await ctx.db.get('leagues', season.leagueId))!;
        const organization = (await ctx.db.get('organizations', season.organizationId))!;
        result.push({
          organization: organization.slug,
          league: league.slug,
          season,
          sport: league.sport,
        });
      }
      return result;
    });
    expect(
      rows.map(({ organization, league, season }) => ({
        organization,
        league,
        name: season.name,
        slug: season.slug,
        playersPerSide: season.playersPerSide,
        minimumRosterSize: season.minimumRosterSize,
        startDate: season.startDate,
        endDate: season.endDate,
        registrationDeadline: season.registrationDeadline,
        status: season.status,
      })),
    ).toEqual([
      {
        organization: 'gulf-coast-sport-social',
        league: 'sunday-reverse-coed-4s',
        name: 'Fall 2027',
        slug: 'fall-2027',
        playersPerSide: 4,
        minimumRosterSize: 4,
        startDate: '2027-09-12',
        endDate: '2027-11-14',
        registrationDeadline: '2027-08-29',
        status: 'draft',
      },
      {
        organization: 'gulf-coast-sport-social',
        league: 'coed-7v7-rec',
        name: 'Fall 2027',
        slug: 'fall-2027',
        playersPerSide: 7,
        minimumRosterSize: 7,
        startDate: '2027-09-08',
        endDate: '2027-11-10',
        registrationDeadline: '2027-08-25',
        status: 'draft',
      },
      {
        organization: 'gulf-coast-sport-social',
        league: 'sunday-reverse-coed-4s',
        name: 'Summer 2027',
        slug: 'summer-2027',
        playersPerSide: 4,
        minimumRosterSize: 4,
        startDate: '2027-06-06',
        endDate: '2027-08-29',
        registrationDeadline: '2027-05-23',
        status: 'published',
      },
      {
        organization: 'gulf-coast-sport-social',
        league: 'coed-7v7-rec',
        name: 'Summer 2027',
        slug: 'summer-2027',
        playersPerSide: 7,
        minimumRosterSize: 7,
        startDate: '2027-06-02',
        endDate: '2027-08-25',
        registrationDeadline: '2027-05-19',
        status: 'published',
      },
    ]);
    // Each follows the rules of seasons.create for its league's sport.
    for (const { sport, season } of rows) {
      expect(
        checkSeasonFields(sport, {
          name: season.name,
          slug: season.slug,
          startDate: season.startDate,
          endDate: season.endDate,
          registrationDeadline: season.registrationDeadline,
          format: formatLabel(season.playersPerSide!),
          minimumRosterSize: season.minimumRosterSize,
        }),
      ).toEqual({});
    }
  });

  test('leaves a season already under a demo slug alone, whatever its status, and inserts the other (#125)', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    // A reused staging: a published season took the slug of one demo draft, and a demo season
    // was deleted.
    await t.run(async (ctx) => {
      const seasons = await ctx.db.query('seasons').collect();
      const coed = seasons.find((s) => s.slug === 'fall-2027' && s.playersPerSide === 7)!;
      await ctx.db.patch('seasons', coed._id, { status: 'published', minimumRosterSize: 9 });
      const other = seasons.find((s) => s.slug === 'fall-2027' && s.playersPerSide === 4)!;
      await ctx.db.delete('seasons', other._id);
    });
    const before = await t.run((ctx) => ctx.db.query('seasons').collect());

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NO_ROWS,
      seasons: 1,
      backfilled: NONE,
    });
    const after = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(after).toHaveLength(4);
    for (const season of before) expect(after).toContainEqual(season);
    expect(
      after.find((season) => season.slug === 'fall-2027' && season.playersPerSide === 7),
    ).toMatchObject({ status: 'published', minimumRosterSize: 9 });
  });

  test('on a deployment where #125’s seed already ran, inserts the two published summer-2027 seasons, leaves the fall-2027 drafts unchanged, and a second run inserts nothing (#126)', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    // #125's seed inserted the two fall-2027 drafts and no summer-2027 season.
    await t.run(async (ctx) => {
      for (const season of await ctx.db.query('seasons').collect()) {
        if (season.slug === 'summer-2027') await ctx.db.delete('seasons', season._id);
      }
    });
    const drafts = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(drafts.map((season) => [season.slug, season.status])).toEqual([
      ['fall-2027', 'draft'],
      ['fall-2027', 'draft'],
    ]);

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NO_ROWS,
      seasons: 2,
      backfilled: NONE,
    });
    const after = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(after).toHaveLength(4);
    for (const draft of drafts) expect(after).toContainEqual(draft);
    const summers = after.filter((season) => season.slug === 'summer-2027');
    expect(
      summers.map((season) => [season.name, season.status, season.playersPerSide]).sort(),
    ).toEqual([
      ['Summer 2027', 'published', 4],
      ['Summer 2027', 'published', 7],
    ]);

    const settled = await snapshot(t);
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(settled);
  });

  test('the published demo seasons write no organization row, and a league’s only change is its publishedSeasonCount (#126, #127)', async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    const before = await t.run(async (ctx) => ({
      organizations: await ctx.db.query('organizations').collect(),
      leagues: await ctx.db.query('leagues').collect(),
    }));
    // Deleting the seasons directly bypasses the writers: reset the counters with them.
    await t.run(async (ctx) => {
      for (const season of await ctx.db.query('seasons').collect()) {
        if (season.slug !== 'summer-2027') continue;
        await ctx.db.delete('seasons', season._id);
        await ctx.db.patch('leagues', season.leagueId, { publishedSeasonCount: 0 });
      }
    });
    await t.mutation(internal.seed.demo, {});
    expect(
      await t.run(async (ctx) => ({
        organizations: await ctx.db.query('organizations').collect(),
        leagues: await ctx.db.query('leagues').collect(),
      })),
    ).toEqual(before);
  });

  test('every demo organization slug is a valid slug and reserved, so a created organization never gets demo rows (#64)', () => {
    expect(seed.DEMO.map((tenant) => tenant.organization.slug).sort()).toEqual(
      [...DEMO_ORGANIZATION_SLUGS].sort(),
    );
    for (const { organization } of seed.DEMO) {
      expect(isSlug(organization.slug), organization.slug).toBe(true);
      expect(isReservedSlug(organization.slug), organization.slug).toBe(true);
    }
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
      sports: [
        {
          key: 'beachVolleyball',
          segment: 'beach-volleyball',
          name: 'Beach volleyball',
          leagueCount: 2,
          locationCount: 1,
        },
        { key: 'soccer', segment: 'soccer', name: 'Soccer', leagueCount: 2, locationCount: 1 },
        {
          key: 'softball',
          segment: 'softball',
          name: 'Softball',
          leagueCount: 1,
          locationCount: 2,
        },
      ],
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
      sports: [],
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
      ...NO_ROWS,
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
      customLevels: ROWS.customLevels,
      leagues: ROWS.leagues - 4,
      seasons: ROWS.seasons,
      backfilled: { ...NONE, leagueDivisions: 4 },
    });

    const after = await snapshot(t);
    // Every earlier location and league is unchanged; the organization gained one of each.
    expect(after.locations.slice(0, before.locations.length)).toEqual(before.locations);
    // A league the demo gave a published season (#126) gained its publishedSeasonCount (#127), and
    // every earlier league its division.
    const DIVISION = ['gender', 'playersPerSide', 'level', 'ageGroup'] as const;
    const withoutBackfill = (league: Doc<'leagues'>) => ({
      ...league,
      publishedSeasonCount: 0,
      ...Object.fromEntries(DIVISION.map((field) => [field, undefined])),
    });
    expect(after.leagues.slice(0, before.leagues.length).map(withoutBackfill)).toEqual(
      before.leagues.map(withoutBackfill),
    );
    expect(after.leagues.find((league) => league.name === 'Sunday Reverse Coed 4s')).toMatchObject({
      gender: 'coed',
      playersPerSide: 4,
      level: 'bb',
      ageGroup: 'adult',
    });
    const gulf = after.organizations.find((organization) => organization._id === gulfId);
    expect(gulf).toEqual({
      ...before.organizations[0],
      leagueCount: 5,
      locationCount: 3,
      sportLeagueCounts: { beachVolleyball: 2, soccer: 2, softball: 1 },
      sportLocationCounts: { beachVolleyball: 1, soccer: 1, softball: 2 },
    });

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
      leagueCount: 6,
      locationCount: 3,
    });
    for (const row of [...locations, ...leagues]) {
      expect(row.sortName, row.name).toBe(row.name.toLowerCase());
    }
    // The sport counters and sportLocations rows equal a recount (#101).
    const stored = await sportStored(t);
    expect(stored).toEqual(await sportRecount(t));
    expect(stored['front-range-rec-sports']).toEqual({
      leagues: { soccer: 4, softball: 2 },
      locations: { soccer: 2, softball: 2 },
      rows: [
        'soccer:Cottonwood Creek Fields:2',
        'soccer:Larkspur Turf Center:2',
        'softball:Bluebird Softball Complex:2',
        'softball:Cottonwood Creek Fields:1',
      ],
    });
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

    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...ROWS,
      backfilled: { ...NONE, leagueDivisions: 1 },
    });

    const after = await snapshot(t);
    expect(after.organizations[0]).toEqual(before.organizations[0]);
    expect(after.locations[0]).toEqual(before.locations[0]);
    expect(after.leagues[0]).toEqual({
      ...before.leagues[0],
      gender: 'coed',
      playersPerSide: 7,
      level: 'rec',
      ageGroup: 'adult',
    });
    expect(await counts(t)).toEqual({
      organizations: ROWS.organizations + 1,
      locations: ROWS.locations + 1,
      customLevels: ROWS.customLevels,
      leagues: ROWS.leagues + 1,
      seasons: ROWS.seasons,
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
      customLevels: ROWS.customLevels,
      leagues: ROWS.leagues,
      seasons: ROWS.seasons,
      backfilled: { organizations: 2, locations: 3, leagues: 2, seasons: 0, leagueDivisions: 2 },
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
    // The sport counters and sportLocations rows equal a recount (#101).
    const stored = await sportStored(t);
    expect(stored).toEqual(await sportRecount(t));
    expect(stored['old-club']).toEqual({
      leagues: { soccer: 1, softball: 1 },
      locations: { soccer: 1 },
      rows: ['soccer:Old Field:1'],
    });
    expect(
      (await t.query(api.organizations.getPublicPage, { slug: 'old-club' }))?.sports.map(
        ({ key, leagueCount, locationCount }) => [key, leagueCount, locationCount],
      ),
    ).toEqual([
      ['soccer', 1, 1],
      ['softball', 1, 0],
    ]);
    expect(
      await t.query(api.organizations.listPublicLeagues, {
        slug: 'old-club',
        page: 1,
        sport: 'softball',
      }),
    ).toEqual({
      rows: [
        { name: 'Beta League', slug: 'beta-league', sportName: 'Softball', locationNames: [] },
      ],
      page: 1,
      pageCount: 1,
      total: 1,
    });
    expect(
      await t.query(api.organizations.listPublicLeagues, { slug: 'old-club', page: 1 }),
    ).toEqual({
      rows: [
        {
          name: 'alpha League',
          slug: 'alpha-league',
          sportName: 'Soccer',
          locationNames: ['Old Field'],
        },
        { name: 'Beta League', slug: 'beta-league', sportName: 'Softball', locationNames: [] },
      ],
      page: 1,
      pageCount: 1,
      total: 2,
    });

    const before = await snapshot(t);
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test('backfills only the sport counters and sportLocations rows on an organization that has #100 fields, once', async () => {
    const t = setup();
    // As on staging after #100's backfill: leagueCount and locationCount are set, the sport
    // counters are not, and a repeated location in one league counts once.
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', {
        name: 'Mid Club',
        slug: 'mid-club',
        leagueCount: 3,
        locationCount: 2,
      });
      const a = await ctx.db.insert('locations', {
        organizationId,
        name: 'Field A',
        address: '1 A Road',
        sortName: 'field a',
      });
      const b = await ctx.db.insert('locations', {
        organizationId,
        name: 'Field B',
        address: '2 B Road',
        sortName: 'field b',
      });
      for (const [name, sport, locationIds] of [
        ['One', 'soccer', [a, a]],
        ['Two', 'soccer', [a, b]],
        ['Three', 'softball', [b]],
      ] as const) {
        await ctx.db.insert('leagues', {
          organizationId,
          name,
          slug: name.toLowerCase(),
          sport,
          locationIds: [...locationIds],
          sortName: name.toLowerCase(),
        });
      }
    });

    // The three leagues were written before #66, so the backfill also sets their status.
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...ROWS,
      backfilled: { ...NONE, organizations: 1, leagues: 3, leagueDivisions: 3 },
    });
    expect((await sportStored(t))['mid-club']).toEqual({
      leagues: { soccer: 2, softball: 1 },
      locations: { soccer: 2, softball: 1 },
      rows: ['soccer:Field A:2', 'soccer:Field B:1', 'softball:Field B:1'],
    });
    expect(await sportStored(t)).toEqual(await sportRecount(t));

    const before = await snapshot(t);
    const rowsBefore = await t.run((ctx) => ctx.db.query('sportLocations').collect());
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query('sportLocations').collect())).toEqual(rowsBefore);
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
    // `DEMO` is the plain data array e2e/pwa.spec.ts reads (#82), and `DEMO_SEASONS` the seasons
    // (#125): no function, nothing to call.
    const { DEMO, DEMO_SEASONS, ...functions } = seed;
    expect(Array.isArray(DEMO)).toBe(true);
    expect(Array.isArray(DEMO_SEASONS)).toBe(true);
    const exports = Object.entries(functions);
    expect(exports.map(([name]) => name)).toEqual(['demo']);
    for (const [name, fn] of exports) {
      const markers = fn as Partial<Record<'isInternal' | 'isPublic', boolean>>;
      expect({ name, isInternal: markers.isInternal }).toEqual({ name, isInternal: true });
      expect({ name, isPublic: markers.isPublic }).toEqual({ name, isPublic: undefined });
    }
  });
});

describe('seed:demo backfill against a recount (#100, tester)', () => {
  /** Each organization's counters next to a recount of its rows, and every row's sortName. */
  async function expectCountersMatchRecount(t: T) {
    const { organizations, locations, leagues } = await snapshot(t);
    for (const organization of organizations) {
      expect([organization.slug, organization.leagueCount, organization.locationCount]).toEqual([
        organization.slug,
        leagues.filter((league) => league.organizationId === organization._id).length,
        locations.filter((location) => location.organizationId === organization._id).length,
      ]);
    }
    for (const row of [...locations, ...leagues]) {
      expect(row.sortName, row.name).toBe(row.name.toLowerCase());
    }
  }

  test('rows added by the writers to an organization without counters are counted by the backfill', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await insertRaw(t);
    await t.run(async (ctx) => {
      const old = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'old-club'))
        .unique();
      if (!old) throw new Error('fixture: old-club is missing');
      await insertLocation(ctx, old._id, { name: 'New Field', address: '3 New Road' });
    });
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'old-club',
      name: 'Gamma League',
      sport: 'soccer',
      locations: ['New Field'],
    });
    // The writers leave an unset counter unset, so the backfill recounts it.
    const old = (await snapshot(t)).organizations.find((o) => o.slug === 'old-club');
    expect([old?.leagueCount, old?.locationCount]).toEqual([undefined, undefined]);

    const result = await t.mutation(internal.seed.demo, {});
    expect(result.backfilled).toEqual({
      organizations: 1,
      locations: 2,
      leagues: 2,
      seasons: 0,
      leagueDivisions: 2,
    });
    await expectCountersMatchRecount(t);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'old-club' })).toMatchObject({
      leagueCount: 3,
      locationCount: 3,
      sportCount: 2,
    });
  });

  test('an organization with only one counter set is recounted for both', async () => {
    const t = setup();
    await insertRaw(t);
    await t.run(async (ctx) => {
      const old = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'old-club'))
        .unique();
      if (!old) throw new Error('fixture: old-club is missing');
      await ctx.db.patch('organizations', old._id, { leagueCount: 99 });
    });
    const result = await t.mutation(internal.seed.demo, {});
    expect(result.backfilled.organizations).toBe(1);
    await expectCountersMatchRecount(t);
  });

  test('three runs after mixed writes keep every counter equal to a recount', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await insertRaw(t);
    await t.mutation(internal.seed.demo, {});
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'gulf-coast-sport-social',
      name: 'Extra Gulf League',
      sport: 'soccer',
      locations: ['Bayside Athletic Complex'],
    });
    for (let run = 0; run < 3; run++) {
      await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
        ...NO_ROWS,
        backfilled: NONE,
      });
      await expectCountersMatchRecount(t);
    }
    expect(
      await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast-sport-social' }),
    ).toMatchObject({ leagueCount: 6, locationCount: 3, sportCount: 3 });
  });
});

describe('seed:demo and league status (#66, tester probes)', () => {
  test('a legacy league without a status becomes published before the recount, a draft stays out of it, and a second run changes nothing', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      // No counters at all (a deployment from before #100): the recount counts published leagues.
      const bare = await ctx.db.insert('organizations', { name: 'Bare Club', slug: 'bare-club' });
      const field = await ctx.db.insert('locations', {
        organizationId: bare,
        name: 'Bare Field',
        address: '1 Road',
      });
      await ctx.db.insert('leagues', {
        organizationId: bare,
        name: 'Legacy One',
        slug: 'legacy-one',
        sport: 'soccer',
        locationIds: [field],
      });
      await ctx.db.insert('leagues', {
        organizationId: bare,
        name: 'Legacy Draft',
        slug: 'legacy-draft',
        sport: 'softball',
        locationIds: [field],
        status: 'draft',
      });
      // Counters already set, as on a deployment after #100/#101 but before #66.
      const counted = await ctx.db.insert('organizations', {
        name: 'Counted Club',
        slug: 'counted-club',
        leagueCount: 1,
        locationCount: 1,
        sportLeagueCounts: { soccer: 1 },
        sportLocationCounts: { soccer: 1 },
      });
      const cf = await ctx.db.insert('locations', {
        organizationId: counted,
        name: 'Counted Field',
        address: '2 Road',
        sortName: 'counted field',
      });
      await ctx.db.insert('leagues', {
        organizationId: counted,
        name: 'Counted League',
        slug: 'counted-league',
        sport: 'soccer',
        locationIds: [cf],
        sortName: 'counted league',
      });
      await ctx.db.insert('sportLocations', {
        organizationId: counted,
        sport: 'soccer',
        locationId: cf,
        leagueCount: 1,
      });
    });

    const first = await t.mutation(internal.seed.demo, {});
    expect(first.backfilled.leagues).toBe(3);
    const statuses = await t.run(async (ctx) =>
      Object.fromEntries((await ctx.db.query('leagues').collect()).map((l) => [l.slug, l.status])),
    );
    expect(statuses).toMatchObject({
      'legacy-one': 'published',
      'legacy-draft': 'draft',
      'counted-league': 'published',
    });
    const bare = await t.query(api.organizations.getPublicPage, { slug: 'bare-club' });
    expect(bare).toMatchObject({ leagueCount: 1, sportCount: 1 });
    expect(bare?.sports.map((sport) => sport.key)).toEqual(['soccer']);
    expect(
      await t.query(api.organizations.listPublicLeagues, { slug: 'bare-club', page: 1 }),
    ).toMatchObject({
      rows: [{ name: 'Legacy One' }],
      total: 1,
    });
    expect(await t.query(api.organizations.getPublicPage, { slug: 'counted-club' })).toMatchObject({
      leagueCount: 1,
    });
    await expectCountersMatchRecountPublished(t);

    const before = await snapshot(t);
    const rowsBefore = await t.run((ctx) => ctx.db.query('sportLocations').collect());
    await expect(t.mutation(internal.seed.demo, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query('sportLocations').collect())).toEqual(rowsBefore);
  });
});

/** The organization counters equal a recount of the published leagues only. */
async function expectCountersMatchRecountPublished(t: T) {
  await t.run(async (ctx) => {
    for (const organization of await ctx.db.query('organizations').collect()) {
      const published = (await ctx.db.query('leagues').collect()).filter(
        (l) => l.organizationId === organization._id && l.status === 'published',
      );
      expect(organization.leagueCount, organization.slug).toBe(published.length);
      const perSport: Record<string, number> = {};
      for (const l of published) perSport[l.sport] = (perSport[l.sport] ?? 0) + 1;
      expect(organization.sportLeagueCounts ?? {}, organization.slug).toEqual(perSport);
    }
  });
}
