/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { modules } from './test.setup';

export const SEED_EXCEPTIONS: Readonly<Record<string, string>> = {
  signInFailures: 'Throttle state from failed sign-ins, not demo content.',
};

export function missingSeedTables(
  tableNames: readonly string[],
  exceptions: Readonly<Record<string, string>>,
  rowCounts: Readonly<Record<string, number>>,
): { empty: string[]; staleExceptions: string[]; seededExceptions: string[] } {
  return {
    empty: tableNames.filter((name) => (rowCounts[name] ?? 0) === 0 && !(name in exceptions)),
    staleExceptions: Object.keys(exceptions).filter((name) => !tableNames.includes(name)),
    seededExceptions: tableNames.filter((name) => name in exceptions && (rowCounts[name] ?? 0) > 0),
  };
}

const TABLES = Object.keys(schema.tables);

function setup() {
  const t = convexTest(schema, modules);
  // The demo accounts are made through Better Auth's sign-up, so the component is registered.
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

async function ids(t: T): Promise<Record<string, string[]>> {
  return t.run(async (ctx) => {
    const result: Record<string, string[]> = {};
    for (const table of TABLES) {
      const rows = await ctx.db.query(table as TableNames).collect();
      result[table] = rows.map((row) => row._id as string).sort();
    }
    return result;
  });
}

function rowCounts(tableIds: Record<string, string[]>): Record<string, number> {
  return Object.fromEntries(Object.entries(tableIds).map(([table, list]) => [table, list.length]));
}

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
  // What the demo accounts need: a throwaway password, the auth variables, and the breached
  // password check on (IS_TEST unset) against a mocked Pwned Passwords range response.
  vi.stubEnv('DEMO_ACCOUNT_PASSWORD', 'throwaway coverage passphrase 2026');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  vi.stubEnv('SITE_URL', 'http://localhost:4000');
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('IS_TEST', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response('0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n', { status: 200 })),
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('seed:demo coverage', () => {
  // The seed signs up three demo accounts, each hashed with scrypt, so a run takes seconds.
  vi.setConfig({ testTimeout: 120_000 });

  test('on an empty backend, every schema table outside SEED_EXCEPTIONS has at least one row, and no exception is stale or on a seeded table', async () => {
    const t = setup();
    await t.action(internal.seed.demo, {});
    expect(missingSeedTables(TABLES, SEED_EXCEPTIONS, rowCounts(await ids(t)))).toEqual({
      empty: [],
      staleExceptions: [],
      seededExceptions: [],
    });
  });

  test('an exception on a table the seed fills fails the check', async () => {
    const t = setup();
    await t.action(internal.seed.demo, {});
    expect(
      missingSeedTables(
        TABLES,
        { ...SEED_EXCEPTIONS, organizations: 'left over' },
        rowCounts(await ids(t)),
      ),
    ).toEqual({ empty: [], staleExceptions: [], seededExceptions: ['organizations'] });
  });

  test('a second run leaves every schema table with the same row count and the same _ids', async () => {
    const t = setup();
    await t.action(internal.seed.demo, {});
    const before = await ids(t);
    await t.action(internal.seed.demo, {});
    const after = await ids(t);
    expect(rowCounts(after)).toEqual(rowCounts(before));
    expect(after).toEqual(before);
  });

  test('the real table names plus a made-up table with no rows and no exception return that table', () => {
    const counts = Object.fromEntries(TABLES.map((table) => [table, 1]));
    expect(missingSeedTables([...TABLES, 'newThings'], {}, counts)).toEqual({
      empty: ['newThings'],
      staleExceptions: [],
      seededExceptions: [],
    });
  });

  test('an exception that names a table not in the list is returned as a stale key', () => {
    const counts = Object.fromEntries(TABLES.map((table) => [table, 1]));
    expect(missingSeedTables(TABLES, { gone: 'was removed' }, counts)).toEqual({
      empty: [],
      staleExceptions: ['gone'],
      seededExceptions: [],
    });
  });

  test('a table with an exception and no rows is not reported', () => {
    expect(missingSeedTables(['a', 'b'], { b: 'throttle state' }, { a: 2 })).toEqual({
      empty: [],
      staleExceptions: [],
      seededExceptions: [],
    });
  });
});
