/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { PENDING_INVITES_LIMIT } from './invites';
import { INVITE_LIFETIME_MS, INVITE_RESTORE_WINDOW_MS } from './lib/inviteInput';
import { insertPendingInvite, setInviteStatus } from './lib/inviteWrites';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});
afterEach(() => {
  vi.useRealTimers();
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
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [],
      leagues: [],
    });
    const person = async (
      authUserId: string,
      membership: {
        organizationId: Id<'organizations'>;
        role: 'orgAdmin' | 'leagueOrganizer';
      } | null,
    ) => {
      const now = Date.now();
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name: authUserId,
            email: `${authUserId}@example.test`,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      } as never)) as { _id: string };
      const userId = await ctx.db.insert('users', {
        authUserId: account._id,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (membership) {
        await ctx.db.insert('memberships', { userId, ...membership, leagueIds: [] });
      }
      return { authUserId: account._id, userId };
    };
    return {
      organizationA,
      organizationB,
      adminA: await person('admin-a', { organizationId: organizationA, role: 'orgAdmin' }),
      organizerA: await person('organizer-a', {
        organizationId: organizationA,
        role: 'leagueOrganizer',
      }),
      adminB: await person('admin-b', { organizationId: organizationB, role: 'orgAdmin' }),
      stranger: await person('stranger', null),
      dana: await person('dana', null),
    };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return {
    t,
    ...ids,
    asAdminA: as(ids.adminA),
    asOrganizerA: as(ids.organizerA),
    asAdminB: as(ids.adminB),
    asStranger: as(ids.stranger),
    asDana: as(ids.dana),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function storedAndRecount(s: Setup, organizationId: Id<'organizations'>) {
  return s.t.run(async (ctx) => {
    const organization = await ctx.db.get('organizations', organizationId);
    const rows = await ctx.db
      .query('invites')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', organizationId).eq('status', 'pending'),
      )
      .collect();
    return { stored: organization?.pendingInviteCount, recount: rows.length };
  });
}

async function expectCountersMatch(s: Setup): Promise<void> {
  for (const organizationId of [s.organizationA, s.organizationB]) {
    const { stored, recount } = await storedAndRecount(s, organizationId);
    expect(stored).toBe(recount);
  }
}

const unsetCounter = (s: Setup, organizationId: Id<'organizations'>) =>
  s.t.run((ctx) =>
    ctx.db.patch('organizations', organizationId, { pendingInviteCount: undefined }),
  );

const fields = (s: Setup, email: string, expiresAt = NOW + INVITE_LIFETIME_MS) => ({
  organizationId: s.organizationA,
  email,
  role: 'orgAdmin' as const,
  leagueIds: [],
  tokenHash: `hash-${email}`,
  expiresAt,
});

const addPending = (s: Setup, email: string, expiresAt?: number) =>
  s.t.run((ctx) => insertPendingInvite(ctx, fields(s, email, expiresAt)));

const create = (s: Setup, email: string) =>
  s.asAdminA.action(api.invites.create, {
    organizationId: s.organizationA,
    email,
    role: 'orgAdmin',
    leagueIds: [],
  });

const revoke = (s: Setup, inviteId: Id<'invites'>) =>
  s.asAdminA.mutation(api.invites.revoke, { inviteId });
const restore = (s: Setup, inviteId: Id<'invites'>) =>
  s.asAdminA.mutation(api.invites.restore, { inviteId });

describe('invites.pendingCount', () => {
  test('counts the pending invites, expired ones included, and not revoked or accepted ones', async () => {
    const s = await setup();
    await addPending(s, 'one@example.com');
    await addPending(s, 'two@example.com');
    await addPending(s, 'expired@example.com', NOW - 1);
    const revoked = await addPending(s, 'revoked@example.com');
    const accepted = await addPending(s, 'accepted@example.com');
    await s.t.run(async (ctx) => {
      await setInviteStatus(ctx, revoked, { status: 'revoked', revokedAt: NOW });
      await setInviteStatus(ctx, accepted, { status: 'accepted' });
    });
    expect(
      await s.asAdminA.query(api.invites.pendingCount, { organizationId: s.organizationA }),
    ).toBe(3);
    expect(
      await s.asAdminB.query(api.invites.pendingCount, { organizationId: s.organizationB }),
    ).toBe(0);
  });

  test('counts past the 200 rows the pending list stops at', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let n = 0; n < PENDING_INVITES_LIMIT + 5; n++) {
        await insertPendingInvite(ctx, fields(s, `p${n}@example.com`));
      }
    });
    const args = { organizationId: s.organizationA };
    expect(await s.asAdminA.query(api.invites.pendingCount, args)).toBe(PENDING_INVITES_LIMIT + 5);
    expect(await s.asAdminA.query(api.invites.listPending, args)).toHaveLength(
      PENDING_INVITES_LIMIT,
    );
  });

  test('refuses the unauthenticated, a league organizer, a non-member, and another organization’s admin', async () => {
    const s = await setup();
    const args = { organizationId: s.organizationA };
    await expect(s.t.query(api.invites.pendingCount, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.query(api.invites.pendingCount, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.asStranger.query(api.invites.pendingCount, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asAdminB.query(api.invites.pendingCount, args)).rejects.toThrow(/Not allowed/);
  });

  test('recounts the rows while the counter is not set, and writes nothing', async () => {
    const s = await setup();
    await addPending(s, 'one@example.com');
    await addPending(s, 'two@example.com');
    await unsetCounter(s, s.organizationA);
    const before = await s.t.run((ctx) => ctx.db.get('organizations', s.organizationA));
    expect(
      await s.asAdminA.query(api.invites.pendingCount, { organizationId: s.organizationA }),
    ).toBe(2);
    expect(await s.t.run((ctx) => ctx.db.get('organizations', s.organizationA))).toEqual(before);
    expect(before?.pendingInviteCount).toBeUndefined();
  });
});

describe('the pending-invite counter', () => {
  test('starts at 0 for a new organization from organizations.create', async () => {
    const s = await setup();
    const { slug } = await s.asStranger.mutation(api.organizations.create, {
      name: 'Org C',
      slug: 'org-c',
    });
    const created = await s.t.run((ctx) =>
      ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .unique(),
    );
    expect(created?.pendingInviteCount).toBe(0);
  });

  test('equals a recount after invites.create, revoke, restore, and accept', async () => {
    const s = await setup();
    const first = await create(s, 'one@example.com');
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
    await create(s, 'two@example.com');
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 2, recount: 2 });
    await revoke(s, first.inviteId);
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
    await restore(s, first.inviteId);
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 2, recount: 2 });
    const danas = await create(s, 'dana@example.test');
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 3, recount: 3 });
    await s.asDana.mutation(api.invites.accept, { token: danas.token });
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 2, recount: 2 });
    await expectCountersMatch(s);
  });

  test('equals a recount after seed:insertDemoInvite', async () => {
    const s = await setup();
    await s.t.mutation(internal.seed.insertDemoData, {});
    const demo = async () => {
      const organization = await s.t.run((ctx) =>
        ctx.db
          .query('organizations')
          .withIndex('by_slug', (q) => q.eq('slug', 'gulf-coast-sport-social'))
          .unique(),
      );
      return storedAndRecount(s, organization!._id);
    };
    expect(await demo()).toEqual({ stored: 0, recount: 0 });
    expect(await s.t.mutation(internal.seed.insertDemoInvite, { tokenHash: 'x' })).toBe(1);
    expect(await demo()).toEqual({ stored: 1, recount: 1 });
    expect(await s.t.mutation(internal.seed.insertDemoInvite, { tokenHash: 'y' })).toBe(0);
    expect(await demo()).toEqual({ stored: 1, recount: 1 });
  });

  test('equals a recount after testing:addInvite', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const s = await setup();
    for (const email of ['late@example.com', 'later@example.com']) {
      await s.t.mutation(internal.testing.addInvite, {
        organizationSlug: 'org-a',
        email,
        role: 'orgAdmin',
        expiresAt: NOW + 1_000,
      });
    }
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 2, recount: 2 });
  });

  test('stays put when a write is refused', async () => {
    const s = await setup();
    await create(s, 'kept@example.com');
    const revoked = await create(s, 'revoked@example.com');
    const danas = await create(s, 'dana@example.test');
    await revoke(s, revoked.inviteId);
    const stays = async () =>
      expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 2, recount: 2 });
    await stays();

    await expect(create(s, 'KEPT@example.com')).rejects.toMatchObject({
      data: { code: 'alreadyInvited' },
    });
    await stays();
    await expect(revoke(s, revoked.inviteId)).rejects.toMatchObject({
      data: { code: 'notPending' },
    });
    await stays();
    const revokedAt = (await s.t.run((ctx) => ctx.db.get('invites', revoked.inviteId)))?.revokedAt;
    vi.setSystemTime((revokedAt ?? NOW) + INVITE_RESTORE_WINDOW_MS + 1);
    await expect(restore(s, revoked.inviteId)).rejects.toMatchObject({
      data: { code: 'windowPassed' },
    });
    await stays();
    await expect(
      s.asStranger.mutation(api.invites.accept, { token: danas.token }),
    ).rejects.toMatchObject({ data: { code: 'emailMismatch' } });
    await stays();
  });

  test('is recounted by the next write while it is not set, and the recount includes an inserted invite', async () => {
    const s = await setup();
    await addPending(s, 'one@example.com');
    await addPending(s, 'two@example.com');
    await unsetCounter(s, s.organizationA);
    await create(s, 'three@example.com');
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 3, recount: 3 });
  });

  test('is recounted by the next write while it is not set, and the recount leaves out an invite that was revoked', async () => {
    const s = await setup();
    const one = await addPending(s, 'one@example.com');
    await addPending(s, 'two@example.com');
    await unsetCounter(s, s.organizationA);
    await revoke(s, one);
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
  });

  test('is recounted by the next write while it is not set, and the recount leaves out an invite that was accepted', async () => {
    const s = await setup();
    const danas = await create(s, 'dana@example.test');
    await addPending(s, 'two@example.com');
    await unsetCounter(s, s.organizationA);
    await s.asDana.mutation(api.invites.accept, { token: danas.token });
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
  });

  test('is recounted by a restore while it is not set, and the recount includes the restored invite', async () => {
    const s = await setup();
    const one = await addPending(s, 'one@example.com');
    await revoke(s, one);
    await unsetCounter(s, s.organizationA);
    await restore(s, one);
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
  });

  test('never goes below 0', async () => {
    const s = await setup();
    const one = await addPending(s, 'one@example.com');
    await s.t.run((ctx) =>
      ctx.db.patch('organizations', s.organizationA, { pendingInviteCount: 0 }),
    );
    await revoke(s, one);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(0);
  });

  test('moves once for an invite that leaves pending twice', async () => {
    const s = await setup();
    const one = await addPending(s, 'one@example.com');
    await addPending(s, 'two@example.com');
    await s.t.run(async (ctx) => {
      await setInviteStatus(ctx, one, { status: 'revoked', revokedAt: NOW });
      await setInviteStatus(ctx, one, { status: 'revoked', revokedAt: NOW });
    });
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
  });

  test('leaves a gone organization alone, so the write still goes through', async () => {
    const s = await setup();
    const one = await s.t.run((ctx) =>
      insertPendingInvite(ctx, {
        ...fields(s, 'one@example.com'),
        organizationId: s.organizationB,
      }),
    );
    await s.t.run((ctx) => ctx.db.delete('organizations', s.organizationB));
    await s.t.run((ctx) => setInviteStatus(ctx, one, { status: 'revoked', revokedAt: NOW }));
    expect((await s.t.run((ctx) => ctx.db.get('invites', one)))?.status).toBe('revoked');
  });
});

describe('seed:demo backfill of the pending-invite counter', () => {
  test('sets a counter that is not set from a recount, counts the organization, and leaves a set one', async () => {
    const s = await setup();
    await addPending(s, 'one@example.com');
    await unsetCounter(s, s.organizationA);
    await s.t.run((ctx) =>
      ctx.db.patch('organizations', s.organizationB, { pendingInviteCount: 40 }),
    );
    const first = await s.t.mutation(internal.seed.insertDemoData, {});
    expect(first.backfilled.staffInviteCounts).toBe(1);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(1);
    expect((await storedAndRecount(s, s.organizationB)).stored).toBe(40);
    const second = await s.t.mutation(internal.seed.insertDemoData, {});
    expect(second.backfilled.staffInviteCounts).toBe(0);
  });
});

describe('the writers of invites', () => {
  const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts', '!./_generated/**'], {
    eager: true,
    query: '?raw',
    import: 'default',
  });
  const WRITES_INVITES = /\.(insert|patch|replace|delete)\(\s*'invites'/;

  test('only convex/lib/inviteWrites.ts inserts, patches, replaces, or deletes an invite', () => {
    const writers = Object.entries(sources)
      .filter(([, text]) => WRITES_INVITES.test(text))
      .map(([path]) => path);
    expect(writers).toEqual(['./lib/inviteWrites.ts']);
  });
});
