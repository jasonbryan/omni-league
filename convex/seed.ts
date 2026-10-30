import { v, type Infer } from 'convex/values';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server';
import { ADULT_CONFIRMATION_FIELD, createAuth } from './auth';
import { authUserIdByEmail } from './lib/authUsers';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { insertMembership } from './lib/memberships';
import { verifyPassword } from './lib/password';
import type { Gender, StandardLevel } from './lib/divisions';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { addCalendarDays, dateAtUtcMinus12 } from './lib/registration';
import type { Role } from './lib/roles';
import { findLeagueBySlugs } from './lib/seasonLookup';
import type { SeasonStatus } from './lib/seasonStatus';
import type { Sport } from './lib/sports';
import {
  backfilledValidator,
  backfillDivisionFields,
  backfillTenantFields,
  divisionBackfilledValidator,
  findCustomLevel,
  insertCustomLevel,
  insertLeague,
  insertLocation,
  insertSeason,
  insertTenant,
  seasonSlugTaken,
  updateOrganizationCityState,
  type DemoDivision,
  type DivisionSeed,
  type NewSeason,
  type Tenant,
} from './lib/tenantWrites';

function division(
  gender: Gender,
  playersPerSide: number,
  level: StandardLevel,
  rest: Partial<DivisionSeed> = {},
): DivisionSeed {
  return { gender, playersPerSide, level, ageGroup: 'adult', ...rest };
}

// Insert-only: never rename or remove an entry, or the seed inserts it again next to the old one.
export const DEMO: readonly Tenant[] = [
  {
    organization: {
      name: 'Gulf Coast Sport & Social',
      slug: 'gulf-coast-sport-social',
      cityState: 'Corpus Christi, TX',
    },
    locations: [
      {
        name: 'Bayside Athletic Complex',
        address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
      },
      {
        name: 'Flour Bluff Softball Park',
        address: '2001 Bluff Diamond Rd, Corpus Christi, TX 78418',
      },
      { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
    ],
    leagues: [
      {
        name: 'Coed 7v7 Rec',
        sport: 'soccer',
        locations: ['Bayside Athletic Complex'],
        division: division('coed', 7, 'rec'),
      },
      {
        name: "Men's Over-30 11v11",
        sport: 'soccer',
        locations: ['Bayside Athletic Complex'],
        division: division('mens', 11, 'rec', { ageGroup: 'over30' }),
      },
      {
        name: 'Sunday Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
        division: division('coed', 4, 'bb'),
      },
      {
        name: 'Thursday Night Coed 2s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
        division: division('coed', 2, 'b'),
      },
      {
        name: 'Wednesday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
        division: division('coed', 10, 'rec'),
      },
    ],
  },
  {
    organization: {
      name: 'Port Aransas Beach Volleyball Club',
      slug: 'port-aransas-beach-volleyball-club',
      cityState: 'Port Aransas, TX',
    },
    locations: [],
    leagues: [],
  },
  {
    organization: {
      name: 'Front Range Rec Sports',
      slug: 'front-range-rec-sports',
      cityState: 'Denver, CO',
    },
    locations: [
      { name: 'Cottonwood Creek Fields', address: '1850 Cottonwood Creek Pkwy, Denver, CO 80219' },
      { name: 'Bluebird Softball Complex', address: '7720 Bluebird Ridge Rd, Aurora, CO 80016' },
      { name: 'Larkspur Turf Center', address: '455 Larkspur Mesa Dr, Lakewood, CO 80228' },
    ],
    leagues: [
      {
        name: 'Coed 6v6 Indoor',
        sport: 'soccer',
        locations: ['Larkspur Turf Center'],
        division: division('coed', 6, 'rec', { minimumRosterSize: 8 }),
      },
      {
        name: 'U10 Girls Fall Rec',
        sport: 'soccer',
        locations: ['Cottonwood Creek Fields'],
        division: division('womens', 7, 'rec', { ageGroup: 'u10' }),
      },
      {
        name: "Women's Sunday 11v11",
        sport: 'soccer',
        locations: ['Cottonwood Creek Fields'],
        division: division('womens', 11, 'intermediate'),
      },
      {
        name: 'Monday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Bluebird Softball Complex'],
        division: division('coed', 10, 'rec'),
      },
      {
        name: "Men's Modified Fast-Pitch",
        sport: 'softball',
        locations: ['Bluebird Softball Complex', 'Cottonwood Creek Fields'],
        division: division('mens', 9, 'competitive'),
      },
    ],
  },
  {
    organization: {
      name: 'Lakeshore Sand League',
      slug: 'lakeshore-sand-league',
      cityState: 'Chicago, IL',
    },
    locations: [
      { name: 'Driftwood Beach Courts', address: '2600 Driftwood Shore Dr, Chicago, IL 60614' },
      { name: 'Harbor Point Sand Courts', address: '915 Harbor Point Ave, Evanston, IL 60201' },
    ],
    leagues: [
      {
        name: "Tuesday Women's 2s",
        sport: 'beachVolleyball',
        locations: ['Driftwood Beach Courts'],
        division: division('womens', 2, 'a'),
      },
      {
        name: 'Saturday Coed 6s',
        sport: 'beachVolleyball',
        locations: ['Driftwood Beach Courts', 'Harbor Point Sand Courts'],
        division: division('coed', 6, 'rec'),
      },
      {
        name: "Competitive Men's 4s",
        sport: 'beachVolleyball',
        locations: ['Harbor Point Sand Courts'],
        division: division('mens', 4, 'aa'),
      },
    ],
  },
  {
    organization: {
      name: 'Saguaro Valley Softball',
      slug: 'saguaro-valley-softball',
      cityState: 'Phoenix, AZ',
    },
    locations: [
      { name: 'Saguaro Ridge Park', address: '3180 Saguaro Ridge Rd, Phoenix, AZ 85042' },
      { name: 'Mesquite Flats Diamonds', address: '640 Mesquite Flats Ln, Tempe, AZ 85281' },
    ],
    leagues: [
      {
        name: 'Friday Night Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Saguaro Ridge Park'],
        division: division('coed', 10, 'rec'),
      },
      {
        name: 'Senior 55+ Slow-Pitch',
        sport: 'softball',
        locations: ['Mesquite Flats Diamonds'],
        division: division('coed', 10, 'rec', { ageGroup: 'over55' }),
      },
      {
        name: "Men's D Division Slow-Pitch",
        sport: 'softball',
        locations: ['Saguaro Ridge Park', 'Mesquite Flats Diamonds'],
        division: division('mens', 10, 'rec', { customLevel: 'D' }),
      },
    ],
  },
  {
    organization: {
      name: 'Rockport Sand Volleyball',
      slug: 'rockport-sand-volleyball',
      cityState: 'Rockport, TX',
    },
    locations: [
      { name: 'Rockport Beach Courts', address: '300 Beach Access Rd, Rockport, TX 78382' },
    ],
    leagues: [
      {
        name: 'Wednesday Coed 2s',
        sport: 'beachVolleyball',
        locations: ['Rockport Beach Courts'],
        division: division('coed', 2, 'rec'),
      },
    ],
  },
  {
    organization: {
      name: 'Confluence Sport & Social',
      slug: 'confluence-sport-social',
      cityState: 'Sacramento, CA',
    },
    locations: [
      {
        name: 'American River Sand Courts',
        address: '2150 Riverbend Levee Rd, Sacramento, CA 95833',
      },
      { name: 'Arden Oaks Fields', address: '4810 Arden Hollow Dr, Sacramento, CA 95821' },
      {
        name: 'Bridgeway Softball Complex',
        address: '900 Bridgeway Landing Blvd, West Sacramento, CA 95691',
      },
      {
        name: 'Capitol Grove Turf Center',
        address: '1730 Capitol Grove Way, Sacramento, CA 95814',
      },
      { name: 'Cosumnes Meadow Park', address: '9055 Meadowlark Bend Rd, Elk Grove, CA 95624' },
      { name: 'Delta Breeze Fields', address: '3340 Delta Breeze Way, Sacramento, CA 95834' },
      { name: 'Heron Marsh Fields', address: '5125 Heron Marsh Rd, Sacramento, CA 95823' },
      { name: 'Juniper Glen Diamonds', address: '2860 Juniper Glen Dr, Roseville, CA 95661' },
      { name: 'Lakeshore Cove Sand Courts', address: '8410 Lakeshore Cove Rd, Folsom, CA 95630' },
      { name: 'Mallard Point Park', address: '4475 Mallard Point Ln, Elk Grove, CA 95758' },
      { name: 'Oak Hollow Diamonds', address: '7120 Oak Hollow Ct, Citrus Heights, CA 95610' },
      { name: 'Pocket Bend Sand Courts', address: '6600 Pocket Bend Dr, Sacramento, CA 95831' },
      {
        name: 'Riverside Landing Softball Park',
        address: '1980 Landing Pier Rd, West Sacramento, CA 95605',
      },
      { name: 'Sunrise Ridge Turf', address: '10250 Sunrise Ridge Pkwy, Rancho Cordova, CA 95670' },
    ],
    leagues: [
      {
        name: 'Coed 6v6 Indoor',
        sport: 'soccer',
        locations: ['Arden Oaks Fields'],
        division: division('coed', 6, 'rec'),
      },
      {
        name: 'Coed 7v7 Rec',
        sport: 'soccer',
        locations: ['Capitol Grove Turf Center', 'Heron Marsh Fields'],
        division: division('coed', 7, 'rec'),
      },
      {
        name: 'Coed 9v9 Twilight',
        sport: 'soccer',
        locations: ['Heron Marsh Fields'],
        division: division('coed', 9, 'intermediate'),
      },
      {
        name: 'Coed Slow-Pitch Sundays',
        sport: 'softball',
        locations: ['Bridgeway Softball Complex'],
        division: division('coed', 10, 'rec'),
      },
      {
        name: 'Competitive Coed 6s',
        sport: 'beachVolleyball',
        locations: ['American River Sand Courts'],
        division: division('coed', 6, 'aa'),
      },
      {
        name: "Competitive Men's 2s",
        sport: 'beachVolleyball',
        locations: ['Lakeshore Cove Sand Courts', 'Pocket Bend Sand Courts'],
        division: division('mens', 2, 'open'),
      },
      {
        name: "Competitive Men's Fast-Pitch",
        sport: 'softball',
        locations: ['Oak Hollow Diamonds'],
        division: division('mens', 9, 'competitive'),
      },
      {
        name: 'Friday Night Coed 4s',
        sport: 'beachVolleyball',
        locations: ['Pocket Bend Sand Courts'],
        division: division('coed', 4, 'b'),
      },
      {
        name: 'Intermediate Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Juniper Glen Diamonds', 'Cosumnes Meadow Park'],
        division: division('coed', 10, 'intermediate'),
      },
      {
        name: "Men's 11v11 Competitive",
        sport: 'soccer',
        locations: ['Delta Breeze Fields'],
        division: division('mens', 11, 'competitive'),
      },
      {
        name: "Men's Over-40 7v7",
        sport: 'soccer',
        locations: ['Sunrise Ridge Turf'],
        division: division('mens', 7, 'rec', { ageGroup: 'over40' }),
      },
      {
        name: 'Monday Coed 4s',
        sport: 'beachVolleyball',
        locations: ['American River Sand Courts'],
        division: division('coed', 4, 'bb'),
      },
      {
        name: 'Monday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Riverside Landing Softball Park'],
        division: division('coed', 10, 'rec'),
      },
      {
        name: 'Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['Lakeshore Cove Sand Courts'],
        division: division('coed', 4, 'rec'),
      },
      {
        name: 'Saturday Coed 6s',
        sport: 'beachVolleyball',
        locations: ['American River Sand Courts', 'Pocket Bend Sand Courts'],
        division: division('coed', 6, 'rec'),
      },
      {
        name: "Sunday Men's Over-50 Slow-Pitch",
        sport: 'softball',
        locations: ['Bridgeway Softball Complex', 'Riverside Landing Softball Park'],
        division: division('mens', 10, 'rec', { ageGroup: 'over50' }),
      },
      {
        name: "Sunday Women's 2s",
        sport: 'beachVolleyball',
        locations: ['Lakeshore Cove Sand Courts'],
        division: division('womens', 2, 'a'),
      },
      {
        name: 'Thursday Coed 2s',
        sport: 'beachVolleyball',
        locations: ['Lakeshore Cove Sand Courts'],
        division: division('coed', 2, 'b'),
      },
      {
        name: "Thursday Men's 4s",
        sport: 'beachVolleyball',
        locations: ['American River Sand Courts'],
        division: division('mens', 4, 'bb'),
      },
      {
        name: "Tuesday Open Men's 2s",
        sport: 'beachVolleyball',
        locations: ['Pocket Bend Sand Courts'],
        division: division('mens', 2, 'open'),
      },
      {
        name: 'U12 Boys Fall Rec',
        sport: 'soccer',
        locations: ['Cosumnes Meadow Park', 'Mallard Point Park'],
        division: division('mens', 9, 'rec', { ageGroup: 'u12' }),
      },
      {
        name: "Wednesday Women's 4s",
        sport: 'beachVolleyball',
        locations: ['Pocket Bend Sand Courts'],
        division: division('womens', 4, 'b'),
      },
      {
        name: "Women's 7v7 Intermediate",
        sport: 'soccer',
        locations: ['Mallard Point Park'],
        division: division('womens', 7, 'intermediate'),
      },
      {
        name: "Women's A 6s",
        sport: 'beachVolleyball',
        locations: ['American River Sand Courts'],
        division: division('womens', 6, 'a'),
      },
      {
        name: "Women's Modified Fast-Pitch",
        sport: 'softball',
        locations: ['Oak Hollow Diamonds'],
        division: division('womens', 9, 'intermediate'),
      },
      {
        name: "Women's Sunday 11v11",
        sport: 'soccer',
        locations: ['Capitol Grove Turf Center'],
        division: division('womens', 11, 'competitive'),
      },
    ],
  },
];

// Never rename or remove an entry: a renamed one is inserted again next to the old.
const DEMO_CUSTOM_LEVELS: readonly {
  organizationSlug: string;
  sport: Sport;
  name: string;
  standardLevel: StandardLevel;
}[] = [
  {
    organizationSlug: 'saguaro-valley-softball',
    sport: 'softball',
    name: 'D',
    standardLevel: 'rec',
  },
];

const DEMO_DIVISIONS: readonly DemoDivision[] = DEMO.flatMap((tenant) =>
  tenant.leagues.flatMap((league) =>
    league.division
      ? [
          {
            organizationSlug: tenant.organization.slug,
            leagueName: league.name,
            division: league.division,
          },
        ]
      : [],
  ),
);

// Insert-only: a published season under the slug of an existing draft would never be inserted, so
// the published seasons have slugs of their own.
export const DEMO_SEASONS: readonly {
  organizationSlug: string;
  leagueSlug: string;
  season: NewSeason;
  status?: SeasonStatus;
}[] = [
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'sunday-reverse-coed-4s',
    season: {
      name: 'Fall 2027',
      slug: 'fall-2027',
      startDate: '2027-09-12',
      endDate: '2027-11-14',
      registrationDeadline: '2027-08-29',
      playersPerSide: 4,
      minimumRosterSize: 4,
    },
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'coed-7v7-rec',
    season: {
      name: 'Fall 2027',
      slug: 'fall-2027',
      startDate: '2027-09-08',
      endDate: '2027-11-10',
      registrationDeadline: '2027-08-25',
      playersPerSide: 7,
      minimumRosterSize: 7,
    },
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'sunday-reverse-coed-4s',
    season: {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-06',
      endDate: '2027-08-29',
      registrationDeadline: '2027-05-23',
      playersPerSide: 4,
      minimumRosterSize: 4,
    },
    status: 'published',
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'coed-7v7-rec',
    season: {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-02',
      endDate: '2027-08-25',
      registrationDeadline: '2027-05-19',
      playersPerSide: 7,
      minimumRosterSize: 7,
    },
    status: 'published',
  },
];

interface RunSeason {
  organizationSlug: string;
  leagueSlug: string;
  name: string;
  slug: string;
  playersPerSide: number;
  deadlineDaysFromRun: number;
  startDaysFromRun: number;
  endDaysFromRun: number;
}

// Dated from the run, so each new deployment shows one season in progress and one past its deadline. Insert-only like the rest, so a
// preview reused across pushes keeps the dates of its first run.
export const DEMO_RUN_SEASONS: readonly RunSeason[] = [
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'sunday-reverse-coed-4s',
    name: 'Current season',
    slug: 'current-season',
    playersPerSide: 4,
    deadlineDaysFromRun: -21,
    startDaysFromRun: -14,
    endDaysFromRun: 56,
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'coed-7v7-rec',
    name: 'Next season',
    slug: 'next-season',
    playersPerSide: 7,
    deadlineDaysFromRun: -2,
    startDaysFromRun: 5,
    endDaysFromRun: 89,
  },
];

function runSeason(demo: RunSeason, today: string): NewSeason {
  return {
    name: demo.name,
    slug: demo.slug,
    startDate: addCalendarDays(today, demo.startDaysFromRun),
    endDate: addCalendarDays(today, demo.endDaysFromRun),
    registrationDeadline: addCalendarDays(today, demo.deadlineDaysFromRun),
    playersPerSide: demo.playersPerSide,
    minimumRosterSize: demo.playersPerSide,
  };
}

const resultValidator = v.object({
  organizations: v.number(),
  locations: v.number(),
  customLevels: v.number(),
  leagues: v.number(),
  seasons: v.number(),
  backfilled: v.object({ ...backfilledValidator.fields, ...divisionBackfilledValidator.fields }),
  updated: v.object({ organizations: v.number() }),
});

// Refuses to write on production, even when run from the dashboard or the CLI.
function assertPreviewDeployment(): void {
  if (env.PREVIEW_ORIGIN_PATTERN !== PREVIEW_ORIGIN_PATTERN) {
    throw new Error(
      'seed:demo refused: PREVIEW_ORIGIN_PATTERN on this deployment is not the preview origin ' +
        'pattern of convex/lib/previewOrigin.ts, so this is not a preview or staging deployment',
    );
  }
}

async function ensureOrganization(
  ctx: MutationCtx,
  tenant: Tenant,
): Promise<{ id: Id<'organizations'>; inserted: boolean; updated: boolean }> {
  const { slug, cityState } = tenant.organization;
  const existing = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
  if (existing) {
    // The one update to an existing row, for a reused staging; it changes nothing once set.
    const updated = existing.cityState === undefined && cityState !== undefined;
    if (updated) await updateOrganizationCityState(ctx, existing._id, cityState);
    return { id: existing._id, inserted: false, updated };
  }
  const id = await insertTenant(ctx, {
    organization: tenant.organization,
    locations: [],
    leagues: [],
  });
  return { id, inserted: true, updated: false };
}

async function ensureCustomLevels(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  organizationSlug: string,
): Promise<number> {
  let inserted = 0;
  for (const level of DEMO_CUSTOM_LEVELS) {
    if (level.organizationSlug !== organizationSlug) continue;
    if (await findCustomLevel(ctx, organizationId, level.sport, level.name)) continue;
    await insertCustomLevel(ctx, organizationId, level);
    inserted++;
  }
  return inserted;
}

export const insertDemoData = internalMutation({
  args: {},
  returns: resultValidator,
  handler: async (ctx) => {
    assertPreviewDeployment();
    const inserted = { organizations: 0, locations: 0, customLevels: 0, leagues: 0, seasons: 0 };
    const updated = { organizations: 0 };
    // Existing organizations get their custom levels first, so a demo league can name its level.
    for (const tenant of DEMO) {
      const slug = tenant.organization.slug;
      const existing = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .unique();
      if (existing) inserted.customLevels += await ensureCustomLevels(ctx, existing._id, slug);
    }
    const divisionBackfilled = await backfillDivisionFields(ctx, DEMO_DIVISIONS);
    const backfilled = { ...(await backfillTenantFields(ctx)), ...divisionBackfilled };
    for (const tenant of DEMO) {
      const organization = await ensureOrganization(ctx, tenant);
      const organizationId = organization.id;
      if (organization.inserted) inserted.organizations++;
      if (organization.updated) updated.organizations++;

      for (const location of tenant.locations) {
        const existing = await ctx.db
          .query('locations')
          .withIndex('by_organizationId_and_name', (q) =>
            q.eq('organizationId', organizationId).eq('name', location.name),
          )
          .first();
        if (existing) continue;
        await insertLocation(ctx, organizationId, location);
        inserted.locations++;
      }

      inserted.customLevels += await ensureCustomLevels(
        ctx,
        organizationId,
        tenant.organization.slug,
      );

      for (const league of tenant.leagues) {
        const existing = await ctx.db
          .query('leagues')
          .withIndex('by_organizationId_and_name', (q) =>
            q.eq('organizationId', organizationId).eq('name', league.name),
          )
          .first();
        if (existing) continue;
        await insertLeague(ctx, organizationId, league);
        inserted.leagues++;
      }
    }

    // A league is missing when a slug collision gave it another slug.
    for (const { organizationSlug, leagueSlug, season, status } of DEMO_SEASONS) {
      const found = await findLeagueBySlugs(ctx, { orgSlug: organizationSlug, leagueSlug });
      if (!found) continue;
      if (await seasonSlugTaken(ctx, found.league._id, season.slug)) continue;
      await insertSeason(ctx, found.league, season, status);
      inserted.seasons++;
    }
    const today = dateAtUtcMinus12(Date.now());
    for (const demo of DEMO_RUN_SEASONS) {
      const found = await findLeagueBySlugs(ctx, {
        orgSlug: demo.organizationSlug,
        leagueSlug: demo.leagueSlug,
      });
      if (!found) continue;
      if (await seasonSlugTaken(ctx, found.league._id, demo.slug)) continue;
      await insertSeason(ctx, found.league, runSeason(demo, today), 'published');
      inserted.seasons++;
    }
    return { ...inserted, backfilled, updated };
  },
});

/** The reserved, non-routable domain (RFC 2606) of every demo account address. */
export const DEMO_ACCOUNT_DOMAIN = 'demo.omni-league.test';

const accountKeyValidator = v.union(
  v.literal('admin'),
  v.literal('organizer'),
  v.literal('player'),
);

type AccountKey = Infer<typeof accountKeyValidator>;

interface DemoMembership {
  organizationSlug: string;
  role: Role;
  leagueSlugs: readonly string[];
}

/**
 * One per role, all with the password in `DEMO_ACCOUNT_PASSWORD`. An address is the account's
 * identity, so an entry is never renamed or removed. A plain value, not a Convex function, so it
 * adds nothing to the API.
 */
export const DEMO_ACCOUNTS: Readonly<
  Record<AccountKey, { email: string; name: string; memberships: readonly DemoMembership[] }>
> = {
  admin: {
    email: `admin@${DEMO_ACCOUNT_DOMAIN}`,
    name: 'Demo Admin',
    memberships: [
      { organizationSlug: 'gulf-coast-sport-social', role: 'orgAdmin', leagueSlugs: [] },
      {
        organizationSlug: 'port-aransas-beach-volleyball-club',
        role: 'orgAdmin',
        leagueSlugs: [],
      },
      // The organization where the custom division level "D" (Rec) shows.
      { organizationSlug: 'saguaro-valley-softball', role: 'orgAdmin', leagueSlugs: [] },
      // The organization with exactly one location, which the create-league form preselects.
      { organizationSlug: 'rockport-sand-volleyball', role: 'orgAdmin', leagueSlugs: [] },
    ],
  },
  organizer: {
    email: `organizer@${DEMO_ACCOUNT_DOMAIN}`,
    name: 'Demo Organizer',
    memberships: [
      {
        organizationSlug: 'gulf-coast-sport-social',
        role: 'leagueOrganizer',
        leagueSlugs: ['sunday-reverse-coed-4s'],
      },
    ],
  },
  player: { email: `player@${DEMO_ACCOUNT_DOMAIN}`, name: 'Demo Player', memberships: [] },
};

/** The pending staff invite on the demo staff list. Its token is discarded, so it cannot be accepted. */
const DEMO_INVITE = {
  organizationSlug: 'gulf-coast-sport-social',
  email: `invited@${DEMO_ACCOUNT_DOMAIN}`,
  role: 'leagueOrganizer',
  leagueSlugs: ['coed-7v7-rec'],
} as const;

/**
 * What `seed:demo` reports for one demo account. Codes only: never the password, a hash, or an
 * error message.
 */
const accountCodeValidator = v.union(
  v.literal('created'),
  v.literal('exists'),
  v.literal('conflict'),
  v.literal('skipped:unset'),
  v.literal('rejected:too_short'),
  v.literal('rejected:too_long'),
  v.literal('rejected:breached'),
  v.literal('rejected:check_unavailable'),
);

type AccountCode = Infer<typeof accountCodeValidator>;

const demoResultValidator = v.object({
  ...resultValidator.fields,
  memberships: v.number(),
  invites: v.number(),
  accounts: v.object({
    admin: accountCodeValidator,
    organizer: accountCodeValidator,
    player: accountCodeValidator,
  }),
});

type DemoResult = Infer<typeof demoResultValidator>;

async function organizationBySlug(ctx: Pick<MutationCtx, 'db'>, slug: string) {
  return ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
}

async function leagueIdsBySlugs(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
  slugs: readonly string[],
): Promise<Id<'leagues'>[] | null> {
  const ids: Id<'leagues'>[] = [];
  for (const slug of slugs) {
    const league = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', slug),
      )
      .unique();
    if (!league) return null;
    ids.push(league._id);
  }
  return ids;
}

/**
 * Skips the insert when the address already has a pending invite (an expired one counts, as in
 * `invites.insertPending`). The token is made in the action and discarded, because a mutation's
 * randomness is seeded; only its hash arrives here, so nothing can accept the invite.
 */
export const insertDemoInvite = internalMutation({
  args: { tokenHash: v.string() },
  returns: v.number(),
  handler: async (ctx, { tokenHash }) => {
    assertPreviewDeployment();
    const organization = await organizationBySlug(ctx, DEMO_INVITE.organizationSlug);
    if (!organization) return 0;
    const leagueIds = await leagueIdsBySlugs(ctx, organization._id, DEMO_INVITE.leagueSlugs);
    if (!leagueIds) return 0;
    const pending = await ctx.db
      .query('invites')
      .withIndex('by_organizationId_and_email_and_status', (q) =>
        q
          .eq('organizationId', organization._id)
          .eq('email', DEMO_INVITE.email)
          .eq('status', 'pending'),
      )
      .first();
    if (pending) return 0;
    await ctx.db.insert('invites', {
      organizationId: organization._id,
      email: DEMO_INVITE.email,
      role: DEMO_INVITE.role,
      leagueIds,
      tokenHash,
      expiresAt: Date.now() + INVITE_LIFETIME_MS,
      status: 'pending',
    });
    return 1;
  },
});

/**
 * Gives the demo account `account` (the auth user `authUserId`) the memberships it is listed with,
 * each only when the user has none in that organization, so a run never changes an existing role
 * and a deleted membership comes back. Takes the auth user id and a name, never the password.
 * Returns the rows inserted.
 */
export const grantDemoMemberships = internalMutation({
  args: { authUserId: v.string(), account: accountKeyValidator },
  returns: v.number(),
  handler: async (ctx, { authUserId, account }) => {
    assertPreviewDeployment();
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user) throw new Error('seed:demo found a demo account with no app user record');
    let inserted = 0;
    for (const membership of DEMO_ACCOUNTS[account].memberships) {
      const organization = await organizationBySlug(ctx, membership.organizationSlug);
      if (!organization) continue;
      const existing = await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) =>
          q.eq('userId', user._id).eq('organizationId', organization._id),
        )
        .unique();
      if (existing) continue;
      const leagueIds = await leagueIdsBySlugs(ctx, organization._id, membership.leagueSlugs);
      if (!leagueIds) continue;
      await insertMembership(ctx, user._id, organization._id, membership.role, leagueIds);
      inserted++;
    }
    return inserted;
  },
});

/**
 * Takes a demo account key, not an address, so it can read only the demo accounts' hashes. Its
 * result goes to `verifyPassword` and nowhere else.
 */
export const findDemoCredential = internalQuery({
  args: { account: accountKeyValidator },
  returns: v.union(
    v.object({ status: v.literal('absent') }),
    v.object({ status: v.literal('noCredential') }),
    v.object({ status: v.literal('found'), authUserId: v.string(), hash: v.string() }),
  ),
  handler: async (ctx, { account }) => {
    assertPreviewDeployment();
    const authUserId = await authUserIdByEmail(ctx, DEMO_ACCOUNTS[account].email);
    if (!authUserId) return { status: 'absent' as const };
    // The component's generated return types are `any`.
    const credential = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'account',
      where: [
        { field: 'userId', value: authUserId },
        { field: 'providerId', value: 'credential' },
      ],
    })) as { password?: string | null } | null;
    if (!credential?.password) return { status: 'noCredential' as const };
    return { status: 'found' as const, authUserId, hash: credential.password };
  },
});

interface AccountOutcome {
  code: AccountCode;
  authUserId?: string;
}

type SignUpOutcome =
  | { kind: 'created'; authUserId: string }
  | { kind: 'rejected'; code: AccountCode }
  | { kind: 'present' };

function authErrorOf(error: unknown): { code?: string; status?: unknown } | null {
  if (typeof error !== 'object' || error === null) return null;
  if ((error as { name?: unknown }).name !== 'APIError') return null;
  const { body, status, statusCode } = error as {
    body?: { code?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  const code = typeof body?.code === 'string' ? body.code : undefined;
  return { code, status: status ?? statusCode };
}

/**
 * Signs the account up through Better Auth, with the 18+ confirmation, and maps a failure by its
 * error code or status, never by message text (`better-auth` 1.6.33, `sign-up.mjs` and the
 * `haveIBeenPwned` plugin): the length and breach codes are `rejected`, a breach check that could
 * not run (status 500, no code) is `check_unavailable`, an address that already exists, or that a
 * concurrent run took during the create, is `present`, and anything else throws a message that
 * holds neither the password nor Better Auth's text.
 */
async function signUp(
  auth: ReturnType<typeof createAuth>,
  key: AccountKey,
  password: string,
): Promise<SignUpOutcome> {
  const { email, name } = DEMO_ACCOUNTS[key];
  try {
    // The 18+ field is this app's (convex/auth.ts), so Better Auth's body type does not list it.
    const body = { name, email, password, [ADULT_CONFIRMATION_FIELD]: true };
    const { user } = await auth.api.signUpEmail({ body });
    return { kind: 'created', authUserId: user.id };
  } catch (error) {
    const failure = authErrorOf(error);
    const code = failure?.code;
    if (code === 'PASSWORD_TOO_SHORT') return { kind: 'rejected', code: 'rejected:too_short' };
    if (code === 'PASSWORD_TOO_LONG') return { kind: 'rejected', code: 'rejected:too_long' };
    if (code === 'PASSWORD_COMPROMISED') return { kind: 'rejected', code: 'rejected:breached' };
    if (code === undefined && failure !== null) {
      if (failure.status === 'INTERNAL_SERVER_ERROR' || failure.status === 500) {
        return { kind: 'rejected', code: 'rejected:check_unavailable' };
      }
    }
    if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || code === 'FAILED_TO_CREATE_USER') {
      return { kind: 'present' };
    }
    const named = code !== undefined && /^[A-Z_]{1,60}$/.test(code) ? ` (${code})` : '';
    // eslint-disable-next-line preserve-caught-error -- the cause is dropped on purpose: only its constant code is named, so no message from Better Auth reaches the build log.
    throw new Error(`seed:demo could not create the ${key} demo account${named}`);
  }
}

async function verifyExistingAccount(
  found: { status: 'noCredential' } | { status: 'found'; authUserId: string; hash: string },
  password: string,
): Promise<AccountOutcome> {
  if (found.status === 'noCredential') return { code: 'conflict' };
  const verified = await verifyPassword({ hash: found.hash, password });
  return verified ? { code: 'exists', authUserId: found.authUserId } : { code: 'conflict' };
}

/**
 * An existing account is verified against its stored hash, never by a sign-in, because a failed
 * sign-in counts toward the per-address throttle. It is never rewritten: a mismatch is `conflict`
 * and gets no role.
 */
async function ensureAccount(
  ctx: ActionCtx,
  auth: ReturnType<typeof createAuth>,
  key: AccountKey,
  password: string,
): Promise<AccountOutcome> {
  const found = await ctx.runQuery(internal.seed.findDemoCredential, { account: key });
  if (found.status !== 'absent') return verifyExistingAccount(found, password);

  const signedUp = await signUp(auth, key, password);
  if (signedUp.kind === 'created') return { code: 'created', authUserId: signedUp.authUserId };
  if (signedUp.kind === 'rejected') return { code: signedUp.code };

  // Another run took the address between the lookup and the create.
  const again = await ctx.runQuery(internal.seed.findDemoCredential, { account: key });
  if (again.status === 'absent') {
    throw new Error(`seed:demo could not create the ${key} demo account and found none`);
  }
  return verifyExistingAccount(again, password);
}

/**
 * An action because Better Auth's sign-up needs one. A missing, too short, too long, or breached
 * password, or an unreachable breach check, creates no account and does not fail the build; the
 * data is still seeded. The password is read once, here, and goes only to Better Auth and
 * `verifyPassword`: never to another Convex function, a result, an error, or a log.
 */
export const demo = internalAction({
  args: {},
  returns: demoResultValidator,
  handler: async (ctx): Promise<DemoResult> => {
    assertPreviewDeployment();
    const data = await ctx.runMutation(internal.seed.insertDemoData, {});
    const invites = await ctx.runMutation(internal.seed.insertDemoInvite, {
      tokenHash: await hashInviteToken(generateInviteToken()),
    });

    const password = env.DEMO_ACCOUNT_PASSWORD;
    const accounts: Record<AccountKey, AccountCode> = {
      admin: 'skipped:unset',
      organizer: 'skipped:unset',
      player: 'skipped:unset',
    };
    let memberships = 0;
    if (password !== undefined && password !== '') {
      const auth = createAuth(ctx);
      for (const key of ['admin', 'organizer', 'player'] as const) {
        const outcome = await ensureAccount(ctx, auth, key, password);
        accounts[key] = outcome.code;
        if (outcome.authUserId !== undefined) {
          memberships += await ctx.runMutation(internal.seed.grantDemoMemberships, {
            authUserId: outcome.authUserId,
            account: key,
          });
        }
      }
    }
    return { ...data, memberships, invites, accounts };
  },
});
