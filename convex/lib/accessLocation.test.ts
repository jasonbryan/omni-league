import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import schema from '../schema';
import { modules } from '../test.setup';
import { requireLocationAdmin, requireOrgAdminOrForbidden } from './access';
import { FORBIDDEN_CODE } from './forbidden';
import { insertLocation, insertTenant } from './tenantWrites';

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
    const tenant = (name: string, slug: string) =>
      insertTenant(ctx, { organization: { name, slug }, locations: [], leagues: [] });
    const organizationA = await tenant('Org A', 'org-a');
    const organizationB = await tenant('Org B', 'org-b');
    const locationA = await insertLocation(ctx, organizationA, {
      name: 'A Field',
      address: 'A St',
    });
    const locationB = await insertLocation(ctx, organizationB, {
      name: 'B Field',
      address: 'B St',
    });
    const member = async (
      authUserId: string,
      organizationId: typeof organizationA | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds: [] });
      }
      return userId;
    };
    const adminA = await member('admin-a', organizationA);
    await member('organizer-a', organizationA, 'leagueOrganizer');
    await member('admin-b', organizationB);
    await member('stranger', null);
    return { organizationA, organizationB, locationA, locationB, adminA };
  });
  return { t, ...ids };
}

describe('requireOrgAdminOrForbidden', () => {
  test('passes an org admin of that organization', async () => {
    const { t, organizationA, adminA } = await setup();
    const result = await t
      .withIdentity(identity('admin-a'))
      .run((ctx) => requireOrgAdminOrForbidden(ctx, organizationA));
    expect(result.user._id).toBe(adminA);
    expect(result.membership.role).toBe('orgAdmin');
  });

  test('throws the FORBIDDEN ConvexError for every other caller, signed in or not', async () => {
    const { t, organizationA } = await setup();
    const callers = ['stranger', 'organizer-a', 'admin-b', 'ghost', null];
    for (const caller of callers) {
      const run = caller ? t.withIdentity(identity(caller)) : t;
      const error = await run
        .run((ctx) => requireOrgAdminOrForbidden(ctx, organizationA))
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error, String(caller)).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<{ code: string }>).data).toEqual({ code: FORBIDDEN_CODE });
    }
  });
});

describe('requireLocationAdmin', () => {
  test("passes the org admin of the location's organization and returns the stored location", async () => {
    const { t, organizationA, locationA } = await setup();
    const result = await t
      .withIdentity(identity('admin-a'))
      .run((ctx) => requireLocationAdmin(ctx, locationA));
    expect(result.location._id).toBe(locationA);
    expect(result.location.organizationId).toBe(organizationA);
    expect(result.membership.role).toBe('orgAdmin');
  });

  test('refuses an org admin of another organization, a league organizer, and a non-member', async () => {
    const { t, locationA, locationB } = await setup();
    for (const caller of ['admin-b', 'organizer-a', 'stranger']) {
      await expect(
        t.withIdentity(identity(caller)).run((ctx) => requireLocationAdmin(ctx, locationA)),
        caller,
      ).rejects.toThrow('Not allowed');
    }
    await expect(
      t.withIdentity(identity('admin-a')).run((ctx) => requireLocationAdmin(ctx, locationB)),
    ).rejects.toThrow('Not allowed');
  });

  test('refuses a caller with no identity, and a location that does not exist', async () => {
    const { t, locationA } = await setup();
    await expect(t.run((ctx) => requireLocationAdmin(ctx, locationA))).rejects.toThrow(
      'Sign in required',
    );
    await t.run((ctx) => ctx.db.delete('locations', locationA));
    await expect(
      t.withIdentity(identity('admin-a')).run((ctx) => requireLocationAdmin(ctx, locationA)),
    ).rejects.toThrow('Not allowed');
  });
});
