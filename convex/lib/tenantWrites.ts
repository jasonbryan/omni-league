import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  ageGroupValidator,
  customLevelNameKey,
  deriveDivisionFromName,
  genderValidator,
  isLevelOfSport,
  isPlayersPerSideOfSport,
  playersPerSideOfSport,
  standardLevelValidator,
  type AgeGroup,
  type Gender,
  type StandardLevel,
} from './divisions';
import { leagueStatusValidator, type LeagueStatus } from './leagueStatus';
import type { SeasonStatus } from './seasonStatus';
import { isChoosableSlug, isSlug, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH, slugify } from './slugs';
import {
  ROSTER_SIZE_INPUT_MAX,
  seasonPlayersPerSide,
  sportValidator,
  type Sport,
  type SportCounts,
} from './sports';

export const divisionSeedValidator = v.object({
  gender: genderValidator,
  playersPerSide: v.number(),
  level: standardLevelValidator,
  customLevel: v.optional(v.string()),
  ageGroup: ageGroupValidator,
  minimumRosterSize: v.optional(v.number()),
});

export type DivisionSeed = Infer<typeof divisionSeedValidator>;

export const leagueSeedValidator = v.object({
  name: v.string(),
  sport: sportValidator,
  locations: v.array(v.string()),
  status: v.optional(leagueStatusValidator),
  division: v.optional(divisionSeedValidator),
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
  const division = league.division
    ? await resolveDivision(ctx, organizationId, league.sport, league.division)
    : undefined;
  const leagueId = await insertLeagueRow(
    ctx,
    organizationId,
    { name: league.name, slug, sport: league.sport, locationIds, division },
    league.status ?? 'published',
  );
  return { leagueId, slug };
}

export interface LeagueDivision {
  gender: Gender;
  playersPerSide: number;
  level: StandardLevel;
  customLevelId?: Id<'customLevels'>;
  ageGroup: AgeGroup;
  minimumRosterSize?: number;
}

export interface NewLeague {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
  division?: LeagueDivision | undefined;
}

async function resolveDivision(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  sport: Sport,
  { customLevel, ...division }: DivisionSeed,
): Promise<LeagueDivision> {
  if (customLevel === undefined) return division;
  const found = await findCustomLevel(ctx, organizationId, sport, customLevel);
  if (!found) {
    throw new Error(`No custom level ${JSON.stringify(customLevel)} exists for ${sport}`);
  }
  if (found.standardLevel !== division.level) {
    throw new Error(
      `Custom level ${JSON.stringify(customLevel)} maps to ${found.standardLevel}, not ${division.level}`,
    );
  }
  return { ...division, customLevelId: found._id };
}

export interface NewCustomLevel {
  sport: Sport;
  name: string;
  standardLevel: StandardLevel;
}

export async function findCustomLevel(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
  sport: Sport,
  name: string,
): Promise<Doc<'customLevels'> | null> {
  return ctx.db
    .query('customLevels')
    .withIndex('by_organizationId_and_sport_and_nameKey', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('sport', sport)
        .eq('nameKey', customLevelNameKey(name)),
    )
    .unique();
}

// The caller has checked access and that the name is free.
export async function insertCustomLevel(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  level: NewCustomLevel,
): Promise<Id<'customLevels'>> {
  if (!isLevelOfSport(level.sport, level.standardLevel)) {
    throw new Error(`Level ${level.standardLevel} is not a level of ${level.sport}`);
  }
  return ctx.db.insert('customLevels', {
    organizationId,
    sport: level.sport,
    name: level.name,
    nameKey: customLevelNameKey(level.name),
    standardLevel: level.standardLevel,
    createdAt: Date.now(),
  });
}

// The caller has checked access and that no league uses it.
export async function deleteCustomLevel(
  ctx: MutationCtx,
  customLevelId: Id<'customLevels'>,
): Promise<void> {
  await ctx.db.delete('customLevels', customLevelId);
}

export async function insertDraftLeague(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  league: NewLeague & { division: LeagueDivision },
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
  playersPerSide: number;
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
    playersPerSide: season.playersPerSide,
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
  if (league.division) assertDivision(league.sport, league.division);
  const leagueId = await ctx.db.insert('leagues', {
    organizationId,
    name: league.name,
    slug: league.slug,
    sport: league.sport,
    locationIds: league.locationIds,
    sortName: sortName(league.name),
    status,
    publishedSeasonCount: 0,
    ...divisionFields(league.division),
  });
  if (status === 'published') {
    await increment(ctx, organizationId, 'leagueCount');
    await countLeagueInSport(ctx, organizationId, league.sport, league.locationIds);
  }
  return leagueId;
}

function assertDivision(sport: Sport, division: LeagueDivision): void {
  const { playersPerSide, level, minimumRosterSize } = division;
  if (!isPlayersPerSideOfSport(sport, playersPerSide)) {
    throw new Error(`${playersPerSide} players per side is not a format of ${sport}`);
  }
  if (!isLevelOfSport(sport, level)) {
    throw new Error(`Level ${level} is not a level of ${sport}`);
  }
  if (
    minimumRosterSize !== undefined &&
    !(
      Number.isInteger(minimumRosterSize) &&
      minimumRosterSize >= playersPerSide &&
      minimumRosterSize <= ROSTER_SIZE_INPUT_MAX
    )
  ) {
    throw new Error(
      `Minimum roster size ${minimumRosterSize} must be a whole number from ${playersPerSide} to ${ROSTER_SIZE_INPUT_MAX}`,
    );
  }
}

function divisionFields(division: LeagueDivision | undefined) {
  if (!division) return {};
  const { customLevelId, minimumRosterSize, ...required } = division;
  return {
    ...required,
    ...(customLevelId !== undefined && { customLevelId }),
    ...(minimumRosterSize !== undefined && { minimumRosterSize }),
  };
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

export const divisionBackfilledValidator = v.object({
  seasons: v.number(),
  leagueDivisions: v.number(),
});

export interface DemoDivision {
  organizationSlug: string;
  leagueName: string;
  division: DivisionSeed;
}

type LeagueDivisionPatch = Partial<
  Pick<
    Doc<'leagues'>,
    'gender' | 'playersPerSide' | 'level' | 'customLevelId' | 'ageGroup' | 'minimumRosterSize'
  >
>;

export async function backfillDivisionFields(
  ctx: MutationCtx,
  demoDivisions: readonly DemoDivision[],
): Promise<Infer<typeof divisionBackfilledValidator>> {
  const backfilled = { seasons: 0, leagueDivisions: 0 };
  const unmigratedSeasons = await ctx.db
    .query('seasons')
    // eslint-disable-next-line @convex-dev/no-filter-in-query -- no index covers `format`; a temporary pass over a small table
    .filter((q) => q.neq(q.field('format'), undefined))
    .take(BACKFILL_SCAN_LIMIT);
  for (const season of unmigratedSeasons) {
    await ctx.db.patch('seasons', season._id, {
      playersPerSide: seasonPlayersPerSide(season),
      format: undefined,
    });
    backfilled.seasons++;
  }

  const organizationSlugs = new Map<Id<'organizations'>, string | undefined>();
  const incompleteLeagues = await ctx.db
    .query('leagues')
    // eslint-disable-next-line @convex-dev/no-filter-in-query -- no index covers a missing field; a temporary pass over a small table
    .filter((q) =>
      q.or(
        q.eq(q.field('playersPerSide'), undefined),
        q.eq(q.field('gender'), undefined),
        q.eq(q.field('level'), undefined),
        q.eq(q.field('ageGroup'), undefined),
      ),
    )
    .take(BACKFILL_SCAN_LIMIT);
  for (const league of incompleteLeagues) {
    if (!organizationSlugs.has(league.organizationId)) {
      const organization = await ctx.db.get('organizations', league.organizationId);
      organizationSlugs.set(league.organizationId, organization?.slug);
    }
    const organizationSlug = organizationSlugs.get(league.organizationId);
    const demo = demoDivisions.find(
      (entry) => entry.organizationSlug === organizationSlug && entry.leagueName === league.name,
    )?.division;
    const derived = deriveDivisionFromName(league.name, league.sport);
    const newest = await ctx.db
      .query('seasons')
      .withIndex('by_leagueId_and_startDate', (q) => q.eq('leagueId', league._id))
      .order('desc')
      .first();

    const playersPerSide =
      league.playersPerSide ??
      demo?.playersPerSide ??
      // The season pass may not have reached this season yet.
      (newest ? seasonPlayersPerSide(newest) : undefined) ??
      derived.playersPerSide ??
      playersPerSideOfSport(league.sport)[0];
    const patch: LeagueDivisionPatch = {
      gender: league.gender ?? demo?.gender ?? derived.gender ?? 'coed',
      playersPerSide,
      level: league.level ?? demo?.level ?? derived.level ?? 'rec',
      ageGroup: league.ageGroup ?? demo?.ageGroup ?? 'adult',
    };
    if (demo?.customLevel !== undefined && league.customLevelId === undefined) {
      const customLevel = await findCustomLevel(
        ctx,
        league.organizationId,
        league.sport,
        demo.customLevel,
      );
      if (customLevel) patch.customLevelId = customLevel._id;
    }
    if (league.playersPerSide === undefined) {
      const minimum = demo
        ? demo.minimumRosterSize
        : newest && newest.minimumRosterSize > playersPerSide
          ? newest.minimumRosterSize
          : undefined;
      if (minimum !== undefined) patch.minimumRosterSize = minimum;
    }
    await ctx.db.patch('leagues', league._id, patch);
    backfilled.leagueDivisions++;
  }
  return backfilled;
}
