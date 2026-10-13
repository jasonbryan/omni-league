// Test-only functions for the local e2e backend (ADR 0005, #59). Every function is internal, so no
// client can call it, and starts with the IS_TEST guard. Playwright calls them through
// `node scripts/e2e-convex.mjs run <name>`, which targets only the local backend.
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
import { formatValidator } from './lib/sports';
import {
  insertLeague,
  insertSeason,
  insertTenant,
  leagueSeedValidator,
  tenantValidator,
} from './lib/tenantWrites';
import { throttleKey } from './lib/signInThrottle';
import { assertTestDeployment, AUTH_COMPONENT_TABLES } from './lib/testOnly';
import schema from './schema';

/** Self-test probe: proves the e2e run reaches the local backend with `IS_TEST` set. */
export const ping = internalQuery({
  args: {},
  returns: v.literal('ok'),
  handler: () => {
    assertTestDeployment();
    return 'ok' as const;
  },
});

/** Documents the component's `deleteMany` removes per call. */
const AUTH_DELETE_BATCH = 500;

/**
 * Empties the deployment, once per run in Playwright `globalSetup`: deletes the documents of every
 * table in `convex/schema.ts` (read from the schema, so a new table needs no edit here) and of every
 * Better Auth component table, cancels pending and running scheduled functions, and deletes stored
 * files. The component's `jwks` holds the JWT signing key encrypted with `BETTER_AUTH_SECRET`; each
 * run sets a new secret, so a key left from an earlier run would fail every token request with
 * HTTP 500 (ADR 0005, ADR 0008). The next token request creates a new key.
 */
export const reset = internalMutation({
  args: {},
  returns: v.object({
    documents: v.number(),
    authDocuments: v.number(),
    scheduledFunctions: v.number(),
    files: v.number(),
  }),
  handler: async (ctx) => {
    assertTestDeployment();
    // Table names come from the schema at run time, so the writer is typed by name only.
    const db: GenericDatabaseWriter<GenericDataModel> = ctx.db;
    let documents = 0;
    for (const table of Object.keys(schema.tables)) {
      for await (const doc of db.query(table)) {
        await db.delete(table, doc['_id'] as GenericId<string>);
        documents++;
      }
    }
    let authDocuments = 0;
    for (const model of AUTH_COMPONENT_TABLES) {
      // Deleted documents leave the index, so each call starts from the beginning again.
      for (;;) {
        // The component's generated return type is `any`.
        const { count, isDone } = (await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: { model },
          paginationOpts: { numItems: AUTH_DELETE_BATCH, cursor: null },
        })) as { count: number; isDone: boolean };
        authDocuments += count;
        if (isDone || count === 0) break;
      }
    }
    let scheduledFunctions = 0;
    for await (const job of ctx.db.system.query('_scheduled_functions')) {
      if (job.state.kind === 'pending' || job.state.kind === 'inProgress') {
        await ctx.scheduler.cancel(job._id);
        scheduledFunctions++;
      }
    }
    let files = 0;
    for await (const file of ctx.db.system.query('_storage')) {
      await ctx.storage.delete(file._id);
      files++;
    }
    return { documents, authDocuments, scheduledFunctions, files };
  },
});

/** A password user for `seedLeague`: the test generates the password per run, never stored. */
const seedUserValidator = v.object({ name: v.string(), email: v.string(), password: v.string() });

/**
 * Creates the calling test's own tenant (ADR 0005, per-test tenant fixture): an organization with
 * the unique name and slug the test chose, its locations, and its leagues, then each of `users`
 * through Better Auth's own sign-up (`auth.api.signUpEmail`, ADR 0008 "Testing"), with the 18+
 * confirmation. That gives each user a real password hash, a `credential` account, and (through
 * the `user.onCreate` trigger) a `users` row, so the test signs in through the real UI.
 * An action, because the sign-up runs through the component's adapter. Throws, writing nothing,
 * when the slug is malformed or taken or a league names a location the tenant does not have.
 * Tests assert only on their own tenant's data, so no reset runs between tests.
 */
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

/** The tenant part of `seedLeague`, in one transaction. */
export const seedTenant = internalMutation({
  args: tenantValidator,
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, tenant) => {
    assertTestDeployment();
    await insertTenant(ctx, tenant);
    return { slug: tenant.organization.slug };
  },
});

/**
 * Adds a league to the organization with `organizationSlug`, at its named locations (#60), and
 * returns the league's slug.
 */
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
    const { slug } = await insertLeague(ctx, organization._id, league);
    return { slug };
  },
});

/**
 * Sets the per-address sign-in throttle's row for `email` to `failures` consecutive failures with
 * no wait left (#63 e2e), so a test reaches the 100-failure hard limit without making 100 attempts
 * and the waits between them. Replaces the address's row, if there is one. `reset` clears it.
 */
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

/**
 * Gives the seeded user with this email a role in the organization with this slug (#65 e2e): an org
 * admin, or a league organizer with no league assigned. Throws, writing nothing, for an unknown
 * organization or account, or when the user already has a membership there.
 */
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

/**
 * Makes the seeded user with this email a league organizer of the leagues with these slugs in the
 * organization with this slug (#125 e2e), so a test has an assigned league organizer without the
 * invite flow. Like `addMembership`, which gives none. Throws, writing nothing, for an unknown
 * organization, account, or league (a league of another organization is unknown), or when the user
 * already has a membership there.
 */
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

/**
 * Adds a league of another organization to the league organizer's assigned leagues (#141 e2e): the
 * seeded user with this email must already be a league organizer of `organizationSlug`, and the
 * league is `leagueSlug` of `leagueOrganizationSlug`. The result is a membership holding a league
 * id of another organization, which nothing in the app writes and `organizations.listMine` must
 * drop. Throws, writing nothing, for an unknown organization, account, or league, no membership,
 * or a league of the membership's own organization.
 */
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

/**
 * Adds a season to the league with `leagueSlug` of the organization with `organizationSlug` (#125
 * e2e), through `insertSeason`. A `draft` unless `status` says `published`. None of
 * `seasons.create`'s rules apply, so a test can seed a registration deadline on or after the start
 * date (#129). Throws, writing nothing, for an unknown organization or league.
 */
export const seedSeason = internalMutation({
  args: {
    organizationSlug: v.string(),
    leagueSlug: v.string(),
    name: v.string(),
    slug: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    format: formatValidator,
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
    await insertSeason(ctx, league, season, status);
    return { slug: season.slug };
  },
});

/** One season of `seedSeasons`: the fields of `seedSeason` after the league. */
const seasonSeedValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  format: formatValidator,
  minimumRosterSize: v.number(),
  status: v.optional(seasonStatusValidator),
});

/**
 * Adds several seasons to one league in one transaction (#127 e2e), each through `insertSeason`
 * like `seedSeason`. Many `seedSeason` calls at once for one league all write that league's
 * `publishedSeasonCount`, so on a slow runner they conflict (`OptimisticConcurrencyControlFailure`);
 * one mutation writes the counter once per season in a single transaction, and needs one process.
 * Throws, writing nothing, for an unknown organization or league.
 */
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
      await insertSeason(ctx, league, season, status);
    }
    return { count: seasons.length };
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

/** The `users` row of the seeded account with this email. */
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

/** Throws when the user already has a membership in the organization: at most one exists. */
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

/**
 * Adds a pending staff invite to the organization with this slug (#67 e2e), written straight to
 * the table so a test can have one whose `expiresAt` has passed, or two pending ones at once,
 * without waiting 14 days or going through the form. A `leagueOrganizer` invite names its leagues
 * of that organization. With `token`, its hash is stored, so a test (#70) can open the invite by
 * the link `/invites/accept#<token>`; without one the hash is random and no token opens it. Throws,
 * writing nothing, for an unknown organization or league.
 */
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

/**
 * The account of the auth user with this email (#62 e2e): its `users` row's name and
 * `adultConfirmedAt`, and how many sessions it has, or `null` when there is no such user. Lets an
 * e2e test check what sign-up wrote and that sign-out deleted the session.
 */
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
