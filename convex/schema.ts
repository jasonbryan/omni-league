import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { sportValidator } from './lib/sports';

export default defineSchema({
  // Organizations are created only by seeds until #64 adds creation. The slug is unique
  // (enforced by the writers in convex/lib/tenantWrites.ts) and names the public page.
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
  }).index('by_slug', ['slug']),

  locations: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    address: v.string(),
  }).index('by_organizationId_and_name', ['organizationId', 'name']),

  // A league is held at one or more of its organization's locations; the list is short and set by
  // an organizer, so it lives on the league. The slug is unique within the organization.
  leagues: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationIds: v.array(v.id('locations')),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_slug', ['organizationId', 'slug']),
});
