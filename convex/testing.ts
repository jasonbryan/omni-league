// Test-only functions for the local e2e backend (ADR 0005, #59). Every export is internal, so no
// client can call it, and starts with the IS_TEST guard. Playwright calls them through
// `node scripts/e2e-convex.mjs run <name>`, which targets only the local backend.
import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server';
import { type GenericId, v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  insertLeague,
  insertTenant,
  leagueSeedValidator,
  tenantValidator,
} from './lib/tenantWrites';
import { assertTestDeployment } from './lib/testOnly';
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

/**
 * Empties the deployment, once per run in Playwright `globalSetup`: deletes the documents of every
 * table in `convex/schema.ts` (read from the schema, so a new table needs no edit here), cancels
 * pending and running scheduled functions, and deletes stored files.
 */
export const reset = internalMutation({
  args: {},
  returns: v.object({ documents: v.number(), scheduledFunctions: v.number(), files: v.number() }),
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
    return { documents, scheduledFunctions, files };
  },
});

/**
 * Creates the calling test's own tenant (ADR 0005, per-test tenant fixture): an organization with
 * the unique name and slug the test chose, its locations, and its leagues. Throws, writing nothing,
 * when the slug is malformed or taken or a league names a location the tenant does not have.
 * Tests assert only on their own tenant's data, so no reset runs between tests.
 */
export const seedLeague = internalMutation({
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
