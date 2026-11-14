import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server';
import { type GenericId, type Infer, v } from 'convex/values';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from './_generated/server';
import { ADULT_CONFIRMATION_FIELD, createAuth } from './auth';
import { INVITE_LIFETIME_MS, normaliseInviteEmail } from './lib/inviteInput';
import { insertPendingInvite } from './lib/inviteWrites';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { insertMembership } from './lib/memberships';
import { roleValidator } from './lib/roles';
import { ACCOUNTS_PER_SEED_CALL } from './lib/seedCallLimits';
import {
  addMinorEntry,
  addRosterEntry,
  insertFreeAgent,
  insertPlacedFreeAgent,
  insertTeamInvite,
  insertTeamWithCaptain,
  insertTournamentTeamWithCaptain,
  isMinorEntry,
  registerTeamOrJoinWaitlist,
  registerTournamentTeamOrJoinWaitlist,
  removeRosterEntry,
} from './lib/rosterWrites';
import { seasonStatusValidator } from './lib/seasonStatus';
import { formatLabel, isPlayersPerSideOfSport } from './lib/divisions';
import { programStatusValidator } from './lib/programs';
import {
  checkScore,
  forfeitScore,
  scoreValidator,
  scoreWinnerSide,
  sportValidator,
  type Score,
} from './lib/sports';
import {
  divisionSeedValidator,
  insertDraftCamp,
  insertDraftTournament,
  insertLeague,
  insertSeason,
  insertTenant,
  leagueSeedValidator,
  programSlugTaken,
  publishTournament,
  tenantValidator,
  defaultDivision,
  type LeagueSeed,
  type LeagueSeedInput,
} from './lib/tenantWrites';
import { throttleKey } from './lib/signInThrottle';
import { DEFAULT_SETS_PER_GAME, setsPerGameValidator } from './lib/tournamentEdit';
import {
  bracketExists,
  gameHasResult,
  replaceBracket,
  saveResult,
  tournamentTeams,
} from './lib/tournamentBracket';
import { findTournamentBySlugs } from './lib/tournamentLookup';
import { assertTestDeployment, AUTH_COMPONENT_TABLES, authModelValidator } from './lib/testOnly';
import schema from './schema';

export const ping = internalQuery({
  args: {},
  returns: v.literal('ok'),
  handler: () => {
    assertTestDeployment();
    return 'ok' as const;
  },
});

// Convex stops a transaction at 4,096 reads and counts each delete as a read, so a batch of 500
// deletes (about 1,000 reads) leaves room even for the component's `deleteMany`, which runs inside
// the calling transaction.
const RESET_BATCH = 500;

const resetCountsValidator = v.object({
  documents: v.number(),
  authDocuments: v.number(),
  scheduledFunctions: v.number(),
  files: v.number(),
});

// An action: each batch is its own transaction, under the read limit.
export const reset = internalAction({
  args: {},
  returns: resetCountsValidator,
  handler: async (ctx): Promise<Infer<typeof resetCountsValidator>> => {
    assertTestDeployment();
    let documents = 0;
    for (const table of Object.keys(schema.tables)) {
      for (;;) {
        const count: number = await ctx.runMutation(internal.testing.resetSchemaBatch, { table });
        documents += count;
        if (count < RESET_BATCH) break;
      }
    }
    // The component's `jwks` key is encrypted with the run's `BETTER_AUTH_SECRET`; a key left from an
    // earlier run fails every token request with HTTP 500.
    let authDocuments = 0;
    for (const model of AUTH_COMPONENT_TABLES) {
      for (;;) {
        const count: number = await ctx.runMutation(internal.testing.resetAuthBatch, { model });
        authDocuments += count;
        if (count < RESET_BATCH) break;
      }
    }
    // Cancelling keeps the row, so each batch resumes from the previous one's cursor.
    let scheduledFunctions = 0;
    let cursor: string | null = null;
    for (;;) {
      const batch: { cancelled: number; cursor: string; isDone: boolean } = await ctx.runMutation(
        internal.testing.resetScheduledBatch,
        { cursor },
      );
      scheduledFunctions += batch.cancelled;
      if (batch.isDone) break;
      cursor = batch.cursor;
    }
    let files = 0;
    for (;;) {
      const count: number = await ctx.runMutation(internal.testing.resetFilesBatch, {});
      files += count;
      if (count < RESET_BATCH) break;
    }
    return { documents, authDocuments, scheduledFunctions, files };
  },
});

export const resetSchemaBatch = internalMutation({
  args: { table: v.string() },
  returns: v.number(),
  handler: async (ctx, { table }) => {
    assertTestDeployment();
    if (!Object.hasOwn(schema.tables, table)) {
      throw new Error(`No table named ${JSON.stringify(table)} in the schema`);
    }
    // Table names come from the schema at run time, so the writer is typed by name only.
    const db: GenericDatabaseWriter<GenericDataModel> = ctx.db;
    const docs = await db.query(table).take(RESET_BATCH);
    for (const doc of docs) await db.delete(table, doc['_id'] as GenericId<string>);
    return docs.length;
  },
});

export const resetAuthBatch = internalMutation({
  args: { model: authModelValidator },
  returns: v.number(),
  handler: async (ctx, { model }) => {
    assertTestDeployment();
    // The component's generated return type is `any`. Deleted documents leave the index, so every
    // call starts from the beginning.
    const { count } = (await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model },
      paginationOpts: { numItems: RESET_BATCH, cursor: null },
    })) as { count: number };
    return count;
  },
});

export const resetScheduledBatch = internalMutation({
  args: { cursor: v.union(v.null(), v.string()) },
  returns: v.object({ cancelled: v.number(), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    assertTestDeployment();
    const { page, continueCursor, isDone } = await ctx.db.system
      .query('_scheduled_functions')
      .paginate({ numItems: RESET_BATCH, cursor });
    let cancelled = 0;
    for (const job of page) {
      if (job.state.kind === 'pending' || job.state.kind === 'inProgress') {
        await ctx.scheduler.cancel(job._id);
        cancelled++;
      }
    }
    return { cancelled, cursor: continueCursor, isDone };
  },
});

export const resetFilesBatch = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    assertTestDeployment();
    const files = await ctx.db.system.query('_storage').take(RESET_BATCH);
    for (const file of files) await ctx.storage.delete(file._id);
    return files.length;
  },
});

function withDivision(league: LeagueSeedInput): LeagueSeed {
  return { ...league, division: league.division ?? defaultDivision(league.sport) };
}

const seedUserValidator = v.object({ name: v.string(), email: v.string(), password: v.string() });

// An action: sign-up runs through the Better Auth component's adapter.
export const seedLeague = internalAction({
  args: { ...tenantValidator.fields, users: v.optional(v.array(seedUserValidator)) },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { users = [], ...tenant }): Promise<{ slug: string }> => {
    assertTestDeployment();
    const { slug }: { slug: string } = await ctx.runMutation(internal.testing.seedTenant, tenant);
    const auth = createAuth(ctx);
    for (const { name, email, password } of users) {
      // The 18+ field is this app's (convex/auth.ts), so Better Auth's body type does not list it.
      const body = { name, email, password, [ADULT_CONFIRMATION_FIELD]: true };
      await auth.api.signUpEmail({ body });
    }
    return { slug };
  },
});

export const seedTenant = internalMutation({
  args: tenantValidator,
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, tenant) => {
    assertTestDeployment();
    await insertTenant(ctx, { ...tenant, leagues: tenant.leagues.map(withDivision) });
    return { slug: tenant.organization.slug };
  },
});

export const addLeague = internalMutation({
  args: { organizationSlug: v.string(), ...leagueSeedValidator.fields },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { organizationSlug, ...league }) => {
    assertTestDeployment();
    const organization = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', organizationSlug))
      .unique();
    if (!organization) {
      throw new Error(`No organization has the slug ${JSON.stringify(organizationSlug)}`);
    }
    const { slug } = await insertLeague(ctx, organization._id, withDivision(league));
    return { slug };
  },
});

export const seedSignInFailures = internalMutation({
  args: { email: v.string(), failures: v.number() },
  returns: v.null(),
  handler: async (ctx, { email, failures }) => {
    assertTestDeployment();
    const key = await throttleKey(email);
    const row = await ctx.db
      .query('signInFailures')
      .withIndex('by_email', (q) => q.eq('email', key))
      .unique();
    if (row) await ctx.db.patch('signInFailures', row._id, { failures, blockedUntil: 0 });
    else await ctx.db.insert('signInFailures', { email: key, failures, blockedUntil: 0 });
    return null;
  },
});

export const addMembership = internalMutation({
  args: { organizationSlug: v.string(), email: v.string(), role: roleValidator },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, email, role }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const user = await userByEmail(ctx, email);
    await assertNoMembership(ctx, user, organization);
    await insertMembership(ctx, user._id, organization._id, role);
    return null;
  },
});

export const addLeagueOrganizer = internalMutation({
  args: {
    organizationSlug: v.string(),
    email: v.string(),
    leagueSlugs: v.array(v.string()),
    tournamentSlugs: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, email, leagueSlugs, tournamentSlugs = [] }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const user = await userByEmail(ctx, email);
    await assertNoMembership(ctx, user, organization);
    const leagueIds = [];
    for (const slug of leagueSlugs) {
      const league = await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organization._id).eq('slug', slug),
        )
        .unique();
      if (!league) throw new Error(`No league has the slug ${JSON.stringify(slug)}`);
      leagueIds.push(league._id);
    }
    const programIds = [];
    for (const slug of tournamentSlugs) {
      const program = await ctx.db
        .query('programs')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organization._id).eq('slug', slug),
        )
        .unique();
      if (program?.type !== 'tournament') {
        throw new Error(`No tournament has the slug ${JSON.stringify(slug)}`);
      }
      programIds.push(program._id);
    }
    await insertMembership(
      ctx,
      user._id,
      organization._id,
      'leagueOrganizer',
      leagueIds,
      programIds,
    );
    return null;
  },
});

export const assignForeignLeague = internalMutation({
  args: {
    organizationSlug: v.string(),
    email: v.string(),
    leagueOrganizationSlug: v.string(),
    leagueSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, email, leagueOrganizationSlug, leagueSlug }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const user = await userByEmail(ctx, email);
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) =>
        q.eq('userId', user._id).eq('organizationId', organization._id),
      )
      .unique();
    if (!membership) throw new Error('This user has no membership in the organization');
    const leagueOrganization = await organizationBySlug(ctx, leagueOrganizationSlug);
    if (leagueOrganization._id === organization._id) {
      throw new Error('The league must belong to another organization');
    }
    const league = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', leagueOrganization._id).eq('slug', leagueSlug),
      )
      .unique();
    if (!league) throw new Error(`No league has the slug ${JSON.stringify(leagueSlug)}`);
    await ctx.db.patch('memberships', membership._id, {
      leagueIds: [...membership.leagueIds, league._id],
    });
    return null;
  },
});

// Skips `seasons.create`'s rules, so a test can seed a deadline on or after the start date.
export const seedSeason = internalMutation({
  args: {
    organizationSlug: v.string(),
    leagueSlug: v.string(),
    name: v.string(),
    slug: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    playersPerSide: v.optional(v.number()),
    minimumRosterSize: v.number(),
    maxTeams: v.optional(v.number()),
    maxRosterSize: v.optional(v.number()),
    status: v.optional(seasonStatusValidator),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { organizationSlug, leagueSlug, status, ...season }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const league = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', leagueSlug),
      )
      .unique();
    if (!league) throw new Error(`No league has the slug ${JSON.stringify(leagueSlug)}`);
    await insertSeason(ctx, league, withPlayersPerSide(league, season), status);
    return { slug: season.slug };
  },
});

// Skips `tournaments.create`'s rules, so a test can seed a deadline that has passed.
export const seedTournament = internalMutation({
  args: {
    organizationSlug: v.string(),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationNames: v.array(v.string()),
    division: v.optional(divisionSeedValidator),
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    maximumTeams: v.number(),
    status: v.optional(programStatusValidator),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { organizationSlug, locationNames, division, status, ...tournament }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    if (await programSlugTaken(ctx, organization._id, tournament.slug)) {
      throw new Error(`The web address ${JSON.stringify(tournament.slug)} is taken`);
    }
    const locationIds: Id<'locations'>[] = [];
    for (const name of locationNames) {
      const location = await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organization._id).eq('name', name),
        )
        .first();
      if (!location) throw new Error(`No location is named ${JSON.stringify(name)}`);
      locationIds.push(location._id);
    }
    const { gender, playersPerSide, level, ageGroup } =
      division ?? defaultDivision(tournament.sport);
    const tournamentId = await insertDraftTournament(ctx, organization._id, {
      ...tournament,
      locationIds,
      division: { gender, playersPerSide, level, ageGroup },
    });
    if (status === 'published') {
      await publishTournament(ctx, (await ctx.db.get('tournaments', tournamentId))!);
    }
    return { slug: tournament.slug };
  },
});

export const seedCamp = internalMutation({
  args: {
    organizationSlug: v.string(),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationNames: v.array(v.string()),
    minimumAge: v.number(),
    maximumAge: v.number(),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { organizationSlug, locationNames, ...camp }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    if (await programSlugTaken(ctx, organization._id, camp.slug)) {
      throw new Error(`The web address ${JSON.stringify(camp.slug)} is taken`);
    }
    const locationIds: Id<'locations'>[] = [];
    for (const name of locationNames) {
      const location = await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organization._id).eq('name', name),
        )
        .first();
      if (!location) throw new Error(`No location is named ${JSON.stringify(name)}`);
      locationIds.push(location._id);
    }
    await insertDraftCamp(ctx, organization._id, { ...camp, locationIds });
    return { slug: camp.slug };
  },
});

/** Another editor's save, for the e2e of a form that was loaded before it. */
export const setTournamentMaximumTeams = internalMutation({
  args: { organizationSlug: v.string(), tournamentSlug: v.string(), maximumTeams: v.number() },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, tournamentSlug, maximumTeams }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) throw new Error(`No tournament has the slug ${JSON.stringify(tournamentSlug)}`);
    await ctx.db.patch('tournaments', found.tournament._id, { maximumTeams });
    return null;
  },
});

/** The sets per game an organizer would choose on the tournament's details, so a test can play a best-of-3 game. */
export const setTournamentSetsPerGame = internalMutation({
  args: {
    organizationSlug: v.string(),
    tournamentSlug: v.string(),
    setsPerGame: setsPerGameValidator,
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, tournamentSlug, setsPerGame }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) throw new Error(`No tournament has the slug ${JSON.stringify(tournamentSlug)}`);
    await ctx.db.patch('tournaments', found.tournament._id, { setsPerGame });
    return null;
  },
});

const seasonSeedValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  playersPerSide: v.optional(v.number()),
  minimumRosterSize: v.number(),
  maxTeams: v.optional(v.number()),
  maxRosterSize: v.optional(v.number()),
  status: v.optional(seasonStatusValidator),
});

// One mutation writes the league's `publishedSeasonCount` once per season. Many `seedSeason` calls at
// once for one league conflict (`OptimisticConcurrencyControlFailure`) on a slow runner.
export const seedSeasons = internalMutation({
  args: {
    organizationSlug: v.string(),
    leagueSlug: v.string(),
    seasons: v.array(seasonSeedValidator),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { organizationSlug, leagueSlug, seasons }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const league = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', leagueSlug),
      )
      .unique();
    if (!league) throw new Error(`No league has the slug ${JSON.stringify(leagueSlug)}`);
    for (const { status, ...season } of seasons) {
      await insertSeason(ctx, league, withPlayersPerSide(league, season), status);
    }
    return { count: seasons.length };
  },
});

function withPlayersPerSide<S extends { playersPerSide?: number | undefined }>(
  league: Doc<'leagues'>,
  season: S,
): Omit<S, 'playersPerSide'> & { playersPerSide: number } {
  const playersPerSide = season.playersPerSide ?? league.playersPerSide;
  if (!isPlayersPerSideOfSport(league.sport, playersPerSide)) {
    throw new Error(
      `${formatLabel(playersPerSide)} is not a format of ${league.sport}, the sport of league ${league.slug}`,
    );
  }
  return { ...season, playersPerSide };
}

// Through the roster writer, so a seeded team keeps the counters and the one-team rule. Skips the registration window.
export const seedTeam = internalMutation({
  args: {
    organizationSlug: v.string(),
    leagueSlug: v.string(),
    seasonSlug: v.string(),
    name: v.string(),
    captainEmail: v.string(),
  },
  returns: v.object({ teamId: v.id('teams') }),
  handler: async (ctx, { organizationSlug, leagueSlug, seasonSlug, name, captainEmail }) => {
    assertTestDeployment();
    const season = await seasonBySlugs(ctx, organizationSlug, leagueSlug, seasonSlug);
    const captain = await userByEmail(ctx, captainEmail);
    const teamId = await insertTeamWithCaptain(ctx, season, { name, captainUserId: captain._id });
    return { teamId };
  },
});

// Through the roster writer, so a seeded team keeps the counters and the one-team rule. Skips the registration window.
export const seedTournamentTeam = internalMutation({
  args: {
    organizationSlug: v.string(),
    tournamentSlug: v.string(),
    name: v.string(),
    captainEmail: v.string(),
  },
  returns: v.object({ teamId: v.id('teams') }),
  handler: async (ctx, { organizationSlug, tournamentSlug, name, captainEmail }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) throw new Error(`No tournament has the slug ${JSON.stringify(tournamentSlug)}`);
    const captain = await userByEmail(ctx, captainEmail);
    const teamId = await insertTournamentTeamWithCaptain(ctx, found.tournament, {
      name,
      captainUserId: captain._id,
    });
    return { teamId };
  },
});

/** Teams with full rosters through the roster writers, for a bracket: the players are accounts with no sign-in, so a seed hashes no password. Skips the registration window. */
export const seedTournamentRosters = internalMutation({
  args: {
    organizationSlug: v.string(),
    tournamentSlug: v.string(),
    // Players default to the tournament's minimum roster size.
    teams: v.array(v.object({ name: v.string(), players: v.optional(v.number()) })),
  },
  returns: v.object({ teamIds: v.array(v.id('teams')) }),
  handler: async (ctx, { organizationSlug, tournamentSlug, teams }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) throw new Error(`No tournament has the slug ${JSON.stringify(tournamentSlug)}`);
    const { tournament } = found;
    const teamIds: Id<'teams'>[] = [];
    for (const { name, players = tournament.minimumRosterSize } of teams) {
      const player = (number: number) =>
        ctx.db.insert('users', {
          authUserId: `e2e-roster-${tournamentSlug}-${name}-${number}`,
          name: `${name} ${number}`,
          adultConfirmedAt: 1,
        });
      const captainUserId = await player(1);
      const teamId = await insertTournamentTeamWithCaptain(ctx, tournament, {
        name,
        captainUserId,
      });
      const team = (await ctx.db.get('teams', teamId))!;
      for (let number = 2; number <= players; number++) {
        await addRosterEntry(ctx, team, {
          userId: await player(number),
          source: 'invite',
          addedByUserId: captainUserId,
        });
      }
      teamIds.push(teamId);
    }
    return { teamIds };
  },
});

/** The bracket of the tournament's confirmed teams, in registration order, through the writer `tournamentGames.createBracket` uses. Skips the registration window and the organizer check. */
export const seedTournamentBracket = internalMutation({
  args: { organizationSlug: v.string(), tournamentSlug: v.string() },
  returns: v.object({ gameCount: v.number() }),
  handler: async (ctx, { organizationSlug, tournamentSlug }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) throw new Error(`No tournament has the slug ${JSON.stringify(tournamentSlug)}`);
    if (await bracketExists(ctx, found.tournament._id)) {
      throw new Error(`The tournament ${JSON.stringify(tournamentSlug)} has a bracket already`);
    }
    const { seeds } = await tournamentTeams(ctx, found.tournament);
    return { gameCount: await replaceBracket(ctx, found.tournament._id, seeds, []) };
  },
});

/** One bracket result through the writer `tournamentGames.enterResult` uses, with its score rules. Skips the organizer check. */
export const seedTournamentResult = internalMutation({
  args: {
    organizationSlug: v.string(),
    tournamentSlug: v.string(),
    round: v.number(),
    slot: v.number(),
    score: v.optional(scoreValidator),
    forfeitSide: v.optional(v.union(v.literal(0), v.literal(1))),
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, tournamentSlug, round, slot, score, forfeitSide }) => {
    assertTestDeployment();
    if ((score === undefined) === (forfeitSide === undefined)) {
      throw new Error('Give either a score or a forfeitSide');
    }
    const organization = await organizationBySlug(ctx, organizationSlug);
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) throw new Error(`No tournament has the slug ${JSON.stringify(tournamentSlug)}`);
    const { tournament } = found;
    const game = await ctx.db
      .query('tournamentGames')
      .withIndex('by_tournamentId_and_stage_and_round_and_slot', (q) =>
        q
          .eq('tournamentId', tournament._id)
          .eq('stage', 'bracket')
          .eq('round', round)
          .eq('slot', slot),
      )
      .unique();
    if (!game) throw new Error(`No game is in round ${round}, slot ${slot}`);
    if (game.teamIds.includes(null)) {
      throw new Error(`The game in round ${round}, slot ${slot} is not ready: a place has no team`);
    }
    if (gameHasResult(game)) {
      throw new Error(`The game in round ${round}, slot ${slot} has a result already`);
    }
    const setsPerGame = tournament.setsPerGame ?? DEFAULT_SETS_PER_GAME;
    const played: Score = score ?? forfeitScore(tournament.sport, setsPerGame, forfeitSide!);
    const issue = checkScore(tournament.sport, setsPerGame, played);
    if (issue) throw new Error(issue.message);
    const winnerSide = scoreWinnerSide(played);
    if (winnerSide === null) throw new Error('The score has no winner');
    const enteredBy = await ctx.db.insert('users', {
      authUserId: `e2e-result-${tournamentSlug}-${round}-${slot}`,
      name: 'E2E result',
      adultConfirmedAt: 1,
    });
    await saveResult(ctx, game, {
      score: played,
      ...(forfeitSide !== undefined && { forfeitTeamId: game.teamIds[forfeitSide]! }),
      winnerTeamId: game.teamIds[winnerSide]!,
      enteredBy,
    });
    return null;
  },
});

/** A team on the tournament's waitlist through the roster writer, skipping the registration window; the tournament must be full. */
export const seedTournamentWaitlistEntry = internalMutation({
  args: {
    organizationSlug: v.string(),
    tournamentSlug: v.string(),
    teamName: v.string(),
    captainEmail: v.string(),
  },
  returns: v.object({ position: v.number() }),
  handler: async (ctx, { organizationSlug, tournamentSlug, teamName, captainEmail }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) throw new Error(`No tournament has the slug ${JSON.stringify(tournamentSlug)}`);
    const captain = await userByEmail(ctx, captainEmail);
    const result = await registerTournamentTeamOrJoinWaitlist(ctx, found.tournament, {
      name: teamName,
      captainUserId: captain._id,
    });
    if (result.status !== 'waitlisted') throw new Error('The tournament is not full');
    return { position: result.position };
  },
});

/** A team on the season's waitlist through the roster writer, skipping the registration window; the season must be full. */
export const seedWaitlistEntry = internalMutation({
  args: {
    organizationSlug: v.string(),
    leagueSlug: v.string(),
    seasonSlug: v.string(),
    teamName: v.string(),
    captainEmail: v.string(),
  },
  returns: v.object({ position: v.number() }),
  handler: async (ctx, { organizationSlug, leagueSlug, seasonSlug, teamName, captainEmail }) => {
    assertTestDeployment();
    const season = await seasonBySlugs(ctx, organizationSlug, leagueSlug, seasonSlug);
    const captain = await userByEmail(ctx, captainEmail);
    const result = await registerTeamOrJoinWaitlist(ctx, season, {
      name: teamName,
      captainUserId: captain._id,
    });
    if (result.status !== 'waitlisted') throw new Error('The season is not full');
    return { position: result.position };
  },
});

/**
 * A waiting free agent through the roster writer, skipping the registration window. With `placedTeamId`, a placed one: the roster entry
 * is written first, because the writer refuses a waiting free agent any entry but a placement.
 */
export const seedFreeAgent = internalMutation({
  args: {
    organizationSlug: v.string(),
    leagueSlug: v.string(),
    seasonSlug: v.string(),
    email: v.string(),
    placedTeamId: v.optional(v.id('teams')),
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, leagueSlug, seasonSlug, email, placedTeamId }) => {
    assertTestDeployment();
    const season = await seasonBySlugs(ctx, organizationSlug, leagueSlug, seasonSlug);
    const user = await userByEmail(ctx, email);
    if (placedTeamId === undefined) {
      await insertFreeAgent(ctx, season, user._id);
      return null;
    }
    const team = await ctx.db.get('teams', placedTeamId);
    if (team?.seasonId !== season._id) throw new Error('The team is not in this season');
    await insertPlacedFreeAgent(ctx, team, user._id);
    return null;
  },
});

/**
 * Up to `ACCOUNTS_PER_SEED_CALL` waiting free agents, numbered from `from`, each with an account of its own. A test reaches the
 * list's cap with sequential calls. The rows of one call share one registration time and a later call's come after, so the index
 * keeps insertion order.
 */
export const seedWaitingFreeAgents = internalMutation({
  args: {
    organizationSlug: v.string(),
    leagueSlug: v.string(),
    seasonSlug: v.string(),
    from: v.optional(v.number()),
    count: v.number(),
    emailPrefix: v.string(),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { organizationSlug, leagueSlug, seasonSlug, from = 1, count, emailPrefix },
  ) => {
    assertTestDeployment();
    assertSeedRange(from, count);
    const season = await seasonBySlugs(ctx, organizationSlug, leagueSlug, seasonSlug);
    await createAccounts(ctx, { from, count, emailPrefix, namePrefix: 'Free Agent' }, (userId) =>
      insertFreeAgent(ctx, season, userId),
    );
    return null;
  },
});

/** Up to `ACCOUNTS_PER_SEED_CALL` league organizers, numbered from `from`, so a test can pass the Staff list's 200 rows with sequential calls. */
export const seedStaff = internalMutation({
  args: {
    organizationSlug: v.string(),
    from: v.optional(v.number()),
    count: v.number(),
    emailPrefix: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, from = 1, count, emailPrefix }) => {
    assertTestDeployment();
    assertSeedRange(from, count);
    const organization = await organizationBySlug(ctx, organizationSlug);
    await createAccounts(ctx, { from, count, emailPrefix, namePrefix: 'Staff' }, async (userId) => {
      await insertMembership(ctx, userId, organization._id, 'leagueOrganizer');
    });
    return null;
  },
});

/** Many pending invites at once. They are org admin invites because Undo refuses a league organizer invite with no league. */
export const seedPendingInvites = internalMutation({
  args: { organizationSlug: v.string(), count: v.number(), emailPrefix: v.string() },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, count, emailPrefix }) => {
    assertTestDeployment();
    const organization = await organizationBySlug(ctx, organizationSlug);
    const expiresAt = Date.now() + INVITE_LIFETIME_MS;
    for (let i = 1; i <= count; i++) {
      await insertPendingInvite(ctx, {
        organizationId: organization._id,
        email: `${emailPrefix}-${numbered(i)}@example.test`,
        role: 'orgAdmin',
        leagueIds: [],
        tokenHash: await hashInviteToken(generateInviteToken()),
        expiresAt,
      });
    }
    return null;
  },
});

const numbered = (i: number) => String(i).padStart(3, '0');

function assertSeedRange(from: number, count: number): void {
  if (!Number.isInteger(from) || from < 1) throw new Error('from must be a positive integer');
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  if (count > ACCOUNTS_PER_SEED_CALL) {
    throw new Error(`A seed makes at most ${ACCOUNTS_PER_SEED_CALL} accounts per call`);
  }
}

async function createAccounts(
  ctx: MutationCtx,
  {
    from,
    count,
    emailPrefix,
    namePrefix,
  }: { from: number; count: number; emailPrefix: string; namePrefix: string },
  each: (userId: Id<'users'>) => Promise<unknown>,
): Promise<void> {
  for (let i = from; i < from + count; i++) {
    const name = `${namePrefix} ${numbered(i)}`;
    await each(
      await createAccount(ctx, { name, email: `${emailPrefix}-${numbered(i)}@example.test` }),
    );
  }
}

/**
 * An account with no credential, for a person a test never signs in as: it stores no password, so
 * no password goes around `hashPassword`. The adapter runs no trigger, so the `users` row is written here.
 */
async function createAccount(
  ctx: MutationCtx,
  { name, email }: { name: string; email: string },
): Promise<Id<'users'>> {
  const now = Date.now();
  // The component's generated return types are `any`.
  const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'user',
      data: {
        name,
        email: email.toLowerCase(),
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  })) as { _id: string };
  return await ctx.db.insert('users', { authUserId: account._id, name, adultConfirmedAt: now });
}

const batchSeasonValidator = v.object({ leagueSlug: v.string(), ...seasonSeedValidator.fields });

const batchTeamValidator = v.object({
  leagueSlug: v.string(),
  seasonSlug: v.string(),
  name: v.string(),
  captainEmail: v.string(),
  playerEmails: v.optional(v.array(v.string())),
  invites: v.optional(
    v.array(v.object({ email: v.string(), expiresAt: v.number(), token: v.optional(v.string()) })),
  ),
  minors: v.optional(v.array(v.object({ guardianEmail: v.string(), minorName: v.string() }))),
});

const batchRowsFields = {
  tenant: v.optional(tenantValidator),
  organizationSlug: v.optional(v.string()),
  accounts: v.optional(v.array(v.object({ name: v.string(), email: v.string() }))),
  memberships: v.optional(
    v.array(
      v.object({
        email: v.string(),
        role: roleValidator,
        leagueSlugs: v.optional(v.array(v.string())),
      }),
    ),
  ),
  seasons: v.optional(v.array(batchSeasonValidator)),
  teams: v.optional(v.array(batchTeamValidator)),
  waitlist: v.optional(
    v.array(
      v.object({
        leagueSlug: v.string(),
        seasonSlug: v.string(),
        teamName: v.string(),
        captainEmail: v.string(),
      }),
    ),
  ),
  freeAgents: v.optional(
    v.array(v.object({ leagueSlug: v.string(), seasonSlug: v.string(), email: v.string() })),
  ),
};

function batchOrganizationSlug({
  tenant,
  organizationSlug,
}: {
  tenant?: { organization: { slug: string } } | undefined;
  organizationSlug?: string | undefined;
}): string {
  const slug = tenant?.organization.slug ?? organizationSlug;
  if (slug === undefined || (tenant !== undefined && organizationSlug !== undefined)) {
    throw new Error('A batch names exactly one of tenant and organizationSlug');
  }
  return slug;
}

const batchResultValidator = v.object({ slug: v.string(), teamIds: v.array(v.id('teams')) });

// A test's whole seed in one CLI call, since each call starts a CLI process. `users` sign up
// through Better Auth's own sign-up, so each password gets a real hash; `accounts` store none.
export const seedBatch = internalAction({
  args: { ...batchRowsFields, users: v.optional(v.array(seedUserValidator)) },
  returns: batchResultValidator,
  handler: async (ctx, { users = [], ...rows }): Promise<Infer<typeof batchResultValidator>> => {
    assertTestDeployment();
    batchOrganizationSlug(rows);
    const auth = createAuth(ctx);
    for (const { name, email, password } of users) {
      // The 18+ field is this app's (convex/auth.ts), so Better Auth's body type does not list it.
      const body = { name, email, password, [ADULT_CONFIRMATION_FIELD]: true };
      await auth.api.signUpEmail({ body });
    }
    return await ctx.runMutation(internal.testing.seedBatchRows, rows);
  },
});

/** Teams come before the waitlist, so a waitlist entry can join the season they fill. */
export const seedBatchRows = internalMutation({
  args: batchRowsFields,
  returns: batchResultValidator,
  handler: async (ctx, rows) => {
    assertTestDeployment();
    const slug = batchOrganizationSlug(rows);
    if (rows.tenant) {
      await insertTenant(ctx, { ...rows.tenant, leagues: rows.tenant.leagues.map(withDivision) });
    }
    const organization = await organizationBySlug(ctx, slug);
    for (const account of rows.accounts ?? []) await createAccount(ctx, account);
    for (const { email, role, leagueSlugs = [] } of rows.memberships ?? []) {
      const user = await userByEmail(ctx, email);
      await assertNoMembership(ctx, user, organization);
      const leagueIds = [];
      for (const leagueSlug of leagueSlugs) {
        leagueIds.push((await leagueBySlug(ctx, organization, leagueSlug))._id);
      }
      await insertMembership(ctx, user._id, organization._id, role, leagueIds);
    }
    for (const { leagueSlug, status, ...season } of rows.seasons ?? []) {
      const league = await leagueBySlug(ctx, organization, leagueSlug);
      await insertSeason(ctx, league, withPlayersPerSide(league, season), status);
    }
    const teamIds = [];
    for (const team of rows.teams ?? []) {
      const season = await seasonBySlugs(ctx, slug, team.leagueSlug, team.seasonSlug);
      const captain = await userByEmail(ctx, team.captainEmail);
      const teamId = await insertTeamWithCaptain(ctx, season, {
        name: team.name,
        captainUserId: captain._id,
      });
      teamIds.push(teamId);
      for (const email of team.playerEmails ?? []) {
        const player = await userByEmail(ctx, email);
        await addRosterEntry(ctx, await teamById(ctx, teamId), {
          userId: player._id,
          source: 'invite',
          addedByUserId: captain._id,
        });
      }
      for (const { email, expiresAt, token } of team.invites ?? []) {
        await insertTeamInvite(ctx, await teamById(ctx, teamId), {
          email: normaliseInviteEmail(email),
          tokenHash: await hashInviteToken(token ?? generateInviteToken()),
          expiresAt,
          invitedByUserId: captain._id,
        });
      }
      for (const { guardianEmail, minorName } of team.minors ?? []) {
        const guardian = await userByEmail(ctx, guardianEmail);
        await addMinorEntry(ctx, await teamById(ctx, teamId), {
          guardianUserId: guardian._id,
          minorName,
          source: 'invite',
          addedByUserId: captain._id,
        });
      }
    }
    for (const entry of rows.waitlist ?? []) {
      const season = await seasonBySlugs(ctx, slug, entry.leagueSlug, entry.seasonSlug);
      const captain = await userByEmail(ctx, entry.captainEmail);
      const result = await registerTeamOrJoinWaitlist(ctx, season, {
        name: entry.teamName,
        captainUserId: captain._id,
      });
      if (result.status !== 'waitlisted') throw new Error('The season is not full');
    }
    for (const { leagueSlug, seasonSlug, email } of rows.freeAgents ?? []) {
      const season = await seasonBySlugs(ctx, slug, leagueSlug, seasonSlug);
      await insertFreeAgent(ctx, season, (await userByEmail(ctx, email))._id);
    }
    return { slug, teamIds };
  },
});

// The roster writers read the team's counters from the document they are given.
async function teamById(ctx: Pick<MutationCtx, 'db'>, teamId: Id<'teams'>): Promise<Doc<'teams'>> {
  const team = await ctx.db.get('teams', teamId);
  if (!team) throw new Error('No team has this id');
  return team;
}

async function leagueBySlug(
  ctx: Pick<MutationCtx, 'db'>,
  organization: Doc<'organizations'>,
  slug: string,
): Promise<Doc<'leagues'>> {
  const league = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organization._id).eq('slug', slug),
    )
    .unique();
  if (!league) throw new Error(`No league has the slug ${JSON.stringify(slug)}`);
  return league;
}

export const addToTeam = internalMutation({
  args: { teamId: v.id('teams'), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { teamId, email }) => {
    assertTestDeployment();
    const team = await ctx.db.get('teams', teamId);
    if (!team) throw new Error('No team has this id');
    const user = await userByEmail(ctx, email);
    await addRosterEntry(ctx, team, {
      userId: user._id,
      source: 'invite',
      addedByUserId: team.captainUserId,
    });
    return null;
  },
});

/** A minor's entry under the guardian, as an accepted invite writes it. */
export const addMinorToTeam = internalMutation({
  args: { teamId: v.id('teams'), guardianEmail: v.string(), minorName: v.string() },
  returns: v.null(),
  handler: async (ctx, { teamId, guardianEmail, minorName }) => {
    assertTestDeployment();
    const team = await ctx.db.get('teams', teamId);
    if (!team) throw new Error('No team has this id');
    const guardian = await userByEmail(ctx, guardianEmail);
    await addMinorEntry(ctx, team, {
      guardianUserId: guardian._id,
      minorName,
      source: 'invite',
      addedByUserId: team.captainUserId,
    });
    return null;
  },
});

/** A pending invite that `token` opens, or that no token opens without one; `expiresAt` in the past makes an expired one. */
export const addTeamInvite = internalMutation({
  args: {
    teamId: v.id('teams'),
    email: v.string(),
    expiresAt: v.number(),
    token: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { teamId, email, expiresAt, token }) => {
    assertTestDeployment();
    const team = await ctx.db.get('teams', teamId);
    if (!team) throw new Error('No team has this id');
    await insertTeamInvite(ctx, team, {
      email: normaliseInviteEmail(email),
      tokenHash: await hashInviteToken(token ?? generateInviteToken()),
      expiresAt,
      invitedByUserId: team.captainUserId,
    });
    return null;
  },
});

export const removeFromTeam = internalMutation({
  args: { teamId: v.id('teams'), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { teamId, email }) => {
    assertTestDeployment();
    const team = await ctx.db.get('teams', teamId);
    if (!team) throw new Error('No team has this id');
    const user = await userByEmail(ctx, email);
    const entries = await ctx.db
      .query('rosterEntries')
      .withIndex('by_teamId_and_status', (q) => q.eq('teamId', teamId).eq('status', 'rostered'))
      .take(200);
    const entry = entries.find((row) => row.userId === user._id && !isMinorEntry(row));
    if (!entry) throw new Error('This user has no rostered entry on the team');
    await removeRosterEntry(ctx, entry, team.captainUserId);
    return null;
  },
});

async function organizationBySlug(
  ctx: Pick<MutationCtx, 'db'>,
  slug: string,
): Promise<Doc<'organizations'>> {
  const organization = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
  if (!organization) throw new Error(`No organization has the slug ${JSON.stringify(slug)}`);
  return organization;
}

async function seasonBySlugs(
  ctx: Pick<MutationCtx, 'db'>,
  organizationSlug: string,
  leagueSlug: string,
  seasonSlug: string,
): Promise<Doc<'seasons'>> {
  const organization = await organizationBySlug(ctx, organizationSlug);
  const league = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organization._id).eq('slug', leagueSlug),
    )
    .unique();
  const season = league
    ? await ctx.db
        .query('seasons')
        .withIndex('by_leagueId_and_slug', (q) =>
          q.eq('leagueId', league._id).eq('slug', seasonSlug),
        )
        .unique()
    : null;
  if (!season) throw new Error(`No season has the slug ${JSON.stringify(seasonSlug)}`);
  return season;
}

async function userByEmail(ctx: MutationCtx, email: string): Promise<Doc<'users'>> {
  // Better Auth stores emails in lower case. The component's generated return types are `any`.
  const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: 'email', value: email.toLowerCase() }],
  })) as { _id: string } | null;
  const user = authUser
    ? await ctx.db
        .query('users')
        .withIndex('by_authUserId', (q) => q.eq('authUserId', authUser._id))
        .unique()
    : null;
  if (!user) throw new Error(`No account has the email ${JSON.stringify(email)}`);
  return user;
}

async function assertNoMembership(
  ctx: Pick<MutationCtx, 'db'>,
  user: Doc<'users'>,
  organization: Doc<'organizations'>,
): Promise<void> {
  const existing = await ctx.db
    .query('memberships')
    .withIndex('by_userId_and_organizationId', (q) =>
      q.eq('userId', user._id).eq('organizationId', organization._id),
    )
    .unique();
  if (existing) throw new Error('This user already has a membership in the organization');
}

export const addInvite = internalMutation({
  args: {
    organizationSlug: v.string(),
    email: v.string(),
    role: roleValidator,
    leagueNames: v.optional(v.array(v.string())),
    tournamentNames: v.optional(v.array(v.string())),
    campNames: v.optional(v.array(v.string())),
    expiresAt: v.number(),
    token: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      organizationSlug,
      email,
      role,
      leagueNames = [],
      tournamentNames = [],
      campNames = [],
      expiresAt,
      token,
    },
  ) => {
    assertTestDeployment();
    const organization = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', organizationSlug))
      .unique();
    if (!organization) {
      throw new Error(`No organization has the slug ${JSON.stringify(organizationSlug)}`);
    }
    const leagueIds = [];
    for (const name of leagueNames) {
      const league = await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organization._id).eq('name', name),
        )
        .first();
      if (!league) throw new Error(`No league named ${JSON.stringify(name)}`);
      leagueIds.push(league._id);
    }
    const programIds = [];
    for (const [type, names] of [
      ['tournament', tournamentNames],
      ['camp', campNames],
    ] as const) {
      for (const name of names) {
        const program = (
          await ctx.db
            .query('programs')
            .withIndex('by_organizationId_and_type_and_status_and_sortName', (q) =>
              q.eq('organizationId', organization._id).eq('type', type),
            )
            .collect()
        ).find((row) => row.name === name);
        if (!program) throw new Error(`No ${type} named ${JSON.stringify(name)}`);
        programIds.push(program._id);
      }
    }
    await insertPendingInvite(ctx, {
      organizationId: organization._id,
      email: normaliseInviteEmail(email),
      role,
      leagueIds,
      ...(programIds.length > 0 && { programIds }),
      tokenHash: await hashInviteToken(token ?? generateInviteToken()),
      expiresAt,
    });
    return null;
  },
});

export const accountByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.null(),
    v.object({ name: v.string(), adultConfirmedAt: v.number(), sessions: v.number() }),
  ),
  handler: async (ctx, { email }) => {
    assertTestDeployment();
    // Better Auth stores emails in lower case. The component's generated return types are `any`.
    const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase() }],
    })) as { _id: string } | null;
    if (!authUser) return null;
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUser._id))
      .unique();
    if (!user) return null;
    const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'session',
      where: [{ field: 'userId', value: authUser._id }],
      paginationOpts: { numItems: 100, cursor: null },
    })) as { page: unknown[] };
    return { name: user.name, adultConfirmedAt: user.adultConfirmedAt, sessions: page.length };
  },
});
