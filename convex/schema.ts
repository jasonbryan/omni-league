import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { ageGroupValidator, genderValidator, standardLevelValidator } from './lib/divisions';
import { freeAgentStatusValidator } from './lib/freeAgent';
import { inviteStatusValidator } from './lib/inviteStatus';
import { leagueStatusValidator } from './lib/leagueStatus';
import { programStatusValidator, programTypeValidator } from './lib/programs';
import { roleValidator } from './lib/roles';
import { rosterEntrySourceValidator, rosterEntryStatusValidator } from './lib/rosterEntry';
import { seasonStatusValidator } from './lib/seasonStatus';
import { sportCountsValidator, sportValidator } from './lib/sports';
import { waitlistEntryStatusValidator } from './lib/waitlist';

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    name: v.string(),
    adultConfirmedAt: v.number(),
  }).index('by_authUserId', ['authUserId']),

  // A row exists for unknown addresses too, so a throttled sign-in cannot reveal which addresses
  // have accounts.
  signInFailures: defineTable({
    email: v.string(),
    failures: v.number(),
    blockedUntil: v.number(),
  }).index('by_email', ['email']),

  ipRateLimits: defineTable({
    key: v.string(),
    count: v.number(),
    lastRequest: v.number(),
    expiresAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_expiresAt', ['expiresAt']),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    cityState: v.optional(v.string()),
    leagueCount: v.optional(v.number()),
    draftLeagueCount: v.optional(v.number()),
    locationCount: v.optional(v.number()),
    staffCount: v.optional(v.number()),
    pendingInviteCount: v.optional(v.number()),
    sportLeagueCounts: v.optional(sportCountsValidator),
    sportLocationCounts: v.optional(sportCountsValidator),
    sortName: v.string(),
    hasPublishedLeague: v.boolean(),
    logoStorageId: v.optional(v.id('_storage')),
  })
    .index('by_slug', ['slug'])
    .index('by_hasPublishedLeague_and_sortName', ['hasPublishedLeague', 'sortName'])
    .index('by_logoStorageId', ['logoStorageId']),

  memberships: defineTable({
    userId: v.id('users'),
    organizationId: v.id('organizations'),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    /** Programs of a type other than league that the organizer runs; absent means none. */
    programIds: v.optional(v.array(v.id('programs'))),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_userId_and_organizationId', ['userId', 'organizationId']),

  // Written only through `convex/lib/inviteWrites.ts`, which keeps the organization's `pendingInviteCount`; the one exception is `testing:resetSchemaBatch`, which empties every table, organizations included.
  invites: defineTable({
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    /** Programs of a type other than league the invite assigns; absent means none. */
    programIds: v.optional(v.array(v.id('programs'))),
    // Only the hash is stored, so a database read cannot reveal a usable invite link.
    tokenHash: v.string(),
    expiresAt: v.number(),
    status: inviteStatusValidator,
    revokedAt: v.optional(v.number()),
  })
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_email_and_status', ['organizationId', 'email', 'status'])
    .index('by_tokenHash', ['tokenHash']),

  locations: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    address: v.string(),
    // `name` lowercased: Convex indexes sort case-sensitively.
    sortName: v.optional(v.string()),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_sortName', ['organizationId', 'sortName']),

  leagues: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationIds: v.array(v.id('locations')),
    // `name` lowercased: Convex indexes sort case-sensitively.
    sortName: v.optional(v.string()),
    status: v.optional(leagueStatusValidator),
    publishedSeasonCount: v.optional(v.number()),
    /** The league's `programs` row, kept in step by `convex/lib/tenantWrites.ts`. */
    programId: v.id('programs'),
    gender: genderValidator,
    playersPerSide: v.number(),
    /** Always a standard level, the value filters use; `customLevelId` is the label shown instead. */
    level: standardLevelValidator,
    customLevelId: v.optional(v.id('customLevels')),
    ageGroup: ageGroupValidator,
    /** Absent means `playersPerSide`; when set it is at least that, and at most `ROSTER_SIZE_INPUT_MAX`. */
    minimumRosterSize: v.optional(v.number()),
    /** The words a search finds the league by: its name, its organization's name, its locations' names, and City, state. */
    searchText: v.string(),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_slug', ['organizationId', 'slug'])
    .index('by_organizationId_and_sortName', ['organizationId', 'sortName'])
    .index('by_organizationId_and_status_and_sortName', ['organizationId', 'status', 'sortName'])
    .index('by_organizationId_and_sport_and_status_and_sortName', [
      'organizationId',
      'sport',
      'status',
      'sortName',
    ])
    .index('by_status_and_sport_and_sortName', ['status', 'sport', 'sortName'])
    .searchIndex('search_searchText', {
      searchField: 'searchText',
      filterFields: ['status', 'sport'],
    }),

  // The fields every program type shares, so a slug is unique across types and one index lists them. The tenant writers keep a league's row equal to the league.
  programs: defineTable({
    organizationId: v.id('organizations'),
    type: programTypeValidator,
    name: v.string(),
    // `name` lowercased: Convex indexes sort case-sensitively.
    sortName: v.string(),
    slug: v.string(),
    sport: sportValidator,
    status: programStatusValidator,
    locationIds: v.array(v.id('locations')),
    gender: genderValidator,
    playersPerSide: v.number(),
    level: standardLevelValidator,
    customLevelId: v.optional(v.id('customLevels')),
    ageGroup: ageGroupValidator,
    /** Set on a program of the league type. */
    leagueId: v.optional(v.id('leagues')),
  })
    .index('by_organizationId_and_slug', ['organizationId', 'slug'])
    .index('by_customLevelId', ['customLevelId'])
    .index('by_organizationId_and_type_and_status_and_sortName', [
      'organizationId',
      'type',
      'status',
      'sortName',
    ]),

  // The tournament part of a program of type `tournament`; `programs` holds its name, slug, and division. Written only by `convex/lib/tenantWrites.ts`.
  tournaments: defineTable({
    programId: v.id('programs'),
    organizationId: v.id('organizations'),
    /** The program's `status` and `sport`, kept equal to it by the tenant writers so the date indexes can serve the public lists. */
    status: programStatusValidator,
    sport: sportValidator,
    /** Calendar dates, `YYYY-MM-DD`; a one-day tournament ends on its start date. */
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    maximumTeams: v.number(),
    /** Kept by `convex/lib/rosterWrites.ts`; absent on a tournament with no team yet. */
    teamCount: v.optional(v.number()),
    /** The division's players per side. */
    minimumRosterSize: v.number(),
    structure: v.literal('bracket'),
    bracketType: v.literal('single'),
  })
    .index('by_programId', ['programId'])
    .index('by_organizationId_and_startDate', ['organizationId', 'startDate'])
    .index('by_organizationId_and_status_and_endDate', ['organizationId', 'status', 'endDate'])
    .index('by_organizationId_and_sport_and_status_and_endDate', [
      'organizationId',
      'sport',
      'status',
      'endDate',
    ])
    .index('by_organizationId_and_status_and_registrationDeadline', [
      'organizationId',
      'status',
      'registrationDeadline',
    ]),

  // A level an organization names for one sport (a letter class such as "D"), mapped to the
  // standard level that filters use. `nameKey` is `name` trimmed, with inner whitespace collapsed
  // and lower-cased, so names that differ only in case or spacing are one level.
  customLevels: defineTable({
    organizationId: v.id('organizations'),
    sport: sportValidator,
    name: v.string(),
    nameKey: v.string(),
    standardLevel: standardLevelValidator,
    createdAt: v.number(),
  }).index('by_organizationId_and_sport_and_nameKey', ['organizationId', 'sport', 'nameKey']),

  sportLocations: defineTable({
    organizationId: v.id('organizations'),
    sport: sportValidator,
    locationId: v.id('locations'),
    leagueCount: v.number(),
  }).index('by_organizationId_and_sport_and_locationId', ['organizationId', 'sport', 'locationId']),

  seasons: defineTable({
    organizationId: v.id('organizations'),
    leagueId: v.id('leagues'),
    name: v.string(),
    slug: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    /** The league's players per side when the season was created. */
    playersPerSide: v.number(),
    minimumRosterSize: v.number(),
    status: seasonStatusValidator,
    /** Kept by `convex/lib/rosterWrites.ts`; absent on a season written before teams existed, which has none. */
    teamCount: v.optional(v.number()),
    /** Absent means no limit. */
    maxTeams: v.optional(v.number()),
    /** Absent means no limit; when set it is at least `minimumRosterSize`. */
    maxRosterSize: v.optional(v.number()),
    /** The `waiting` waitlist entries, kept by `convex/lib/rosterWrites.ts`; absent on a season written before the waitlist existed, which has none. */
    waitlistCount: v.optional(v.number()),
  })
    .index('by_leagueId_and_slug', ['leagueId', 'slug'])
    .index('by_leagueId_and_startDate', ['leagueId', 'startDate'])
    .index('by_leagueId_and_status_and_startDate', ['leagueId', 'status', 'startDate'])
    .index('by_organizationId_and_status_and_registrationDeadline', [
      'organizationId',
      'status',
      'registrationDeadline',
    ]),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps `rosterCount` and the parent's `teamCount`.
  // A team has exactly one parent: `leagueId` with `seasonId`, or `tournamentId`.
  teams: defineTable({
    organizationId: v.id('organizations'),
    leagueId: v.optional(v.id('leagues')),
    seasonId: v.optional(v.id('seasons')),
    tournamentId: v.optional(v.id('tournaments')),
    name: v.string(),
    // `name` lowercased: names are unique in a season or a tournament ignoring case.
    sortName: v.string(),
    captainUserId: v.id('users'),
    /** The team's `rostered` entries. */
    rosterCount: v.number(),
    /** The team's `pending` invites, expired ones included; absent on a team written before invites existed, which has none. */
    pendingInviteCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_seasonId_and_sortName', ['seasonId', 'sortName'])
    .index('by_tournamentId_and_sortName', ['tournamentId', 'sortName'])
    .index('by_seasonId_and_rosterCount', ['seasonId', 'rosterCount'])
    .index('by_captainUserId', ['captainUserId']),

  // A removed entry keeps its row, with status `removed`, so records that point at it stay valid.
  rosterEntries: defineTable({
    organizationId: v.id('organizations'),
    /** Set with the team's `seasonId`, or `tournamentId` with the team's. */
    seasonId: v.optional(v.id('seasons')),
    tournamentId: v.optional(v.id('tournaments')),
    teamId: v.id('teams'),
    /** The guardian's, when the entry is a minor's. */
    userId: v.id('users'),
    /** Set only on a minor's entry, which has no account (requirements, Accounts). */
    minorName: v.optional(v.string()),
    status: rosterEntryStatusValidator,
    source: rosterEntrySourceValidator,
    addedAt: v.number(),
    addedByUserId: v.id('users'),
    removedAt: v.optional(v.number()),
    removedByUserId: v.optional(v.id('users')),
  })
    .index('by_teamId_and_status', ['teamId', 'status'])
    .index('by_seasonId_and_userId_and_minorName_and_status', [
      'seasonId',
      'userId',
      'minorName',
      'status',
    ])
    .index('by_tournamentId_and_userId_and_minorName', ['tournamentId', 'userId', 'minorName'])
    .index('by_userId_and_status', ['userId', 'status']),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps the team's `pendingInviteCount`.
  // A pending invite is not a roster entry.
  teamInvites: defineTable({
    organizationId: v.id('organizations'),
    /** Set with the team's `seasonId`; a tournament team's invite has none, and the team names its tournament. */
    seasonId: v.optional(v.id('seasons')),
    teamId: v.id('teams'),
    /** Trimmed and lowercased, so an address matches whatever its case. */
    email: v.string(),
    // Only the hash is stored, so a database read cannot reveal a usable invite link.
    tokenHash: v.string(),
    expiresAt: v.number(),
    status: inviteStatusValidator,
    invitedByUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_teamId_and_status', ['teamId', 'status'])
    .index('by_teamId_and_email', ['teamId', 'email'])
    .index('by_tokenHash', ['tokenHash']),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps one place per person per season:
  // a free agent is not a roster entry until placement adds one.
  freeAgents: defineTable({
    organizationId: v.id('organizations'),
    seasonId: v.id('seasons'),
    userId: v.id('users'),
    status: freeAgentStatusValidator,
    registeredAt: v.number(),
    placedTeamId: v.optional(v.id('teams')),
    placedAt: v.optional(v.number()),
  })
    .index('by_seasonId_and_status_and_registeredAt', ['seasonId', 'status', 'registeredAt'])
    .index('by_seasonId_and_userId', ['seasonId', 'userId'])
    .index('by_userId_and_status', ['userId', 'status']),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps the season's `waitlistCount`. A waiting entry is not a team or a
  // roster entry, so it carries no fee; promotion turns it into a team.
  waitlistEntries: defineTable({
    organizationId: v.id('organizations'),
    seasonId: v.id('seasons'),
    /** The captain. */
    userId: v.id('users'),
    teamName: v.string(),
    // `teamName` lowercased: a team name is unique across the season's teams and waiting entries.
    sortName: v.string(),
    status: waitlistEntryStatusValidator,
    requestedAt: v.number(),
    promotedTeamId: v.optional(v.id('teams')),
    promotedAt: v.optional(v.number()),
    promotedByUserId: v.optional(v.id('users')),
  })
    .index('by_seasonId_and_status_and_requestedAt', ['seasonId', 'status', 'requestedAt'])
    .index('by_seasonId_and_userId', ['seasonId', 'userId'])
    .index('by_seasonId_and_sortName', ['seasonId', 'sortName']),

  // An endpoint is an unguessable capability URL only its browser holds, so presenting it is proof
  // enough to move its row to the caller.
  pushSubscriptions: defineTable({
    userId: v.id('users'),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    expirationTime: v.optional(v.number()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    lastSuccessAt: v.optional(v.number()),
    failureCount: v.number(),
  })
    .index('by_endpoint', ['endpoint'])
    .index('by_userId', ['userId'])
    .index('by_lastSeenAt', ['lastSeenAt']),

  // Reused for most of its 12 hours because Apple asks for no more than one new token an hour.
  // Never returned by a public function.
  pushVapidTokens: defineTable({
    origin: v.string(),
    publicKey: v.string(),
    subject: v.string(),
    authorization: v.string(),
    expiresAt: v.number(),
  })
    .index('by_origin', ['origin'])
    .index('by_expiresAt', ['expiresAt']),

  pushTestSends: defineTable({
    userId: v.id('users'),
    sentAt: v.number(),
  }).index('by_userId_and_sentAt', ['userId', 'sentAt']),
});
