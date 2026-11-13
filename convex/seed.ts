import { v, type Infer } from 'convex/values';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { ADULT_CONFIRMATION_FIELD, createAuth } from './auth';
import { authUserIdByEmail } from './lib/authUsers';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { backfillPendingInviteCounts, insertPendingInvite } from './lib/inviteWrites';
import { backfillStaffCounts, insertMembership } from './lib/memberships';
import { verifyPassword } from './lib/password';
import type { Gender, StandardLevel } from './lib/divisions';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { addCalendarDays, dateAtUtcMinus12 } from './lib/registration';
import type { Role } from './lib/roles';
import {
  backfillSeasonTeamCounts,
  backfillSeasonWaitlistCounts,
  acceptTeamInvite,
  addMinorEntry,
  addRosterEntry,
  adultEntryInSeason,
  adultEntryInTournament,
  backfillTeamPendingInviteCounts,
  freeAgentInSeason,
  insertFreeAgent,
  insertPlacedFreeAgent,
  insertTeamInvite,
  insertTeamWithCaptain,
  insertTournamentTeamWithCaptain,
  pendingTeamInvite,
  registerTeamOrJoinWaitlist,
  registerTournamentTeamOrJoinWaitlist,
  removeRosterEntry,
  teamWithSortName,
} from './lib/rosterWrites';
import { findLeagueBySlugs, findSeasonBySlugs } from './lib/seasonLookup';
import { seasonIsFull } from './lib/seasonInput';
import { teamSortName } from './lib/teamInput';
import { tournamentIsFull } from './lib/tournamentInput';
import {
  bracketExists,
  replaceBracket,
  tournamentTeams as seededTeamsOf,
} from './lib/tournamentBracket';
import { findTournamentBySlugs } from './lib/tournamentLookup';
import { DEMO_LOGO_ORGANIZATION_SLUG, demoLogoBytes } from './seedAssets';
import type { SeasonStatus } from './lib/seasonStatus';
import type { Sport } from './lib/sports';
import {
  backfilledValidator,
  backfillDraftLeagueCounts,
  backfillTenantFields,
  findCustomLevel,
  insertCustomLevel,
  insertLeague,
  insertLocation,
  insertDraftTournament,
  publishTournament,
  insertSeason,
  insertTenant,
  programSlugTaken,
  seasonSlugTaken,
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
        name: 'Men Over-30 11v11',
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
        name: 'Women Sunday 11v11',
        sport: 'soccer',
        locations: ['Cottonwood Creek Fields'],
        division: division('womens', 11, 'intermediate'),
      },
      {
        name: 'U10 Girls Select',
        sport: 'soccer',
        locations: ['Larkspur Turf Center'],
        division: division('womens', 7, 'competitive', { ageGroup: 'u10' }),
      },
      {
        name: 'Monday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Bluebird Softball Complex'],
        division: division('coed', 10, 'rec'),
      },
      {
        name: 'Men Modified Fast-Pitch',
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
        name: 'Tuesday Women 2s',
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
        name: 'Competitive Men 4s',
        sport: 'beachVolleyball',
        locations: ['Harbor Point Sand Courts'],
        division: division('mens', 4, 'aa'),
      },
      {
        name: 'Monday Coed 4s',
        sport: 'beachVolleyball',
        locations: ['Driftwood Beach Courts'],
        division: division('coed', 4, 'bb'),
      },
      {
        name: 'Wednesday Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['Harbor Point Sand Courts'],
        division: division('coed', 4, 'b'),
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
        name: 'Men D Division Slow-Pitch',
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
        name: 'Competitive Men 2s',
        sport: 'beachVolleyball',
        locations: ['Lakeshore Cove Sand Courts', 'Pocket Bend Sand Courts'],
        division: division('mens', 2, 'open'),
      },
      {
        name: 'Competitive Men Fast-Pitch',
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
        name: 'Men 11v11 Competitive',
        sport: 'soccer',
        locations: ['Delta Breeze Fields'],
        division: division('mens', 11, 'competitive'),
      },
      {
        name: 'Men Over-40 7v7',
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
        name: 'Sunday Men Over-50 Slow-Pitch',
        sport: 'softball',
        locations: ['Bridgeway Softball Complex', 'Riverside Landing Softball Park'],
        division: division('mens', 10, 'rec', { ageGroup: 'over50' }),
      },
      {
        name: 'Sunday Women 2s',
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
        name: 'Thursday Men 4s',
        sport: 'beachVolleyball',
        locations: ['American River Sand Courts'],
        division: division('mens', 4, 'bb'),
      },
      {
        name: 'Tuesday Open Men 2s',
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
        name: 'Wednesday Women 4s',
        sport: 'beachVolleyball',
        locations: ['Pocket Bend Sand Courts'],
        division: division('womens', 4, 'b'),
      },
      {
        name: 'Women 7v7 Intermediate',
        sport: 'soccer',
        locations: ['Mallard Point Park'],
        division: division('womens', 7, 'intermediate'),
      },
      {
        name: 'Women A 6s',
        sport: 'beachVolleyball',
        locations: ['American River Sand Courts'],
        division: division('womens', 6, 'a'),
      },
      {
        name: 'Women Modified Fast-Pitch',
        sport: 'softball',
        locations: ['Oak Hollow Diamonds'],
        division: division('womens', 9, 'intermediate'),
      },
      {
        name: 'Women Sunday 11v11',
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
      maxRosterSize: 6,
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
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'thursday-night-coed-2s',
    season: {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-03',
      endDate: '2027-08-26',
      registrationDeadline: '2027-05-20',
      playersPerSide: 2,
      minimumRosterSize: 2,
      maxTeams: 2,
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

// Dated from the run, so each new deployment shows one season in progress, one past its deadline and one ended. Insert-only like the rest, so a
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
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'coed-7v7-rec',
    name: 'Past season',
    slug: 'past-season',
    playersPerSide: 7,
    deadlineDaysFromRun: -70,
    startDaysFromRun: -63,
    endDaysFromRun: -7,
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

interface DemoTournament {
  organizationSlug: string;
  name: string;
  slug: string;
  sport: Sport;
  locations: readonly string[];
  division: Pick<DivisionSeed, 'gender' | 'playersPerSide' | 'level' | 'ageGroup'>;
  startDaysFromRun: number;
  endDaysFromRun: number;
  deadlineDaysFromRun: number;
  maximumTeams: number;
  status: 'draft' | 'published';
}

// Dated from the run, so a new deployment shows each tournament ahead of its dates, the published one with registration open. Insert-only like the rest, so a preview reused across pushes keeps the dates of its first run.
export const DEMO_TOURNAMENTS: readonly DemoTournament[] = [
  {
    organizationSlug: 'gulf-coast-sport-social',
    name: 'Winter Doubles Classic',
    slug: 'winter-doubles-classic',
    sport: 'beachVolleyball',
    locations: ['North Beach Sand Courts'],
    division: division('coed', 2, 'open'),
    startDaysFromRun: 60,
    endDaysFromRun: 61,
    deadlineDaysFromRun: 53,
    maximumTeams: 16,
    status: 'draft',
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    name: 'Gulf Coast Beach Open',
    slug: 'gulf-coast-beach-open',
    sport: 'beachVolleyball',
    locations: ['North Beach Sand Courts'],
    division: division('coed', 2, 'open'),
    startDaysFromRun: 30,
    endDaysFromRun: 31,
    deadlineDaysFromRun: 23,
    maximumTeams: 16,
    status: 'published',
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    name: 'Gulf Coast King of the Beach',
    slug: 'gulf-coast-king-of-the-beach',
    sport: 'beachVolleyball',
    locations: ['North Beach Sand Courts'],
    division: division('coed', 2, 'open'),
    startDaysFromRun: 45,
    endDaysFromRun: 46,
    deadlineDaysFromRun: 38,
    maximumTeams: 4,
    status: 'published',
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    name: 'Labor Day Sand Slam',
    slug: 'labor-day-sand-slam',
    sport: 'beachVolleyball',
    locations: ['North Beach Sand Courts'],
    division: division('coed', 2, 'open'),
    startDaysFromRun: 4,
    endDaysFromRun: 5,
    deadlineDaysFromRun: -3,
    maximumTeams: 8,
    status: 'published',
  },
];

async function ensureTournament(
  ctx: MutationCtx,
  demo: DemoTournament,
  today: string,
): Promise<boolean> {
  const organization = await organizationBySlug(ctx, demo.organizationSlug);
  if (!organization || (await programSlugTaken(ctx, organization._id, demo.slug))) return false;
  const locationIds: Id<'locations'>[] = [];
  for (const name of demo.locations) {
    const location = await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', organization._id).eq('name', name),
      )
      .first();
    if (!location) return false;
    locationIds.push(location._id);
  }
  const tournamentId = await insertDraftTournament(ctx, organization._id, {
    name: demo.name,
    slug: demo.slug,
    sport: demo.sport,
    locationIds,
    division: demo.division,
    startDate: addCalendarDays(today, demo.startDaysFromRun),
    endDate: addCalendarDays(today, demo.endDaysFromRun),
    registrationDeadline: addCalendarDays(today, demo.deadlineDaysFromRun),
    maximumTeams: demo.maximumTeams,
  });
  if (demo.status === 'published') {
    await publishTournament(ctx, (await ctx.db.get('tournaments', tournamentId))!);
  }
  return true;
}

const resultValidator = v.object({
  organizations: v.number(),
  locations: v.number(),
  customLevels: v.number(),
  leagues: v.number(),
  seasons: v.number(),
  tournaments: v.number(),
  backfilled: v.object({
    ...backfilledValidator.fields,
    teamCounts: v.number(),
    pendingInviteCounts: v.number(),
    waitlistCounts: v.number(),
    staffCounts: v.number(),
    staffInviteCounts: v.number(),
    draftLeagueCounts: v.number(),
  }),
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
): Promise<{ id: Id<'organizations'>; inserted: boolean }> {
  const existing = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', tenant.organization.slug))
    .unique();
  if (existing) return { id: existing._id, inserted: false };
  const id = await insertTenant(ctx, {
    organization: tenant.organization,
    locations: [],
    leagues: [],
  });
  return { id, inserted: true };
}

async function findLeagueByName(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  name: string,
): Promise<Doc<'leagues'> | null> {
  return ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )
    .first();
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
    const inserted = {
      organizations: 0,
      locations: 0,
      customLevels: 0,
      leagues: 0,
      seasons: 0,
      tournaments: 0,
    };
    const backfilled = {
      ...(await backfillTenantFields(ctx)),
      teamCounts: await backfillSeasonTeamCounts(ctx),
      pendingInviteCounts: await backfillTeamPendingInviteCounts(ctx),
      waitlistCounts: await backfillSeasonWaitlistCounts(ctx),
      staffCounts: await backfillStaffCounts(ctx),
      staffInviteCounts: await backfillPendingInviteCounts(ctx),
      draftLeagueCounts: await backfillDraftLeagueCounts(ctx),
    };
    for (const tenant of DEMO) {
      const organization = await ensureOrganization(ctx, tenant);
      const organizationId = organization.id;
      if (organization.inserted) inserted.organizations++;

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
        if (await findLeagueByName(ctx, organizationId, league.name)) continue;
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
    for (const demo of DEMO_TOURNAMENTS) {
      if (await ensureTournament(ctx, demo, today)) inserted.tournaments++;
    }
    return { ...inserted, backfilled };
  },
});

/** The reserved, non-routable domain (RFC 2606) of every demo account address. */
export const DEMO_ACCOUNT_DOMAIN = 'demo.omni-league.test';

const accountKeyValidator = v.union(
  v.literal('admin'),
  v.literal('organizer'),
  v.literal('player'),
  v.literal('captain'),
  v.literal('guardian'),
);

type AccountKey = Infer<typeof accountKeyValidator>;

interface DemoMembership {
  organizationSlug: string;
  role: Role;
  leagueSlugs: readonly string[];
  tournamentSlugs?: readonly string[];
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
        tournamentSlugs: ['gulf-coast-beach-open'],
      },
    ],
  },
  player: { email: `player@${DEMO_ACCOUNT_DOMAIN}`, name: 'Demo Player', memberships: [] },
  captain: { email: `captain@${DEMO_ACCOUNT_DOMAIN}`, name: 'Demo Captain', memberships: [] },
  guardian: { email: `guardian@${DEMO_ACCOUNT_DOMAIN}`, name: 'Demo Guardian', memberships: [] },
};

const ACCOUNT_KEYS = ['admin', 'organizer', 'player', 'captain', 'guardian'] as const;

export const DEMO_TEAM_SEASON = {
  orgSlug: 'gulf-coast-sport-social',
  leagueSlug: 'sunday-reverse-coed-4s',
  seasonSlug: 'summer-2027',
} as const;

export const DEMO_TOURNAMENT = {
  orgSlug: 'gulf-coast-sport-social',
  tournamentSlug: 'gulf-coast-beach-open',
} as const;

/**
 * Fictional captains, signed up with a random password that is discarded, so nobody can sign in as
 * them. An address is the captain's identity, so an entry is never renamed or removed.
 */
export const DEMO_CAPTAINS = [
  { email: `maya.chen@${DEMO_ACCOUNT_DOMAIN}`, name: 'Maya Chen' },
  { email: `jordan.reyes@${DEMO_ACCOUNT_DOMAIN}`, name: 'Jordan Reyes' },
  { email: `priya.patel@${DEMO_ACCOUNT_DOMAIN}`, name: 'Priya Patel' },
] as const;

/**
 * Fictional free agents, waiting in `DEMO_TEAM_SEASON` and signed up as the captains are. An address is
 * the person's identity, so an entry is never renamed or removed.
 */
export const DEMO_FREE_AGENT_PEOPLE = [
  { email: `sam.okoye@${DEMO_ACCOUNT_DOMAIN}`, name: 'Sam Okoye' },
  { email: `lena.ortiz@${DEMO_ACCOUNT_DOMAIN}`, name: 'Lena Ortiz' },
  { email: `theo.grant@${DEMO_ACCOUNT_DOMAIN}`, name: 'Theo Grant' },
] as const;

/**
 * A fictional free agent already placed on a demo team, signed up as the captains are. It is inserted
 * placed, with its roster entry, so the seed never patches a waiting free agent.
 */
const DEMO_PLACED_FREE_AGENT = {
  email: `nia.brooks@${DEMO_ACCOUNT_DOMAIN}`,
  name: 'Nia Brooks',
  teamName: 'Dig Dynasty',
} as const;

/**
 * A fictional player removed from a demo team by its captain, signed up as the captains are. The entry
 * is kept with status `removed`, so it shows in the data and not on the roster.
 */
const DEMO_REMOVED_PLAYER = {
  email: `rio.santos@${DEMO_ACCOUNT_DOMAIN}`,
  name: 'Rio Santos',
  teamName: 'Net Results',
} as const;

/** The second player of each `DEMO_BRACKET_TEAMS` team beyond the two already in the demo data, signed up as the captains are. */
const DEMO_BRACKET_PARTNERS = [
  { email: `kai.mendoza@${DEMO_ACCOUNT_DOMAIN}`, name: 'Kai Mendoza' },
  { email: `zoe.hartley@${DEMO_ACCOUNT_DOMAIN}`, name: 'Zoe Hartley' },
  { email: `omar.haddad@${DEMO_ACCOUNT_DOMAIN}`, name: 'Omar Haddad' },
  { email: `ines.costa@${DEMO_ACCOUNT_DOMAIN}`, name: 'Ines Costa' },
] as const;

const FICTIONAL_PEOPLE: readonly { email: string; name: string }[] = [
  ...DEMO_CAPTAINS,
  ...DEMO_FREE_AGENT_PEOPLE,
  DEMO_PLACED_FREE_AGENT,
  DEMO_REMOVED_PLAYER,
  ...DEMO_BRACKET_PARTNERS,
];

/** player@ waits in another season than its team's, so the one-place rule holds. */
export const DEMO_FREE_AGENTS: readonly {
  email: string;
  season: { orgSlug: string; leagueSlug: string; seasonSlug: string };
}[] = [
  ...DEMO_FREE_AGENT_PEOPLE.map(({ email }) => ({ email, season: DEMO_TEAM_SEASON })),
  {
    email: `player@${DEMO_ACCOUNT_DOMAIN}`,
    season: {
      orgSlug: 'gulf-coast-sport-social',
      leagueSlug: 'coed-7v7-rec',
      seasonSlug: 'summer-2027',
    },
  },
  {
    email: `player@${DEMO_ACCOUNT_DOMAIN}`,
    season: {
      orgSlug: 'gulf-coast-sport-social',
      leagueSlug: 'coed-7v7-rec',
      seasonSlug: 'past-season',
    },
  },
];

/** Its demo teams fill its `maxTeams`, so it shows a full season. */
export const DEMO_FULL_SEASON = {
  orgSlug: 'gulf-coast-sport-social',
  leagueSlug: 'thursday-night-coed-2s',
  seasonSlug: 'summer-2027',
} as const;

/** Each team is inserted by name in `DEMO_FULL_SEASON`, once its captain's account exists. */
export const DEMO_FULL_SEASON_TEAMS: readonly { name: string; captainEmail: string }[] = [
  { name: 'Pair of Aces', captainEmail: DEMO_CAPTAINS[0].email },
  { name: 'Two Tall', captainEmail: DEMO_CAPTAINS[1].email },
];

/** Joins `DEMO_FULL_SEASON`'s waitlist once the season is full, inserted by team name once its captain's account exists. */
export const DEMO_WAITLIST_ENTRY = {
  teamName: 'Late Lobsters',
  captainEmail: DEMO_CAPTAINS[2].email,
} as const;

/** Each team is inserted by name in `DEMO_TOURNAMENT`, once its captain's account exists. player@ captains Sand Crabs, so the player account has a tournament team under Your teams. */
export const DEMO_TOURNAMENT_TEAMS: readonly { name: string; captainEmail: string }[] = [
  { name: 'Sand Crabs', captainEmail: `player@${DEMO_ACCOUNT_DOMAIN}` },
  { name: 'Beach Bombers', captainEmail: DEMO_CAPTAINS[0].email },
  { name: 'Set Point', captainEmail: DEMO_CAPTAINS[1].email },
  { name: 'Spike Squad', captainEmail: DEMO_CAPTAINS[2].email },
];

/** Its demo teams fill its `maximumTeams`, so it shows a full tournament. */
export const DEMO_FULL_TOURNAMENT = {
  orgSlug: 'gulf-coast-sport-social',
  tournamentSlug: 'gulf-coast-king-of-the-beach',
} as const;

/** Each team is inserted by name in `DEMO_FULL_TOURNAMENT`, once its captain's account exists. */
export const DEMO_FULL_TOURNAMENT_TEAMS: readonly { name: string; captainEmail: string }[] = [
  { name: 'Salt & Spike', captainEmail: DEMO_CAPTAINS[0].email },
  { name: 'Dune Divers', captainEmail: DEMO_CAPTAINS[1].email },
  { name: 'Pepper Party', captainEmail: DEMO_CAPTAINS[2].email },
  { name: 'Tide Turners', captainEmail: DEMO_FREE_AGENT_PEOPLE[0].email },
];

/** Joins `DEMO_FULL_TOURNAMENT`'s waitlist once the tournament is full, inserted by team name once its captain's account exists. */
export const DEMO_TOURNAMENT_WAITLIST_ENTRY = {
  teamName: 'Sunrise Setters',
  captainEmail: DEMO_FREE_AGENT_PEOPLE[1].email,
} as const;

/** Registration is closed, so its teams are confirmed with two players each and its bracket exists. */
export const DEMO_BRACKET_TOURNAMENT = {
  orgSlug: 'gulf-coast-sport-social',
  tournamentSlug: 'labor-day-sand-slam',
} as const;

/** Each team is inserted by name in `DEMO_BRACKET_TOURNAMENT`, in seed order, once both players' accounts exist. */
export const DEMO_BRACKET_TEAMS: readonly {
  name: string;
  captainEmail: string;
  partnerEmail: string;
}[] = [
  {
    name: 'Sun Chasers',
    captainEmail: DEMO_CAPTAINS[0].email,
    partnerEmail: DEMO_PLACED_FREE_AGENT.email,
  },
  {
    name: 'Shoreline Smash',
    captainEmail: DEMO_CAPTAINS[1].email,
    partnerEmail: DEMO_REMOVED_PLAYER.email,
  },
  {
    name: 'Coastal Crush',
    captainEmail: DEMO_CAPTAINS[2].email,
    partnerEmail: DEMO_BRACKET_PARTNERS[0].email,
  },
  {
    name: 'Dune Dashers',
    captainEmail: DEMO_FREE_AGENT_PEOPLE[0].email,
    partnerEmail: DEMO_BRACKET_PARTNERS[1].email,
  },
  {
    name: 'Riptide',
    captainEmail: DEMO_FREE_AGENT_PEOPLE[1].email,
    partnerEmail: DEMO_BRACKET_PARTNERS[2].email,
  },
  {
    name: 'Wave Riders',
    captainEmail: DEMO_FREE_AGENT_PEOPLE[2].email,
    partnerEmail: DEMO_BRACKET_PARTNERS[3].email,
  },
];

/** Each team is inserted by name in `DEMO_TEAM_SEASON`, once its captain's account exists. */
export const DEMO_TEAMS: readonly { name: string; captainEmail: string }[] = [
  { name: 'Net Results', captainEmail: DEMO_CAPTAINS[0].email },
  { name: 'Block Party', captainEmail: DEMO_CAPTAINS[1].email },
  { name: 'Dig Dynasty', captainEmail: DEMO_CAPTAINS[2].email },
  { name: 'Sand Sharks', captainEmail: `captain@${DEMO_ACCOUNT_DOMAIN}` },
];

/**
 * The pending invites on the captain@ account's team. Each `tokenHash` is a marker that no SHA-256
 * hex digest can equal, so no token opens it; no token is made in a mutation, whose randomness is
 * seeded.
 */
const DEMO_TEAM_INVITES = {
  teamName: 'Sand Sharks',
  invites: [
    { email: `devon.park@${DEMO_ACCOUNT_DOMAIN}`, tokenHash: 'demo-invite-1' },
    { email: `kai.nakamura@${DEMO_ACCOUNT_DOMAIN}`, tokenHash: 'demo-invite-2' },
  ],
} as const;

/**
 * Sand Crabs, which player@ captains in `DEMO_TOURNAMENT`: one pending invite, and one fictional
 * player who accepted. The markers work as in `DEMO_TEAM_INVITES`, and each invite is inserted once.
 */
const DEMO_TOURNAMENT_INVITES = {
  teamName: 'Sand Crabs',
  pending: { email: `ari.silva@${DEMO_ACCOUNT_DOMAIN}`, tokenHash: 'demo-invite-tournament-1' },
  accepted: {
    email: `theo.grant@${DEMO_ACCOUNT_DOMAIN}`,
    tokenHash: 'demo-invite-tournament-player',
  },
} as const;

/**
 * player@ joins the captain@ account's team by accepting an invite, so the team shows 2 of 4. The
 * marker inserts it once: a removed entry is not put back.
 */
const DEMO_TEAM_PLAYER = {
  teamName: 'Sand Sharks',
  email: `player@${DEMO_ACCOUNT_DOMAIN}`,
  tokenHash: 'demo-invite-player',
} as const;

/**
 * guardian@'s minor on a team the captain@ and player@ accounts play against, so they see the
 * shortened name. Inserted once: any entry of guardian@ in the season, removed included, means it was.
 */
const DEMO_MINOR = {
  teamName: 'Block Party',
  guardianEmail: `guardian@${DEMO_ACCOUNT_DOMAIN}`,
  minorName: 'Ava Lane',
} as const;

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
  logos: v.number(),
  memberships: v.number(),
  invites: v.number(),
  teams: v.number(),
  teamInvites: v.number(),
  freeAgents: v.number(),
  accounts: v.object({
    admin: accountCodeValidator,
    organizer: accountCodeValidator,
    player: accountCodeValidator,
    captain: accountCodeValidator,
    guardian: accountCodeValidator,
  }),
});

type DemoResult = Infer<typeof demoResultValidator>;

async function organizationBySlug(ctx: Pick<QueryCtx | MutationCtx, 'db'>, slug: string) {
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

async function tournamentProgramIdsBySlugs(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
  slugs: readonly string[],
): Promise<Id<'programs'>[] | null> {
  const ids: Id<'programs'>[] = [];
  for (const slug of slugs) {
    const program = await ctx.db
      .query('programs')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', slug),
      )
      .unique();
    if (program?.type !== 'tournament') return null;
    ids.push(program._id);
  }
  return ids;
}

/** So a run stores the file only once. */
export const demoLogoNeeded = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    assertPreviewDeployment();
    const organization = await organizationBySlug(ctx, DEMO_LOGO_ORGANIZATION_SLUG);
    return organization !== null && organization.logoStorageId === undefined;
  },
});

/** The organization may have gained a logo since `demoLogoNeeded` answered. */
export const setDemoLogo = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.number(),
  handler: async (ctx, { storageId }) => {
    assertPreviewDeployment();
    const organization = await organizationBySlug(ctx, DEMO_LOGO_ORGANIZATION_SLUG);
    if (!organization || organization.logoStorageId !== undefined) {
      await ctx.storage.delete(storageId);
      return 0;
    }
    await ctx.db.patch('organizations', organization._id, { logoStorageId: storageId });
    return 1;
  },
});

async function ensureDemoLogo(ctx: ActionCtx): Promise<number> {
  if (!(await ctx.runQuery(internal.seed.demoLogoNeeded, {}))) return 0;
  const storageId = await ctx.storage.store(
    new Blob([demoLogoBytes().slice()], { type: 'image/png' }),
  );
  return await ctx.runMutation(internal.seed.setDemoLogo, { storageId });
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
    await insertPendingInvite(ctx, {
      organizationId: organization._id,
      email: DEMO_INVITE.email,
      role: DEMO_INVITE.role,
      leagueIds,
      tokenHash,
      expiresAt: Date.now() + INVITE_LIFETIME_MS,
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
      const programIds = await tournamentProgramIdsBySlugs(
        ctx,
        organization._id,
        membership.tournamentSlugs ?? [],
      );
      if (!leagueIds || !programIds) continue;
      await insertMembership(
        ctx,
        user._id,
        organization._id,
        membership.role,
        leagueIds,
        programIds,
      );
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

export const findFictionalDemoUser = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { email }) => {
    assertPreviewDeployment();
    if (!FICTIONAL_PEOPLE.some((person) => person.email === email)) {
      throw new Error('seed:demo looked up an address that is not a fictional demo user');
    }
    return authUserIdByEmail(ctx, email);
  },
});

/**
 * Inserts each demo team whose captain is in `captains` (auth user ids by address) and is on no team
 * in its season yet, through the roster writer. Returns the teams inserted.
 */
export const insertDemoTeams = internalMutation({
  args: { captains: v.array(v.object({ email: v.string(), authUserId: v.string() })) },
  returns: v.number(),
  handler: async (ctx, { captains }) => {
    assertPreviewDeployment();
    const tournamentTeams =
      (await insertTournamentTeams(ctx, DEMO_TOURNAMENT, DEMO_TOURNAMENT_TEAMS, captains)) +
      (await insertTournamentTeams(
        ctx,
        DEMO_FULL_TOURNAMENT,
        DEMO_FULL_TOURNAMENT_TEAMS,
        captains,
      )) +
      (await insertTournamentTeams(ctx, DEMO_BRACKET_TOURNAMENT, DEMO_BRACKET_TEAMS, captains));
    await insertDemoBracketPartners(ctx, captains);
    await insertDemoBracket(ctx);
    await insertDemoTournamentWaitlistEntry(ctx, captains);
    const found = await findSeasonBySlugs(ctx, DEMO_TEAM_SEASON);
    if (!found) return tournamentTeams;
    let inserted =
      tournamentTeams + (await insertSeasonTeams(ctx, found.season._id, DEMO_TEAMS, captains));
    await insertDemoRemovedPlayer(ctx, captains);
    const full = await findSeasonBySlugs(ctx, DEMO_FULL_SEASON);
    if (full) {
      inserted += await insertSeasonTeams(ctx, full.season._id, DEMO_FULL_SEASON_TEAMS, captains);
      await insertDemoWaitlistEntry(ctx, full.season._id, captains);
    }
    return inserted;
  },
});

async function insertTournamentTeams(
  ctx: MutationCtx,
  slugs: { orgSlug: string; tournamentSlug: string },
  teams: readonly { name: string; captainEmail: string }[],
  captains: readonly { email: string; authUserId: string }[],
): Promise<number> {
  const organization = await organizationBySlug(ctx, slugs.orgSlug);
  const found =
    organization && (await findTournamentBySlugs(ctx, organization, slugs.tournamentSlug));
  if (!found) return 0;
  const tournamentId = found.tournament._id;
  let inserted = 0;
  for (const team of teams) {
    const authUserId = captains.find((captain) => captain.email === team.captainEmail)?.authUserId;
    if (authUserId === undefined) continue;
    const sortName = teamSortName(team.name);
    const named = await ctx.db
      .query('teams')
      .withIndex('by_tournamentId_and_sortName', (q) =>
        q.eq('tournamentId', tournamentId).eq('sortName', sortName),
      )
      .first();
    if (named) continue;
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user || (await adultEntryInTournament(ctx, tournamentId, user._id))) continue;
    const tournament = await ctx.db.get('tournaments', tournamentId);
    if (!tournament || tournamentIsFull(tournament)) return inserted;
    await insertTournamentTeamWithCaptain(ctx, tournament, {
      name: team.name,
      captainUserId: user._id,
    });
    inserted++;
  }
  return inserted;
}

async function demoBracketTournament(ctx: MutationCtx): Promise<Doc<'tournaments'> | null> {
  const organization = await organizationBySlug(ctx, DEMO_BRACKET_TOURNAMENT.orgSlug);
  const found =
    organization &&
    (await findTournamentBySlugs(ctx, organization, DEMO_BRACKET_TOURNAMENT.tournamentSlug));
  return found ? found.tournament : null;
}

/** A team below the minimum roster size gets its partner; a roster at the minimum is not refilled. */
async function insertDemoBracketPartners(
  ctx: MutationCtx,
  people: readonly { email: string; authUserId: string }[],
): Promise<void> {
  const tournament = await demoBracketTournament(ctx);
  if (!tournament) return;
  for (const { name, partnerEmail } of DEMO_BRACKET_TEAMS) {
    const authUserId = people.find((person) => person.email === partnerEmail)?.authUserId;
    const team = await ctx.db
      .query('teams')
      .withIndex('by_tournamentId_and_sortName', (q) =>
        q.eq('tournamentId', tournament._id).eq('sortName', teamSortName(name)),
      )
      .first();
    if (authUserId === undefined || !team || team.rosterCount >= tournament.minimumRosterSize) {
      continue;
    }
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user || (await adultEntryInTournament(ctx, tournament._id, user._id))) continue;
    await addRosterEntry(ctx, team, {
      userId: user._id,
      source: 'invite',
      addedByUserId: team.captainUserId,
    });
  }
}

/** Once, and only with every demo team confirmed, so the bracket is never made from some of them and left out of date. */
async function insertDemoBracket(ctx: MutationCtx): Promise<void> {
  const tournament = await demoBracketTournament(ctx);
  if (!tournament || (await bracketExists(ctx, tournament._id))) return;
  const { seeds } = await seededTeamsOf(ctx, tournament);
  if (seeds.length < DEMO_BRACKET_TEAMS.length) return;
  await replaceBracket(ctx, tournament._id, seeds, []);
}

async function insertDemoWaitlistEntry(
  ctx: MutationCtx,
  seasonId: Id<'seasons'>,
  captains: readonly { email: string; authUserId: string }[],
): Promise<void> {
  const { teamName, captainEmail } = DEMO_WAITLIST_ENTRY;
  const authUserId = captains.find((captain) => captain.email === captainEmail)?.authUserId;
  if (authUserId === undefined) return;
  const seeded = await ctx.db
    .query('waitlistEntries')
    .withIndex('by_seasonId_and_sortName', (q) =>
      q.eq('seasonId', seasonId).eq('sortName', teamSortName(teamName)),
    )
    .first();
  if (seeded || (await teamWithSortName(ctx, seasonId, teamName))) return;
  const user = await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
  const season = await ctx.db.get('seasons', seasonId);
  // Only a full season puts the team on the waitlist; any other would register it.
  if (!user || !season || !seasonIsFull(season)) return;
  await registerTeamOrJoinWaitlist(ctx, season, { name: teamName, captainUserId: user._id });
}

async function insertDemoTournamentWaitlistEntry(
  ctx: MutationCtx,
  captains: readonly { email: string; authUserId: string }[],
): Promise<void> {
  const { teamName, captainEmail } = DEMO_TOURNAMENT_WAITLIST_ENTRY;
  const authUserId = captains.find((captain) => captain.email === captainEmail)?.authUserId;
  if (authUserId === undefined) return;
  const organization = await organizationBySlug(ctx, DEMO_FULL_TOURNAMENT.orgSlug);
  const found =
    organization &&
    (await findTournamentBySlugs(ctx, organization, DEMO_FULL_TOURNAMENT.tournamentSlug));
  if (!found) return;
  const tournamentId = found.tournament._id;
  const seeded = await ctx.db
    .query('waitlistEntries')
    .withIndex('by_tournamentId_and_sortName', (q) =>
      q.eq('tournamentId', tournamentId).eq('sortName', teamSortName(teamName)),
    )
    .first();
  if (seeded) return;
  const user = await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
  const tournament = await ctx.db.get('tournaments', tournamentId);
  // Only a full tournament puts the team on the waitlist; any other would register it.
  if (!user || !tournament || !tournamentIsFull(tournament)) return;
  await registerTournamentTeamOrJoinWaitlist(ctx, tournament, {
    name: teamName,
    captainUserId: user._id,
  });
}

async function insertSeasonTeams(
  ctx: MutationCtx,
  seasonId: Id<'seasons'>,
  teams: readonly { name: string; captainEmail: string }[],
  captains: readonly { email: string; authUserId: string }[],
): Promise<number> {
  let inserted = 0;
  for (const team of teams) {
    const authUserId = captains.find((captain) => captain.email === team.captainEmail)?.authUserId;
    if (authUserId === undefined) continue;
    if (await teamWithSortName(ctx, seasonId, team.name)) continue;
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user) continue;
    if (await adultEntryInSeason(ctx, seasonId, user._id)) continue;
    const season = await ctx.db.get('seasons', seasonId);
    if (!season || seasonIsFull(season)) return inserted;
    await insertTeamWithCaptain(ctx, season, { name: team.name, captainUserId: user._id });
    inserted++;
  }
  return inserted;
}

/** Once: any entry of the person in the season, removed included, means it was seeded already. */
async function insertDemoRemovedPlayer(
  ctx: MutationCtx,
  people: readonly { email: string; authUserId: string }[],
): Promise<void> {
  const authUserId = people.find(
    (person) => person.email === DEMO_REMOVED_PLAYER.email,
  )?.authUserId;
  if (authUserId === undefined) return;
  const found = await findSeasonBySlugs(ctx, DEMO_TEAM_SEASON);
  if (!found) return;
  const seasonId = found.season._id;
  const team = await teamWithSortName(ctx, seasonId, DEMO_REMOVED_PLAYER.teamName);
  if (!team) return;
  const user = await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
  if (!user) return;
  const seeded = await ctx.db
    .query('rosterEntries')
    .withIndex('by_seasonId_and_userId_and_minorName_and_status', (q) =>
      q.eq('seasonId', seasonId).eq('userId', user._id),
    )
    .first();
  if (seeded || (await freeAgentInSeason(ctx, seasonId, user._id))) return;
  const entryId = await addRosterEntry(ctx, team, {
    userId: user._id,
    source: 'invite',
    addedByUserId: team.captainUserId,
  });
  const entry = await ctx.db.get('rosterEntries', entryId);
  if (entry) await removeRosterEntry(ctx, entry, team.captainUserId);
}

/** Each demo invite is inserted once, by its marker, even after it is revoked. */
export const insertDemoTeamInvites = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    assertPreviewDeployment();
    const found = await findSeasonBySlugs(ctx, DEMO_TEAM_SEASON);
    const team = found
      ? await teamWithSortName(ctx, found.season._id, DEMO_TEAM_INVITES.teamName)
      : null;
    if (!team) return 0;
    let inserted = 0;
    for (const invite of DEMO_TEAM_INVITES.invites) {
      const marked = await ctx.db
        .query('teamInvites')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', invite.tokenHash))
        .first();
      if (marked || (await pendingTeamInvite(ctx, team._id, invite.email))) continue;
      const current = await ctx.db.get('teams', team._id);
      if (!current) return inserted;
      await insertTeamInvite(ctx, current, {
        ...invite,
        expiresAt: Date.now() + INVITE_LIFETIME_MS,
        invitedByUserId: current.captainUserId,
      });
      inserted++;
    }
    return inserted;
  },
});

/** Each invite is inserted once, by its marker, so a revoked or removed one is not put back. */
export const insertDemoTournamentInvites = internalMutation({
  args: { people: v.array(v.object({ email: v.string(), authUserId: v.string() })) },
  returns: v.number(),
  handler: async (ctx, { people }) => {
    assertPreviewDeployment();
    const organization = await organizationBySlug(ctx, DEMO_TOURNAMENT.orgSlug);
    const found =
      organization &&
      (await findTournamentBySlugs(ctx, organization, DEMO_TOURNAMENT.tournamentSlug));
    if (!found) return 0;
    const team = await ctx.db
      .query('teams')
      .withIndex('by_tournamentId_and_sortName', (q) =>
        q
          .eq('tournamentId', found.tournament._id)
          .eq('sortName', teamSortName(DEMO_TOURNAMENT_INVITES.teamName)),
      )
      .first();
    if (!team) return 0;
    const { pending, accepted } = DEMO_TOURNAMENT_INVITES;
    let inserted = 0;
    const marked = async (tokenHash: string) =>
      ctx.db
        .query('teamInvites')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .first();
    const invite = (row: { email: string; tokenHash: string }) =>
      insertTeamInvite(ctx, team, {
        ...row,
        expiresAt: Date.now() + INVITE_LIFETIME_MS,
        invitedByUserId: team.captainUserId,
      });
    if (
      !(await marked(pending.tokenHash)) &&
      !(await pendingTeamInvite(ctx, team._id, pending.email))
    ) {
      await invite(pending);
      inserted++;
    }
    const authUserId = people.find((person) => person.email === accepted.email)?.authUserId;
    const user =
      authUserId === undefined
        ? null
        : await ctx.db
            .query('users')
            .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
            .unique();
    if (
      user &&
      !(await marked(accepted.tokenHash)) &&
      !(await adultEntryInTournament(ctx, found.tournament._id, user._id))
    ) {
      await acceptTeamInvite(ctx, await invite(accepted), user._id);
      inserted++;
    }
    return inserted;
  },
});

export const insertDemoTeamPlayer = internalMutation({
  args: { authUserId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { authUserId }) => {
    assertPreviewDeployment();
    const found = await findSeasonBySlugs(ctx, DEMO_TEAM_SEASON);
    if (!found) return false;
    const seasonId = found.season._id;
    const team = await teamWithSortName(ctx, seasonId, DEMO_TEAM_PLAYER.teamName);
    if (!team) return false;
    const marked = await ctx.db
      .query('teamInvites')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', DEMO_TEAM_PLAYER.tokenHash))
      .first();
    if (marked || (await pendingTeamInvite(ctx, team._id, DEMO_TEAM_PLAYER.email))) return false;
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user || (await adultEntryInSeason(ctx, seasonId, user._id))) return false;
    const inviteId = await insertTeamInvite(ctx, team, {
      email: DEMO_TEAM_PLAYER.email,
      tokenHash: DEMO_TEAM_PLAYER.tokenHash,
      expiresAt: Date.now() + INVITE_LIFETIME_MS,
      invitedByUserId: team.captainUserId,
    });
    await acceptTeamInvite(ctx, inviteId, user._id);
    return true;
  },
});

export const insertDemoMinor = internalMutation({
  args: { authUserId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { authUserId }) => {
    assertPreviewDeployment();
    const found = await findSeasonBySlugs(ctx, DEMO_TEAM_SEASON);
    const team = found ? await teamWithSortName(ctx, found.season._id, DEMO_MINOR.teamName) : null;
    if (!team) return false;
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user) return false;
    const seeded = await ctx.db
      .query('rosterEntries')
      .withIndex('by_seasonId_and_userId_and_minorName_and_status', (q) =>
        q.eq('seasonId', team.seasonId).eq('userId', user._id),
      )
      .first();
    if (seeded) return false;
    await addMinorEntry(ctx, team, {
      guardianUserId: user._id,
      minorName: DEMO_MINOR.minorName,
      source: 'invite',
      addedByUserId: team.captainUserId,
    });
    return true;
  },
});

/**
 * Inserts each demo free agent whose account is in `people` (auth user ids by address) and who has no
 * free-agent row and no roster entry in its season yet, through the roster writer. Returns the free
 * agents inserted.
 */
export const insertDemoFreeAgents = internalMutation({
  args: { people: v.array(v.object({ email: v.string(), authUserId: v.string() })) },
  returns: v.number(),
  handler: async (ctx, { people }) => {
    assertPreviewDeployment();
    let inserted = 0;
    for (const freeAgent of DEMO_FREE_AGENTS) {
      const authUserId = people.find((person) => person.email === freeAgent.email)?.authUserId;
      if (authUserId === undefined) continue;
      const found = await findSeasonBySlugs(ctx, freeAgent.season);
      if (!found) continue;
      const user = await ctx.db
        .query('users')
        .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
        .unique();
      if (!user) continue;
      if (await freeAgentInSeason(ctx, found.season._id, user._id)) continue;
      if (await adultEntryInSeason(ctx, found.season._id, user._id)) continue;
      await insertFreeAgent(ctx, found.season, user._id);
      inserted++;
    }
    if (await insertDemoPlacedFreeAgent(ctx, people)) inserted++;
    return inserted;
  },
});

async function insertDemoPlacedFreeAgent(
  ctx: MutationCtx,
  people: readonly { email: string; authUserId: string }[],
): Promise<boolean> {
  const authUserId = people.find(
    (person) => person.email === DEMO_PLACED_FREE_AGENT.email,
  )?.authUserId;
  if (authUserId === undefined) return false;
  const found = await findSeasonBySlugs(ctx, DEMO_TEAM_SEASON);
  if (!found) return false;
  const seasonId = found.season._id;
  const team = await teamWithSortName(ctx, seasonId, DEMO_PLACED_FREE_AGENT.teamName);
  if (!team) return false;
  const user = await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
  if (!user) return false;
  if (await freeAgentInSeason(ctx, seasonId, user._id)) return false;
  if (await adultEntryInSeason(ctx, seasonId, user._id)) return false;
  await insertPlacedFreeAgent(ctx, team, user._id);
  return true;
}

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
 * error code or status, never by message text (`better-auth` 1.7.18, `sign-up.mjs` and the
 * `haveIBeenPwned` plugin): the length and breach codes are `rejected`, a breach check that could
 * not run (status 500, no code) is `check_unavailable`, an address that already exists, or that a
 * concurrent run took during the create, is `present`, and anything else throws a message that
 * holds neither the password nor Better Auth's text.
 */
async function signUp(
  auth: ReturnType<typeof createAuth>,
  { email, name }: { email: string; name: string },
  password: string,
  label: string,
): Promise<SignUpOutcome> {
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
    throw new Error(`seed:demo could not create the ${label} demo account${named}`);
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

  const signedUp = await signUp(auth, DEMO_ACCOUNTS[key], password, key);
  if (signedUp.kind === 'created') return { code: 'created', authUserId: signedUp.authUserId };
  if (signedUp.kind === 'rejected') return { code: signedUp.code };

  // Another run took the address between the lookup and the create.
  const again = await ctx.runQuery(internal.seed.findDemoCredential, { account: key });
  if (again.status === 'absent') {
    throw new Error(`seed:demo could not create the ${key} demo account and found none`);
  }
  return verifyExistingAccount(again, password);
}

/** Answers the person's auth user id, or `null` when sign-up refused it this run (a later run tries again). */
async function ensureFictionalUser(
  ctx: ActionCtx,
  auth: ReturnType<typeof createAuth>,
  person: { email: string; name: string },
): Promise<string | null> {
  const existing = await ctx.runQuery(internal.seed.findFictionalDemoUser, { email: person.email });
  if (existing !== null) return existing;
  // Made here and discarded, so the account has no usable password.
  const signedUp = await signUp(auth, person, generateInviteToken(), 'fictional user');
  if (signedUp.kind === 'created') return signedUp.authUserId;
  if (signedUp.kind === 'rejected') return null;
  // Another run took the address between the lookup and the create.
  return ctx.runQuery(internal.seed.findFictionalDemoUser, { email: person.email });
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
    const logos = await ensureDemoLogo(ctx);
    const invites = await ctx.runMutation(internal.seed.insertDemoInvite, {
      tokenHash: await hashInviteToken(generateInviteToken()),
    });

    const password = env.DEMO_ACCOUNT_PASSWORD;
    const accounts: Record<AccountKey, AccountCode> = {
      admin: 'skipped:unset',
      organizer: 'skipped:unset',
      player: 'skipped:unset',
      captain: 'skipped:unset',
      guardian: 'skipped:unset',
    };
    let memberships = 0;
    let teams = 0;
    let teamInvites = 0;
    let freeAgents = 0;
    if (password !== undefined && password !== '') {
      const auth = createAuth(ctx);
      const people: { email: string; authUserId: string }[] = [];
      for (const key of ACCOUNT_KEYS) {
        const outcome = await ensureAccount(ctx, auth, key, password);
        accounts[key] = outcome.code;
        if (outcome.authUserId !== undefined) {
          people.push({ email: DEMO_ACCOUNTS[key].email, authUserId: outcome.authUserId });
          memberships += await ctx.runMutation(internal.seed.grantDemoMemberships, {
            authUserId: outcome.authUserId,
            account: key,
          });
        }
      }
      // The demo teams are data for the demo accounts to see, so none is seeded while no account exists.
      if (people.length > 0) {
        for (const person of FICTIONAL_PEOPLE) {
          const authUserId = await ensureFictionalUser(ctx, auth, person);
          if (authUserId !== null) people.push({ email: person.email, authUserId });
        }
        teams = await ctx.runMutation(internal.seed.insertDemoTeams, { captains: people });
        teamInvites = await ctx.runMutation(internal.seed.insertDemoTeamInvites, {});
        const player = people.find((account) => account.email === DEMO_TEAM_PLAYER.email);
        if (player) {
          await ctx.runMutation(internal.seed.insertDemoTeamPlayer, {
            authUserId: player.authUserId,
          });
        }
        teamInvites += await ctx.runMutation(internal.seed.insertDemoTournamentInvites, { people });
        freeAgents = await ctx.runMutation(internal.seed.insertDemoFreeAgents, { people });
        const guardian = people.find((account) => account.email === DEMO_MINOR.guardianEmail);
        if (guardian) {
          await ctx.runMutation(internal.seed.insertDemoMinor, {
            authUserId: guardian.authUserId,
          });
        }
      }
    }
    return { ...data, logos, memberships, invites, teams, teamInvites, freeAgents, accounts };
  },
});
