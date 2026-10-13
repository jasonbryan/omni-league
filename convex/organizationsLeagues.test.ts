import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { LIST_MINE_LEAGUES_LIMIT } from './organizations';
import { insertLeague, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// `organizations.listMine` and its `leagues` field (#141): a league organizer's assigned leagues in
// each organization, from the caller's own membership. Identities are faked the way ADR 0008
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
 * Organization A (`org-a`) with the leagues "Coed Soccer", "beach 2s", "L Draft" (a draft), and
 * "M Other", and organization B (`org-b`) with the league "Sand 2s". Users: `organizer` (a league
 * organizer of A assigned "Coed Soccer", "beach 2s", and "L Draft", but not "M Other"), `admin` (an
 * org admin of A), `outsider` (an org admin of B), and `ghost` (an identity with no `users` row).
 */
async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const leagueIds: Record<string, Id<'leagues'>> = {};
    for (const [key, name, status] of [
      ['coed', 'Coed Soccer', 'published'],
      ['beach', 'beach 2s', 'published'],
      ['draft', 'L Draft', 'draft'],
      ['other', 'M Other', 'published'],
    ] as const) {
      const { leagueId } = await insertLeague(ctx, a, {
        name,
        sport: 'soccer',
        locations: ['Alpha Field'],
        status,
      });
      leagueIds[key] = leagueId;
    }
    leagueIds['foreign'] = (
      await insertLeague(ctx, b, {
        name: 'Sand 2s',
        sport: 'beachVolleyball',
        locations: ['B Field'],
      })
    ).leagueId;
    const user = (authUserId: string) =>
      ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    const organizer = await user('organizer');
    const admin = await user('admin');
    const outsider = await user('outsider');
    await ctx.db.insert('memberships', {
      userId: organizer,
      organizationId: a,
      role: 'leagueOrganizer',
      leagueIds: [leagueIds['coed'], leagueIds['beach'], leagueIds['draft']],
    });
    await ctx.db.insert('memberships', {
      userId: admin,
      organizationId: a,
      role: 'orgAdmin',
      leagueIds: [],
    });
    await ctx.db.insert('memberships', {
      userId: outsider,
      organizationId: b,
      role: 'orgAdmin',
      leagueIds: [],
    });
    return { organizationA: a, organizationB: b, leagueIds };
  });
  const as = (authUserId: string) => t.withIdentity(identity(authUserId));
  return { t, ...seeded, as };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Replaces the league ids of the first membership with this role in this organization. */
async function assign(
  t: Setup['t'],
  organizationId: Id<'organizations'>,
  role: 'orgAdmin' | 'leagueOrganizer',
  leagueIds: Id<'leagues'>[],
) {
  await t.run(async (ctx) => {
    const membership = (await ctx.db.query('memberships').collect()).find(
      (m) => m.organizationId === organizationId && m.role === role,
    )!;
    await ctx.db.patch('memberships', membership._id, { leagueIds });
  });
}

describe('organizations.listMine: leagues (#141)', () => {
  test("a league organizer's row lists their assigned leagues, drafts included, and not an unassigned one", async () => {
    const { as } = await setup();
    const rows = await as('organizer').query(api.organizations.listMine, {});
    expect(rows).toEqual([
      {
        name: 'Org A',
        slug: 'org-a',
        role: 'leagueOrganizer',
        leagues: [
          { name: 'beach 2s', slug: 'beach-2s' },
          { name: 'Coed Soccer', slug: 'coed-soccer' },
          { name: 'L Draft', slug: 'l-draft' },
        ],
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain('M Other');
  });

  test('sorts leagues by name ignoring case: "beach 2s" before "Coed Soccer"', async () => {
    const { as } = await setup();
    const [row] = await as('organizer').query(api.organizations.listMine, {});
    expect(row?.leagues.map((league) => league.name)).toEqual([
      'beach 2s',
      'Coed Soccer',
      'L Draft',
    ]);
  });

  test("an org admin's row has leagues []", async () => {
    const { as } = await setup();
    await expect(as('admin').query(api.organizations.listMine, {})).resolves.toEqual([
      { name: 'Org A', slug: 'org-a', role: 'orgAdmin', leagues: [] },
    ]);
  });

  test("an org admin's leagues stay [] even when the membership row carries league ids", async () => {
    const { t, as, organizationA, leagueIds } = await setup();
    await assign(t, organizationA, 'orgAdmin', [leagueIds['coed']]);
    const rows = await as('admin').query(api.organizations.listMine, {});
    expect(rows.map((row) => row.leagues)).toEqual([[]]);
  });

  test('a user of another organization sees neither L nor M, and no league of organization A', async () => {
    const { as } = await setup();
    const rows = await as('outsider').query(api.organizations.listMine, {});
    expect(rows).toEqual([{ name: 'Org B', slug: 'org-b', role: 'orgAdmin', leagues: [] }]);
    expect(JSON.stringify(rows)).not.toMatch(/L Draft|M Other|Coed Soccer/);
  });

  test('returns [] with no identity and for an identity with no users row', async () => {
    const { t, as } = await setup();
    await expect(t.query(api.organizations.listMine, {})).resolves.toEqual([]);
    await expect(as('ghost').query(api.organizations.listMine, {})).resolves.toEqual([]);
  });

  test("drops an assigned id that belongs to another organization's league", async () => {
    const { t, as, organizationA, leagueIds } = await setup();
    await assign(t, organizationA, 'leagueOrganizer', [leagueIds['coed'], leagueIds['foreign']]);
    const [row] = await as('organizer').query(api.organizations.listMine, {});
    expect(row?.leagues).toEqual([{ name: 'Coed Soccer', slug: 'coed-soccer' }]);
  });

  test("when the only assigned id is another organization's league, leagues is [] and the row stays", async () => {
    const { t, as, organizationA, leagueIds } = await setup();
    await assign(t, organizationA, 'leagueOrganizer', [leagueIds['foreign']]);
    await expect(as('organizer').query(api.organizations.listMine, {})).resolves.toEqual([
      { name: 'Org A', slug: 'org-a', role: 'leagueOrganizer', leagues: [] },
    ]);
  });

  test('drops an assigned id whose league no longer exists', async () => {
    const { t, as, organizationA, leagueIds } = await setup();
    await t.run(async (ctx) => ctx.db.delete('leagues', leagueIds['beach']));
    await assign(t, organizationA, 'leagueOrganizer', [leagueIds['coed'], leagueIds['beach']]);
    const [row] = await as('organizer').query(api.organizations.listMine, {});
    expect(row?.leagues).toEqual([{ name: 'Coed Soccer', slug: 'coed-soccer' }]);
  });

  test('sorts a league stored without a sortName by its lower-cased name', async () => {
    const { t, as, organizationA, leagueIds } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch('leagues', leagueIds['coed'], { sortName: undefined });
    });
    await assign(t, organizationA, 'leagueOrganizer', [leagueIds['coed'], leagueIds['beach']]);
    const [row] = await as('organizer').query(api.organizations.listMine, {});
    expect(row?.leagues.map((league) => league.name)).toEqual(['beach 2s', 'Coed Soccer']);
  });

  test('lists each league once when the assigned ids repeat', async () => {
    const { t, as, organizationA, leagueIds } = await setup();
    await assign(t, organizationA, 'leagueOrganizer', [leagueIds['coed'], leagueIds['coed']]);
    const [row] = await as('organizer').query(api.organizations.listMine, {});
    expect(row?.leagues).toEqual([{ name: 'Coed Soccer', slug: 'coed-soccer' }]);
  });

  test('a league organizer of two organizations gets each organization its own leagues', async () => {
    const { t, as, organizationB, leagueIds } = await setup();
    await t.run(async (ctx) => {
      const organizer = (await ctx.db.query('users').collect()).find(
        (u) => u.authUserId === 'organizer',
      )!;
      await ctx.db.insert('memberships', {
        userId: organizer._id,
        organizationId: organizationB,
        role: 'leagueOrganizer',
        leagueIds: [leagueIds['foreign']],
      });
    });
    const rows = await as('organizer').query(api.organizations.listMine, {});
    expect(rows.map((row) => [row.slug, row.leagues.map((league) => league.slug)])).toEqual([
      ['org-a', ['beach-2s', 'coed-soccer', 'l-draft']],
      ['org-b', ['sand-2s']],
    ]);
  });
  test("two league organizers of one organization each see only their own assignment, never the other's", async () => {
    const { t, as, organizationA, leagueIds } = await setup();
    await t.run(async (ctx) => {
      const second = await ctx.db.insert('users', {
        authUserId: 'second',
        name: 'second',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId: second,
        organizationId: organizationA,
        role: 'leagueOrganizer',
        leagueIds: [leagueIds['other']],
      });
    });
    const mine = await as('organizer').query(api.organizations.listMine, {});
    const theirs = await as('second').query(api.organizations.listMine, {});
    expect(theirs.map((row) => row.leagues)).toEqual([[{ name: 'M Other', slug: 'm-other' }]]);
    expect(JSON.stringify(theirs)).not.toMatch(/Coed Soccer|beach 2s|L Draft/);
    expect(JSON.stringify(mine)).not.toContain('M Other');
  });

  test('reads no more than LIST_MINE_LEAGUES_LIMIT assigned ids of a membership', async () => {
    const { t, as, organizationA } = await setup();
    const extra = await t.run(async (ctx) => {
      const ids: Id<'leagues'>[] = [];
      for (let i = 0; i <= LIST_MINE_LEAGUES_LIMIT; i++) {
        const { leagueId } = await insertLeague(ctx, organizationA, {
          name: `Extra ${String(i).padStart(3, '0')}`,
          sport: 'soccer',
          locations: ['Alpha Field'],
        });
        ids.push(leagueId);
      }
      return ids;
    });
    await assign(t, organizationA, 'leagueOrganizer', extra);
    const [row] = await as('organizer').query(api.organizations.listMine, {});
    expect(row?.leagues).toHaveLength(LIST_MINE_LEAGUES_LIMIT);
    expect(row?.leagues.map((league) => league.slug)).not.toContain(
      `extra-${LIST_MINE_LEAGUES_LIMIT}`,
    );
  });
});
