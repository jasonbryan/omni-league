/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertDraftLeague, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Org', slug: 'org' },
      locations: [
        { name: 'Alpha Field', address: '1 Alpha St' },
        { name: 'Bravo Beach', address: '2 Bravo St' },
      ],
      leagues: [{ name: 'Live Soccer', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const locationIn = async (name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const x = await locationIn('Alpha Field');
    const y = await locationIn('Bravo Beach');
    const draft = (name: string, locationIds: Id<'locations'>[]) =>
      insertDraftLeague(ctx, organizationId, {
        name,
        slug: name.toLowerCase().replace(/ /g, '-'),
        sport: 'soccer',
        locationIds,
        division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
      });
    const one = await draft('Draft One', [x, y]);
    const two = await draft('Draft Two', [x]);
    const twice = await draft('Draft Twice', [x, x]);
    const three = await draft('Draft Three', [y]);
    for (const [authUserId, role, leagueIds] of [
      ['admin', 'orgAdmin', []],
      ['organizer', 'leagueOrganizer', [one]],
    ] as const) {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId,
        role,
        leagueIds: [...leagueIds],
      });
    }
    return { organizationId, x, y, one, two, twice, three };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity(identity('admin')),
    organizer: t.withIdentity(identity('organizer')),
  };
}

const counted = (s: Awaited<ReturnType<typeof setup>>) =>
  s.t.run(async (ctx) => {
    const organization = (await ctx.db.get('organizations', s.organizationId))!;
    const rows = await ctx.db.query('sportLocations').collect();
    return {
      leagueCount: organization.leagueCount,
      locationCount: organization.locationCount,
      sportLeagueCounts: organization.sportLeagueCounts,
      sportLocationCounts: organization.sportLocationCounts,
      rows: rows.map((row) => `${row.sport}/${row.locationId}/${row.leagueCount}`).sort(),
    };
  });

describe('leagues.publish at the same time', () => {
  test('the same draft published by an admin and its organizer at once counts once', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.admin.mutation(api.leagues.publish, { leagueId: s.one }),
      s.organizer.mutation(api.leagues.publish, { leagueId: s.one }),
      s.admin.mutation(api.leagues.publish, { leagueId: s.one }),
      s.organizer.mutation(api.leagues.publish, { leagueId: s.one }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
    expect(await counted(s)).toEqual({
      leagueCount: 2,
      locationCount: 2,
      sportLeagueCounts: { soccer: 2 },
      sportLocationCounts: { soccer: 2 },
      rows: [`soccer/${s.x}/2`, `soccer/${s.y}/1`].sort(),
    });
  });

  test('different drafts published at once each count once, and a shared location adds up', async () => {
    const s = await setup();
    await Promise.all([
      s.admin.mutation(api.leagues.publish, { leagueId: s.one }),
      s.admin.mutation(api.leagues.publish, { leagueId: s.two }),
      s.admin.mutation(api.leagues.publish, { leagueId: s.three }),
    ]);
    expect(await counted(s)).toEqual({
      leagueCount: 4,
      locationCount: 2,
      sportLeagueCounts: { soccer: 4 },
      sportLocationCounts: { soccer: 2 },
      rows: [`soccer/${s.x}/3`, `soccer/${s.y}/2`].sort(),
    });
    const page = await s.t.query(api.organizations.getPublicPage, { slug: 'org' });
    expect(page?.sports).toEqual([
      expect.objectContaining({ key: 'soccer', leagueCount: 4, locationCount: 2 }),
    ]);
  });
});

describe('leagues.publish inputs', () => {
  test('a league that names a location twice counts the location once', async () => {
    const s = await setup();
    await s.admin.mutation(api.leagues.publish, { leagueId: s.twice });
    expect(await counted(s)).toMatchObject({
      leagueCount: 2,
      rows: [`soccer/${s.x}/2`],
    });
  });

  test('an id of another table is refused and nothing changes', async () => {
    const s = await setup();
    const before = await counted(s);
    await expect(
      s.admin.mutation(api.leagues.publish, { leagueId: s.x as unknown as Id<'leagues'> }),
    ).rejects.toThrow();
    await expect(
      s.admin.mutation(api.leagues.publish, { leagueId: 'not-an-id' as unknown as Id<'leagues'> }),
    ).rejects.toThrow();
    expect(await counted(s)).toEqual(before);
  });

  test('a publish moves the public league list, the sport view, and the sports of its locations, and not the location rows', async () => {
    const s = await setup();
    const locations = () =>
      s.t.query(api.organizations.listPublicLocations, { slug: 'org', page: 1 });
    const leagues = () => s.t.query(api.organizations.listPublicLeagues, { slug: 'org', page: 1 });
    const locationsBefore = await locations();
    expect((await leagues()).total).toBe(1);
    await s.admin.mutation(api.leagues.publish, { leagueId: s.one });
    const locationsAfter = await locations();
    const rowsWithout = (result: typeof locationsAfter) =>
      result.rows.map(({ name, address }) => ({ name, address }));
    expect(rowsWithout(locationsAfter)).toEqual(rowsWithout(locationsBefore));
    expect(locationsAfter.total).toBe(locationsBefore.total);
    expect(locationsBefore.rows.map((row) => row.sportNames)).toEqual([['Soccer'], []]);
    expect(locationsAfter.rows.map((row) => row.sportNames)).toEqual([['Soccer'], ['Soccer']]);
    const after = await leagues();
    expect(after.total).toBe(2);
    expect(after.rows.map((row) => row.name)).toEqual(['Draft One', 'Live Soccer']);
    expect(after.rows[0]?.locationNames).toEqual(['Alpha Field', 'Bravo Beach']);
    const sport = await s.t.query(api.organizations.listPublicLeagues, {
      slug: 'org',
      page: 1,
      sport: 'soccer',
    });
    expect(sport.total).toBe(2);
  });

  test('an admin list shows the status change and the unpublished drafts stay Draft', async () => {
    const s = await setup();
    await s.admin.mutation(api.leagues.publish, { leagueId: s.two });
    const rows = await s.admin.query(api.leagues.listForAdmin, {
      organizationId: s.organizationId,
    });
    const status = Object.fromEntries(rows.map((row) => [row.name, row.status]));
    expect(status).toEqual({
      'Live Soccer': 'published',
      'Draft One': 'draft',
      'Draft Two': 'published',
      'Draft Twice': 'draft',
      'Draft Three': 'draft',
    });
  });
});
