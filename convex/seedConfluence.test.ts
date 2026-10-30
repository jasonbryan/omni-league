/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import {
  deriveDivisionFromName,
  type AgeGroup,
  type Gender,
  type StandardLevel,
} from './lib/divisions';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import type { Sport } from './lib/sports';
import schema from './schema';
import { DEMO } from './seed';
import { modules } from './test.setup';

const SLUG = 'confluence-sport-social';

function setup() {
  return convexTest(schema, modules);
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const LOCATIONS: readonly (readonly [name: string, address: string])[] = [
  ['American River Sand Courts', '2150 Riverbend Levee Rd, Sacramento, CA 95833'],
  ['Arden Oaks Fields', '4810 Arden Hollow Dr, Sacramento, CA 95821'],
  ['Bridgeway Softball Complex', '900 Bridgeway Landing Blvd, West Sacramento, CA 95691'],
  ['Capitol Grove Turf Center', '1730 Capitol Grove Way, Sacramento, CA 95814'],
  ['Cosumnes Meadow Park', '9055 Meadowlark Bend Rd, Elk Grove, CA 95624'],
  ['Delta Breeze Fields', '3340 Delta Breeze Way, Sacramento, CA 95834'],
  ['Heron Marsh Fields', '5125 Heron Marsh Rd, Sacramento, CA 95823'],
  ['Juniper Glen Diamonds', '2860 Juniper Glen Dr, Roseville, CA 95661'],
  ['Lakeshore Cove Sand Courts', '8410 Lakeshore Cove Rd, Folsom, CA 95630'],
  ['Mallard Point Park', '4475 Mallard Point Ln, Elk Grove, CA 95758'],
  ['Oak Hollow Diamonds', '7120 Oak Hollow Ct, Citrus Heights, CA 95610'],
  ['Pocket Bend Sand Courts', '6600 Pocket Bend Dr, Sacramento, CA 95831'],
  ['Riverside Landing Softball Park', '1980 Landing Pier Rd, West Sacramento, CA 95605'],
  ['Sunrise Ridge Turf', '10250 Sunrise Ridge Pkwy, Rancho Cordova, CA 95670'],
];

interface ExpectedLeague {
  name: string;
  sport: Sport;
  gender: Gender;
  playersPerSide: number;
  level: StandardLevel;
  ageGroup: AgeGroup;
  label: string;
  locations: readonly string[];
}

function league(
  name: string,
  sport: Sport,
  label: string,
  [gender, playersPerSide, level, ageGroup = 'adult']: readonly [
    Gender,
    number,
    StandardLevel,
    AgeGroup?,
  ],
  locations: readonly string[],
): ExpectedLeague {
  return { name, sport, gender, playersPerSide, level, ageGroup, label, locations };
}

const LEAGUES: readonly ExpectedLeague[] = [
  league(
    'Coed 6v6 Indoor',
    'soccer',
    'Coed · 6v6 · Rec',
    ['coed', 6, 'rec'],
    ['Arden Oaks Fields'],
  ),
  league(
    'Coed 7v7 Rec',
    'soccer',
    'Coed · 7v7 · Rec',
    ['coed', 7, 'rec'],
    ['Capitol Grove Turf Center', 'Heron Marsh Fields'],
  ),
  league(
    'Coed 9v9 Twilight',
    'soccer',
    'Coed · 9v9 · Intermediate',
    ['coed', 9, 'intermediate'],
    ['Heron Marsh Fields'],
  ),
  league(
    'Coed Slow-Pitch Sundays',
    'softball',
    'Coed · 10v10 · Rec',
    ['coed', 10, 'rec'],
    ['Bridgeway Softball Complex'],
  ),
  league(
    'Competitive Coed 6s',
    'beachVolleyball',
    'Coed · 6v6 · AA',
    ['coed', 6, 'aa'],
    ['American River Sand Courts'],
  ),
  league(
    "Competitive Men's 2s",
    'beachVolleyball',
    "Men's · 2v2 · Open",
    ['mens', 2, 'open'],
    ['Lakeshore Cove Sand Courts', 'Pocket Bend Sand Courts'],
  ),
  league(
    "Competitive Men's Fast-Pitch",
    'softball',
    "Men's · 9v9 · Competitive",
    ['mens', 9, 'competitive'],
    ['Oak Hollow Diamonds'],
  ),
  league(
    'Friday Night Coed 4s',
    'beachVolleyball',
    'Coed · 4v4 · B',
    ['coed', 4, 'b'],
    ['Pocket Bend Sand Courts'],
  ),
  league(
    'Intermediate Coed Slow-Pitch',
    'softball',
    'Coed · 10v10 · Intermediate',
    ['coed', 10, 'intermediate'],
    ['Juniper Glen Diamonds', 'Cosumnes Meadow Park'],
  ),
  league(
    "Men's 11v11 Competitive",
    'soccer',
    "Men's · 11v11 · Competitive",
    ['mens', 11, 'competitive'],
    ['Delta Breeze Fields'],
  ),
  league(
    "Men's Over-40 7v7",
    'soccer',
    "Men's · 7v7 · Rec · 40+",
    ['mens', 7, 'rec', 'over40'],
    ['Sunrise Ridge Turf'],
  ),
  league(
    'Monday Coed 4s',
    'beachVolleyball',
    'Coed · 4v4 · BB',
    ['coed', 4, 'bb'],
    ['American River Sand Courts'],
  ),
  league(
    'Monday Coed Slow-Pitch',
    'softball',
    'Coed · 10v10 · Rec',
    ['coed', 10, 'rec'],
    ['Riverside Landing Softball Park'],
  ),
  league(
    'Reverse Coed 4s',
    'beachVolleyball',
    'Coed · 4v4 · Rec',
    ['coed', 4, 'rec'],
    ['Lakeshore Cove Sand Courts'],
  ),
  league(
    'Saturday Coed 6s',
    'beachVolleyball',
    'Coed · 6v6 · Rec',
    ['coed', 6, 'rec'],
    ['American River Sand Courts', 'Pocket Bend Sand Courts'],
  ),
  league(
    "Sunday Men's Over-50 Slow-Pitch",
    'softball',
    "Men's · 10v10 · Rec · 50+",
    ['mens', 10, 'rec', 'over50'],
    ['Bridgeway Softball Complex', 'Riverside Landing Softball Park'],
  ),
  league(
    "Sunday Women's 2s",
    'beachVolleyball',
    "Women's · 2v2 · A",
    ['womens', 2, 'a'],
    ['Lakeshore Cove Sand Courts'],
  ),
  league(
    'Thursday Coed 2s',
    'beachVolleyball',
    'Coed · 2v2 · B',
    ['coed', 2, 'b'],
    ['Lakeshore Cove Sand Courts'],
  ),
  league(
    "Thursday Men's 4s",
    'beachVolleyball',
    "Men's · 4v4 · BB",
    ['mens', 4, 'bb'],
    ['American River Sand Courts'],
  ),
  league(
    "Tuesday Open Men's 2s",
    'beachVolleyball',
    "Men's · 2v2 · Open",
    ['mens', 2, 'open'],
    ['Pocket Bend Sand Courts'],
  ),
  league(
    'U12 Boys Fall Rec',
    'soccer',
    'Boys · 9v9 · Rec · U12',
    ['mens', 9, 'rec', 'u12'],
    ['Cosumnes Meadow Park', 'Mallard Point Park'],
  ),
  league(
    "Wednesday Women's 4s",
    'beachVolleyball',
    "Women's · 4v4 · B",
    ['womens', 4, 'b'],
    ['Pocket Bend Sand Courts'],
  ),
  league(
    "Women's 7v7 Intermediate",
    'soccer',
    "Women's · 7v7 · Intermediate",
    ['womens', 7, 'intermediate'],
    ['Mallard Point Park'],
  ),
  league(
    "Women's A 6s",
    'beachVolleyball',
    "Women's · 6v6 · A",
    ['womens', 6, 'a'],
    ['American River Sand Courts'],
  ),
  league(
    "Women's Modified Fast-Pitch",
    'softball',
    "Women's · 9v9 · Intermediate",
    ['womens', 9, 'intermediate'],
    ['Oak Hollow Diamonds'],
  ),
  league(
    "Women's Sunday 11v11",
    'soccer',
    "Women's · 11v11 · Competitive",
    ['womens', 11, 'competitive'],
    ['Capitol Grove Turf Center'],
  ),
];

const confluence = () => {
  const tenant = DEMO.find(({ organization }) => organization.slug === SLUG);
  if (!tenant) throw new Error('Confluence Sport & Social is not in DEMO');
  return tenant;
};

async function seeded() {
  const t = setup();
  await t.mutation(internal.seed.insertDemoData, {});
  return t;
}

describe('Confluence Sport & Social demo organization', () => {
  test('is the last entry of DEMO, so the first four stay the ones the PWA e2e takes', () => {
    expect(DEMO.at(-1)?.organization).toEqual({
      name: 'Confluence Sport & Social',
      slug: SLUG,
      cityState: 'Sacramento, CA',
    });
  });

  test('has 14 locations and 26 leagues, in name order', () => {
    expect(confluence().locations.map(({ name, address }) => [name, address])).toEqual(
      LOCATIONS.map(([name, address]) => [name, address]),
    );
    expect(confluence().leagues.map((entry) => entry.name)).toEqual(
      LEAGUES.map((entry) => entry.name),
    );
  });

  test('each league names its own locations and holds the division of its table row', () => {
    const locationNames = new Set(confluence().locations.map((location) => location.name));
    for (const expected of LEAGUES) {
      const row = confluence().leagues.find((entry) => entry.name === expected.name);
      expect(row, expected.name).toMatchObject({
        sport: expected.sport,
        locations: expected.locations,
        division: {
          gender: expected.gender,
          playersPerSide: expected.playersPerSide,
          level: expected.level,
          ageGroup: expected.ageGroup,
        },
      });
      expect(row?.division?.customLevel, expected.name).toBeUndefined();
      for (const name of row?.locations ?? []) expect(locationNames.has(name), name).toBe(true);
    }
  });

  test('every value deriveDivisionFromName reads from a league name equals the stored one', () => {
    for (const entry of confluence().leagues) {
      const derived = deriveDivisionFromName(entry.name, entry.sport);
      const stored = entry.division;
      for (const field of ['gender', 'playersPerSide', 'level'] as const) {
        if (derived[field] !== undefined) {
          expect({ name: entry.name, field, value: stored?.[field] }).toEqual({
            name: entry.name,
            field,
            value: derived[field],
          });
        }
      }
    }
  });

  test('each sport covers all three genders, two or more players-per-side values, and two or more levels', () => {
    for (const sport of ['beachVolleyball', 'soccer', 'softball'] as const) {
      const divisions = confluence()
        .leagues.filter((entry) => entry.sport === sport)
        .map((entry) => entry.division);
      expect(new Set(divisions.map((d) => d?.gender)).size, sport).toBe(3);
      expect(new Set(divisions.map((d) => d?.playersPerSide)).size, sport).toBeGreaterThanOrEqual(
        2,
      );
      expect(new Set(divisions.map((d) => d?.level)).size, sport).toBeGreaterThanOrEqual(2);
    }
    const levels = new Set(
      confluence()
        .leagues.filter((entry) => entry.sport === 'beachVolleyball')
        .map((entry) => entry.division?.level),
    );
    expect([...levels].sort()).toEqual(['a', 'aa', 'b', 'bb', 'open', 'rec']);
  });

  test('a seeded deployment holds its counters and the sport counters', async () => {
    const t = await seeded();
    const row = await t.run((ctx) =>
      ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', SLUG))
        .unique(),
    );
    expect(row).toMatchObject({
      name: 'Confluence Sport & Social',
      cityState: 'Sacramento, CA',
      leagueCount: 26,
      locationCount: 14,
      sportLeagueCounts: { beachVolleyball: 12, soccer: 8, softball: 6 },
      sportLocationCounts: { beachVolleyball: 3, soccer: 7, softball: 5 },
    });
    expect(await t.query(api.organizations.getPublicPage, { slug: SLUG })).toMatchObject({
      leagueCount: 26,
      locationCount: 14,
      sportCount: 3,
    });
  });

  test('stores no custom level and no season for it', async () => {
    const t = await seeded();
    const rows = await t.run(async (ctx) => {
      const organization = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', SLUG))
        .unique();
      return {
        customLevels: (await ctx.db.query('customLevels').collect()).filter(
          (level) => level.organizationId === organization?._id,
        ),
        seasons: (await ctx.db.query('seasons').collect()).filter(
          (season) => season.organizationId === organization?._id,
        ),
      };
    });
    expect(rows).toEqual({ customLevels: [], seasons: [] });
  });

  test('lists leagues 1 to 5 on page 1 of 6', async () => {
    const t = await seeded();
    const page = await t.query(api.organizations.listPublicLeagues, { slug: SLUG, page: 1 });
    expect(page).toMatchObject({ page: 1, pageCount: 6, total: 26 });
    expect(page.rows.map((row) => [row.name, row.divisionLabel, row.locationNames])).toEqual(
      LEAGUES.slice(0, 5).map((entry) => [entry.name, entry.label, entry.locations]),
    );
  });

  test('lists the five first beach volleyball leagues on page 1 of 3', async () => {
    const t = await seeded();
    const page = await t.query(api.organizations.listPublicLeagues, {
      slug: SLUG,
      page: 1,
      sport: 'beachVolleyball',
    });
    expect(page).toMatchObject({ page: 1, pageCount: 3, total: 12 });
    expect(page.rows.map((row) => row.name)).toEqual([
      'Competitive Coed 6s',
      "Competitive Men's 2s",
      'Friday Night Coed 4s',
      'Monday Coed 4s',
      'Reverse Coed 4s',
    ]);
  });

  test('lists the soccer and softball leagues over 2 pages', async () => {
    const t = await seeded();
    for (const [sport, total, pageCount] of [
      ['soccer', 8, 2],
      ['softball', 6, 2],
    ] as const) {
      expect(
        await t.query(api.organizations.listPublicLeagues, { slug: SLUG, page: 1, sport }),
      ).toMatchObject({ pageCount, total });
    }
  });

  test('lists locations 1 to 5 on page 1 of 3, and locations 11 to 14 on page 3', async () => {
    const t = await seeded();
    const first = await t.query(api.organizations.listPublicLocations, { slug: SLUG, page: 1 });
    expect(first).toMatchObject({ page: 1, pageCount: 3, total: 14 });
    expect(first.rows.map((row) => [row.name, row.address])).toEqual(LOCATIONS.slice(0, 5));
    const last = await t.query(api.organizations.listPublicLocations, { slug: SLUG, page: 3 });
    expect(last.rows.map((row) => [row.name, row.address])).toEqual(LOCATIONS.slice(10));
  });

  test('is first on page 1 of the organizations list, and Saguaro Valley Softball is alone on page 2', async () => {
    const t = await seeded();
    const first = await t.query(api.search.organizations, { page: 1 });
    expect(first.pageCount).toBe(2);
    expect(first.rows.map((row) => row.name)).toEqual([
      'Confluence Sport & Social',
      'Front Range Rec Sports',
      'Gulf Coast Sport & Social',
      'Lakeshore Sand League',
      'Rockport Sand Volleyball',
    ]);
    expect(first.rows[0]).toMatchObject({
      sportNames: ['Beach volleyball', 'Soccer', 'Softball'],
      cityState: 'Sacramento, CA',
    });
    const second = await t.query(api.search.organizations, { page: 2 });
    expect(second.rows.map((row) => row.name)).toEqual(['Saguaro Valley Softball']);
  });

  test('a second run inserts nothing', async () => {
    const t = await seeded();
    await expect(t.mutation(internal.seed.insertDemoData, {})).resolves.toMatchObject({
      organizations: 0,
      locations: 0,
      leagues: 0,
    });
  });
});
