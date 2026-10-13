import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { inviteStatusValidator } from './lib/inviteStatus';
import { leagueStatusValidator } from './lib/leagueStatus';
import { roleValidator } from './lib/roles';
import { seasonStatusValidator } from './lib/seasonStatus';
import { formatValidator, sportCountsValidator, sportValidator } from './lib/sports';

// Every write to organizations, locations, leagues, sportLocations, and seasons goes through
// convex/lib/tenantWrites.ts, which keeps `sortName`, the organization's counters, the
// sportLocations rows, and the league's `publishedSeasonCount` in the same mutation as the row
// (#100, #101, #127).
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

  // The per-address sign-in throttle (#63, ADR 0008 "Rate limits and lockout"): one row for each
  // email address with consecutive password failures, known or not, so an unknown address
  // behaves exactly like a known one. `email` is the key from `throttleKey` (convex/lib/
  // signInThrottle.ts). `failures` counts the consecutive attempts that have not yet signed in:
  // an attempt is counted when it starts, so parallel guesses are counted before any is checked,
  // and a success deletes the row. Attempts before `blockedUntil` (ms since the epoch) are
  // refused, and at 100 `failures` the address stays refused until the owner deletes the row in
  // the Convex dashboard (a password reset does after #26). Only the internal functions in
  // convex/signInThrottle.ts read or write it; no public function exposes it.
  signInFailures: defineTable({
    email: v.string(),
    failures: v.number(),
    blockedUntil: v.number(),
  }).index('by_email', ['email']),

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

  // An invitation to join an organization's staff (#67, ADR 0008, glossary: Invite). A pending
  // invite grants nothing; accepting it (#70) creates the membership. `email` is normalised
  // (trimmed, lower case). Only the SHA-256 hash of the token is stored, as lower-case hex: the
  // token is made in the `invites.create` action, shown once in the invite link, and never read
  // back. `expiresAt` is 14 days after creation; an invite that has expired keeps status
  // `pending` until it is revoked, and blocks a new invite to the address until then.
  // `leagueIds` are the leagues of a `leagueOrganizer` invite (empty for an `orgAdmin`).
  invites: defineTable({
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    tokenHash: v.string(),
    expiresAt: v.number(),
    status: inviteStatusValidator,
    /**
     * When an org admin revoked the invite (#211), which `invites.restore` measures its 10-minute
     * window from. Set by `revoke` and cleared by `restore`; rows revoked before it existed have
     * none and cannot be restored. No backfill.
     */
    revokedAt: v.optional(v.number()),
  })
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_email_and_status', ['organizationId', 'email', 'status'])
    .index('by_tokenHash', ['tokenHash']),

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
    /**
     * `draft` until an organizer publishes the league (#66, #69); only `published` leagues reach the
     * public pages and their counters. Optional only until every existing row is backfilled
     * (`seed:demo` sets `published`); #104 or a named follow-up makes it required. A row without
     * one is on no public index and is listed to staff as a draft.
     */
    status: v.optional(leagueStatusValidator),
    /**
     * The league's number of `published` seasons (#127): the public league page's Seasons total.
     * Kept by `insertSeason` and `publishSeason` in convex/lib/tenantWrites.ts, in the same
     * mutation as the season row. A league without one (written before #127) reads as 0 until
     * `seed:demo` sets it from a recount; #104 or a named follow-up makes it required.
     */
    publishedSeasonCount: v.optional(v.number()),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_slug', ['organizationId', 'slug'])
    // Every league of the organization, drafts included, for its admin area.
    .index('by_organizationId_and_sortName', ['organizationId', 'sortName'])
    // The public lists read `status` = `published`, so drafts never take a place in a page.
    .index('by_organizationId_and_status_and_sortName', ['organizationId', 'status', 'sortName'])
    .index('by_organizationId_and_sport_and_status_and_sortName', [
      'organizationId',
      'sport',
      'status',
      'sortName',
    ]),

  // How many leagues of one sport are held at one location (#101). A row exists while that number
  // is at least 1, so the rows of a sport are its distinct locations: the count a delete can keep
  // correct without a scan. At most 3 rows per location.
  sportLocations: defineTable({
    organizationId: v.id('organizations'),
    sport: sportValidator,
    locationId: v.id('locations'),
    leagueCount: v.number(),
  }).index('by_organizationId_and_sport_and_locationId', ['organizationId', 'sport', 'locationId']),

  // A season of a league (#125, glossary: Season): registration, teams, the schedule, standings,
  // and fees belong to a season. Inserted only by `insertSeason` in convex/lib/tenantWrites.ts.
  // `organizationId` is the league's organization, copied at insert. The dates are calendar
  // dates written `YYYY-MM-DD` with no time zone (convex/lib/seasonInput.ts). Registration closes
  // at the end of `registrationDeadline` and when the season starts, so the deadline is before
  // `startDate`; `seasons.create` checks that, and `insertSeason` does not. A season is a `draft`
  // until an organizer publishes it (#126); only a `published` one reaches public pages. There is
  // no price: ADR 0012's payment slice 2 adds prices.
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
    // The slug is unique within the league (`seasonSlugTaken`); every season route resolves it here.
    .index('by_leagueId_and_slug', ['leagueId', 'slug'])
    // Every season of the league, drafts included, newest start date first: the organizer's list.
    .index('by_leagueId_and_startDate', ['leagueId', 'startDate'])
    // The public league page reads `status` = `published`, so drafts never take a place in it.
    .index('by_leagueId_and_status_and_startDate', ['leagueId', 'status', 'startDate']),
});
