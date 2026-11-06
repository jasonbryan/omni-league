/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MEMBERS_LIMIT } from './memberships';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertMembership } from './lib/memberships';
import { insertTenant } from './lib/tenantWrites';
import { deleteUserRecord } from './lib/users';
import schema from './schema';
import { modules } from './test.setup';

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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
  betterAuthTest.register(t, 'betterAuth');
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
    // No Better Auth user stands behind these rows, as for an account removed from the auth side.
    const person = async (authUserId: string) =>
      ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    const adminA = await person('admin-a');
    const organizerA = await person('organizer-a');
    const adminB = await person('admin-b');
    const stranger = await person('stranger');
    await insertMembership(ctx, adminA, organizationA, 'orgAdmin');
    await insertMembership(ctx, organizerA, organizationA, 'leagueOrganizer');
    await insertMembership(ctx, adminB, organizationB, 'orgAdmin');
    return { organizationA, organizationB, adminA, organizerA, adminB, stranger };
  });
  return {
    t,
    ...ids,
    asAdminA: t.withIdentity(identity('admin-a')),
    asOrganizerA: t.withIdentity(identity('organizer-a')),
    asAdminB: t.withIdentity(identity('admin-b')),
    asStranger: t.withIdentity(identity('stranger')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function storedAndRecount(s: Setup, organizationId: Id<'organizations'>) {
  return s.t.run(async (ctx) => {
    const organization = await ctx.db.get('organizations', organizationId);
    const rows = await ctx.db
      .query('memberships')
      .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
      .collect();
    return { stored: organization?.staffCount, recount: rows.length };
  });
}

async function expectCountersMatch(s: Setup): Promise<void> {
  for (const organizationId of [s.organizationA, s.organizationB]) {
    const { stored, recount } = await storedAndRecount(s, organizationId);
    expect(stored).toBe(recount);
  }
}

const unsetCounter = (s: Setup, organizationId: Id<'organizations'>) =>
  s.t.run((ctx) => ctx.db.patch('organizations', organizationId, { staffCount: undefined }));

const addUser = (s: Setup, name: string) =>
  s.t.run((ctx) => ctx.db.insert('users', { authUserId: name, name, adultConfirmedAt: 1 }));

describe('memberships.staffCount', () => {
  test('returns the organization’s staff count to its org admin', async () => {
    const s = await setup();
    expect(
      await s.asAdminA.query(api.memberships.staffCount, { organizationId: s.organizationA }),
    ).toBe(2);
    expect(
      await s.asAdminB.query(api.memberships.staffCount, { organizationId: s.organizationB }),
    ).toBe(1);
  });

  test('refuses the unauthenticated, a league organizer, a non-member, and another organization’s admin', async () => {
    const s = await setup();
    const args = { organizationId: s.organizationA };
    await expect(s.t.query(api.memberships.staffCount, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.query(api.memberships.staffCount, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.asStranger.query(api.memberships.staffCount, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.asAdminB.query(api.memberships.staffCount, args)).rejects.toThrow(/Not allowed/);
  });

  test('counts past the 200 rows the member list stops at', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let n = 0; n < MEMBERS_LIMIT; n++) {
        const userId = await ctx.db.insert('users', {
          authUserId: `extra-${n}`,
          name: `Extra ${n}`,
          adultConfirmedAt: 1,
        });
        await insertMembership(ctx, userId, s.organizationA, 'orgAdmin');
      }
    });
    const args = { organizationId: s.organizationA };
    expect(await s.asAdminA.query(api.memberships.staffCount, args)).toBe(MEMBERS_LIMIT + 2);
  });

  test('reads a counter that is not set yet from the rows', async () => {
    const s = await setup();
    await unsetCounter(s, s.organizationA);
    expect(
      await s.asAdminA.query(api.memberships.staffCount, { organizationId: s.organizationA }),
    ).toBe(2);
  });
});

describe('the staff counter', () => {
  test('equals a recount of the rows after every writer', async () => {
    const s = await setup();
    await expectCountersMatch(s);
    const newcomer = await addUser(s, 'newcomer');
    await s.t.run((ctx) => insertMembership(ctx, newcomer, s.organizationB, 'leagueOrganizer'));
    await expectCountersMatch(s);
    await s.t.run((ctx) => deleteUserRecord(ctx, 'organizer-a'));
    await expectCountersMatch(s);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(1);
    expect((await storedAndRecount(s, s.organizationB)).stored).toBe(2);
  });

  test('a missing organization leaves the count alone, so deleting a user still goes through', async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.delete('organizations', s.organizationB));
    await s.t.run((ctx) => deleteUserRecord(ctx, 'admin-b'));
    const rows = await s.t.run((ctx) => ctx.db.query('memberships').collect());
    expect(rows.map((row) => row.userId)).not.toContain(s.adminB);
  });

  test('starts at 0 for a new organization', async () => {
    const s = await setup();
    const organizationId = await s.t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Org C', slug: 'org-c' },
        locations: [],
        leagues: [],
      }),
    );
    expect((await storedAndRecount(s, organizationId)).stored).toBe(0);
  });

  test('a counter that is not set yet is recounted by the next write, which includes it', async () => {
    const s = await setup();
    await unsetCounter(s, s.organizationA);
    const newcomer = await addUser(s, 'newcomer');
    await s.t.run((ctx) => insertMembership(ctx, newcomer, s.organizationA, 'orgAdmin'));
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 3, recount: 3 });
  });

  test('deleting a user removes their memberships and the count follows', async () => {
    const s = await setup();
    await s.t.run((ctx) => deleteUserRecord(ctx, 'admin-a'));
    const rows = await s.t.run((ctx) => ctx.db.query('memberships').collect());
    expect(rows.map((row) => row.userId)).not.toContain(s.adminA);
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
    expect(await storedAndRecount(s, s.organizationB)).toEqual({ stored: 1, recount: 1 });
  });
});

describe('seed:demo backfill of the staff counter', () => {
  test('sets a counter that is not set from a recount, counts the organization, and leaves a set one', async () => {
    const s = await setup();
    await unsetCounter(s, s.organizationA);
    await s.t.run((ctx) => ctx.db.patch('organizations', s.organizationB, { staffCount: 40 }));
    const first = await s.t.mutation(internal.seed.insertDemoData, {});
    expect(first.backfilled.staffCounts).toBe(1);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(2);
    expect((await storedAndRecount(s, s.organizationB)).stored).toBe(40);
    const second = await s.t.mutation(internal.seed.insertDemoData, {});
    expect(second.backfilled.staffCounts).toBe(0);
  });
});
