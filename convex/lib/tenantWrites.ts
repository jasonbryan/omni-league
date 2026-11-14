import { ConvexError, v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  ageGroupValidator,
  customLevelNameKey,
  genderValidator,
  isLevelOfSport,
  isPlayersPerSideOfSport,
  playersPerSideOfSport,
  standardLevelValidator,
  type AgeGroup,
  type Gender,
  type StandardLevel,
} from './divisions';
import { LEAGUE_MESSAGES, type LeagueInputError } from './leagueInput';
import { leagueDivisionSearchWords, type LeagueDivisionFields } from './leagueDivision';
import { leagueStatusValidator, type LeagueStatus } from './leagueStatus';
import { joinSearchText } from './searchQuery';
import { editableOf, type TournamentEditable } from './tournamentEdit';
import type { SeasonStatus } from './seasonStatus';
import { isChoosableSlug, isSlug, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH, slugify } from './slugs';
import { ROSTER_SIZE_INPUT_MAX, sportValidator, type Sport, type SportCounts } from './sports';

export const divisionSeedValidator = v.object({
  gender: genderValidator,
  playersPerSide: v.number(),
  level: standardLevelValidator,
  customLevel: v.optional(v.string()),
  ageGroup: ageGroupValidator,
  minimumRosterSize: v.optional(v.number()),
});

export type DivisionSeed = Infer<typeof divisionSeedValidator>;

export function defaultDivision(sport: Sport): DivisionSeed {
  return {
    gender: 'coed',
    playersPerSide: playersPerSideOfSport(sport)[0],
    level: 'rec',
    ageGroup: 'adult',
  };
}

export const leagueSeedValidator = v.object({
  name: v.string(),
  sport: sportValidator,
  locations: v.array(v.string()),
  status: v.optional(leagueStatusValidator),
  // Optional only because the `testing:` seeds fill in a default.
  division: v.optional(divisionSeedValidator),
});

export const tenantValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string(), cityState: v.optional(v.string()) }),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  leagues: v.array(leagueSeedValidator),
});

export type LeagueSeedInput = Infer<typeof leagueSeedValidator>;
export type LeagueSeed = Omit<LeagueSeedInput, 'division'> & { division: DivisionSeed };
export type LocationSeed = Infer<typeof tenantValidator>['locations'][number];
export type Tenant = Omit<Infer<typeof tenantValidator>, 'leagues'> & { leagues: LeagueSeed[] };

export function sortName(name: string): string {
  return name.toLowerCase();
}

// An organization's `sortName` and `hasPublishedLeague` feed the organizations list: a writer that renames an organization, or unpublishes or deletes its last published league, must keep both current.
async function markHasPublishedLeague(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
): Promise<void> {
  const organization = await organizationOf(ctx, organizationId);
  if (organization.hasPublishedLeague === true) return;
  await ctx.db.patch('organizations', organizationId, { hasPublishedLeague: true });
}

export const MAX_LEAGUES_SEARCH_UPDATED = 200;

type LeagueSearchFields = LeagueDivisionFields & Pick<Doc<'leagues'>, 'name' | 'locationIds'>;

// Every writer of a league's name, sport, division, or locations, of a location's name, or of an organization's name or City, state keeps `searchText` current through these, so a new writer must too.
async function leagueSearchText(
  ctx: Pick<MutationCtx, 'db'>,
  organization: Doc<'organizations'>,
  league: LeagueSearchFields,
): Promise<string> {
  const locationNames: string[] = [];
  for (const id of league.locationIds) {
    const location = await ctx.db.get('locations', id);
    if (location?.organizationId === organization._id) locationNames.push(location.name);
  }
  return joinSearchText([
    league.name,
    ...(await leagueDivisionSearchWords(ctx, league)),
    organization.name,
    ...locationNames,
    organization.cityState,
  ]);
}

async function organizationOf(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
): Promise<Doc<'organizations'>> {
  const organization = await ctx.db.get('organizations', organizationId);
  if (!organization) throw new Error('No organization has this id');
  return organization;
}

async function refreshLeaguesSearchText(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  locationId?: Id<'locations'>,
): Promise<void> {
  const organization = await organizationOf(ctx, organizationId);
  const leagues = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
    .take(MAX_LEAGUES_SEARCH_UPDATED + 1);
  if (leagues.length > MAX_LEAGUES_SEARCH_UPDATED) {
    throw new Error(
      `Organization ${JSON.stringify(organization.slug)} has more than ${MAX_LEAGUES_SEARCH_UPDATED} leagues, so their search text cannot be rewritten in one change`,
    );
  }
  for (const league of leagues) {
    if (locationId !== undefined && !league.locationIds.includes(locationId)) continue;
    const searchText = await leagueSearchText(ctx, organization, league);
    if (league.searchText !== searchText) {
      await ctx.db.patch('leagues', league._id, { searchText });
    }
  }
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

export async function recountDraftLeagues(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
): Promise<number> {
  const drafts = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_status_and_sortName', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'draft'),
    )
    .take(BACKFILL_SCAN_LIMIT);
  return drafts.length;
}

// Every league that enters or leaves `draft` goes through here, so `organizations.draftLeagueCount` stays equal to their count; a new writer does too.
// Called after the row changed, so an unset counter's recount already includes the change.
async function changeDraftLeagueCount(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  change: 1 | -1,
): Promise<void> {
  const organization = await organizationOf(ctx, organizationId);
  const draftLeagueCount =
    organization.draftLeagueCount === undefined
      ? await recountDraftLeagues(ctx, organizationId)
      : Math.max(0, organization.draftLeagueCount + change);
  await ctx.db.patch('organizations', organizationId, { draftLeagueCount });
}

export async function backfillDraftLeagueCounts(ctx: MutationCtx): Promise<number> {
  let backfilled = 0;
  for (const organization of await ctx.db.query('organizations').take(BACKFILL_SCAN_LIMIT)) {
    if (organization.draftLeagueCount !== undefined) continue;
    await ctx.db.patch('organizations', organization._id, {
      draftLeagueCount: await recountDraftLeagues(ctx, organization._id),
    });
    backfilled++;
  }
  return backfilled;
}

export async function organizationSlugTaken(
  ctx: Pick<QueryCtx, 'db'>,
  slug: string,
): Promise<boolean> {
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
  organization: { name: string; slug: string; cityState?: string | undefined },
): Promise<Id<'organizations'>> {
  const { name, slug, cityState } = organization;
  // Reserved slugs are allowed: the demo seeds use them.
  await assertSlugFree(ctx, slug);
  return ctx.db.insert('organizations', {
    name,
    slug,
    ...(cityState !== undefined && { cityState }),
    sortName: sortName(name),
    hasPublishedLeague: false,
    leagueCount: 0,
    draftLeagueCount: 0,
    locationCount: 0,
    staffCount: 0,
    pendingInviteCount: 0,
    sportLeagueCounts: {},
    sportLocationCounts: {},
  });
}

export async function updateOrganizationCityState(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  cityState: string | null,
): Promise<void> {
  await ctx.db.patch('organizations', organizationId, { cityState: cityState ?? undefined });
  await refreshLeaguesSearchText(ctx, organizationId);
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
  await refreshLeaguesSearchText(ctx, location.organizationId, location._id);
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
  const slug = await nextFreeSlug(ctx, organizationId, slugify(league.name));
  const division = await resolveDivision(ctx, organizationId, league.sport, league.division);
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
  division: LeagueDivision;
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

// The caller has checked access and that no program uses it.
export async function deleteCustomLevel(
  ctx: MutationCtx,
  customLevelId: Id<'customLevels'>,
): Promise<void> {
  await ctx.db.delete('customLevels', customLevelId);
}

export async function insertDraftLeague(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  league: NewLeague,
): Promise<Id<'leagues'>> {
  return insertLeagueRow(ctx, organizationId, league, 'draft');
}

export interface NewTournament {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
  division: Omit<LeagueDivision, 'minimumRosterSize'>;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  maximumTeams: number;
}

// The caller has checked access, the input, and that the slug is free. The minimum roster size is the division's players per side, which a tournament cannot raise.
export async function insertDraftTournament(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  tournament: NewTournament,
): Promise<Id<'tournaments'>> {
  const { division } = tournament;
  assertDivision(tournament.sport, division);
  const programId = await ctx.db.insert('programs', {
    organizationId,
    type: 'tournament',
    name: tournament.name,
    sortName: sortName(tournament.name),
    slug: tournament.slug,
    sport: tournament.sport,
    status: 'draft',
    locationIds: tournament.locationIds,
    ...divisionFields(division),
  });
  return ctx.db.insert('tournaments', {
    programId,
    organizationId,
    status: 'draft',
    sport: tournament.sport,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    registrationDeadline: tournament.registrationDeadline,
    maximumTeams: tournament.maximumTeams,
    minimumRosterSize: division.playersPerSide,
    structure: 'bracket',
    bracketType: 'single',
  });
}

export interface NewCamp {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
  minimumAge: number;
  maximumAge: number;
}

// The caller has checked access, the input, and that the slug is free. `programs` requires a division, which a camp has none of, so its row holds the sport's default and nothing reads it for a camp.
export async function insertDraftCamp(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  camp: NewCamp,
): Promise<Id<'camps'>> {
  const programId = await ctx.db.insert('programs', {
    organizationId,
    type: 'camp',
    name: camp.name,
    sortName: sortName(camp.name),
    slug: camp.slug,
    sport: camp.sport,
    status: 'draft',
    locationIds: camp.locationIds,
    ...defaultDivision(camp.sport),
  });
  return ctx.db.insert('camps', {
    programId,
    organizationId,
    minimumAge: camp.minimumAge,
    maximumAge: camp.maximumAge,
  });
}

export async function publishTournament(
  ctx: MutationCtx,
  tournament: Doc<'tournaments'>,
): Promise<void> {
  const program = await ctx.db.get('programs', tournament.programId);
  if (program?.organizationId !== tournament.organizationId) {
    throw new Error(`Tournament ${tournament._id} has no program of its organization`);
  }
  if (program.status === 'published') return;
  await ctx.db.patch('programs', program._id, { status: 'published' });
  await ctx.db.patch('tournaments', tournament._id, { status: 'published' });
}

// The caller has checked access and the input.
export async function updateTournamentDetails(
  ctx: MutationCtx,
  tournament: Doc<'tournaments'>,
  change: TournamentEditable,
): Promise<{ earlier: TournamentEditable; written: TournamentEditable }> {
  const earlier = editableOf(tournament);
  await ctx.db.patch('tournaments', tournament._id, change);
  return { earlier, written: change };
}

export const MAX_DRAFT_SEASONS_UPDATED = 200;

export const leagueEarlierValidator = v.object({
  name: v.string(),
  gender: genderValidator,
  playersPerSide: v.number(),
  level: standardLevelValidator,
  customLevelId: v.optional(v.id('customLevels')),
  ageGroup: ageGroupValidator,
  minimumRosterSize: v.optional(v.number()),
});

export const draftSeasonEarlierValidator = v.object({
  seasonId: v.id('seasons'),
  playersPerSide: v.number(),
  minimumRosterSize: v.number(),
});

export const leagueWrittenValidator = v.object({
  name: v.string(),
  gender: genderValidator,
  playersPerSide: v.number(),
  level: standardLevelValidator,
  customLevelId: v.optional(v.id('customLevels')),
  ageGroup: ageGroupValidator,
  minimumRosterSize: v.optional(v.number()),
});

export const leagueUpdateEarlierValidator = v.object({
  league: leagueEarlierValidator,
  draftSeasons: v.array(draftSeasonEarlierValidator),
  written: leagueWrittenValidator,
});

export type LeagueEarlier = Infer<typeof leagueEarlierValidator>;
export type DraftSeasonEarlier = Infer<typeof draftSeasonEarlierValidator>;
export type LeagueWritten = Infer<typeof leagueWrittenValidator>;
export type LeagueUpdateEarlier = Infer<typeof leagueUpdateEarlierValidator>;

export function leagueHolds(league: Doc<'leagues'>, written: LeagueWritten): boolean {
  return (
    league.name === written.name &&
    league.gender === written.gender &&
    league.playersPerSide === written.playersPerSide &&
    league.level === written.level &&
    league.customLevelId === written.customLevelId &&
    league.ageGroup === written.ageGroup &&
    league.minimumRosterSize === written.minimumRosterSize
  );
}

function effectiveMinimum(division: {
  playersPerSide?: number | undefined;
  minimumRosterSize?: number | undefined;
}): number | undefined {
  return division.minimumRosterSize ?? division.playersPerSide;
}

// The caller has checked access and the input. Draft seasons follow the league only when its
// players per side or its effective minimum changes, so a rename leaves a season's own minimum.
export async function updateLeague(
  ctx: MutationCtx,
  league: Doc<'leagues'>,
  change: { name: string; division: LeagueDivision },
): Promise<LeagueUpdateEarlier> {
  assertDivision(league.sport, change.division);
  const earlier: LeagueEarlier = {
    name: league.name,
    gender: league.gender,
    playersPerSide: league.playersPerSide,
    level: league.level,
    ageGroup: league.ageGroup,
    ...(league.customLevelId !== undefined && { customLevelId: league.customLevelId }),
    ...(league.minimumRosterSize !== undefined && { minimumRosterSize: league.minimumRosterSize }),
  };
  const seasonsFollow =
    league.playersPerSide !== change.division.playersPerSide ||
    effectiveMinimum(league) !== effectiveMinimum(change.division);
  const draftSeasons: DraftSeasonEarlier[] = [];
  if (seasonsFollow) {
    const drafts = await ctx.db
      .query('seasons')
      .withIndex('by_leagueId_and_status_and_startDate', (q) =>
        q.eq('leagueId', league._id).eq('status', 'draft'),
      )
      .take(MAX_DRAFT_SEASONS_UPDATED + 1);
    if (drafts.length > MAX_DRAFT_SEASONS_UPDATED) {
      throw new ConvexError({
        field: 'format',
        code: 'draftSeasonsTooMany',
        message: LEAGUE_MESSAGES.draftSeasonsTooMany,
      } satisfies LeagueInputError);
    }
    const playersPerSide = change.division.playersPerSide;
    const minimumRosterSize = effectiveMinimum(change.division)!;
    for (const season of drafts) assertMaxRosterSizeHolds(season, minimumRosterSize);
    for (const season of drafts) {
      if (
        season.playersPerSide === playersPerSide &&
        season.minimumRosterSize === minimumRosterSize
      ) {
        continue;
      }
      draftSeasons.push({
        seasonId: season._id,
        playersPerSide: season.playersPerSide,
        minimumRosterSize: season.minimumRosterSize,
      });
      await ctx.db.patch('seasons', season._id, { playersPerSide, minimumRosterSize });
    }
  }
  await ctx.db.patch('leagues', league._id, {
    name: change.name,
    sortName: sortName(change.name),
    searchText: await leagueSearchText(ctx, await organizationOf(ctx, league.organizationId), {
      ...league,
      name: change.name,
      ...change.division,
      customLevelId: change.division.customLevelId,
    }),
    ...leagueDivisionPatch(change.division),
  });
  await syncProgramOfLeague(ctx, league._id);
  const { customLevelId, minimumRosterSize } = change.division;
  const written: LeagueWritten = {
    name: change.name,
    gender: change.division.gender,
    playersPerSide: change.division.playersPerSide,
    level: change.division.level,
    ...(customLevelId !== undefined && { customLevelId }),
    ageGroup: change.division.ageGroup,
    ...(minimumRosterSize !== undefined && { minimumRosterSize }),
  };
  return { league: earlier, draftSeasons, written };
}

function assertMaxRosterSizeHolds(season: Doc<'seasons'>, minimumRosterSize: number): void {
  if (season.maxRosterSize === undefined || season.maxRosterSize >= minimumRosterSize) return;
  throw new ConvexError({
    field: 'format',
    code: 'draftSeasonMaxRosterSizeLow',
    message: LEAGUE_MESSAGES.draftSeasonMaxRosterSizeLow(
      season.name,
      season.maxRosterSize,
      minimumRosterSize,
    ),
  } satisfies LeagueInputError);
}

function isDraftOf(
  season: Doc<'seasons'> | null,
  league: Doc<'leagues'>,
): season is Doc<'seasons'> {
  return season?.leagueId === league._id && season.status === 'draft';
}

export async function restoreLeague(
  ctx: MutationCtx,
  league: Doc<'leagues'>,
  earlier: LeagueUpdateEarlier,
): Promise<void> {
  const { league: values } = earlier;
  const drafts: DraftSeasonEarlier[] = [];
  for (const draft of earlier.draftSeasons) {
    const season = await ctx.db.get('seasons', draft.seasonId);
    if (!isDraftOf(season, league)) continue;
    assertMaxRosterSizeHolds(season, draft.minimumRosterSize);
    drafts.push(draft);
  }
  await ctx.db.patch('leagues', league._id, {
    name: values.name,
    sortName: sortName(values.name),
    searchText: await leagueSearchText(ctx, await organizationOf(ctx, league.organizationId), {
      ...league,
      name: values.name,
      gender: values.gender,
      playersPerSide: values.playersPerSide,
      level: values.level,
      customLevelId: values.customLevelId,
      ageGroup: values.ageGroup,
    }),
    gender: values.gender,
    playersPerSide: values.playersPerSide,
    level: values.level,
    customLevelId: values.customLevelId,
    ageGroup: values.ageGroup,
    minimumRosterSize: values.minimumRosterSize,
  });
  await syncProgramOfLeague(ctx, league._id);
  for (const { seasonId, playersPerSide, minimumRosterSize } of drafts) {
    await ctx.db.patch('seasons', seasonId, { playersPerSide, minimumRosterSize });
  }
}

export async function publishLeague(ctx: MutationCtx, league: Doc<'leagues'>): Promise<void> {
  if (league.status === 'published') return;
  await ctx.db.patch('leagues', league._id, {
    status: 'published',
    searchText: await leagueSearchText(
      ctx,
      await organizationOf(ctx, league.organizationId),
      league,
    ),
  });
  await syncProgramOfLeague(ctx, league._id);
  await markHasPublishedLeague(ctx, league.organizationId);
  if (league.status === 'draft') await changeDraftLeagueCount(ctx, league.organizationId, -1);
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
  maxTeams?: number;
  maxRosterSize?: number;
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
    teamCount: 0,
    waitlistCount: 0,
    ...(season.maxTeams !== undefined && { maxTeams: season.maxTeams }),
    ...(season.maxRosterSize !== undefined && { maxRosterSize: season.maxRosterSize }),
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
  ctx: Pick<QueryCtx, 'db'>,
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
  assertDivision(league.sport, league.division);
  const searchText = await leagueSearchText(ctx, await organizationOf(ctx, organizationId), {
    organizationId,
    name: league.name,
    sport: league.sport,
    locationIds: league.locationIds,
    ...league.division,
  });
  const row = {
    name: league.name,
    sport: league.sport,
    locationIds: league.locationIds,
    status,
    ...divisionFields(league.division),
  };
  const programId = await ctx.db.insert('programs', {
    ...programFieldsOfLeague(row),
    organizationId,
    type: 'league',
    slug: league.slug,
  });
  const leagueId = await ctx.db.insert('leagues', {
    ...row,
    organizationId,
    slug: league.slug,
    sortName: sortName(league.name),
    searchText,
    publishedSeasonCount: 0,
    programId,
  });
  await ctx.db.patch('programs', programId, { leagueId });
  if (status === 'draft') await changeDraftLeagueCount(ctx, organizationId, 1);
  if (status === 'published') {
    await markHasPublishedLeague(ctx, organizationId);
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

// Every division field is set, so one the change leaves out is cleared.
function leagueDivisionPatch(division: LeagueDivision) {
  const { customLevelId, minimumRosterSize, ...required } = division;
  return { ...required, customLevelId, minimumRosterSize };
}

function divisionFields(division: LeagueDivision) {
  const { customLevelId, minimumRosterSize, ...required } = division;
  return {
    ...required,
    ...(customLevelId !== undefined && { customLevelId }),
    ...(minimumRosterSize !== undefined && { minimumRosterSize }),
  };
}

export async function programSlugTaken(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
  slug: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query('programs')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organizationId).eq('slug', slug),
    )
    .first();
  return existing !== null;
}

export async function leagueSlugTaken(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
  slug: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organizationId).eq('slug', slug),
    )
    .first();
  return existing !== null || (await programSlugTaken(ctx, organizationId, slug));
}

// Every writer of a league's name, status, locations, or division calls `syncProgramOfLeague` after the league patch, so a new writer must too.
function programFieldsOfLeague(
  league: Pick<
    Doc<'leagues'>,
    | 'name'
    | 'sport'
    | 'status'
    | 'locationIds'
    | 'gender'
    | 'playersPerSide'
    | 'level'
    | 'customLevelId'
    | 'ageGroup'
  >,
) {
  return {
    name: league.name,
    sortName: sortName(league.name),
    sport: league.sport,
    // A league stored before drafts existed was published.
    status: league.status ?? 'published',
    locationIds: league.locationIds,
    gender: league.gender,
    playersPerSide: league.playersPerSide,
    level: league.level,
    customLevelId: league.customLevelId,
    ageGroup: league.ageGroup,
  };
}

async function syncProgramOfLeague(ctx: MutationCtx, leagueId: Id<'leagues'>): Promise<void> {
  const league = await ctx.db.get('leagues', leagueId);
  if (!league) throw new Error('No league has this id');
  await ctx.db.patch('programs', league.programId, programFieldsOfLeague(league));
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

export async function nextFreeSlug(
  ctx: Pick<QueryCtx, 'db'>,
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

export async function recountPublishedSeasons(
  ctx: MutationCtx,
  leagueId: Id<'leagues'>,
): Promise<number> {
  const published = await ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_status_and_startDate', (q) =>
      q.eq('leagueId', leagueId).eq('status', 'published'),
    )
    .take(BACKFILL_SCAN_LIMIT);
  return published.length;
}

export const BACKFILL_SCAN_LIMIT = 1000;

/** Throws at the scan limit, because a recount that stops there would be short. */
export async function backfillOrganizationTenantFields(
  ctx: MutationCtx,
  organization: Doc<'organizations'>,
): Promise<boolean> {
  const countersSet =
    organization.leagueCount !== undefined &&
    organization.locationCount !== undefined &&
    organization.sportLeagueCounts !== undefined &&
    organization.sportLocationCounts !== undefined;
  const organizationId = organization._id;
  if (countersSet) return false;
  const locations = await ctx.db
    .query('locations')
    .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
    .take(BACKFILL_SCAN_LIMIT);
  const leagues = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
    .take(BACKFILL_SCAN_LIMIT);
  if (locations.length >= BACKFILL_SCAN_LIMIT || leagues.length >= BACKFILL_SCAN_LIMIT) {
    throw new Error(
      `Organization ${JSON.stringify(organization.slug)} has ${BACKFILL_SCAN_LIMIT} or more locations or leagues, so its counters cannot be recounted in one change`,
    );
  }
  // Recount from no rows, so a row left by an earlier partial run is not counted twice.
  const existingRows = await ctx.db
    .query('sportLocations')
    .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .take(BACKFILL_SCAN_LIMIT);
  if (existingRows.length >= BACKFILL_SCAN_LIMIT) {
    throw new Error(
      `Organization ${JSON.stringify(organization.slug)} has ${BACKFILL_SCAN_LIMIT} or more sport location rows, so its counters cannot be recounted in one change`,
    );
  }
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
  return true;
}

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
    if (await backfillOrganizationTenantFields(ctx, organization)) backfilled.organizations++;
  }
  return backfilled;
}
