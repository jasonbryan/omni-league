import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { sportValidator } from './lib/sports';

// Every write to organizations, locations, and leagues goes through convex/lib/tenantWrites.ts,
// which keeps `sortName` and the organization's counters in the same mutation as the row (#100).
// Those fields are optional only until every existing row is backfilled (`seed:demo`); #104 makes
// them required.
export default defineSchema({
  // Organizations are created only by seeds until #64 adds creation. The slug is unique
  // (enforced by the writers in convex/lib/tenantWrites.ts) and names the public page.
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    /** The organization's number of leagues: the public page's Leagues total. */
    leagueCount: v.optional(v.number()),
    /** The organization's number of locations: the public page's Locations total. */
    locationCount: v.optional(v.number()),
  }).index('by_slug', ['slug']),

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
});
