/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_MAX_ROWS } from './lib/publicList';
import { insertOrganization, insertTenant, type LeagueSeed } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

const LOCATION = { name: 'Courts', address: '1 Rd' };

const league = (name: string, sport: LeagueSeed['sport'], status?: 'draft'): LeagueSeed => ({
  name,
  sport,
  locations: [LOCATION.name],
  ...(status && { status }),
});

async function tenant(
  t: T,
  name: string,
  leagues: LeagueSeed[],
  cityState?: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: {
        name,
        slug: name.toLowerCase().replace(/\W+/g, '-'),
        ...(cityState && { cityState }),
      },
      locations: [LOCATION],
      leagues,
    });
  });
}

async function seedSeven(t: T): Promise<void> {
  for (const name of ['Echo', 'delta', 'Charlie', 'bravo', 'Alpha', 'Foxtrot', 'Golf']) {
    await tenant(t, `${name} Club`, [league('Coed', 'soccer')]);
  }
}

describe('search:organizations', () => {
  test('lists organizations with a published league by name ignoring case, with sports and City, state', async () => {
    const t = setup();
    await tenant(
      t,
      'Gulf Coast Sport & Social',
      [league('A', 'softball'), league('B', 'beachVolleyball'), league('C', 'soccer')],
      'Corpus Christi, TX',
    );
    await tenant(t, 'front range', [league('D', 'soccer')]);
    await tenant(t, 'Alpha', [league('E', 'softball')], 'Denver, CO');

    expect(await t.query(api.search.organizations, { page: 1 })).toEqual({
      rows: [
        { name: 'Alpha', slug: 'alpha', sportNames: ['Softball'], cityState: 'Denver, CO' },
        { name: 'front range', slug: 'front-range', sportNames: ['Soccer'] },
        {
          name: 'Gulf Coast Sport & Social',
          slug: 'gulf-coast-sport-social',
          sportNames: ['Beach volleyball', 'Soccer', 'Softball'],
          cityState: 'Corpus Christi, TX',
        },
      ],
      page: 1,
      pageCount: 1,
      total: 3,
    });
  });

  test('never returns an organization with only draft leagues or none', async () => {
    const t = setup();
    await tenant(t, 'Published', [league('A', 'soccer'), league('B', 'softball', 'draft')]);
    await tenant(t, 'Drafts only', [league('C', 'soccer', 'draft')]);
    await tenant(t, 'No leagues', []);
    await t.run((ctx) => insertOrganization(ctx, { name: 'Bare', slug: 'bare' }));

    const page = await t.query(api.search.organizations, { page: 1 });
    expect(page.rows).toEqual([{ name: 'Published', slug: 'published', sportNames: ['Soccer'] }]);
    expect(page.total).toBe(1);
  });

  test('returns only published fields, with no id', async () => {
    const t = setup();
    await tenant(t, 'Gulf', [league('A', 'soccer')], 'Corpus Christi, TX');
    const page = await t.query(api.search.organizations, { page: 1 });
    expect(Object.keys(page.rows[0]).sort()).toEqual(['cityState', 'name', 'slug', 'sportNames']);
  });

  test('holds 5 rows per page, and page 2 holds the 6th and 7th', async () => {
    const t = setup();
    await seedSeven(t);
    const first = await t.query(api.search.organizations, { page: 1 });
    expect(first.rows.map((row) => row.name)).toEqual([
      'Alpha Club',
      'bravo Club',
      'Charlie Club',
      'delta Club',
      'Echo Club',
    ]);
    expect([first.page, first.pageCount, first.total]).toEqual([1, 2, 7]);
    const second = await t.query(api.search.organizations, { page: 2 });
    expect(second.rows.map((row) => row.name)).toEqual(['Foxtrot Club', 'Golf Club']);
    expect(second.page).toBe(2);
  });

  test.each([0, -1, 1.5, 3, 1000])('answers page 1 for the page %s', async (page) => {
    const t = setup();
    await seedSeven(t);
    const result = await t.query(api.search.organizations, { page });
    expect(result.page).toBe(1);
    expect(result.rows[0].name).toBe('Alpha Club');
  });

  test('is empty with no organization that has a published league', async () => {
    const t = setup();
    await tenant(t, 'Drafts only', [league('C', 'soccer', 'draft')]);
    expect(await t.query(api.search.organizations, { page: 1 })).toEqual({
      rows: [],
      page: 1,
      pageCount: 0,
      total: 0,
    });
  });

  test('reaches at most the most rows a public list holds', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < PUBLIC_LIST_MAX_ROWS + 3; i++) {
        const name = `Club ${String(i).padStart(3, '0')}`;
        await ctx.db.insert('organizations', {
          name,
          slug: `club-${i}`,
          sortName: name.toLowerCase(),
          hasPublishedLeague: true,
          sportLeagueCounts: { soccer: 1 },
        });
      }
    });
    const last = await t.query(api.search.organizations, { page: PUBLIC_LIST_MAX_PAGE });
    expect([last.total, last.pageCount]).toEqual([PUBLIC_LIST_MAX_ROWS, PUBLIC_LIST_MAX_PAGE]);
    expect(last.rows.at(-1)?.name).toBe('Club 199');
  });

  test('needs no sign-in', async () => {
    const t = setup();
    await seedSeven(t);
    await expect(t.query(api.search.organizations, { page: 1 })).resolves.toBeDefined();
  });
});
