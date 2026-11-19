/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { modules } from './test.setup';

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('seed:demo and Find a program', () => {
  test('finds the demo tournament next to the demo leagues, each with its type', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.insertDemoData, {});
    const result = await t.query(api.search.programs, { q: 'beach' });
    const found = result.rows.map((row) => [row.type, row.name]);
    expect(found).toContainEqual(['tournament', 'Gulf Coast Beach Open']);
    expect(found).toContainEqual(['league', 'Sunday Reverse Coed 4s']);
    expect(result.typeCounts.map(({ type }) => type)).toEqual(['league', 'tournament']);
  });

  test('lists the demo tournaments by name for a type and a sport, without a search', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.insertDemoData, {});
    const result = await t.query(api.search.programsBrowse, {
      type: 'tournament',
      sport: 'beachVolleyball',
      page: 1,
    });
    expect(result.rows.map((row) => row.name)).toContain('Gulf Coast Beach Open');
    const names = result.rows.map((row) => row.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    );
  });

  test('finds the demo camp by a search for junior, with its ages and sessions, and not the draft camp', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.insertDemoData, {});
    const result = await t.query(api.search.programs, { q: 'junior', withCamps: true });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      type: 'camp',
      name: 'Junior Beach Volleyball Camp',
      minimumAge: 9,
      maximumAge: 14,
    });
    expect(result.rows[0].type === 'camp' && result.rows[0].sessions).toHaveLength(4);
    const draft = await t.query(api.search.programs, { q: 'fall break', withCamps: true });
    expect(draft.rows).toEqual([]);
  });

  test('lists the demo camps by name for the camp type, without a search, and counts them', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.insertDemoData, {});
    const result = await t.query(api.search.programsBrowse, {
      type: 'camp',
      sport: 'beachVolleyball',
      withCamps: true,
      page: 1,
    });
    expect(result.rows.map((row) => row.name)).toEqual([
      'Adult Beach Skills Camp',
      'Junior Beach Volleyball Camp',
    ]);
    expect(result.total).toBe(2);
    expect(result.typeCounts).toContainEqual({ type: 'camp', count: 2 });
  });

  test('sets current on every demo program, and its end date from the tournament, camp, or training program', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.insertDemoData, {});
    const { programs, typeRows } = await t.run(async (ctx) => {
      const typeRows: [string, string | null][] = [];
      for (const row of await ctx.db.query('tournaments').collect()) {
        typeRows.push([row.programId, row.endDate]);
      }
      for (const row of await ctx.db.query('camps').collect()) {
        typeRows.push([row.programId, row.lastSessionEndDate ?? null]);
      }
      for (const row of await ctx.db.query('trainings').collect()) {
        typeRows.push([row.programId, row.lastClassDate ?? null]);
      }
      return { programs: await ctx.db.query('programs').collect(), typeRows };
    });
    const ends = new Map(typeRows);
    expect(programs.map((program) => program.type)).toEqual(
      expect.arrayContaining(['league', 'tournament', 'camp', 'training']),
    );
    for (const program of programs) {
      expect(program.current, program.slug).toBeDefined();
      if (program.type === 'league') {
        expect(program).toMatchObject({ current: true });
        expect(program).not.toHaveProperty('endDate');
      } else {
        expect(program.endDate ?? null, program.slug).toBe(ends.get(program._id));
      }
    }
  });
});
