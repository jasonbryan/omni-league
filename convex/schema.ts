import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { inviteStatusValidator } from './lib/inviteStatus';
import { leagueStatusValidator } from './lib/leagueStatus';
import { roleValidator } from './lib/roles';
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
    leagueCount: v.optional(v.number()),
    locationCount: v.optional(v.number()),
    sportLeagueCounts: v.optional(sportCountsValidator),
    sportLocationCounts: v.optional(sportCountsValidator),
  }).index('by_slug', ['slug']),

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
    ]),

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
    format: formatValidator,
    minimumRosterSize: v.number(),
    status: seasonStatusValidator,
  })
    .index('by_leagueId_and_slug', ['leagueId', 'slug'])
    .index('by_leagueId_and_startDate', ['leagueId', 'startDate'])
    .index('by_leagueId_and_status_and_startDate', ['leagueId', 'status', 'startDate']),
});
