/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { formatLabel } from './lib/divisions';
import { leagueDivisionLabel } from './lib/leagueDivision';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { registrationIsOpen, seasonPhase } from './lib/registration';
import { searchWords } from './lib/searchQuery';
import { checkSeasonFields } from './lib/seasonInput';
import { DEMO_ORGANIZATION_SLUGS, isReservedSlug, isSlug } from './lib/slugs';
import { sportName } from './lib/sports';
import { insertLeague, insertLocation, insertTenant, defaultDivision } from './lib/tenantWrites';
import schema from './schema';
import * as seed from './seed';
import {
  insertLeagueWithProgram,
  modules,
  leagueRequiredFields,
  organizationListFields,
} from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const ROWS = {
  organizations: 7,
  locations: 25,
  customLevels: 1,
  leagues: 46,
  seasons: 8,
  tournaments: 2,
};
const NONE = {
  organizations: 0,
  locations: 0,
  leagues: 0,
  teamCounts: 0,
  pendingInviteCounts: 0,
  waitlistCounts: 0,
  staffCounts: 0,
  staffInviteCounts: 0,
  draftLeagueCounts: 0,
};
const NO_ROWS = {
  organizations: 0,
  locations: 0,
  customLevels: 0,
  leagues: 0,
  seasons: 0,
  tournaments: 0,
};
const FULL = { ...ROWS, backfilled: NONE };

async function counts(t: T) {
  return t.run(async (ctx) => ({
    organizations: (await ctx.db.query('organizations').collect()).length,
    locations: (await ctx.db.query('locations').collect()).length,
    customLevels: (await ctx.db.query('customLevels').collect()).length,
    leagues: (await ctx.db.query('leagues').collect()).length,
    seasons: (await ctx.db.query('seasons').collect()).length,
    tournaments: (await ctx.db.query('tournaments').collect()).length,
  }));
}

async function snapshot(t: T) {
  return t.run(async (ctx) => ({
    organizations: await ctx.db.query('organizations').collect(),
    locations: await ctx.db.query('locations').collect(),
    leagues: await ctx.db.query('leagues').collect(),
    seasons: await ctx.db.query('seasons').collect(),
  }));
}

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

async function insertRaw(t: T): Promise<void> {
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert('organizations', {
      ...organizationListFields('Old Club'),
      name: 'Old Club',
      slug: 'old-club',
    });
    const field = await ctx.db.insert('locations', {
      organizationId,
      name: 'Old Field',
      address: '1 Old Road',
    });
    await ctx.db.insert('locations', { organizationId, name: 'Other Field', address: '2 Road' });
    await insertLeagueWithProgram(ctx, {
      ...leagueRequiredFields('softball', 'Beta League'),
      organizationId,
      name: 'Beta League',
      slug: 'beta-league',
      sport: 'softball',
      locationIds: [],
    });
    await insertLeagueWithProgram(ctx, {
      ...leagueRequiredFields('soccer', 'alpha League'),
      organizationId,
      name: 'alpha League',
      slug: 'alpha-league',
      sport: 'soccer',
      locationIds: [field],
    });
  });
}

// 18:00 UTC on Oct 27 is 06:00 on Oct 27 at UTC-12.
const RUN = Date.UTC(2026, 9, 27, 18);

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(RUN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('seed:demo', () => {
  test('on an empty deployment, creates every demo organization and returns the inserted counts', async () => {
    const t = setup();
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual(FULL);
    expect(await counts(t)).toEqual(ROWS);
  });

  test('adds the two demo draft seasons and the six published ones of Gulf Coast Sport & Social, as seasons.create would take them', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
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
          leagueDivision: {
            playersPerSide: league.playersPerSide,
            minimumRosterSize: league.minimumRosterSize ?? league.playersPerSide,
          },
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
      {
        organization: 'gulf-coast-sport-social',
        league: 'thursday-night-coed-2s',
        name: 'Summer 2027',
        slug: 'summer-2027',
        playersPerSide: 2,
        minimumRosterSize: 2,
        startDate: '2027-06-03',
        endDate: '2027-08-26',
        registrationDeadline: '2027-05-20',
        status: 'published',
      },
      {
        organization: 'gulf-coast-sport-social',
        league: 'sunday-reverse-coed-4s',
        name: 'Current season',
        slug: 'current-season',
        playersPerSide: 4,
        minimumRosterSize: 4,
        startDate: '2026-10-13',
        endDate: '2026-12-22',
        registrationDeadline: '2026-10-06',
        status: 'published',
      },
      {
        organization: 'gulf-coast-sport-social',
        league: 'coed-7v7-rec',
        name: 'Next season',
        slug: 'next-season',
        playersPerSide: 7,
        minimumRosterSize: 7,
        startDate: '2026-11-01',
        endDate: '2027-01-24',
        registrationDeadline: '2026-10-25',
        status: 'published',
      },
      {
        organization: 'gulf-coast-sport-social',
        league: 'coed-7v7-rec',
        name: 'Past season',
        slug: 'past-season',
        playersPerSide: 7,
        minimumRosterSize: 7,
        startDate: '2026-08-25',
        endDate: '2026-10-20',
        registrationDeadline: '2026-08-18',
        status: 'published',
      },
    ]);
    for (const { leagueDivision, season } of rows) {
      expect(
        checkSeasonFields({
          name: season.name,
          slug: season.slug,
          startDate: season.startDate,
          endDate: season.endDate,
          registrationDeadline: season.registrationDeadline,
          maxTeams: season.maxTeams,
          maxRosterSize: season.maxRosterSize,
          minimumRosterSize: season.minimumRosterSize,
        }),
      ).toEqual({});
      expect({
        playersPerSide: season.playersPerSide,
        minimumRosterSize: season.minimumRosterSize,
      }).toEqual(leagueDivision);
    }
  });

  test('leaves a season already under a demo slug alone, whatever its status, and inserts the other', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    await t.run(async (ctx) => {
      const seasons = await ctx.db.query('seasons').collect();
      const coed = seasons.find((s) => s.slug === 'fall-2027' && s.playersPerSide === 7)!;
      await ctx.db.patch('seasons', coed._id, { status: 'published', minimumRosterSize: 9 });
      const other = seasons.find((s) => s.slug === 'fall-2027' && s.playersPerSide === 4)!;
      await ctx.db.delete('seasons', other._id);
    });
    const before = await t.run((ctx) => ctx.db.query('seasons').collect());

    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...NO_ROWS,
      seasons: 1,
      backfilled: NONE,
    });
    const after = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(after).toHaveLength(8);
    for (const season of before) expect(after).toContainEqual(season);
    expect(
      after.find((season) => season.slug === 'fall-2027' && season.playersPerSide === 7),
    ).toMatchObject({ status: 'published', minimumRosterSize: 9 });
  });

  test('on a deployment where the draft seasons were already seeded, inserts the three published summer-2027 seasons, leaves the fall-2027 drafts unchanged, and a second run inserts nothing', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    await t.run(async (ctx) => {
      for (const season of await ctx.db.query('seasons').collect()) {
        if (season.slug === 'summer-2027') await ctx.db.delete('seasons', season._id);
      }
    });
    const drafts = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(drafts.map((season) => [season.slug, season.status])).toEqual([
      ['fall-2027', 'draft'],
      ['fall-2027', 'draft'],
      ['current-season', 'published'],
      ['next-season', 'published'],
      ['past-season', 'published'],
    ]);

    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...NO_ROWS,
      seasons: 3,
      backfilled: NONE,
    });
    const after = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(after).toHaveLength(8);
    for (const draft of drafts) expect(after).toContainEqual(draft);
    const summers = after.filter((season) => season.slug === 'summer-2027');
    expect(
      summers.map((season) => [season.name, season.status, season.playersPerSide]).sort(),
    ).toEqual([
      ['Summer 2027', 'published', 2],
      ['Summer 2027', 'published', 4],
      ['Summer 2027', 'published', 7],
    ]);

    const settled = await snapshot(t);
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(settled);
  });

  test('the published demo seasons write no organization row, and a league’s only change is its publishedSeasonCount', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const before = await t.run(async (ctx) => ({
      organizations: await ctx.db.query('organizations').collect(),
      leagues: await ctx.db.query('leagues').collect(),
    }));
    // Deleting the seasons directly bypasses the writers: reset the counters with them.
    await t.run(async (ctx) => {
      for (const season of await ctx.db.query('seasons').collect()) {
        if (season.slug !== 'summer-2027') continue;
        await ctx.db.delete('seasons', season._id);
        const league = (await ctx.db.get('leagues', season.leagueId))!;
        await ctx.db.patch('leagues', season.leagueId, {
          publishedSeasonCount: (league.publishedSeasonCount ?? 0) - 1,
        });
      }
    });
    await t.mutation(internal.seed.insertDemoData, {});
    expect(
      await t.run(async (ctx) => ({
        organizations: await ctx.db.query('organizations').collect(),
        leagues: await ctx.db.query('leagues').collect(),
      })),
    ).toEqual(before);
  });

  test('the demo admin administers an organization with exactly one location and a league', () => {
    const administered = seed.DEMO_ACCOUNTS.admin.memberships
      .filter((membership) => membership.role === 'orgAdmin')
      .map((membership) => membership.organizationSlug);
    const single = seed.DEMO.filter(
      (tenant) =>
        administered.includes(tenant.organization.slug) &&
        tenant.locations.length === 1 &&
        tenant.leagues.length > 0,
    );
    expect(single.map((tenant) => tenant.organization.slug)).toEqual(['rockport-sand-volleyball']);
  });

  test('every demo organization slug is a valid slug and reserved, so a created organization never gets demo rows', () => {
    expect(seed.DEMO.map((tenant) => tenant.organization.slug).sort()).toEqual(
      [...DEMO_ORGANIZATION_SLUGS].sort(),
    );
    for (const { organization } of seed.DEMO) {
      expect(isSlug(organization.slug), organization.slug).toBe(true);
      expect(isReservedSlug(organization.slug), organization.slug).toBe(true);
    }
  });

  test('keeps the two mockup organizations exactly as the mockup shows them', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});

    const gulf = await t.query(api.organizations.getPublicPage, {
      slug: 'gulf-coast-sport-social',
    });
    expect(gulf).toEqual({
      name: 'Gulf Coast Sport & Social',
      slug: 'gulf-coast-sport-social',
      cityState: 'Corpus Christi, TX',
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
      {
        name: 'Bayside Athletic Complex',
        address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
        sportNames: ['Soccer', 'Softball'],
      },
      {
        name: 'Flour Bluff Softball Park',
        address: '2001 Bluff Diamond Rd, Corpus Christi, TX 78418',
        sportNames: ['Softball'],
      },
      {
        name: 'North Beach Sand Courts',
        address: '3500 Sandcourt Ln, Corpus Christi, TX 78402',
        sportNames: ['Beach volleyball'],
      },
    ]);
    expect(gulfLeagues.rows.map((league) => [league.name, league.divisionLabel])).toEqual([
      ['Coed 7v7 Rec', 'Coed · 7v7 · Rec'],
      ['Men Over-30 11v11', 'Men · 11v11 · Rec · 30+'],
      ['Sunday Reverse Coed 4s', 'Coed · 4v4 · BB'],
      ['Thursday Night Coed 2s', 'Coed · 2v2 · B'],
      ['Wednesday Coed Slow-Pitch', 'Coed · 10v10 · Rec'],
    ]);
    expect(
      gulfLeagues.rows.map((league) => [league.name, league.sportName, league.locationNames]),
    ).toEqual([
      ['Coed 7v7 Rec', 'Soccer', ['Bayside Athletic Complex']],
      ['Men Over-30 11v11', 'Soccer', ['Bayside Athletic Complex']],
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
      cityState: 'Port Aransas, TX',
      leagueCount: 0,
      locationCount: 0,
      sportCount: 0,
      sports: [],
    });
  });

  test('covers every sport in at least 2 organizations, one multi-sport and one empty organization', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
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
    await t.mutation(internal.seed.insertDemoData, {});
    const { organizations } = await snapshot(t);
    for (const { slug } of organizations) {
      const page = await t.query(api.organizations.getPublicPage, { slug });
      expect(page?.slug).toBe(slug);
    }
  });

  test('a second run inserts nothing, returns zero counts, and changes no row', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const before = await snapshot(t);
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test('inserts exactly a missing demo location and a missing demo league, with its links', async () => {
    const t = setup();
    const gulfId = await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
        locations: [
          {
            name: 'Bayside Athletic Complex',
            address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
          },
          {
            name: 'North Beach Sand Courts',
            address: '3500 Sandcourt Ln, Corpus Christi, TX 78402',
          },
        ],
        leagues: [
          {
            name: 'Coed 7v7 Rec',
            sport: 'soccer',
            locations: ['Bayside Athletic Complex'],
            division: defaultDivision('soccer'),
          },
          {
            name: 'Men Over-30 11v11',
            sport: 'soccer',
            locations: ['Bayside Athletic Complex'],
            division: defaultDivision('soccer'),
          },
          {
            name: 'Sunday Reverse Coed 4s',
            sport: 'beachVolleyball',
            locations: ['North Beach Sand Courts'],
            division: defaultDivision('beachVolleyball'),
          },
          {
            name: 'Thursday Night Coed 2s',
            sport: 'beachVolleyball',
            locations: ['North Beach Sand Courts'],
            division: defaultDivision('beachVolleyball'),
          },
        ],
      }),
    );
    const before = await snapshot(t);

    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      organizations: ROWS.organizations - 1,
      locations: ROWS.locations - 2,
      customLevels: ROWS.customLevels,
      leagues: ROWS.leagues - 4,
      seasons: ROWS.seasons,
      tournaments: ROWS.tournaments,
      backfilled: NONE,
    });

    const after = await snapshot(t);
    expect(after.locations.slice(0, before.locations.length)).toEqual(before.locations);
    const withoutSeasonCount = (league: Doc<'leagues'>) => ({ ...league, publishedSeasonCount: 0 });
    expect(after.leagues.slice(0, before.leagues.length).map(withoutSeasonCount)).toEqual(
      before.leagues.map(withoutSeasonCount),
    );
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
    await t.run(async (ctx) => {
      const id = await insertTenant(ctx, {
        organization: { name: 'Front Range Rec Sports', slug: 'front-range-rec-sports' },
        locations: [
          { name: 'Larkspur Turf Center', address: '455 Larkspur Mesa Dr, Lakewood, CO 80228' },
        ],
        leagues: [
          {
            name: 'Coed 6v6 Indoor',
            sport: 'soccer',
            locations: ['Larkspur Turf Center'],
            division: defaultDivision('soccer'),
          },
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
        division: defaultDivision('softball'),
      });
    });
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'front-range-rec-sports',
      name: 'Extra League',
      sport: 'soccer',
      locations: ['Larkspur Turf Center'],
    });

    await t.mutation(internal.seed.insertDemoData, {});

    const { organizations, locations, leagues } = await snapshot(t);
    for (const organization of organizations) {
      expect([organization.slug, organization.leagueCount, organization.locationCount]).toEqual([
        organization.slug,
        leagues.filter((league) => league.organizationId === organization._id).length,
        locations.filter((location) => location.organizationId === organization._id).length,
      ]);
    }
    expect(organizations.find((o) => o.slug === 'front-range-rec-sports')).toMatchObject({
      leagueCount: 7,
      locationCount: 3,
    });
    for (const row of [...locations, ...leagues]) {
      expect(row.sortName, row.name).toBe(row.name.toLowerCase());
    }
    const stored = await sportStored(t);
    expect(stored).toEqual(await sportRecount(t));
    expect(stored['front-range-rec-sports']).toEqual({
      leagues: { soccer: 5, softball: 2 },
      locations: { soccer: 2, softball: 2 },
      rows: [
        'soccer:Cottonwood Creek Fields:2',
        'soccer:Larkspur Turf Center:3',
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
          {
            name: 'Coed 7v7 Rec',
            sport: 'soccer',
            locations: ['Bayside Athletic Complex'],
            division: defaultDivision('soccer'),
          },
        ],
      }),
    );
    const before = await snapshot(t);

    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...ROWS,
      backfilled: NONE,
    });

    const after = await snapshot(t);
    expect(after.organizations[0]).toEqual(before.organizations[0]);
    expect(after.locations[0]).toEqual(before.locations[0]);
    expect(after.leagues[0]).toEqual(before.leagues[0]);
    expect(await counts(t)).toEqual({
      organizations: ROWS.organizations + 1,
      locations: ROWS.locations + 1,
      customLevels: ROWS.customLevels,
      leagues: ROWS.leagues + 1,
      seasons: ROWS.seasons,
      tournaments: ROWS.tournaments,
    });
  });

  test('backfills sortName and the counters on rows written before they existed, once', async () => {
    const t = setup();
    await insertRaw(t);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', {
        ...organizationListFields('Lakeshore Sand League'),
        name: 'Lakeshore Sand League',
        slug: 'lakeshore-sand-league',
      });
      await ctx.db.insert('locations', {
        organizationId,
        name: 'Driftwood Beach Courts',
        address: '2600 Driftwood Shore Dr, Chicago, IL 60614',
      });
    });

    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      organizations: ROWS.organizations - 1,
      locations: ROWS.locations - 1,
      customLevels: ROWS.customLevels,
      leagues: ROWS.leagues,
      seasons: ROWS.seasons,
      tournaments: ROWS.tournaments,
      backfilled: {
        organizations: 2,
        locations: 3,
        leagues: 2,
        teamCounts: 0,
        pendingInviteCounts: 0,
        waitlistCounts: 0,
        staffCounts: 2,
        staffInviteCounts: 2,
        draftLeagueCounts: 2,
      },
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
        {
          name: 'Beta League',
          slug: 'beta-league',
          sportName: 'Softball',
          locationNames: [],
          divisionLabel: 'Coed · 9v9 · Rec',
          seasons: [],
        },
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
          divisionLabel: 'Coed · 4v4 · Rec',
          seasons: [],
        },
        {
          name: 'Beta League',
          slug: 'beta-league',
          sportName: 'Softball',
          locationNames: [],
          divisionLabel: 'Coed · 9v9 · Rec',
          seasons: [],
        },
      ],
      page: 1,
      pageCount: 1,
      total: 2,
    });

    const before = await snapshot(t);
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test('backfills only the sport counters and sportLocations rows on an organization that has the league and location counts, once', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', {
        ...organizationListFields('Mid Club'),
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
        await insertLeagueWithProgram(ctx, {
          ...leagueRequiredFields(sport, name),
          organizationId,
          name,
          slug: name.toLowerCase(),
          sport,
          locationIds: [...locationIds],
          sortName: name.toLowerCase(),
        });
      }
    });

    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...ROWS,
      backfilled: {
        ...NONE,
        organizations: 1,
        leagues: 3,
        staffCounts: 1,
        staffInviteCounts: 1,
        draftLeagueCounts: 1,
      },
    });
    expect((await sportStored(t))['mid-club']).toEqual({
      leagues: { soccer: 2, softball: 1 },
      locations: { soccer: 2, softball: 1 },
      rows: ['soccer:Field A:2', 'soccer:Field B:1', 'softball:Field B:1'],
    });
    expect(await sportStored(t)).toEqual(await sportRecount(t));

    const before = await snapshot(t);
    const rowsBefore = await t.run((ctx) => ctx.db.query('sportLocations').collect());
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
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
      await expect(t.mutation(internal.seed.insertDemoData, {})).rejects.toThrow(
        /PREVIEW_ORIGIN_PATTERN/,
      );
      expect(await snapshot(t)).toEqual(before);
    },
  );

  test('runs without IS_TEST (previews and staging never set it)', async () => {
    vi.stubEnv('IS_TEST', undefined);
    const t = setup();
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual(FULL);
  });

  test('every export is an internal function, so no client can call it', () => {
    const {
      DEMO,
      DEMO_SEASONS,
      DEMO_RUN_SEASONS,
      DEMO_TOURNAMENTS,
      DEMO_ACCOUNTS,
      DEMO_ACCOUNT_DOMAIN,
      DEMO_TEAM_SEASON,
      DEMO_CAPTAINS,
      DEMO_TEAMS,
      DEMO_TOURNAMENT,
      DEMO_TOURNAMENT_TEAMS,
      DEMO_FULL_SEASON,
      DEMO_FULL_SEASON_TEAMS,
      DEMO_WAITLIST_ENTRY,
      DEMO_FREE_AGENT_PEOPLE,
      DEMO_FREE_AGENTS,
      ...functions
    } = seed;
    expect(Array.isArray(DEMO)).toBe(true);
    expect(Array.isArray(DEMO_SEASONS)).toBe(true);
    expect(Array.isArray(DEMO_RUN_SEASONS)).toBe(true);
    expect(Array.isArray(DEMO_TOURNAMENTS)).toBe(true);
    expect(Object.keys(DEMO_ACCOUNTS)).toEqual([
      'admin',
      'organizer',
      'player',
      'captain',
      'guardian',
    ]);
    expect(DEMO_ACCOUNT_DOMAIN).toBe('demo.omni-league.test');
    expect(DEMO_TEAM_SEASON.seasonSlug).toBe('summer-2027');
    expect(DEMO_CAPTAINS).toHaveLength(3);
    expect(DEMO_TEAMS).toHaveLength(4);
    expect(DEMO_TOURNAMENT.tournamentSlug).toBe('gulf-coast-beach-open');
    expect(DEMO_TOURNAMENT_TEAMS.map((team) => team.name)).toEqual([
      'Sand Crabs',
      'Beach Bombers',
      'Set Point',
      'Spike Squad',
    ]);
    expect(DEMO_TOURNAMENT_TEAMS[0]?.captainEmail).toBe(`player@${DEMO_ACCOUNT_DOMAIN}`);
    expect(DEMO_FULL_SEASON.leagueSlug).toBe('thursday-night-coed-2s');
    expect(DEMO_FULL_SEASON_TEAMS).toHaveLength(2);
    expect(DEMO_WAITLIST_ENTRY.teamName).toBe('Late Lobsters');
    expect(DEMO_FREE_AGENT_PEOPLE).toHaveLength(3);
    expect(DEMO_FREE_AGENTS).toHaveLength(5);
    const exports = Object.entries(functions);
    expect(exports.map(([name]) => name).sort()).toEqual([
      'demo',
      'demoLogoNeeded',
      'findDemoCredential',
      'findFictionalDemoUser',
      'grantDemoMemberships',
      'insertDemoData',
      'insertDemoFreeAgents',
      'insertDemoInvite',
      'insertDemoMinor',
      'insertDemoTeamInvites',
      'insertDemoTeamPlayer',
      'insertDemoTeams',
      'insertDemoTournamentInvites',
      'setDemoLogo',
    ]);
    for (const [name, fn] of exports) {
      const markers = fn as Partial<Record<'isInternal' | 'isPublic', boolean>>;
      expect({ name, isInternal: markers.isInternal }).toEqual({ name, isInternal: true });
      expect({ name, isPublic: markers.isPublic }).toEqual({ name, isPublic: undefined });
    }
  });
});

describe('seed:demo league search text', () => {
  test('every demo league holds its sport name and every word of the division label its row shows', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const held = await t.run(async (ctx) => {
      const leagues = await ctx.db.query('leagues').collect();
      return Promise.all(
        leagues.map(async (league) => ({
          name: league.name,
          words: searchWords(league.searchText),
          sport: searchWords(sportName(league.sport)),
          label: searchWords(await leagueDivisionLabel(ctx, league)),
        })),
      );
    });
    expect(held).toHaveLength(ROWS.leagues);
    for (const { name, words, sport, label } of held) {
      expect(label.length, name).toBeGreaterThan(0);
      expect(
        [...sport, ...label].filter((word) => !words.includes(word)),
        name,
      ).toEqual([]);
    }
  });
});

describe('seed:demo league programs', () => {
  test('every demo league has one program row equal to it, in its own organization, and a second run adds none', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    await t.mutation(internal.seed.insertDemoData, {});
    const { leagues, programs } = await t.run(async (ctx) => ({
      leagues: await ctx.db.query('leagues').collect(),
      programs: (await ctx.db.query('programs').collect()).filter(
        (program) => program.type === 'league',
      ),
    }));
    expect(programs).toHaveLength(ROWS.leagues);
    for (const league of leagues) {
      const matching = programs.filter((program) => program.leagueId === league._id);
      expect(matching, league.name).toHaveLength(1);
      expect(league.programId, league.name).toBe(matching[0]._id);
      expect(matching[0], league.name).toMatchObject({
        organizationId: league.organizationId,
        type: 'league',
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        status: league.status,
        gender: league.gender,
        playersPerSide: league.playersPerSide,
        level: league.level,
        ageGroup: league.ageGroup,
      });
    }
  });
});

describe('seed:demo tournaments', () => {
  async function winterDoublesClassic(t: T, slug = 'winter-doubles-classic') {
    return t.run(async (ctx) => {
      const organization = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'gulf-coast-sport-social'))
        .unique();
      const program = await ctx.db
        .query('programs')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organization!._id).eq('slug', slug),
        )
        .unique();
      const tournaments = await ctx.db.query('tournaments').collect();
      const location = await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organization!._id).eq('name', 'North Beach Sand Courts'),
        )
        .unique();
      return {
        organizationId: organization!._id,
        location: location!._id,
        program,
        tournaments,
        tournament: tournaments.find((row) => row.programId === program?._id),
      };
    });
  }

  test('adds the draft Winter Doubles Classic of Gulf Coast Sport & Social, dated after the run, and a second run adds none', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const second = await t.mutation(internal.seed.insertDemoData, {});
    expect(second.tournaments).toBe(0);
    const { organizationId, location, program, tournaments, tournament } =
      await winterDoublesClassic(t);
    expect(tournaments).toHaveLength(2);
    expect(program).toMatchObject({
      organizationId,
      type: 'tournament',
      name: 'Winter Doubles Classic',
      sport: 'beachVolleyball',
      status: 'draft',
      locationIds: [location],
      gender: 'coed',
      playersPerSide: 2,
      level: 'open',
      ageGroup: 'adult',
    });
    expect(tournament).toMatchObject({
      organizationId,
      maximumTeams: 16,
      minimumRosterSize: 2,
      structure: 'bracket',
      bracketType: 'single',
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(tournament!.registrationDeadline > today).toBe(true);
    expect(tournament!.startDate > tournament!.registrationDeadline).toBe(true);
    expect(tournament!.endDate >= tournament!.startDate).toBe(true);
  });

  test('adds the published Gulf Coast Beach Open with registration open, and its public page answers', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const { organizationId, location, program, tournament } = await winterDoublesClassic(
      t,
      'gulf-coast-beach-open',
    );
    expect(program).toMatchObject({
      organizationId,
      type: 'tournament',
      name: 'Gulf Coast Beach Open',
      sport: 'beachVolleyball',
      status: 'published',
      locationIds: [location],
      gender: 'coed',
      playersPerSide: 2,
      level: 'open',
      ageGroup: 'adult',
    });
    expect(tournament).toMatchObject({ organizationId, maximumTeams: 16, minimumRosterSize: 2 });
    expect(registrationIsOpen(tournament!, Date.now())).toBe(true);
    expect(tournament!.startDate > tournament!.registrationDeadline).toBe(true);
    expect(tournament!.endDate >= tournament!.startDate).toBe(true);
    expect(
      await t.query(api.tournaments.getPublicPage, {
        orgSlug: 'gulf-coast-sport-social',
        tournamentSlug: 'gulf-coast-beach-open',
      }),
    ).toMatchObject({
      name: 'Gulf Coast Beach Open',
      divisionLabel: 'Coed · 2v2 · Open',
      locations: [{ name: 'North Beach Sand Courts' }],
    });
  });

  test('lists Gulf Coast Beach Open, not the draft, on the page and the beach volleyball view of Gulf Coast Sport & Social, and among its open registrations', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const slug = 'gulf-coast-sport-social';
    const beach = { organizationSlug: slug, page: 1, sport: 'beachVolleyball' as const };
    const names = (rows: { name: string }[]) => rows.map((row) => row.name);
    expect(
      names((await t.query(api.tournaments.listPublic, { organizationSlug: slug, page: 1 })).rows),
    ).toEqual(['Gulf Coast Beach Open']);
    expect(names((await t.query(api.tournaments.listPublic, beach)).rows)).toEqual([
      'Gulf Coast Beach Open',
    ]);
    expect((await t.query(api.tournaments.listPublic, { ...beach, sport: 'soccer' })).rows).toEqual(
      [],
    );
    expect(
      names(await t.query(api.tournaments.listOpenForOrganization, { organizationSlug: slug })),
    ).toEqual(['Gulf Coast Beach Open']);
  });

  test('adds only the tournament whose web address is free where a program holds the other', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await insertTenant(ctx, {
        organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
        locations: [{ name: 'North Beach Sand Courts', address: '1 Sand Ln' }],
        leagues: [
          {
            name: 'Winter Doubles Classic',
            sport: 'beachVolleyball',
            locations: ['North Beach Sand Courts'],
            division: defaultDivision('beachVolleyball'),
          },
        ],
      });
    });
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.tournaments).toBe(1);
    const held = await winterDoublesClassic(t);
    expect(held.tournaments).toHaveLength(1);
    expect(held.program?.type).toBe('league');
  });
});

describe('seed:demo backfill against a recount', () => {
  async function expectCountersMatchRecount(t: T) {
    const { organizations, locations, leagues } = await snapshot(t);
    for (const organization of organizations) {
      expect([organization.slug, organization.leagueCount, organization.locationCount]).toEqual([
        organization.slug,
        leagues.filter((league) => league.organizationId === organization._id).length,
        locations.filter((location) => location.organizationId === organization._id).length,
      ]);
    }
    for (const organization of organizations) {
      expect([organization.slug, organization.draftLeagueCount]).toEqual([
        organization.slug,
        leagues.filter(
          (league) => league.organizationId === organization._id && league.status === 'draft',
        ).length,
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

    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.backfilled).toEqual({
      organizations: 1,
      locations: 2,
      leagues: 2,
      teamCounts: 0,
      pendingInviteCounts: 0,
      waitlistCounts: 0,
      staffCounts: 1,
      staffInviteCounts: 1,
      draftLeagueCounts: 1,
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
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(result.backfilled.organizations).toBe(1);
    await expectCountersMatchRecount(t);
  });

  test('three runs after mixed writes keep every counter equal to a recount', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await insertRaw(t);
    await t.mutation(internal.seed.insertDemoData, {});
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'gulf-coast-sport-social',
      name: 'Extra Gulf League',
      sport: 'soccer',
      locations: ['Bayside Athletic Complex'],
    });
    for (let run = 0; run < 3; run++) {
      await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
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

describe('seed:demo and league status', () => {
  test('a legacy league without a status becomes published before the recount, a draft stays out of it, and a second run changes nothing', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const bare = await ctx.db.insert('organizations', {
        ...organizationListFields('Bare Club'),
        name: 'Bare Club',
        slug: 'bare-club',
      });
      const field = await ctx.db.insert('locations', {
        organizationId: bare,
        name: 'Bare Field',
        address: '1 Road',
      });
      await insertLeagueWithProgram(ctx, {
        ...leagueRequiredFields('soccer', 'Legacy One'),
        organizationId: bare,
        name: 'Legacy One',
        slug: 'legacy-one',
        sport: 'soccer',
        locationIds: [field],
      });
      await insertLeagueWithProgram(ctx, {
        ...leagueRequiredFields('softball', 'Legacy Draft'),
        organizationId: bare,
        name: 'Legacy Draft',
        slug: 'legacy-draft',
        sport: 'softball',
        locationIds: [field],
        status: 'draft',
      });
      const counted = await ctx.db.insert('organizations', {
        ...organizationListFields('Counted Club'),
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
      await insertLeagueWithProgram(ctx, {
        ...leagueRequiredFields('soccer', 'Counted League'),
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

    const first = await t.mutation(internal.seed.insertDemoData, {});
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
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await snapshot(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query('sportLocations').collect())).toEqual(rowsBefore);
  });
});

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

describe('seed:demo seasons dated from the run', () => {
  const seasonsOf = (t: T, slug: string) =>
    t.run(async (ctx) => {
      const found = [];
      for (const season of await ctx.db.query('seasons').collect()) {
        if (season.slug !== slug) continue;
        const league = (await ctx.db.get('leagues', season.leagueId))!;
        found.push({ league: league.slug, season });
      }
      return found;
    });

  test('puts one demo season in progress, one with registration closed and one ended, whenever it runs', async () => {
    for (const run of [RUN, Date.UTC(2027, 2, 3, 18), Date.UTC(2028, 1, 29, 18)]) {
      vi.setSystemTime(run);
      const t = setup();
      await t.mutation(internal.seed.insertDemoData, {});
      const [current] = await seasonsOf(t, 'current-season');
      const [next] = await seasonsOf(t, 'next-season');
      const [past] = await seasonsOf(t, 'past-season');
      expect(current?.league, String(run)).toBe('sunday-reverse-coed-4s');
      expect(seasonPhase(current.season, run), String(run)).toBe('inProgress');
      expect(next?.league, String(run)).toBe('coed-7v7-rec');
      expect(seasonPhase(next.season, run), String(run)).toBe('registrationClosed');
      expect(past?.league, String(run)).toBe('coed-7v7-rec');
      expect(seasonPhase(past.season, run), String(run)).toBe('ended');
      expect(current?.season.status).toBe('published');
      expect(next?.season.status).toBe('published');
      expect(past?.season.status).toBe('published');
    }
  });

  test('keeps the Summer 2027 seasons of the three leagues open for registration beside them', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const published = await t.query(api.seasons.listOpenForOrganization, {
      orgSlug: 'gulf-coast-sport-social',
    });
    const open = published.filter((season) => registrationIsOpen(season, RUN));
    expect(open.map((season) => [season.league.slug, season.slug])).toEqual([
      ['sunday-reverse-coed-4s', 'summer-2027'],
      ['thursday-night-coed-2s', 'summer-2027'],
      ['coed-7v7-rec', 'summer-2027'],
    ]);
  });

  test('gives the closed demo season a later open season of its league to link to, and the open one its address and division', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const slugs = { orgSlug: 'gulf-coast-sport-social', leagueSlug: 'coed-7v7-rec' };
    const closed = await t.query(api.seasons.getPublicPage, {
      ...slugs,
      seasonSlug: 'next-season',
    });
    const upcoming = closed?.league.upcomingSeasons ?? [];
    expect(upcoming.map((season) => season.slug)).toContain('summer-2027');
    const next = upcoming.find(
      (season) => season.slug !== 'next-season' && registrationIsOpen(season, RUN),
    );
    expect(next?.slug).toBe('summer-2027');
    const open = await t.query(api.seasons.getPublicPage, { ...slugs, seasonSlug: 'summer-2027' });
    expect(open?.league.locations?.[0]?.address).toMatch(/Corpus Christi/);
    expect(open?.league.divisionLabel).toBe('Coed · 7v7 · Rec');
  });

  test('shows the public league pages their card, statuses, and empty state', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const orgSlug = 'gulf-coast-sport-social';
    const sunday = await t.query(api.leagues.getPublicPage, {
      orgSlug,
      leagueSlug: 'sunday-reverse-coed-4s',
    });
    const phases = (sunday?.seasons ?? []).map((season) => [season.slug, seasonPhase(season, RUN)]);
    expect(phases).toEqual([
      ['summer-2027', 'registrationOpen'],
      ['current-season', 'inProgress'],
    ]);
    const coed = await t.query(api.leagues.getPublicPage, {
      orgSlug,
      leagueSlug: 'coed-7v7-rec',
    });
    expect(coed?.seasons?.map((season) => [season.slug, seasonPhase(season, RUN)])).toEqual([
      ['summer-2027', 'registrationOpen'],
      ['next-season', 'registrationClosed'],
      ['past-season', 'ended'],
    ]);
    const overThirty = await t.query(api.leagues.getPublicPage, {
      orgSlug,
      leagueSlug: 'men-over-30-11v11',
    });
    expect(overThirty?.seasons).toEqual([]);
  });

  test('is insert-only: a later run changes no date, so staging keeps the phases of its first run', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const first = await seasonsOf(t, 'current-season');
    vi.setSystemTime(RUN + 90 * 24 * 60 * 60 * 1000);
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toEqual({
      ...NO_ROWS,
      backfilled: NONE,
    });
    expect(await seasonsOf(t, 'current-season')).toEqual(first);
  });
});

const DEMO_CITY_STATES: Readonly<Record<string, string>> = {
  'gulf-coast-sport-social': 'Corpus Christi, TX',
  'port-aransas-beach-volleyball-club': 'Port Aransas, TX',
  'front-range-rec-sports': 'Denver, CO',
  'lakeshore-sand-league': 'Chicago, IL',
  'saguaro-valley-softball': 'Phoenix, AZ',
  'rockport-sand-volleyball': 'Rockport, TX',
  'confluence-sport-social': 'Sacramento, CA',
};

describe('seed:demo divisions on an empty deployment', () => {
  test('inserts each demo organization with its City, state', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const rows = await t.run((ctx) => ctx.db.query('organizations').collect());
    expect(Object.fromEntries(rows.map((row) => [row.slug, row.cityState ?? null]))).toEqual(
      DEMO_CITY_STATES,
    );
  });

  test('gives every demo league its division, and the custom level to the league that uses it', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});

    const stored = await t.run(async (ctx) => {
      const organizations = await ctx.db.query('organizations').collect();
      const leagues = await ctx.db.query('leagues').collect();
      return leagues.map((league) => ({
        organization: organizations.find((o) => o._id === league.organizationId)!.slug,
        league,
      }));
    });
    const demoLeagues = seed.DEMO.flatMap((tenant) =>
      tenant.leagues.map((league) => ({ organization: tenant.organization.slug, league })),
    );
    expect(stored).toHaveLength(demoLeagues.length);
    for (const { organization, league } of demoLeagues) {
      const row = stored.find(
        (entry) => entry.organization === organization && entry.league.name === league.name,
      )?.league;
      expect(row, league.name).toMatchObject({
        gender: league.division.gender,
        playersPerSide: league.division.playersPerSide,
        level: league.division.level,
        ageGroup: league.division.ageGroup,
      });
    }

    const levels = await t.run((ctx) => ctx.db.query('customLevels').collect());
    expect(levels).toEqual([
      expect.objectContaining({ name: 'D', standardLevel: 'rec', sport: 'softball' }),
    ]);
    const used = stored.filter((entry) => entry.league.customLevelId !== undefined);
    expect(used.map((entry) => [entry.organization, entry.league.name])).toEqual([
      ['saguaro-valley-softball', 'Men D Division Slow-Pitch'],
    ]);
    expect(used[0].league.customLevelId).toBe(levels[0]._id);
    expect(levels[0].organizationId).toBe(used[0].league.organizationId);
  });

  test('raises the minimum roster size of Coed 6v6 Indoor to 8 and adds the youth league U10 Girls Fall Rec', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const { leagues, frontRange } = await t.run(async (ctx) => ({
      leagues: await ctx.db.query('leagues').collect(),
      frontRange: await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'front-range-rec-sports'))
        .unique(),
    }));
    expect(
      leagues.find(
        (league) => league.name === 'Coed 6v6 Indoor' && league.organizationId === frontRange?._id,
      ),
    ).toMatchObject({
      playersPerSide: 6,
      minimumRosterSize: 8,
    });
    const youth = leagues.find((league) => league.name === 'U10 Girls Fall Rec');
    expect(youth).toMatchObject({
      gender: 'womens',
      playersPerSide: 7,
      level: 'rec',
      ageGroup: 'u10',
      sport: 'soccer',
    });
    const location = await t.run((ctx) => ctx.db.get('locations', youth!.locationIds[0]));
    expect(location?.name).toBe('Cottonwood Creek Fields');
    expect(leagues.filter((league) => league.minimumRosterSize !== undefined)).toHaveLength(1);
  });

  test('adds the youth league U10 Girls Select, a second one at a different location, so the youth filters list two', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const { leagues, frontRange } = await t.run(async (ctx) => ({
      leagues: await ctx.db.query('leagues').collect(),
      frontRange: await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'front-range-rec-sports'))
        .unique(),
    }));
    const select = leagues.find((league) => league.name === 'U10 Girls Select');
    expect(select).toMatchObject({
      organizationId: frontRange?._id,
      gender: 'womens',
      playersPerSide: 7,
      level: 'competitive',
      ageGroup: 'u10',
      sport: 'soccer',
      status: 'published',
    });
    const location = await t.run((ctx) => ctx.db.get('locations', select!.locationIds[0]));
    expect(location?.name).toBe('Larkspur Turf Center');
    const youth = leagues.filter(
      (league) => league.sport === 'soccer' && league.ageGroup === 'u10',
    );
    expect(youth.map((league) => league.name).sort()).toEqual([
      'U10 Girls Fall Rec',
      'U10 Girls Select',
    ]);
  });

  test('the demo seasons store players per side and no format', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const seasons = await t.run((ctx) => ctx.db.query('seasons').collect());
    expect(seasons.map((row) => formatLabel(row.playersPerSide)).sort()).toEqual([
      '2v2',
      '4v4',
      '4v4',
      '4v4',
      '7v7',
      '7v7',
      '7v7',
      '7v7',
    ]);
    for (const row of seasons) expect(row).not.toHaveProperty('format');
  });
});
