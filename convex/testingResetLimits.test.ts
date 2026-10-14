/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { components, internal } from './_generated/api';
import { AUTH_COMPONENT_TABLES } from './lib/testOnly';
import schema from './schema';
import { modules } from './test.setup';

// convex-test applies Convex's 4,096 only to index-range reads and counts a delete as a read against
// the separate `documentsRead` limit (32,000 by default), so this limit stands in for the real
// backend, where each delete counts as a read. convex-test counts each deleted document about twice
// (once from the query, once from the delete).
const READ_LIMIT = 4_096;
const LIMITS = { documentsRead: READ_LIMIT };
const HOUR = 60 * 60 * 1000;
const CHUNK = 200;
const PENDING_ARGS = { email: 'pending@example.test', failures: 1 };

function setup() {
  const t = convexTest({ schema, modules, transactionLimits: LIMITS });
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

const runReset = (t: T) => t.action(internal.testing.reset, {});

async function inChunks(total: number, write: (from: number, to: number) => Promise<void>) {
  for (let from = 0; from < total; from += CHUNK) await write(from, Math.min(from + CHUNK, total));
}

function seedSignInFailures(t: T, total: number, prefix = 'row') {
  return inChunks(total, (from, to) =>
    t.run(async (ctx) => {
      for (let i = from; i < to; i++) {
        await ctx.db.insert('signInFailures', {
          email: `${prefix}-${i}@example.test`,
          failures: 1,
          blockedUntil: 0,
        });
      }
    }),
  );
}

async function seedUsersWithSessionsAndJwks(t: T, total: number): Promise<number> {
  const users = Math.floor(total / 2);
  const now = Date.now();
  const create = (ctx: Parameters<Parameters<T['run']>[0]>[0], input: Record<string, unknown>) =>
    ctx.runMutation(components.betterAuth.adapter.create, { input } as never) as Promise<{
      _id: string;
    }>;
  await t.run((ctx) =>
    create(ctx, {
      model: 'jwks',
      data: { publicKey: '{}', privateKey: 'enc', createdAt: now },
    }),
  );
  await inChunks(users, (from, to) =>
    t.run(async (ctx) => {
      for (let i = from; i < to; i++) {
        const user = await create(ctx, {
          model: 'user',
          data: {
            name: `User ${i}`,
            email: `user-${i}@example.test`,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        });
        await create(ctx, {
          model: 'session',
          data: {
            token: `token-${i}`,
            userId: user._id,
            expiresAt: now + HOUR,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }),
  );
  return users * 2 + 1;
}

async function nonEmptyAuthTables(t: T): Promise<string[]> {
  const tables: string[] = [];
  for (const model of AUTH_COMPONENT_TABLES) {
    const { page } = await t.run(
      async (ctx) =>
        (await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model,
          paginationOpts: { numItems: 1, cursor: null },
        })) as { page: unknown[] },
    );
    if (page.length > 0) tables.push(model);
  }
  return tables;
}

const signInFailureCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query('signInFailures').collect()).length);

const pendingJobCount = (t: T) =>
  t.run(
    async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).filter(
        (job) => job.state.kind === 'pending' || job.state.kind === 'inProgress',
      ).length,
  );

const fileCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.system.query('_storage').collect()).length);

beforeEach(() => {
  vi.stubEnv('IS_TEST', 'true');
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('SITE_URL', 'http://localhost:4000');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('testing:reset under the read limit', () => {
  test('clears more documents in one schema table than a transaction may read', async () => {
    const t = setup();
    const total = READ_LIMIT + 104;
    await seedSignInFailures(t, total);

    await expect(runReset(t)).resolves.toEqual({
      documents: total,
      authDocuments: 0,
      scheduledFunctions: 0,
      files: 0,
    });
    expect(await signInFailureCount(t)).toBe(0);
  }, 60_000);

  test('clears more Better Auth rows than a transaction may read, jwks included', async () => {
    const t = setup();
    const seeded = await seedUsersWithSessionsAndJwks(t, READ_LIMIT + 104);
    expect(seeded).toBeGreaterThan(READ_LIMIT);
    expect(await nonEmptyAuthTables(t)).toEqual(['user', 'session', 'jwks']);

    await expect(runReset(t)).resolves.toEqual({
      documents: 0,
      authDocuments: seeded,
      scheduledFunctions: 0,
      files: 0,
    });
    expect(await nonEmptyAuthTables(t)).toEqual([]);
  }, 120_000);

  test('keeps every batch under the limit when a schema table, the auth tables, jobs, and files are all full', async () => {
    const t = setup();
    const schemaRows = READ_LIMIT - 96;
    await seedSignInFailures(t, schemaRows);
    const authRows = await seedUsersWithSessionsAndJwks(t, READ_LIMIT - 96);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++)
        await ctx.scheduler.runAfter(HOUR, internal.testing.seedSignInFailures, PENDING_ARGS);
      for (let i = 0; i < 4; i++) await ctx.storage.store(new Blob([`file ${i}`]));
    });

    await expect(runReset(t)).resolves.toEqual({
      documents: schemaRows,
      authDocuments: authRows,
      scheduledFunctions: 3,
      files: 4,
    });
    expect(await signInFailureCount(t)).toBe(0);
    expect(await nonEmptyAuthTables(t)).toEqual([]);
    expect(await pendingJobCount(t)).toBe(0);
    expect(await fileCount(t)).toBe(0);
  }, 120_000);

  test('finishes when old canceled and completed jobs outnumber a batch, and cancels the pending ones among them', async () => {
    const t = setup();
    const done = 600;
    const mixed = 600;
    await t.run(async (ctx) => {
      await ctx.scheduler.runAfter(HOUR, internal.testing.seedSignInFailures, PENDING_ARGS);
    });
    await inChunks(done, (from, to) =>
      t.run(async (ctx) => {
        for (let i = from; i < to; i++) {
          await ctx.scheduler.runAfter(0, internal.testing.seedSignInFailures, {
            email: `done-${i}@example.test`,
            failures: 1,
          });
        }
      }),
    );
    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    let pending = 1;
    await inChunks(mixed, (from, to) =>
      t.run(async (ctx) => {
        for (let i = from; i < to; i++) {
          const id = await ctx.scheduler.runAfter(
            HOUR,
            internal.testing.seedSignInFailures,
            PENDING_ARGS,
          );
          if (i % 2 === 0) await ctx.scheduler.cancel(id);
        }
      }),
    );
    pending += mixed / 2;
    const files = 1_100;
    await inChunks(files, (from, to) =>
      t.run(async (ctx) => {
        for (let i = from; i < to; i++) await ctx.storage.store(new Blob([`file ${i}`]));
      }),
    );
    expect(await pendingJobCount(t)).toBe(pending);

    await expect(runReset(t)).resolves.toEqual({
      documents: done,
      authDocuments: 0,
      scheduledFunctions: pending,
      files,
    });
    expect(await pendingJobCount(t)).toBe(0);
    expect(await fileCount(t)).toBe(0);
  }, 120_000);
});

describe('IS_TEST guard on the reset batches', () => {
  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('every batch function throws with IS_TEST %s and touches nothing', async (_, value) => {
    const t = setup();
    await seedSignInFailures(t, 3);
    vi.stubEnv('IS_TEST', value);

    await expect(
      t.mutation(internal.testing.resetSchemaBatch, { table: 'signInFailures' }),
    ).rejects.toThrow(/IS_TEST/);
    await expect(t.mutation(internal.testing.resetAuthBatch, { model: 'user' })).rejects.toThrow(
      /IS_TEST/,
    );
    await expect(
      t.mutation(internal.testing.resetScheduledBatch, { cursor: null }),
    ).rejects.toThrow(/IS_TEST/);
    await expect(t.mutation(internal.testing.resetFilesBatch, {})).rejects.toThrow(/IS_TEST/);
    expect(await signInFailureCount(t)).toBe(3);
  });

  test('the schema batch refuses a table the schema does not define', async () => {
    const t = setup();
    await expect(
      t.mutation(internal.testing.resetSchemaBatch, { table: 'not_a_table' }),
    ).rejects.toThrow(/not_a_table/);
  });
});
