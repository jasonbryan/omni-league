// Test-only functions for the local e2e backend (ADR 0005, #59). Every function is internal, so no
// client can call it, and starts with the IS_TEST guard. Playwright calls them through
// `node scripts/e2e-convex.mjs run <name>`, which targets only the local backend.
import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server';
import { type GenericId, v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { ADULT_CONFIRMATION_FIELD, createAuth } from './auth';
import {
  insertLeague,
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
