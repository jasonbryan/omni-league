import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { leagueStatusValidator, type LeagueStatus } from './leagueStatus';
import type { SeasonStatus } from './seasonStatus';
import { isChoosableSlug, isSlug, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH, slugify } from './slugs';
import { sportValidator, type Format, type Sport, type SportCounts } from './sports';

export const leagueSeedValidator = v.object({
  name: v.string(),
  sport: sportValidator,
  locations: v.array(v.string()),
  status: v.optional(leagueStatusValidator),
});

export const tenantValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  leagues: v.array(leagueSeedValidator),
});

export type LeagueSeed = Infer<typeof leagueSeedValidator>;
export type LocationSeed = Infer<typeof tenantValidator>['locations'][number];
export type Tenant = Infer<typeof tenantValidator>;

export function sortName(name: string): string {
  return name.toLowerCase();
}

type Counter = 'leagueCount' | 'locationCount';

// An unset counter stays unset: the `seed:demo` backfill recounts it and skips a set one.
async function increment(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  counter: Counter,
): Promise<void> {
  const organization: Doc<'organizations'> | null = await ctx.db.get(
    'organizations',
    organizationId,
  );
  if (!organization) throw new Error('No organization has this id');
  const count = organization[counter];
  if (count === undefined) return;
  await ctx.db.patch('organizations', organizationId, { [counter]: count + 1 });
}

export async function organizationSlugTaken(ctx: MutationCtx, slug: string): Promise<boolean> {
  const taken = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();
  return taken !== null;
}

async function assertSlugFree(ctx: MutationCtx, slug: string): Promise<void> {
  if (!isSlug(slug)) {
    throw new Error(
      `Organization slug ${JSON.stringify(slug)} is not a slug (lowercase letters and digits ` +
        `joined by single hyphens, ${MIN_SLUG_LENGTH} to ${MAX_SLUG_LENGTH} characters)`,
    );
  }
  if (await organizationSlugTaken(ctx, slug)) {
    throw new Error(`Organization slug ${JSON.stringify(slug)} is taken`);
  }
}

export async function insertOrganization(
  ctx: MutationCtx,
  organization: { name: string; slug: string },
): Promise<Id<'organizations'>> {
  const { name, slug } = organization;
  // Reserved slugs are allowed: the demo seeds use them.
  await assertSlugFree(ctx, slug);
  return ctx.db.insert('organizations', {
    name,
    slug,
    leagueCount: 0,
    locationCount: 0,
    sportLeagueCounts: {},
    sportLocationCounts: {},
  });
}

export async function insertTenant(ctx: MutationCtx, tenant: Tenant): Promise<Id<'organizations'>> {
  await assertSlugFree(ctx, tenant.organization.slug);

  const locationNames = new Set<string>();
  for (const location of tenant.locations) {
    if (locationNames.has(location.name)) {
      throw new Error(`Location ${JSON.stringify(location.name)} is listed twice`);
    }
    locationNames.add(location.name);
  }
  for (const league of tenant.leagues) {
    for (const location of league.locations) {
      if (!locationNames.has(location)) {
        throw new Error(
          `League ${JSON.stringify(league.name)} names the unknown location ${JSON.stringify(location)}`,
        );
      }
    }
  }

  const organizationId = await insertOrganization(ctx, tenant.organization);
  for (const location of tenant.locations) {
    await insertLocation(ctx, organizationId, location);
  }
  for (const league of tenant.leagues) {
    await insertLeague(ctx, organizationId, league);
  }
  return organizationId;
}

export async function insertLocation(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  location: LocationSeed,
): Promise<Id<'locations'>> {
  const locationId = await ctx.db.insert('locations', {
    organizationId,
    name: location.name,
    address: location.address,
    sortName: sortName(location.name),
  });
  await increment(ctx, organizationId, 'locationCount');
  return locationId;
}

export async function updateLocation(
  ctx: MutationCtx,
  location: Doc<'locations'>,
  change: LocationSeed,
): Promise<void> {
  await ctx.db.patch('locations', location._id, {
    name: change.name,
    address: change.address,
    sortName: sortName(change.name),
  });
}

export async function insertLeague(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  league: LeagueSeed,
): Promise<{ leagueId: Id<'leagues'>; slug: string }> {
  const locationIds: Id<'locations'>[] = [];
  for (const name of league.locations) {
    const location = await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', organizationId).eq('name', name),
      )
      .first();
    if (!location) {
      throw new Error(
        `League ${JSON.stringify(league.name)} names the unknown location ${JSON.stringify(name)}`,
      );
    }
    locationIds.push(location._id);
  }
  const slug = await uniqueLeagueSlug(ctx, organizationId, slugify(league.name));
  const leagueId = await insertLeagueRow(
    ctx,
    organizationId,
    { name: league.name, slug, sport: league.sport, locationIds },
    league.status ?? 'published',
  );
  return { leagueId, slug };
}

export interface NewLeague {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
}

export async function insertDraftLeague(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  league: NewLeague,
): Promise<Id<'leagues'>> {
  return insertLeagueRow(ctx, organizationId, league, 'draft');
}

export async function publishLeague(ctx: MutationCtx, league: Doc<'leagues'>): Promise<void> {
  if (league.status === 'published') return;
  await ctx.db.patch('leagues', league._id, { status: 'published' });
  const wasPublicAndCounted = league.status === undefined;
  if (wasPublicAndCounted) return;
  await increment(ctx, league.organizationId, 'leagueCount');
  await countLeagueInSport(ctx, league.organizationId, league.sport, league.locationIds);
}

export interface NewSeason {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  format: Format;
  minimumRosterSize: number;
}

// Values are validated in `seasons.create`, not here, so a seed can hold a deadline on or after the
// start date.
export async function insertSeason(
  ctx: MutationCtx,
  league: Doc<'leagues'>,
  season: NewSeason,
  status: SeasonStatus = 'draft',
): Promise<Id<'seasons'>> {
  const seasonId = await ctx.db.insert('seasons', {
    organizationId: league.organizationId,
    leagueId: league._id,
    name: season.name,
    slug: season.slug,
    startDate: season.startDate,
    endDate: season.endDate,
    registrationDeadline: season.registrationDeadline,
    format: season.format,
    minimumRosterSize: season.minimumRosterSize,
    status,
  });
  if (status === 'published') await countPublishedSeason(ctx, league._id);
  return seasonId;
}

export async function publishSeason(ctx: MutationCtx, season: Doc<'seasons'>): Promise<void> {
  if (season.status === 'published') return;
  await ctx.db.patch('seasons', season._id, { status: 'published' });
  await countPublishedSeason(ctx, season.leagueId);
}

// Read fresh so a stale `Doc` cannot lose a count. An unset counter is recounted, which already
// includes this season.
async function countPublishedSeason(ctx: MutationCtx, leagueId: Id<'leagues'>): Promise<void> {
  const league = await ctx.db.get('leagues', leagueId);
  if (!league) throw new Error('No league has this id');
  const count =
    league.publishedSeasonCount === undefined
      ? await recountPublishedSeasons(ctx, leagueId)
      : league.publishedSeasonCount + 1;
  await ctx.db.patch('leagues', leagueId, { publishedSeasonCount: count });
}

export async function seasonSlugTaken(
  ctx: Pick<MutationCtx, 'db'>,
  leagueId: Id<'leagues'>,
  slug: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_slug', (q) => q.eq('leagueId', leagueId).eq('slug', slug))
    .first();
  return existing !== null;
}

async function insertLeagueRow(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  league: NewLeague,
  status: LeagueStatus,
): Promise<Id<'leagues'>> {
  const leagueId = await ctx.db.insert('leagues', {
    organizationId,
    name: league.name,
    slug: league.slug,
    sport: league.sport,
    locationIds: league.locationIds,
    sortName: sortName(league.name),
    status,
    publishedSeasonCount: 0,
  });
  if (status === 'published') {
    await increment(ctx, organizationId, 'leagueCount');
    await countLeagueInSport(ctx, organizationId, league.sport, league.locationIds);
  }
  return leagueId;
}

export async function leagueSlugTaken(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
  slug: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organizationId).eq('slug', slug),
    )
    .first();
  return existing !== null;
}

// A sport counted here for an organization with unset sport counters would be counted twice by the
// backfill, which recounts counters and rows together; such an organization is left alone.
async function countLeagueInSport(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  sport: Sport,
  locationIds: Id<'locations'>[],
): Promise<void> {
  const organization = await ctx.db.get('organizations', organizationId);
  if (!organization) throw new Error('No organization has this id');
  const { sportLeagueCounts, sportLocationCounts } = organization;
  if (sportLeagueCounts === undefined || sportLocationCounts === undefined) return;
  let newLocations = 0;
  for (const locationId of new Set(locationIds)) {
    const row = await ctx.db
      .query('sportLocations')
      .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
        q.eq('organizationId', organizationId).eq('sport', sport).eq('locationId', locationId),
      )
      .unique();
    if (row) {
      await ctx.db.patch('sportLocations', row._id, { leagueCount: row.leagueCount + 1 });
    } else {
      await ctx.db.insert('sportLocations', { organizationId, sport, locationId, leagueCount: 1 });
      newLocations++;
    }
  }
  await ctx.db.patch('organizations', organizationId, {
    sportLeagueCounts: { ...sportLeagueCounts, [sport]: (sportLeagueCounts[sport] ?? 0) + 1 },
    sportLocationCounts:
      newLocations === 0
        ? sportLocationCounts
        : { ...sportLocationCounts, [sport]: (sportLocationCounts[sport] ?? 0) + newLocations },
  });
}

async function uniqueLeagueSlug(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  base: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const slug = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!isChoosableSlug(slug)) continue;
    if (!(await leagueSlugTaken(ctx, organizationId, slug))) return slug;
  }
}

async function recountPublishedSeasons(ctx: MutationCtx, leagueId: Id<'leagues'>): Promise<number> {
  const published = await ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_status_and_startDate', (q) =>
      q.eq('leagueId', leagueId).eq('status', 'published'),
    )
    .take(BACKFILL_SCAN_LIMIT);
  return published.length;
}

export const BACKFILL_SCAN_LIMIT = 1000;

export const backfilledValidator = v.object({
  organizations: v.number(),
  locations: v.number(),
  leagues: v.number(),
});

export async function backfillTenantFields(
  ctx: MutationCtx,
): Promise<Infer<typeof backfilledValidator>> {
  const backfilled = { organizations: 0, locations: 0, leagues: 0 };
  for (const location of await ctx.db.query('locations').take(BACKFILL_SCAN_LIMIT)) {
    if (location.sortName !== undefined) continue;
    await ctx.db.patch('locations', location._id, { sortName: sortName(location.name) });
    backfilled.locations++;
  }
  // Runs before the organization pass, whose recount reads each league's status.
  for (const league of await ctx.db.query('leagues').take(BACKFILL_SCAN_LIMIT)) {
    if (
      league.sortName !== undefined &&
      league.status !== undefined &&
      league.publishedSeasonCount !== undefined
    ) {
      continue;
    }
    await ctx.db.patch('leagues', league._id, {
      sortName: league.sortName ?? sortName(league.name),
      status: league.status ?? 'published',
      publishedSeasonCount:
        league.publishedSeasonCount ?? (await recountPublishedSeasons(ctx, league._id)),
    });
    backfilled.leagues++;
  }
  for (const organization of await ctx.db.query('organizations').take(BACKFILL_SCAN_LIMIT)) {
    if (
      organization.leagueCount !== undefined &&
      organization.locationCount !== undefined &&
      organization.sportLeagueCounts !== undefined &&
      organization.sportLocationCounts !== undefined
    ) {
      continue;
    }
    const organizationId = organization._id;
    const locations = await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
      .take(BACKFILL_SCAN_LIMIT);
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
      .take(BACKFILL_SCAN_LIMIT);
    // Recount from no rows, so a row left by an earlier partial run is not counted twice.
    const existingRows = await ctx.db
      .query('sportLocations')
      .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
        q.eq('organizationId', organizationId),
      )
      .take(BACKFILL_SCAN_LIMIT);
    for (const row of existingRows) await ctx.db.delete('sportLocations', row._id);
    const sportLeagueCounts: SportCounts = {};
    const sportLocationCounts: SportCounts = {};
    const leaguesPerLocation = new Map<string, number>();
    for (const league of leagues) {
      if (league.status !== 'published') continue;
      sportLeagueCounts[league.sport] = (sportLeagueCounts[league.sport] ?? 0) + 1;
      for (const locationId of new Set(league.locationIds)) {
        const key = `${league.sport}/${locationId}`;
        leaguesPerLocation.set(key, (leaguesPerLocation.get(key) ?? 0) + 1);
      }
    }
    for (const [key, leagueCount] of leaguesPerLocation) {
      const [sport, locationId] = key.split('/') as [Sport, Id<'locations'>];
      await ctx.db.insert('sportLocations', { organizationId, sport, locationId, leagueCount });
      sportLocationCounts[sport] = (sportLocationCounts[sport] ?? 0) + 1;
    }
    await ctx.db.patch('organizations', organizationId, {
      leagueCount: leagues.filter((league) => league.status === 'published').length,
      locationCount: locations.length,
      sportLeagueCounts,
      sportLocationCounts,
    });
    backfilled.organizations++;
  }
  return backfilled;
}
