/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const MEN_SOCCER = 'Men Over-30 11v11';
const WOMEN_SOCCER = 'Women Sunday 11v11';
const WOMEN_VOLLEYBALL = 'Tuesday Women 2s';
const JOES = "Joe's Pub 4s";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
      locations: [{ name: 'Bayside Athletic Complex', address: '1 Bay Rd' }],
      leagues: [
        {
          name: MEN_SOCCER,
          sport: 'soccer',
          locations: ['Bayside Athletic Complex'],
          division: { gender: 'mens', playersPerSide: 11, level: 'rec', ageGroup: 'over30' },
        },
        {
          name: WOMEN_SOCCER,
          sport: 'soccer',
          locations: ['Bayside Athletic Complex'],
          division: {
            gender: 'womens',
            playersPerSide: 11,
            level: 'competitive',
            ageGroup: 'adult',
          },
        },
        {
          name: WOMEN_VOLLEYBALL,
          sport: 'beachVolleyball',
          locations: ['Bayside Athletic Complex'],
          division: { gender: 'womens', playersPerSide: 2, level: 'a', ageGroup: 'adult' },
        },
        {
          name: JOES,
          sport: 'beachVolleyball',
          locations: ['Bayside Athletic Complex'],
          division: { gender: 'coed', playersPerSide: 4, level: 'b', ageGroup: 'adult' },
        },
      ],
    });
  });
  return t;
}

async function names(t: Awaited<ReturnType<typeof setup>>, q: string) {
  const result = await t.query(api.search.leagues, { q });
  return result.rows.map((row) => row.name).sort();
}

describe('search.leagues by gender', () => {
  test.each<[string, string[]]>([
    ['men', [MEN_SOCCER]],
    ['mens', [MEN_SOCCER]],
    ['women', [WOMEN_SOCCER, WOMEN_VOLLEYBALL].sort()],
    ['womens', [WOMEN_SOCCER, WOMEN_VOLLEYBALL].sort()],
    ["men's", [MEN_SOCCER]],
    ['men’s', [MEN_SOCCER]],
    ["men's soccer", [MEN_SOCCER]],
    ["MEN'S SOCCER", [MEN_SOCCER]],
    ['mens soccer', [MEN_SOCCER]],
    ["women's volleyball", [WOMEN_VOLLEYBALL]],
    ['women’s soccer', [WOMEN_SOCCER]],
  ])('%j lists only the leagues of that gender', async (q, expected) => {
    const t = await setup();
    expect(await names(t, q)).toEqual(expected);
  });

  test.each(["'s", '’s', "'s ’s"])('%j alone returns no rows', async (q) => {
    const t = await setup();
    expect(await t.query(api.search.leagues, { q })).toEqual({ rows: [], more: false });
  });
});

describe('search.leagues by a possessive name', () => {
  test.each(["joe's", 'joe’s pub', 'joe', "joe's pub 4s"])('%j finds the league', async (q) => {
    const t = await setup();
    expect(await names(t, q)).toEqual([JOES]);
  });

  test('a suggestion for a search with no match is built from the words without possessives', async () => {
    const t = await setup();
    const result = await t.query(api.search.leagues, { q: "joe's pub pickleball's" });
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toEqual(['joe pub']);
  });
});
