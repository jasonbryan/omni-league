/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { modules } from './test.setup';
import organizationsSource from './organizations.ts?raw';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

/** Organization A: two locations and three leagues, inserted out of name order. */
async function seedA(t: T): Promise<Id<'organizations'>> {
  return t.run(async (ctx) => {
    const org = await ctx.db.insert('organizations', {
      name: 'Gulf Coast Sport & Social',
      slug: 'gulf-coast',
    });
    const north = await ctx.db.insert('locations', {
      organizationId: org,
      name: 'North Beach Sand Courts',
      address: '3500 Surfside Blvd, Corpus Christi, TX 78402',
    });
    const bayside = await ctx.db.insert('locations', {
      organizationId: org,
      name: 'Bayside Athletic Complex',
      address: '4410 Ocean Dr, Corpus Christi, TX 78412',
    });
    await ctx.db.insert('leagues', {
      organizationId: org,
      name: 'Wednesday Coed Slow-Pitch',
      slug: 'wednesday-coed-slow-pitch',
      sport: 'softball',
      locationIds: [north, bayside],
    });
    await ctx.db.insert('leagues', {
      organizationId: org,
      name: 'coed 7v7 Rec',
      slug: 'coed-7v7-rec',
      sport: 'soccer',
      locationIds: [bayside],
    });
    await ctx.db.insert('leagues', {
      organizationId: org,
      name: 'Thursday Night Coed 2s',
      slug: 'thursday-night-coed-2s',
      sport: 'beachVolleyball',
      locationIds: [],
    });
    return org;
  });
}

/** Organization B: one location and one league, which A's page must never show. */
async function seedB(t: T): Promise<void> {
  await t.run(async (ctx) => {
    const org = await ctx.db.insert('organizations', { name: 'Other Org', slug: 'other-org' });
    const field = await ctx.db.insert('locations', {
      organizationId: org,
      name: 'B Field',
      address: '1 B Street',
    });
    await ctx.db.insert('leagues', {
      organizationId: org,
      name: 'B League',
      slug: 'b-league',
      sport: 'soccer',
      locationIds: [field],
    });
  });
}

const PAGE_A = {
  name: 'Gulf Coast Sport & Social',
  slug: 'gulf-coast',
  locations: [
    { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
    { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
  ],
  // Sorted by name, ignoring case; a league's locations keep the league's own order.
  leagues: [
    { name: 'coed 7v7 Rec', sportName: 'Soccer', locationNames: ['Bayside Athletic Complex'] },
    { name: 'Thursday Night Coed 2s', sportName: 'Beach volleyball', locationNames: [] },
    {
      name: 'Wednesday Coed Slow-Pitch',
      sportName: 'Softball',
      locationNames: ['North Beach Sand Courts', 'Bayside Athletic Complex'],
    },
  ],
};

describe('organizations:getPublicPage', () => {
  test('returns the name, slug, locations, and leagues with sport display names, sorted by name', async () => {
    const t = setup();
    await seedA(t);
    expect(await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' })).toEqual(PAGE_A);
  });

  test('returns empty lists for an organization with no locations and no leagues', async () => {
    const t = setup();
    await t.run((ctx) => ctx.db.insert('organizations', { name: 'Empty Club', slug: 'empty' }));
    expect(await t.query(api.organizations.getPublicPage, { slug: 'empty' })).toEqual({
      name: 'Empty Club',
      slug: 'empty',
      locations: [],
      leagues: [],
    });
  });

  test.each(['does-not-exist', '', 'Gulf-Coast', 'gulf-coast ', '../gulf-coast', 'x'.repeat(5000)])(
    'returns null for the unknown slug %j',
    async (slug) => {
      const t = setup();
      await seedA(t);
      expect(await t.query(api.organizations.getPublicPage, { slug })).toBeNull();
    },
  );

  test('rejects arguments outside the validator', async () => {
    const t = setup();
    await expect(
      t.query(api.organizations.getPublicPage, { slug: 1 } as unknown as { slug: string }),
    ).rejects.toThrow(/Validator|validator|slug/);
    await expect(
      t.query(api.organizations.getPublicPage, {
        slug: 'gulf-coast',
        organizationId: 'x',
      } as unknown as { slug: string }),
    ).rejects.toThrow();
  });

  test('anonymous and signed-in callers get the same result, with none of another organization', async () => {
    const t = setup();
    await seedA(t);
    await seedB(t);
    const anonymous = await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' });
    const signedIn = await t
      .withIdentity({ subject: 'user-b', tokenIdentifier: 'test|user-b', name: 'B Admin' })
      .query(api.organizations.getPublicPage, { slug: 'gulf-coast' });
    expect(anonymous).toEqual(PAGE_A);
    expect(signedIn).toEqual(anonymous);
    const text = JSON.stringify(anonymous);
    expect(text).not.toContain('B Field');
    expect(text).not.toContain('B League');
    expect(text).not.toContain('1 B Street');

    // And B's page holds only B's data.
    expect(await t.query(api.organizations.getPublicPage, { slug: 'other-org' })).toEqual({
      name: 'Other Org',
      slug: 'other-org',
      locations: [{ name: 'B Field', address: '1 B Street' }],
      leagues: [{ name: 'B League', sportName: 'Soccer', locationNames: ['B Field'] }],
    });
  });

  test("a league never names another organization's location, even if its document points at one", async () => {
    const t = setup();
    const orgA = await seedA(t);
    await seedB(t);
    await t.run(async (ctx) => {
      const bField = (await ctx.db.query('locations').collect()).find(
        (location) => location.name === 'B Field',
      );
      if (!bField) throw new Error('fixture: B Field missing');
      await ctx.db.insert('leagues', {
        organizationId: orgA,
        name: 'Crossed League',
        slug: 'crossed-league',
        sport: 'soccer',
        locationIds: [bField._id],
      });
    });
    const page = await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' });
    expect(page?.leagues.find((league) => league.name === 'Crossed League')).toEqual({
      name: 'Crossed League',
      sportName: 'Soccer',
      locationNames: [],
    });
    expect(JSON.stringify(page)).not.toContain('B Field');
  });

  test('returns only the fields of the returns validator: no ids, creation times, or slugs of children', async () => {
    const t = setup();
    await seedA(t);
    const page = await t.query(api.organizations.getPublicPage, { slug: 'gulf-coast' });
    expect(Object.keys(page ?? {}).sort()).toEqual(['leagues', 'locations', 'name', 'slug']);
    for (const location of page?.locations ?? []) {
      expect(Object.keys(location).sort()).toEqual(['address', 'name']);
    }
    for (const league of page?.leagues ?? []) {
      expect(Object.keys(league).sort()).toEqual(['locationNames', 'name', 'sportName']);
    }
    expect(JSON.stringify(page)).not.toMatch(/_id|_creationTime|organizationId|locationIds/);
  });

  test('every database read goes through an index (no table scan, no .filter())', () => {
    const reads = [...organizationsSource.matchAll(/ctx\.db\s*\.query\([^)]*\)\s*\.(\w+)/g)];
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.map(([, next]) => next)).toEqual(reads.map(() => 'withIndex'));
    expect(organizationsSource).not.toMatch(/\.filter\(\s*\(?q\b/);
  });
});
