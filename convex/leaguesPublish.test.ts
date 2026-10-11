/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertDraftLeague, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// `leagues.publish` and `leagues.publishedCount` (#69). Identities are faked the way ADR 0008
// "Testing" shows.

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

/**
 * Organization A with locations X (Alpha Field) and Y (Bravo Beach), a published soccer league at
 * X, a draft soccer league `Draft Soccer` at X and Y, a draft softball league `Draft Softball` at
 * Y, and a draft beach volleyball league `Other Draft` at X. Organization B has one location and a
 * draft league. Users: `admin-a`, `organizer-a` (assigned to `Draft Soccer` only), `admin-b`,
 * `stranger` (no membership), and `ghost` (an identity with no `users` row).
 */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [
        { name: 'Alpha Field', address: '1 Alpha St' },
        { name: 'Bravo Beach', address: '2 Bravo St' },
      ],
      leagues: [{ name: 'Live Soccer', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const locationIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const x = await locationIn(organizationA, 'Alpha Field');
    const y = await locationIn(organizationA, 'Bravo Beach');
    const bField = await locationIn(organizationB, 'B Field');
    const draft = (
      organizationId: Id<'organizations'>,
      name: string,
      sport: 'soccer' | 'softball' | 'beachVolleyball',
      locationIds: Id<'locations'>[],
    ) =>
      insertDraftLeague(ctx, organizationId, {
        name,
        slug: name.toLowerCase().replace(/ /g, '-'),
        sport,
        locationIds,
      });
    const draftSoccer = await draft(organizationA, 'Draft Soccer', 'soccer', [x, y]);
    const draftSoftball = await draft(organizationA, 'Draft Softball', 'softball', [y]);
    const otherDraft = await draft(organizationA, 'Other Draft', 'beachVolleyball', [x]);
    const draftB = await draft(organizationB, 'Draft B', 'soccer', [bField]);
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
      leagueIds: Id<'leagues'>[] = [],
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
      }
    };
    await member('admin-a', organizationA);
    await member('organizer-a', organizationA, 'leagueOrganizer', [draftSoccer]);
    await member('admin-b', organizationB);
    await member('stranger', null);
    return { organizationA, organizationB, x, y, draftSoccer, draftSoftball, otherDraft, draftB };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    adminB: t.withIdentity(identity('admin-b')),
    organizerA: t.withIdentity(identity('organizer-a')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Everything a publish may touch, so a refused or repeated call can be shown to change nothing. */
const snapshot = (t: Setup['t']) =>
  t.run(async (ctx) => ({
    leagues: await ctx.db.query('leagues').collect(),
    organizations: await ctx.db.query('organizations').collect(),
    sportLocations: await ctx.db.query('sportLocations').collect(),
  }));

const statusOf = (t: Setup['t'], id: Id<'leagues'>) =>
  t.run(async (ctx) => (await ctx.db.get('leagues', id))?.status);

describe('leagues.publish', () => {
  test('an org admin publishes a draft: it is published and counted once', async () => {
    const s = await setup();
    await expect(s.adminA.mutation(api.leagues.publish, { leagueId: s.draftSoccer })).resolves.toBe(
      null,
    );
    expect(await statusOf(s.t, s.draftSoccer)).toBe('published');
    const organization = await s.t.run((ctx) => ctx.db.get('organizations', s.organizationA));
    expect(organization).toMatchObject({
      leagueCount: 2,
      locationCount: 2,
      sportLeagueCounts: { soccer: 2 },
      sportLocationCounts: { soccer: 2 },
    });
  });

  test('a shared location goes to 2, a new one to 1, and the soccer entry gains 1 league and 1 location', async () => {
    const s = await setup();
    const before = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    expect(before?.sports).toEqual([
      expect.objectContaining({ key: 'soccer', leagueCount: 1, locationCount: 1 }),
    ]);
    await s.adminA.mutation(api.leagues.publish, { leagueId: s.draftSoccer });
    const rows = await s.t.run((ctx) =>
      ctx.db
        .query('sportLocations')
        .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
          q.eq('organizationId', s.organizationA),
        )
        .collect(),
    );
    expect(rows.map((row) => `${row.sport}/${row.locationId}/${row.leagueCount}`).sort()).toEqual(
      [`soccer/${s.x}/2`, `soccer/${s.y}/1`].sort(),
    );
    const after = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    expect(after?.leagueCount).toBe(2);
    expect(after?.sports).toEqual([
      expect.objectContaining({ key: 'soccer', leagueCount: 2, locationCount: 2 }),
    ]);
  });

  test('a repeat publish succeeds and changes no row or counter', async () => {
    const s = await setup();
    await s.adminA.mutation(api.leagues.publish, { leagueId: s.draftSoccer });
    const before = await snapshot(s.t);
    await expect(s.adminA.mutation(api.leagues.publish, { leagueId: s.draftSoccer })).resolves.toBe(
      null,
    );
    // The seed's league was published from the start, so it is a repeat too.
    const live = (await s.t.run((ctx) => ctx.db.query('leagues').first()))!;
    expect(live.status).toBe('published');
    await expect(s.adminA.mutation(api.leagues.publish, { leagueId: live._id })).resolves.toBe(
      null,
    );
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('a league stored without a status was already counted: publishing it sets the status and increments nothing', async () => {
    const s = await setup();
    const live = (await s.t.run((ctx) => ctx.db.query('leagues').first()))!;
    await s.t.run((ctx) => ctx.db.patch('leagues', live._id, { status: undefined }));
    const stored = await s.t.run((ctx) => ctx.db.get('leagues', live._id));
    expect(stored).not.toHaveProperty('status');
    const before = await snapshot(s.t);
    await expect(s.adminA.mutation(api.leagues.publish, { leagueId: live._id })).resolves.toBe(
      null,
    );
    expect(await statusOf(s.t, live._id)).toBe('published');
    const after = await snapshot(s.t);
    expect(after.organizations).toEqual(before.organizations);
    expect(after.sportLocations).toEqual(before.sportLocations);
    expect(after.leagues.map((league) => ({ ...league, status: undefined }))).toEqual(
      before.leagues.map((league) => ({ ...league, status: undefined })),
    );
  });

  test('the league appears on the public pages and in the public queries at once, and only then', async () => {
    const s = await setup();
    const page = () => s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    const leagues = (args: { sport?: 'soccer' | 'softball' }) =>
      s.t.query(api.organizations.listPublicLeagues, { slug: 'org-a', page: 1, ...args });

    expect((await leagues({})).rows.map((row) => row.name)).toEqual(['Live Soccer']);
    expect((await leagues({ sport: 'softball' })).total).toBe(0);
    expect((await page())?.sports.map((sport) => sport.key)).toEqual(['soccer']);

    await s.adminA.mutation(api.leagues.publish, { leagueId: s.draftSoftball });

    const after = await leagues({});
    expect(after.total).toBe(2);
    expect(after.rows.map((row) => row.name)).toEqual(['Draft Softball', 'Live Soccer']);
    expect(after.rows[0]).toEqual({
      name: 'Draft Softball',
      sportName: 'Softball',
      locationNames: ['Bravo Beach'],
    });
    expect((await leagues({ sport: 'softball' })).rows.map((row) => row.name)).toEqual([
      'Draft Softball',
    ]);
    expect((await page())?.sports.map((sport) => sport.key)).toEqual(['soccer', 'softball']);
    // The drafts still unpublished stay off every list.
    expect(after.rows.map((row) => row.name)).not.toContain('Draft Soccer');
  });

  test('a league organizer assigned to the league publishes it; another league in the organization is refused', async () => {
    const s = await setup();
    await expect(
      s.organizerA.mutation(api.leagues.publish, { leagueId: s.draftSoccer }),
    ).resolves.toBe(null);
    expect(await statusOf(s.t, s.draftSoccer)).toBe('published');
    const before = await snapshot(s.t);
    await expect(
      s.organizerA.mutation(api.leagues.publish, { leagueId: s.draftSoftball }),
    ).rejects.toThrow('Not allowed');
    expect(await snapshot(s.t)).toEqual(before);
    expect(await statusOf(s.t, s.draftSoftball)).toBe('draft');
  });

  test('refuses an unauthenticated caller, an identity with no users row, a non-member, and an org admin of another organization', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    const callers = [
      ['unauthenticated', s.t, 'Sign in required'],
      ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
      ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
      ['org admin of B', s.adminB, 'Not allowed'],
    ] as const;
    for (const [label, caller, message] of callers) {
      await expect(
        caller.mutation(api.leagues.publish, { leagueId: s.draftSoccer }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await snapshot(s.t)).toEqual(before);
    expect(await statusOf(s.t, s.draftSoccer)).toBe('draft');
  });

  test('refuses a league that does not exist', async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.delete('leagues', s.otherDraft));
    const before = await snapshot(s.t);
    await expect(
      s.adminA.mutation(api.leagues.publish, { leagueId: s.otherDraft }),
    ).rejects.toThrow('Not allowed');
    expect(await snapshot(s.t)).toEqual(before);
  });

  test("an org admin of one organization cannot publish another organization's league", async () => {
    const s = await setup();
    await expect(s.adminA.mutation(api.leagues.publish, { leagueId: s.draftB })).rejects.toThrow(
      'Not allowed',
    );
    expect(await statusOf(s.t, s.draftB)).toBe('draft');
  });

  test('an organization whose counters are not set yet keeps them unset, and the league is published', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('organizations', s.organizationB, {
        leagueCount: undefined,
        sportLeagueCounts: undefined,
        sportLocationCounts: undefined,
      });
    });
    await s.adminB.mutation(api.leagues.publish, { leagueId: s.draftB });
    expect(await statusOf(s.t, s.draftB)).toBe('published');
    const organization = await s.t.run((ctx) => ctx.db.get('organizations', s.organizationB));
    expect(organization?.leagueCount).toBeUndefined();
    expect(organization?.sportLeagueCounts).toBeUndefined();
    const rows = await s.t.run((ctx) => ctx.db.query('sportLocations').collect());
    expect(rows.filter((row) => row.organizationId === s.organizationB)).toEqual([]);
  });
});

describe('leagues.publishedCount', () => {
  test('is the organization’s leagueCount counter, and moves when a draft is published', async () => {
    const s = await setup();
    const args = { organizationId: s.organizationA };
    await expect(s.adminA.query(api.leagues.publishedCount, args)).resolves.toBe(1);
    await s.adminA.mutation(api.leagues.publish, { leagueId: s.draftSoccer });
    await expect(s.adminA.query(api.leagues.publishedCount, args)).resolves.toBe(2);
  });

  test('reads the counter, not a capped list: a counter of 500 reads 500', async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch('organizations', s.organizationA, { leagueCount: 500 }));
    await expect(
      s.adminA.query(api.leagues.publishedCount, { organizationId: s.organizationA }),
    ).resolves.toBe(500);
  });

  test('reads 0 when the counter is not set yet', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('organizations', s.organizationA, { leagueCount: undefined }),
    );
    await expect(
      s.adminA.query(api.leagues.publishedCount, { organizationId: s.organizationA }),
    ).resolves.toBe(0);
  });

  test('is refused to every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    const args = { organizationId: s.organizationA };
    await expect(s.t.query(api.leagues.publishedCount, args)).rejects.toThrow('Sign in required');
    for (const caller of [s.adminB, s.organizerA, s.t.withIdentity(identity('stranger'))]) {
      await expect(caller.query(api.leagues.publishedCount, args)).rejects.toThrow('Not allowed');
    }
  });
});
