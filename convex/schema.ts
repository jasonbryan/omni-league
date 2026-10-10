import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { roleValidator } from './lib/roles';
import { sportCountsValidator, sportValidator } from './lib/sports';

// Every write to organizations, locations, leagues, and sportLocations goes through
// convex/lib/tenantWrites.ts, which keeps `sortName`, the organization's counters, and the
// sportLocations rows in the same mutation as the row (#100, #101).
// Those fields are optional only until every existing row is backfilled (`seed:demo`); #104 makes
// them required.
export default defineSchema({
  // The app's record of each account (#62, ADR 0008 "Identity key"). Created by the Better Auth
  // component's `user.onCreate` trigger in the same transaction as the auth user, and deleted by
  // `onDelete`. Keyed on the Better Auth user id, which is the JWT `sub` (`identity.subject`).
  // `adultConfirmedAt` is when the account holder confirmed being 18 or older: the sign-up hook
  // refuses any sign-up without that confirmation, so the trigger stamps the creation time.
  users: defineTable({
    authUserId: v.string(),
    name: v.string(),
    adultConfirmedAt: v.number(),
  }).index('by_authUserId', ['authUserId']),

  // Created by `organizations.create` (#64) and the seeds, through convex/lib/tenantWrites.ts. The
  // slug is unique (enforced by the writers) and names the public page.
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    /** The organization's number of leagues: the public page's Leagues total. */
    leagueCount: v.optional(v.number()),
    /** The organization's number of locations: the public page's Locations total. */
    locationCount: v.optional(v.number()),
    /** The organization's number of leagues of each sport (#101). */
    sportLeagueCounts: v.optional(sportCountsValidator),
    /**
     * The organization's number of distinct locations that hold a league of each sport (#101): the
     * number of its `sportLocations` rows of that sport.
     */
    sportLocationCounts: v.optional(sportCountsValidator),
  }).index('by_slug', ['slug']),

  // A user's role in one organization (#64, glossary: Membership), at most one row per user and
  // organization. `leagueIds` are the leagues assigned to a `leagueOrganizer` (empty for an
  // `orgAdmin`, who runs every league). Every staff function authorizes through
  // convex/lib/access.ts.
  memberships: defineTable({
    userId: v.id('users'),
    organizationId: v.id('organizations'),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_userId_and_organizationId', ['userId', 'organizationId']),

  locations: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    address: v.string(),
    /** `name` lowercased, so the index sorts by name ignoring case. */
    sortName: v.optional(v.string()),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_sortName', ['organizationId', 'sortName']),

  // A league is held at one or more of its organization's locations; the list is short and set by
  // an organizer, so it lives on the league. The slug is unique within the organization.
  leagues: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationIds: v.array(v.id('locations')),
    /** `name` lowercased, so the indexes sort by name ignoring case. */
    sortName: v.optional(v.string()),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_slug', ['organizationId', 'slug'])
    .index('by_organizationId_and_sortName', ['organizationId', 'sortName'])
    .index('by_organizationId_and_sport_and_sortName', ['organizationId', 'sport', 'sortName']),

  // How many leagues of one sport are held at one location (#101). A row exists while that number
  // is at least 1, so the rows of a sport are its distinct locations: the count a delete can keep
  // correct without a scan. At most 3 rows per location.
  sportLocations: defineTable({
    organizationId: v.id('organizations'),
    sport: sportValidator,
    locationId: v.id('locations'),
    leagueCount: v.number(),
  }).index('by_organizationId_and_sport_and_locationId', ['organizationId', 'sport', 'locationId']),
});
