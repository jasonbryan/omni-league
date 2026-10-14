// Writers for an organization with its locations, leagues, and seasons: `organizations.create`
// (#64), `locations.create` and `locations.update` (#65), `leagues.create` (#66) and
// `leagues.publish` (#69), `seasons.create` (#125) and `seasons.publish` (#126), and the seeds,
// `seed:demo` (previews and staging) and the IS_TEST tenant seeds in `convex/testing.ts`. These are
// the only writers of these tables.
//
// Writer contract (#100, #101): every insert, update, or delete of an organization, location,
// league, or `sportLocations` row goes through this module, which keeps each row's `sortName`, the
// organization's `leagueCount` and `locationCount`, its per-sport `sportLeagueCounts` and
// `sportLocationCounts`, and the `sportLocations` rows in the same mutation as the row. A write
// elsewhere makes the public page's totals, sports, and page count disagree with its rows. Only
// published leagues count (#66): `insertLeague` counts a published league, and a draft
// (`insertDraftLeague`, `leagues.create`) changes no counter and writes no `sportLocations` row.
// `publishLeague` (#69) counts a draft once, when it becomes `published`. The first writer that
// unpublishes or deletes a league, or changes its locations, decrements what `insertLeague`
// incremented: `leagueCount`, `sportLeagueCounts[sport]`, and the `sportLocations` row of each
// location the league leaves, deleting that row at 0 and decrementing `sportLocationCounts[sport]`.
//
// Writer contract for seasons (#127): every season insert goes through `insertSeason` (#125) and
// every season publish through `publishSeason` (#126). Each keeps the league's
// `publishedSeasonCount`, the public league page's Seasons total, in the same mutation as the
// season: `insertSeason` adds 1 for a season inserted as `published`, `publishSeason` adds 1 when
// a draft becomes `published` and nothing for a repeat. A league without the counter (written
// before #127, or inserted by a path that does not set it) reads as 0 in the reader, and a writer
// sets it from a recount of the league's published seasons. The first writer that unpublishes or
// deletes a published season decrements it.
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

/**
 * A league to create; `locations` names locations of the same organization. `status` is
 * `published` when left out, so a seed's pages are public; only the e2e seeds ask for a `draft`.
 */
export const leagueSeedValidator = v.object({
  name: v.string(),
  sport: sportValidator,
  locations: v.array(v.string()),
  status: v.optional(leagueStatusValidator),
  division: v.optional(divisionSeedValidator),
});

/** An organization with its locations and leagues. */
export const tenantValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  leagues: v.array(leagueSeedValidator),
});

export type LeagueSeed = Infer<typeof leagueSeedValidator>;
export type LocationSeed = Infer<typeof tenantValidator>['locations'][number];
export type Tenant = Infer<typeof tenantValidator>;

/** The key a location or league sorts by: its name, lowercased, so the order ignores case. */
export function sortName(name: string): string {
  return name.toLowerCase();
}

type Counter = 'leagueCount' | 'locationCount';

/**
 * Adds 1 to one of the organization's counters. A counter that is not set yet (a row written
 * before #100) stays unset: the backfill in `seed:demo` sets it from a recount, which would skip it
 * once set, so counting from 0 here would leave it short.
 */
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

/** Whether an organization already has this slug. */
export async function organizationSlugTaken(ctx: MutationCtx, slug: string): Promise<boolean> {
  const taken = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();
  return taken !== null;
}

/** Throws when the slug is malformed or an organization already has it. */
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

/**
 * Inserts an organization with its counters at zero (`leagueCount`, `locationCount`, and the
 * sport counters empty) and no `sportLocations` row: the writer of `organizations.create` (#64)
 * and of every seed. Throws before writing when the slug is malformed or taken. A reserved slug is
 * allowed here, because the demo seeds use them; `organizations.create` refuses them first.
 */
export async function insertOrganization(
  ctx: MutationCtx,
  organization: { name: string; slug: string },
): Promise<Id<'organizations'>> {
  const { name, slug } = organization;
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

/**
 * Inserts the organization, then its locations, then its leagues. Throws before writing when the
 * slug is malformed or taken, a location name repeats, or a league names a location the tenant
 * does not have.
 */
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

/**
 * Inserts a location of `organizationId` with its `sortName`, and adds 1 to the organization's
 * `locationCount`. The seeds check that a name is not repeated in the organization; the admin
 * mutations (#65) do not, because the approved design has no message for it.
 */
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

/**
 * Changes a stored location's name and address (#65) and sets its `sortName` from the new name, so
 * the public list and the admin list re-sort. No counter moves: the organization's
 * `locationCount` counts rows, and `sportLocations` rows and `sportLocationCounts` are keyed by
 * the location's id, not its name. The organization never changes. Callers have already checked
 * access and trimmed and validated both values.
 */
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

/**
 * Inserts a league of `organizationId` at the named locations of that organization, with a slug
 * from its name that is unique within the organization (`name`, `name-2`, ...) and one a user
 * could choose, and its `sortName`. The league is `published` unless the seed says `draft`, and
 * only a published league is counted (`insertLeagueRow`). Throws when a location name is unknown.
 * Returns the new league's id and slug.
 */
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

/** A league to insert: its slug is final and its locations are ids of the organization's. */
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

/**
 * Inserts a `draft` league (#66): the writer of `leagues.create`. A draft is on no public list and
 * in no counter, so it adds nothing to `leagueCount`, `sportLeagueCounts`, `sportLocations`, or
 * `sportLocationCounts`; `publishLeague` (#69) does. The caller has checked access, trimmed the name,
 * validated the slug and `leagueSlugTaken`, and checked that every location belongs to the
 * organization.
 */
export async function insertDraftLeague(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  league: NewLeague,
): Promise<Id<'leagues'>> {
  return insertLeagueRow(ctx, organizationId, league, 'draft');
}

/**
 * Publishes a draft league (#69): sets its `status` to `published` and counts it once, as
 * `insertLeague` counts a published league: adds 1 to the organization's `leagueCount` and
 * `sportLeagueCounts[sport]`, and to the `sportLocations` row of each distinct location (a new
 * row starts at 1 and adds 1 to `sportLocationCounts[sport]`). A league that is already
 * `published` is left alone and changes no counter or row. A league stored without a status
 * (written before #66) was public and `insertLeague` already counted it, so it gets the
 * `published` status and no counter or row changes. The caller has checked access
 * (`requireLeagueOrganizer`).
 */
export async function publishLeague(ctx: MutationCtx, league: Doc<'leagues'>): Promise<void> {
  if (league.status === 'published') return;
  await ctx.db.patch('leagues', league._id, { status: 'published' });
  if (league.status === undefined) return;
  await increment(ctx, league.organizationId, 'leagueCount');
  await countLeagueInSport(ctx, league.organizationId, league.sport, league.locationIds);
}

/** A season to insert: its slug is final, and its dates and players per side have been checked. */
export interface NewSeason {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  playersPerSide: number;
  minimumRosterSize: number;
}

/**
 * Inserts a season of `league` (#125): the one writer of the `seasons` table, used by
 * `seasons.create`, `seed:demo`, and the IS_TEST seeds. The organization is the league's own, so a
 * season never names another organization. A `draft` unless the caller says `published` (only the
 * seeds do; `seasons.publish` goes through `publishSeason`). It checks nothing about the values: the name, slug, date,
 * format, and minimum rules live in `seasons.create` (`convex/lib/seasonInput.ts`), so a seed can
 * hold a deadline on or after the start date, which #129's start-date case needs. A season inserted
 * as `published` adds 1 to the league's `publishedSeasonCount` (#127); a draft writes no counter.
 * It writes no other row.
 */
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

/**
 * Publishes a draft season (#126): sets its `status` to `published`, which puts it on the league's
 * public page (#127), and adds 1 to the league's `publishedSeasonCount`, once. A season that is
 * already `published` is left alone and nothing is written, so a repeat publish counts nothing.
 * The caller has checked access (`requireLeagueOrganizer`, with the league taken from the stored
 * season) and that the league is published.
 */
export async function publishSeason(ctx: MutationCtx, season: Doc<'seasons'>): Promise<void> {
  if (season.status === 'published') return;
  await ctx.db.patch('seasons', season._id, { status: 'published' });
  await countPublishedSeason(ctx, season.leagueId);
}

/**
 * Counts the season that was just written as `published` in the league's `publishedSeasonCount`,
 * read fresh so a stale `Doc` cannot lose a count. A league without the counter gets a recount,
 * which already includes that season: the backfill in `seed:demo` skips a league that has a
 * counter, so starting from 0 would leave a league whose earlier published seasons were never
 * counted short for good. For a league created after the backfill (no earlier season) the recount
 * is 1.
 */
async function countPublishedSeason(ctx: MutationCtx, leagueId: Id<'leagues'>): Promise<void> {
  const league = await ctx.db.get('leagues', leagueId);
  if (!league) throw new Error('No league has this id');
  const count =
    league.publishedSeasonCount === undefined
      ? await recountPublishedSeasons(ctx, leagueId)
      : league.publishedSeasonCount + 1;
  await ctx.db.patch('leagues', leagueId, { publishedSeasonCount: count });
}

/** Whether a season of the league already has this slug, drafts included. */
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

/** Whether a league of the organization already has this slug, drafts included. */
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

/**
 * Counts one new league of `sport` at `locationIds` (#101): adds 1 to `sportLeagueCounts[sport]`,
 * and adds 1 to the `sportLocations` row of each distinct location, inserting the row at 1 and
 * adding 1 to `sportLocationCounts[sport]` when it is new. An organization whose sport counters
 * are not set yet (written before #101) is left alone, rows included: the backfill recounts
 * counters and rows together and would count a row written here twice.
 */
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
    // A sport with no location has no entry, as the backfill leaves it.
    sportLocationCounts:
      newLocations === 0
        ? sportLocationCounts
        : { ...sportLocationCounts, [sport]: (sportLocationCounts[sport] ?? 0) + newLocations },
  });
}

/**
 * The first of `base`, `base-2`, `base-3`, ... that a user could choose (`isChoosableSlug`: not
 * reserved, 3 to 60 characters) and no league of the organization has. A name such as `New`, `A`,
 * or `5k` therefore gets `new-2`, `a-2`, or `5k-2`.
 */
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

/** The number of the league's `published` seasons, read through the published-seasons index. */
async function recountPublishedSeasons(ctx: MutationCtx, leagueId: Id<'leagues'>): Promise<number> {
  const published = await ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_status_and_startDate', (q) =>
      q.eq('leagueId', leagueId).eq('status', 'published'),
    )
    .take(BACKFILL_SCAN_LIMIT);
  return published.length;
}

/** Rows the backfill reads per table, and per organization when it recounts (staging: 15 leagues). */
export const BACKFILL_SCAN_LIMIT = 1000;

/** Rows the backfill changed, per table. */
export const backfilledValidator = v.object({
  organizations: v.number(),
  locations: v.number(),
  leagues: v.number(),
});

/**
 * Sets the fields #100, #101, #66, and #127 added on rows written before them (a reused staging
 * deployment): `sortName` on each location and league without one, `status` `published` on each
 * league without one (every league written before #66 was public), `publishedSeasonCount` on each
 * league without one (a recount of its published seasons, #127), and the four counters (league
 * and location totals, and the per-sport league and location counts with the `sportLocations`
 * rows), from a recount of the published leagues, on each organization missing any. The league
 * pass runs first, so the recount sees every status. Reads at most `BACKFILL_SCAN_LIMIT` rows per
 * table. Returns the number of rows changed per table; a second run changes none. Run by
 * `seed:demo` under its deployment guard, before its inserts; #104 removes it once the fields are
 * required.
 */
export async function backfillTenantFields(
  ctx: MutationCtx,
): Promise<Infer<typeof backfilledValidator>> {
  const backfilled = { organizations: 0, locations: 0, leagues: 0 };
  for (const location of await ctx.db.query('locations').take(BACKFILL_SCAN_LIMIT)) {
    if (location.sortName !== undefined) continue;
    await ctx.db.patch('locations', location._id, { sortName: sortName(location.name) });
    backfilled.locations++;
  }
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
      // From a recount of the published seasons, whatever the league's status (#127).
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
    // Recount the sport counters and the sportLocations rows together (#101), starting from no
    // rows so that a row left by an earlier partial run is never counted twice.
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
      // A draft is in no counter and has no row (#66); #69's publish counts it.
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
    // eslint-disable-next-line @convex-dev/no-filter-in-query -- no index covers a missing field; a temporary pass over a small table
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
