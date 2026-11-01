import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { ageGroupValidator, genderValidator, standardLevelValidator } from './lib/divisions';
import { inviteStatusValidator } from './lib/inviteStatus';
import { leagueStatusValidator } from './lib/leagueStatus';
import { roleValidator } from './lib/roles';
import { rosterEntrySourceValidator, rosterEntryStatusValidator } from './lib/rosterEntry';
import { seasonStatusValidator } from './lib/seasonStatus';
import { formatValidator, sportCountsValidator, sportValidator } from './lib/sports';

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

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    cityState: v.optional(v.string()),
    leagueCount: v.optional(v.number()),
    locationCount: v.optional(v.number()),
    sportLeagueCounts: v.optional(sportCountsValidator),
    sportLocationCounts: v.optional(sportCountsValidator),
    sortName: v.optional(v.string()),
    hasPublishedLeague: v.optional(v.boolean()),
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
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_userId_and_organizationId', ['userId', 'organizationId']),

  invites: defineTable({
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
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
    gender: v.optional(genderValidator),
    playersPerSide: v.optional(v.number()),
    /** Always a standard level, the value filters use; `customLevelId` is the label shown instead. */
    level: v.optional(standardLevelValidator),
    customLevelId: v.optional(v.id('customLevels')),
    ageGroup: v.optional(ageGroupValidator),
    /** Absent means `playersPerSide`; when set it is at least that, and at most `ROSTER_SIZE_INPUT_MAX`. */
    minimumRosterSize: v.optional(v.number()),
    /** The words a search finds the league by: its name, its organization's name, its locations' names, and City, state. */
    searchText: v.optional(v.string()),
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
    // Whether any league still uses a custom level, so deleting one reads an index, not the table.
    .index('by_customLevelId', ['customLevelId'])
    .searchIndex('search_searchText', {
      searchField: 'searchText',
      filterFields: ['status', 'sport'],
    }),

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
    playersPerSide: v.optional(v.number()),
    format: v.optional(formatValidator),
    minimumRosterSize: v.number(),
    status: seasonStatusValidator,
    /** Kept by `convex/lib/rosterWrites.ts`; absent on a season written before teams existed, which has none. */
    teamCount: v.optional(v.number()),
  })
    .index('by_leagueId_and_slug', ['leagueId', 'slug'])
    .index('by_leagueId_and_startDate', ['leagueId', 'startDate'])
    .index('by_leagueId_and_status_and_startDate', ['leagueId', 'status', 'startDate'])
    .index('by_organizationId_and_status_and_registrationDeadline', [
      'organizationId',
      'status',
      'registrationDeadline',
    ]),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps `rosterCount` and the season's `teamCount`.
  teams: defineTable({
    organizationId: v.id('organizations'),
    leagueId: v.id('leagues'),
    seasonId: v.id('seasons'),
    name: v.string(),
    // `name` lowercased: names are unique in a season ignoring case.
    sortName: v.string(),
    captainUserId: v.id('users'),
    /** The team's `rostered` entries. */
    rosterCount: v.number(),
    createdAt: v.number(),
  })
    .index('by_seasonId_and_sortName', ['seasonId', 'sortName'])
    .index('by_captainUserId', ['captainUserId']),

  // A removed entry keeps its row, with status `removed`, so records that point at it stay valid.
  rosterEntries: defineTable({
    organizationId: v.id('organizations'),
    seasonId: v.id('seasons'),
    teamId: v.id('teams'),
    userId: v.id('users'),
    status: rosterEntryStatusValidator,
    source: rosterEntrySourceValidator,
    addedAt: v.number(),
    addedByUserId: v.id('users'),
    removedAt: v.optional(v.number()),
    removedByUserId: v.optional(v.id('users')),
  })
    .index('by_teamId_and_status', ['teamId', 'status'])
    .index('by_seasonId_and_userId', ['seasonId', 'userId'])
    .index('by_userId_and_status', ['userId', 'status']),
});
