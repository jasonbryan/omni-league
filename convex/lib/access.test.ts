import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { modules } from '../test.setup';
import { requireLeagueOrganizer, requireOrgAdmin } from './access';
import { insertTenant } from './tenantWrites';

// The access helpers every staff function uses from #64 on (convex.md, Functions). Identities are
// faked the way ADR 0008 "Testing" shows.

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

/**
 * Organization A with leagues L1 and L2, organization B with league LB, and these users:
 * `admin-a` (org admin of A), `organizer-l1` (league organizer of L1 in A), `organizer-lb` (league
 * organizer of LB in B), `admin-b` (org admin of B), `stranger` (no membership), `ghost` (an
 * identity with no `users` row).
 */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [],
      leagues: [],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [],
      leagues: [],
    });
    const league = (organizationId: Id<'organizations'>, slug: string) =>
      ctx.db.insert('leagues', {
        organizationId,
        name: slug,
        slug,
        sport: 'soccer',
        locationIds: [],
        sortName: slug,
      });
    const l1 = await league(organizationA, 'l1');
    const l2 = await league(organizationA, 'l2');
    const lb = await league(organizationB, 'lb');
    const user = (authUserId: string) =>
      ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    const adminA = await user('admin-a');
    const organizerL1 = await user('organizer-l1');
    const organizerLb = await user('organizer-lb');
    const adminB = await user('admin-b');
    await user('stranger');
    await ctx.db.insert('memberships', {
      userId: adminA,
      organizationId: organizationA,
      role: 'orgAdmin',
      leagueIds: [],
    });
    await ctx.db.insert('memberships', {
      userId: organizerL1,
      organizationId: organizationA,
      role: 'leagueOrganizer',
      leagueIds: [l1],
    });
    await ctx.db.insert('memberships', {
      userId: organizerLb,
      organizationId: organizationB,
      role: 'leagueOrganizer',
      leagueIds: [lb],
    });
    await ctx.db.insert('memberships', {
      userId: adminB,
      organizationId: organizationB,
      role: 'orgAdmin',
      leagueIds: [],
    });
    return { organizationA, organizationB, l1, l2, lb, adminA, organizerL1 };
  });
  return { t, ...ids };
}

describe('requireOrgAdmin', () => {
  test('passes an org admin of that organization, and returns the user and membership', async () => {
    const { t, organizationA, adminA } = await setup();
    const result = await t
      .withIdentity(identity('admin-a'))
      .run((ctx) => requireOrgAdmin(ctx, organizationA));
    expect(result.user._id).toBe(adminA);
    expect(result.membership.role).toBe('orgAdmin');
    expect(result.membership.organizationId).toBe(organizationA);
  });

  test('refuses a non-member, a league organizer, and an org admin of another organization', async () => {
    const { t, organizationA } = await setup();
    for (const caller of ['stranger', 'organizer-l1', 'organizer-lb', 'admin-b']) {
      await expect(
        t.withIdentity(identity(caller)).run((ctx) => requireOrgAdmin(ctx, organizationA)),
        caller,
      ).rejects.toThrow('Not allowed');
    }
  });

  test('refuses a caller with no identity, and an identity with no users row', async () => {
    const { t, organizationA } = await setup();
    await expect(t.run((ctx) => requireOrgAdmin(ctx, organizationA))).rejects.toThrow(
      'Sign in required',
    );
    await expect(
      t.withIdentity(identity('ghost')).run((ctx) => requireOrgAdmin(ctx, organizationA)),
    ).rejects.toThrow('Sign in required');
  });
});

describe('requireLeagueOrganizer', () => {
  test('passes the league organizer of L and the org admin of its organization', async () => {
    const { t, l1 } = await setup();
    const organizer = await t
      .withIdentity(identity('organizer-l1'))
      .run((ctx) => requireLeagueOrganizer(ctx, l1));
    expect(organizer.membership.role).toBe('leagueOrganizer');
    const admin = await t
      .withIdentity(identity('admin-a'))
      .run((ctx) => requireLeagueOrganizer(ctx, l1));
    expect(admin.membership.role).toBe('orgAdmin');
  });

  test('refuses a league organizer of another league of the same organization', async () => {
    const { t, l2 } = await setup();
    await expect(
      t.withIdentity(identity('organizer-l1')).run((ctx) => requireLeagueOrganizer(ctx, l2)),
    ).rejects.toThrow('Not allowed');
  });

  test('refuses a league organizer and an org admin of another organization', async () => {
    const { t, l1 } = await setup();
    await expect(
      t.withIdentity(identity('organizer-lb')).run((ctx) => requireLeagueOrganizer(ctx, l1)),
    ).rejects.toThrow('Not allowed');
    await expect(
      t.withIdentity(identity('admin-b')).run((ctx) => requireLeagueOrganizer(ctx, l1)),
    ).rejects.toThrow('Not allowed');
  });

  test('refuses a non-member and a caller with no identity, and a league that does not exist', async () => {
    const { t, l1, organizerL1 } = await setup();
    await expect(
      t.withIdentity(identity('stranger')).run((ctx) => requireLeagueOrganizer(ctx, l1)),
    ).rejects.toThrow('Not allowed');
    await expect(t.run((ctx) => requireLeagueOrganizer(ctx, l1))).rejects.toThrow(
      'Sign in required',
    );
    // A league deleted after its id was handed out: refused, not an error that names the league.
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert('leagues', {
        organizationId: (await ctx.db.query('organizations').first())!._id,
        name: 'x',
        slug: 'xxx',
        sport: 'soccer',
        locationIds: [],
      });
      await ctx.db.delete('leagues', id);
      return id;
    });
    await expect(
      t.withIdentity(identity('admin-a')).run((ctx) => requireLeagueOrganizer(ctx, gone)),
    ).rejects.toThrow('Not allowed');
    expect(organizerL1).toBeTruthy();
  });
});

describe('requireLeagueOrganizer, forged assignments', () => {
  test("refuses an organizer whose leagueIds names another organization's league", async () => {
    const { t, organizationA, lb } = await setup();
    // organizer-l1 holds a membership in A only; a stray id of B's league in its assignments must
    // not open B's league, because the membership is looked up in the league's own organization.
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query('memberships')
        .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationA))
        .collect();
      const organizer = membership.find((m) => m.role === 'leagueOrganizer')!;
      await ctx.db.patch('memberships', organizer._id, { leagueIds: [...organizer.leagueIds, lb] });
    });
    await expect(
      t.withIdentity(identity('organizer-l1')).run((ctx) => requireLeagueOrganizer(ctx, lb)),
    ).rejects.toThrow('Not allowed');
  });

  test('refuses a league organizer with no assigned leagues', async () => {
    const { t, l1, organizationA } = await setup();
    await t.run(async (ctx) => {
      const user = await ctx.db.insert('users', {
        authUserId: 'empty-organizer',
        name: 'empty-organizer',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId: user,
        organizationId: organizationA,
        role: 'leagueOrganizer',
        leagueIds: [],
      });
    });
    await expect(
      t.withIdentity(identity('empty-organizer')).run((ctx) => requireLeagueOrganizer(ctx, l1)),
    ).rejects.toThrow('Not allowed');
  });
});
