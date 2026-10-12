import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { env, internalMutation, type MutationCtx } from './_generated/server';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { findLeagueBySlugs } from './lib/seasonLookup';
import {
  backfilledValidator,
  backfillTenantFields,
  insertLeague,
  insertLocation,
  insertSeason,
  insertTenant,
  seasonSlugTaken,
  type NewSeason,
  type Tenant,
} from './lib/tenantWrites';

/**
 * The demo organizations. All names and addresses are fictional demo values. The first two are
 * the organizations of the approved mockup (design/mockups/60-organization-page.html, #73), kept
 * exactly as the mockup shows them: one with leagues and locations, one empty. Every sport has
 * leagues in at least two organizations, and some organizations run more than one sport.
 *
 * Later features add their demo rows here, under the same insert-only rule (hosting.md, Demo
 * data): never rename or remove an entry, because a renamed one is inserted again next to the old.
 *
 * Exported for `e2e/pwa.spec.ts` (#82), which opens these pages on a production build seeded by
 * `seed:demo`. A plain value, not a Convex function, so it adds nothing to the API.
 */
export const DEMO: readonly Tenant[] = [
  {
    organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
    locations: [
      { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
      { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
      { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
    ],
    leagues: [
      { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Bayside Athletic Complex'] },
      { name: "Men's Over-30 11v11", sport: 'soccer', locations: ['Bayside Athletic Complex'] },
      {
        name: 'Sunday Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
      },
      {
        name: 'Thursday Night Coed 2s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
      },
      {
        name: 'Wednesday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      },
    ],
  },
  {
    organization: {
      name: 'Port Aransas Beach Volleyball Club',
      slug: 'port-aransas-beach-volleyball-club',
    },
    locations: [],
    leagues: [],
  },
  {
    organization: { name: 'Front Range Rec Sports', slug: 'front-range-rec-sports' },
    locations: [
      { name: 'Cottonwood Creek Fields', address: '1850 Cottonwood Creek Pkwy, Denver, CO 80219' },
      { name: 'Bluebird Softball Complex', address: '7720 Bluebird Ridge Rd, Aurora, CO 80016' },
      { name: 'Larkspur Turf Center', address: '455 Larkspur Mesa Dr, Lakewood, CO 80228' },
    ],
    leagues: [
      { name: 'Coed 6v6 Indoor', sport: 'soccer', locations: ['Larkspur Turf Center'] },
      { name: "Women's Sunday 11v11", sport: 'soccer', locations: ['Cottonwood Creek Fields'] },
      {
        name: 'Monday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Bluebird Softball Complex'],
      },
      {
        name: "Men's Modified Fast-Pitch",
        sport: 'softball',
        locations: ['Bluebird Softball Complex', 'Cottonwood Creek Fields'],
      },
    ],
  },
  {
    organization: { name: 'Lakeshore Sand League', slug: 'lakeshore-sand-league' },
    locations: [
      { name: 'Driftwood Beach Courts', address: '2600 Driftwood Shore Dr, Chicago, IL 60614' },
      { name: 'Harbor Point Sand Courts', address: '915 Harbor Point Ave, Evanston, IL 60201' },
    ],
    leagues: [
      {
        name: "Tuesday Women's 2s",
        sport: 'beachVolleyball',
        locations: ['Driftwood Beach Courts'],
      },
      {
        name: 'Saturday Coed 6s',
        sport: 'beachVolleyball',
        locations: ['Driftwood Beach Courts', 'Harbor Point Sand Courts'],
      },
      {
        name: "Competitive Men's 4s",
        sport: 'beachVolleyball',
        locations: ['Harbor Point Sand Courts'],
      },
    ],
  },
  {
    organization: { name: 'Saguaro Valley Softball', slug: 'saguaro-valley-softball' },
    locations: [
      { name: 'Saguaro Ridge Park', address: '3180 Saguaro Ridge Rd, Phoenix, AZ 85042' },
      { name: 'Mesquite Flats Diamonds', address: '640 Mesquite Flats Ln, Tempe, AZ 85281' },
    ],
    leagues: [
      {
        name: 'Friday Night Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Saguaro Ridge Park'],
      },
      { name: 'Senior 55+ Slow-Pitch', sport: 'softball', locations: ['Mesquite Flats Diamonds'] },
      {
        name: "Men's D Division Slow-Pitch",
        sport: 'softball',
        locations: ['Saguaro Ridge Park', 'Mesquite Flats Diamonds'],
      },
    ],
  },
];

/**
 * The demo seasons (#125): draft seasons of demo leagues, by the organization's and the league's
 * slug. Only drafts are seeded here; #126 inserts the published ones under other slugs
 * (`summer-2027`), so on a reused staging an insert-only seed never leaves a stale draft under a
 * published season's slug. Never rename or remove an entry (hosting.md, Demo data).
 *
 * A plain value, not a Convex function, so it adds nothing to the API.
 */
export const DEMO_SEASONS: readonly {
  organizationSlug: string;
  leagueSlug: string;
  season: NewSeason;
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
      format: '4v4',
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
      format: '7v7',
      minimumRosterSize: 7,
    },
  },
];

/** Rows inserted by one run, per table, and the rows its backfill changed (#100). */
const resultValidator = v.object({
  organizations: v.number(),
  locations: v.number(),
  leagues: v.number(),
  seasons: v.number(),
  backfilled: backfilledValidator,
});

/**
 * Throws unless `PREVIEW_ORIGIN_PATTERN` is exactly this project's preview origin pattern. Every
 * preview and staging deployment has it as a Convex default preview variable (hosting.md), and
 * `scripts/check-deploy-env.mjs production` fails when production has it, so the seed cannot write
 * on production even when run from the dashboard or the CLI. The message holds no value.
 */
function assertPreviewDeployment(): void {
  if (env.PREVIEW_ORIGIN_PATTERN !== PREVIEW_ORIGIN_PATTERN) {
    throw new Error(
      'seed:demo refused: PREVIEW_ORIGIN_PATTERN on this deployment is not the preview origin ' +
        'pattern of convex/lib/previewOrigin.ts, so this is not a preview or staging deployment',
    );
  }
}

/** The id of the organization with this slug, inserting the organization when it is missing. */
async function ensureOrganization(
  ctx: MutationCtx,
  tenant: Tenant,
): Promise<{ id: Id<'organizations'>; inserted: boolean }> {
  const { slug } = tenant.organization;
  const existing = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
  if (existing) return { id: existing._id, inserted: false };
  // insertTenant validates the slug; the locations and leagues follow one by one below.
  const id = await insertTenant(ctx, {
    organization: tenant.organization,
    locations: [],
    leagues: [],
  });
  return { id, inserted: true };
}

/**
 * Demo data for deploy previews and staging, run by `npx convex run seed:demo --preview-name
 * <name>` on every build of netlify.toml's `deploy-preview` and `branch-deploy` contexts, after
 * the deploy environment check. The production context never runs it.
 *
 * Insert-only, per record: it inserts each demo organization (by slug), location (by name within
 * its organization), and league (by name within its organization, with its location links) only
 * when it is missing, through the shared writers, which keep the organization's counters. It
 * never deletes a row, and a second run inserts nothing. It returns the number of rows it inserted
 * per table, which the build log shows. It throws before reading or writing unless the deployment
 * is a preview or staging deployment (`assertPreviewDeployment`).
 *
 * It also inserts the draft demo seasons (`DEMO_SEASONS`, #125) of the demo leagues, by slug within
 * the league, through `insertSeason`.
 *
 * Before inserting, it backfills the fields #100, #101, and #66 added on any row written before
 * them (`backfillTenantFields`, the only update it makes, on demo and other rows alike): `sortName`,
 * the counters, and `status` `published` on a league without one, before the recount that counts
 * only published leagues. It reports the changed rows as `backfilled`. Every demo league is inserted
 * `published`. #104 removes the backfill.
 */
export const demo = internalMutation({
  args: {},
  returns: resultValidator,
  handler: async (ctx) => {
    assertPreviewDeployment();
    const backfilled = await backfillTenantFields(ctx);
    const inserted = { organizations: 0, locations: 0, leagues: 0, seasons: 0 };
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

      for (const league of tenant.leagues) {
        const existing = await ctx.db
          .query('leagues')
          .withIndex('by_organizationId_and_name', (q) =>
            q.eq('organizationId', organizationId).eq('name', league.name),
          )
          .first();
        if (existing) continue;
        // Links the league to its named locations, which exist by now; throws on an unknown one.
        await insertLeague(ctx, organizationId, league);
        inserted.leagues++;
      }
    }

    // The seasons last, so every demo league exists. A season is inserted when its league has none
    // under the slug, whatever that one's status; a league that is missing (a slug collision made
    // the stored slug differ) is skipped.
    for (const { organizationSlug, leagueSlug, season } of DEMO_SEASONS) {
      const found = await findLeagueBySlugs(ctx, { orgSlug: organizationSlug, leagueSlug });
      if (!found) continue;
      if (await seasonSlugTaken(ctx, found.league._id, season.slug)) continue;
      await insertSeason(ctx, found.league, season);
      inserted.seasons++;
    }
    return { ...inserted, backfilled };
  },
});
