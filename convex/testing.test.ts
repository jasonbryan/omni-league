import betterAuthTest from '@convex-dev/better-auth/test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import * as testing from './testing';
import { modules } from './test.setup';

// `testing:reset` derives its tables from `convex/schema.ts`, so a fixture schema replaces it
// here: two tables, neither of which `testing.ts` names (#59). The getter defers the read until
// `reset` runs, after the assignment below.
const fixture = vi.hoisted((): { schema: unknown } => ({ schema: undefined }));
vi.mock('./schema', () => ({
  get default() {
    return fixture.schema;
  },
}));

const schema = defineSchema({
  alpha: defineTable({ name: v.string() }),
  beta: defineTable({ n: v.number() }),
});
fixture.schema = schema;

const HOUR = 60 * 60 * 1000;

function setup() {
  const t = convexTest(schema, modules);
  // `reset` also clears the Better Auth component's tables (#62; testingAuth.test.ts).
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

/** Two documents per fixture table, one pending scheduled function, and one stored file. */
async function seed(t: ReturnType<typeof setup>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('alpha', { name: 'a1' });
    await ctx.db.insert('alpha', { name: 'a2' });
    await ctx.db.insert('beta', { n: 1 });
    await ctx.db.insert('beta', { n: 2 });
    await ctx.scheduler.runAfter(HOUR, internal.testing.reset, {});
    await ctx.storage.store(new Blob(['fixture file']));
  });
}

async function remaining(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => ({
    alpha: (await ctx.db.query('alpha').collect()).length,
    beta: (await ctx.db.query('beta').collect()).length,
    pendingJobs: (await ctx.db.system.query('_scheduled_functions').collect()).filter(
      (job) => job.state.kind === 'pending' || job.state.kind === 'inProgress',
    ).length,
    files: (await ctx.db.system.query('_storage').collect()).length,
  }));
}

const NOTHING_LEFT = { alpha: 0, beta: 0, pendingJobs: 0, files: 0 };
const ALL_SEEDED = { alpha: 2, beta: 2, pendingJobs: 1, files: 1 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('IS_TEST guard', () => {
  // Unset, then values that are not exactly "true".
  const refused: [string, string | undefined][] = [
    ['unset', undefined],
    ['"false"', 'false'],
    ['"TRUE"', 'TRUE'],
    ['"1"', '1'],
    ['"true " (trailing space)', 'true '],
    ['empty', ''],
  ];

  test.each(refused)(
    'testing:reset throws with IS_TEST %s, before touching data',
    async (_, value) => {
      vi.stubEnv('IS_TEST', value);
      const t = setup();
      await seed(t);
      await expect(t.mutation(internal.testing.reset, {})).rejects.toThrow(/IS_TEST/);
      expect(await remaining(t)).toEqual(ALL_SEEDED);
    },
  );

  test.each(refused)('testing:ping throws with IS_TEST %s', async (_, value) => {
    vi.stubEnv('IS_TEST', value);
    const t = setup();
    await expect(t.query(internal.testing.ping, {})).rejects.toThrow(/IS_TEST/);
  });

  test('testing:ping returns "ok" with IS_TEST exactly "true"', async () => {
    vi.stubEnv('IS_TEST', 'true');
    await expect(setup().query(internal.testing.ping, {})).resolves.toBe('ok');
  });
});

describe('testing:reset', () => {
  test('leaves no document, pending scheduled function, or stored file', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await seed(t);
    expect(await remaining(t)).toEqual(ALL_SEEDED);

    await expect(t.mutation(internal.testing.reset, {})).resolves.toEqual({
      documents: 4,
      authDocuments: 0,
      scheduledFunctions: 1,
      files: 1,
    });
    expect(await remaining(t)).toEqual(NOTHING_LEFT);
  });

  test('on an empty deployment deletes nothing', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    await expect(t.mutation(internal.testing.reset, {})).resolves.toEqual({
      documents: 0,
      authDocuments: 0,
      scheduledFunctions: 0,
      files: 0,
    });
  });
});

describe('convex/testing.ts exports', () => {
  test('every export is a registered internal function, so no client can call it', () => {
    const exports = Object.entries(testing);
    expect(exports.map(([name]) => name).sort()).toEqual([
      'accountByEmail',
      'addLeague',
      'addMembership',
      'ping',
      'reset',
      'seedLeague',
      'seedTenant',
    ]);
    for (const [name, fn] of exports) {
      // The markers `internalQuery`/`internalMutation`/`internalAction` set (convex/server).
      const markers = fn as Partial<
        Record<'isQuery' | 'isMutation' | 'isAction' | 'isInternal' | 'isPublic', boolean>
      >;
      const kinds = [markers.isQuery, markers.isMutation, markers.isAction].filter(Boolean);
      expect({ name, kinds: kinds.length }).toEqual({ name, kinds: 1 });
      expect({ name, isInternal: markers.isInternal }).toEqual({ name, isInternal: true });
      expect({ name, isPublic: markers.isPublic }).toEqual({ name, isPublic: undefined });
    }
  });
});
