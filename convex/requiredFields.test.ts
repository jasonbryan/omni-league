/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertDraftLeague, insertLeague, insertSeason, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

const COED_4S = { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' } as const;
const SOCCER_7S = { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' } as const;
const ADMIN = {
  subject: 'admin',
  issuer: 'http://127.0.0.1:3211',
  email: 'admin@example.test',
  emailVerified: false,
  name: 'admin',
  sessionId: 's1',
};
const SEASON = {
  name: 'Fall 2027',
  slug: 'fall-2027',
  startDate: '2027-09-01',
  endDate: '2027-11-15',
  registrationDeadline: '2027-08-25',
};

const LEAGUE_FIELDS = [
  'gender',
  'playersPerSide',
  'level',
  'ageGroup',
  'searchText',
  'programId',
] as const satisfies readonly (keyof Doc<'leagues'>)[];
const ORGANIZATION_FIELDS = ['sortName', 'hasPublishedLeague'] as const;

async function everyRow(t: T) {
  return t.run(async (ctx) => ({
    leagues: await ctx.db.query('leagues').collect(),
    seasons: await ctx.db.query('seasons').collect(),
    organizations: await ctx.db.query('organizations').collect(),
  }));
}

async function expectRequiredFields(t: T, rows: { leagues: number; seasons: number }) {
  const found = await everyRow(t);
  expect(found.leagues).toHaveLength(rows.leagues);
  expect(found.seasons).toHaveLength(rows.seasons);
  for (const league of found.leagues) {
    for (const field of LEAGUE_FIELDS) {
      expect(league[field], `${league.name}.${field}`).toBeDefined();
    }
  }
  for (const season of found.seasons) {
    expect(typeof season.playersPerSide, `${season.slug}.playersPerSide`).toBe('number');
    expect(season, `${season.slug}`).not.toHaveProperty('format');
  }
  for (const organization of found.organizations) {
    for (const field of ORGANIZATION_FIELDS) {
      expect(organization[field], `${organization.slug}.${field}`).toBeDefined();
    }
  }
}

async function withOrganization(t: T) {
  return t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [],
    });
    const location = (await ctx.db.query('locations').collect())[0];
    const userId = await ctx.db.insert('users', {
      authUserId: 'admin',
      name: 'admin',
      adultConfirmedAt: 1,
    });
    await ctx.db.insert('memberships', { userId, organizationId, role: 'orgAdmin', leagueIds: [] });
    return { organizationId, locationId: location._id };
  });
}

describe('the schema', () => {
  async function league(t: T, organizationId: Doc<'organizations'>['_id']) {
    const programId = await t.run((ctx) =>
      ctx.db.insert('programs', {
        organizationId,
        type: 'league',
        name: 'League',
        sortName: 'league',
        slug: 'league',
        sport: 'beachVolleyball',
        status: 'draft',
        locationIds: [],
        ...COED_4S,
      }),
    );
    return {
      organizationId,
      name: 'League',
      slug: 'league',
      sport: 'beachVolleyball' as const,
      locationIds: [],
      searchText: 'league',
      programId,
      ...COED_4S,
    };
  }

  test.each(LEAGUE_FIELDS)('refuses a league with no %s', async (field) => {
    const t = setup();
    const { organizationId } = await withOrganization(t);
    const row: Record<string, unknown> = await league(t, organizationId);
    delete row[field];
    await expect(t.run((ctx) => ctx.db.insert('leagues', row as Doc<'leagues'>))).rejects.toThrow();
  });

  test('keeps minimumRosterSize and customLevelId optional on a league', async () => {
    const t = setup();
    const { organizationId } = await withOrganization(t);
    const row = await league(t, organizationId);
    await t.run((ctx) => ctx.db.insert('leagues', row));
    expect(await t.run((ctx) => ctx.db.query('leagues').collect())).toHaveLength(1);
  });

  test.each(['playersPerSide'] as const)('refuses a season with no %s', async (field) => {
    const t = setup();
    const { organizationId } = await withOrganization(t);
    const leagueRow = await league(t, organizationId);
    const leagueId = await t.run((ctx) => ctx.db.insert('leagues', leagueRow));
    const row: Record<string, unknown> = {
      organizationId,
      leagueId,
      ...SEASON,
      playersPerSide: 4,
      minimumRosterSize: 4,
      status: 'draft',
    };
    delete row[field];
    await expect(t.run((ctx) => ctx.db.insert('seasons', row as Doc<'seasons'>))).rejects.toThrow();
  });

  test('refuses a season that holds a format', async () => {
    const t = setup();
    const { organizationId } = await withOrganization(t);
    const leagueRow = await league(t, organizationId);
    const leagueId = await t.run((ctx) => ctx.db.insert('leagues', leagueRow));
    await expect(
      t.run((ctx) =>
        ctx.db.insert('seasons', {
          organizationId,
          leagueId,
          ...SEASON,
          playersPerSide: 4,
          minimumRosterSize: 4,
          status: 'draft',
          format: '4v4',
        } as never),
      ),
    ).rejects.toThrow();
  });

  test.each(ORGANIZATION_FIELDS)('refuses an organization with no %s', async (field) => {
    const t = setup();
    const row: Record<string, unknown> = {
      name: 'Org',
      slug: 'org',
      sortName: 'org',
      hasPublishedLeague: false,
    };
    delete row[field];
    await expect(
      t.run((ctx) => ctx.db.insert('organizations', row as Doc<'organizations'>)),
    ).rejects.toThrow();
  });
});

describe('every writer sets the required fields', () => {
  beforeEach(() => {
    vi.stubEnv('IS_TEST', 'true');
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('insertLeague, insertDraftLeague, and insertSeason', async () => {
    const t = setup();
    const { organizationId } = await withOrganization(t);
    await t.run(async (ctx) => {
      const published = await insertLeague(ctx, organizationId, {
        name: 'Sand 4s',
        sport: 'beachVolleyball',
        locations: ['Alpha Field'],
        division: COED_4S,
      });
      await insertDraftLeague(ctx, organizationId, {
        name: 'Draft 4s',
        slug: 'draft-4s',
        sport: 'beachVolleyball',
        locationIds: [],
        division: COED_4S,
      });
      const league = (await ctx.db.get('leagues', published.leagueId))!;
      await insertSeason(ctx, league, { ...SEASON, playersPerSide: 4, minimumRosterSize: 4 });
    });
    await expectRequiredFields(t, { leagues: 2, seasons: 1 });
  });

  test('leagues.create and seasons.create', async () => {
    const t = setup();
    const { organizationId, locationId } = await withOrganization(t);
    const admin = t.withIdentity(ADMIN);
    const { leagueId } = await admin.mutation(api.leagues.create, {
      organizationId,
      name: 'Sand 4s',
      slug: 'sand-4s',
      sport: 'beachVolleyball',
      locationIds: [locationId],
      ...COED_4S,
    });
    await admin.mutation(api.seasons.create, { leagueId, ...SEASON });
    await expectRequiredFields(t, { leagues: 1, seasons: 1 });
  });

  test('the testing seeds', async () => {
    const t = setup();
    await t.action(internal.testing.seedLeague, {
      organization: { name: 'E2E Org', slug: 'e2e-org' },
      locations: [{ name: 'Field', address: '1 Test Road' }],
      leagues: [
        { name: 'No Division', sport: 'soccer', locations: ['Field'] },
        { name: 'With Division', sport: 'soccer', locations: ['Field'], division: SOCCER_7S },
      ],
    });
    await t.mutation(internal.testing.addLeague, {
      organizationSlug: 'e2e-org',
      name: 'Added',
      sport: 'softball',
      locations: ['Field'],
    });
    await t.mutation(internal.testing.seedSeason, {
      organizationSlug: 'e2e-org',
      leagueSlug: 'added',
      ...SEASON,
      minimumRosterSize: 9,
    });
    await t.mutation(internal.testing.seedSeasons, {
      organizationSlug: 'e2e-org',
      leagueSlug: 'no-division',
      seasons: [{ ...SEASON, slug: 'one', minimumRosterSize: 4 }],
    });
    await expectRequiredFields(t, { leagues: 3, seasons: 2 });
  });

  test('seed:demo on an empty deployment', async () => {
    const t = setup();
    await t.mutation(internal.seed.insertDemoData, {});
    const found = await everyRow(t);
    expect(found.leagues.length).toBeGreaterThan(0);
    await expectRequiredFields(t, {
      leagues: found.leagues.length,
      seasons: found.seasons.length,
    });
  });

  test('seed:demo returns the inserted counts and only the counters still optional, with no updated', async () => {
    const t = setup();
    const result = await t.mutation(internal.seed.insertDemoData, {});
    expect(Object.keys(result).sort()).toEqual(
      [
        'backfilled',
        'campSessions',
        'camps',
        'customLevels',
        'leagues',
        'locations',
        'organizations',
        'seasons',
        'tournaments',
      ].sort(),
    );
    expect(result.backfilled).toEqual({
      organizations: 0,
      locations: 0,
      leagues: 0,
      teamCounts: 0,
      pendingInviteCounts: 0,
      waitlistCounts: 0,
      staffCounts: 0,
      staffInviteCounts: 0,
      draftLeagueCounts: 0,
    });
  });
});
