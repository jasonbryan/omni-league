import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server';
import { type GenericId, v } from 'convex/values';
import { components, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from './_generated/server';
import { ADULT_CONFIRMATION_FIELD, createAuth } from './auth';
import { normaliseInviteEmail } from './lib/inviteInput';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { insertMembership } from './lib/memberships';
import { roleValidator } from './lib/roles';
import { seasonStatusValidator } from './lib/seasonStatus';
import { playersPerSideOfSport } from './lib/divisions';
import type { Sport } from './lib/sports';
import {
  insertLeague,
  insertSeason,
  insertTenant,
  leagueSeedValidator,
  tenantValidator,
  type LeagueSeed,
} from './lib/tenantWrites';
import { throttleKey } from './lib/signInThrottle';
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

interface ResetCounts {
  documents: number;
  authDocuments: number;
  scheduledFunctions: number;
  files: number;
}

// An action that clears the deployment one batch per transaction, so any amount of leftovers resets
// without one transaction reading them all.
export const reset = internalAction({
  args: {},
  returns: v.object({
    documents: v.number(),
    authDocuments: v.number(),
    scheduledFunctions: v.number(),
    files: v.number(),
  }),
  handler: async (ctx): Promise<ResetCounts> => {
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
    // Cancelling keeps the row, so each batch starts after the last row the previous one saw.
    let scheduledFunctions = 0;
    let after: number | null = null;
    for (;;) {
      const batch: { cancelled: number; last: number | null } = await ctx.runMutation(
        internal.testing.resetScheduledBatch,
        { after },
      );
      scheduledFunctions += batch.cancelled;
      if (batch.last === null) break;
      after = batch.last;
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
  args: { after: v.union(v.null(), v.number()) },
  returns: v.object({ cancelled: v.number(), last: v.union(v.null(), v.number()) }),
  handler: async (ctx, { after }) => {
    assertTestDeployment();
    const jobs = await ctx.db.system
      .query('_scheduled_functions')
      .withIndex('by_creation_time', (q) => (after === null ? q : q.gt('_creationTime', after)))
      .take(RESET_BATCH);
    let cancelled = 0;
    for (const job of jobs) {
      if (job.state.kind === 'pending' || job.state.kind === 'inProgress') {
        await ctx.scheduler.cancel(job._id);
        cancelled++;
      }
    }
    return { cancelled, last: jobs.at(-1)?._creationTime ?? null };
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

function withDivision(league: LeagueSeed): LeagueSeed {
  return {
    ...league,
    division: league.division ?? {
      gender: 'coed',
      playersPerSide: smallestPlayersPerSide(league.sport),
      level: 'rec',
      ageGroup: 'adult',
    },
  };
}

function smallestPlayersPerSide(sport: Sport): number {
  return playersPerSideOfSport(sport)[0];
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
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, email, leagueSlugs }) => {
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
    await insertMembership(ctx, user._id, organization._id, 'leagueOrganizer', leagueIds);
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

const seasonSeedValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  playersPerSide: v.optional(v.number()),
  minimumRosterSize: v.number(),
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
  return {
    ...season,
    playersPerSide:
      season.playersPerSide ?? league.playersPerSide ?? smallestPlayersPerSide(league.sport),
  };
}

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
    expiresAt: v.number(),
    token: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { organizationSlug, email, role, leagueNames = [], expiresAt, token }) => {
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
    await ctx.db.insert('invites', {
      organizationId: organization._id,
      email: normaliseInviteEmail(email),
      role,
      leagueIds,
      tokenHash: await hashInviteToken(token ?? generateInviteToken()),
      expiresAt,
      status: 'pending',
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
