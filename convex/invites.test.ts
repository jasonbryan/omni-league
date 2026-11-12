/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { INVITE_LIFETIME_MS, INVITE_MESSAGES, INVITE_RESTORE_WINDOW_MS } from './lib/inviteInput';
import { hashInviteToken } from './lib/inviteToken';
import { insertMembership } from './lib/memberships';
import { insertTenant, defaultDivision } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

type Role = 'orgAdmin' | 'leagueOrganizer';

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Coed 7v7',
          sport: 'soccer',
          locations: ['Alpha Field'],
          division: defaultDivision('soccer'),
        },
        {
          name: 'Sand 2s',
          sport: 'beachVolleyball',
          locations: ['Alpha Field'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [
        {
          name: 'Other Sand',
          sport: 'beachVolleyball',
          locations: ['B Field'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const leagueIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const person = async (
      authUserId: string,
      membership: {
        organizationId: Id<'organizations'>;
        role: Role;
        leagueIds?: Id<'leagues'>[];
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
        await ctx.db.insert('memberships', {
          userId,
          organizationId: membership.organizationId,
          role: membership.role,
          leagueIds: membership.leagueIds ?? [],
        });
      }
      return { authUserId: account._id, userId };
    };
    const coed = await leagueIn(organizationA, 'Coed 7v7');
    const sand = await leagueIn(organizationA, 'Sand 2s');
    const other = await leagueIn(organizationB, 'Other Sand');
    return {
      organizationA,
      organizationB,
      coed,
      sand,
      other,
      adminA: await person('admin-a', { organizationId: organizationA, role: 'orgAdmin' }),
      organizerA: await person('organizer-a', {
        organizationId: organizationA,
        role: 'leagueOrganizer',
        leagueIds: [coed],
      }),
      adminB: await person('admin-b', { organizationId: organizationB, role: 'orgAdmin' }),
      stranger: await person('stranger', null),
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
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

type StaffCtx = Parameters<Parameters<Setup['t']['run']>[0]>[0];

async function addStaff(
  ctx: StaffCtx,
  organizationId: Id<'organizations'>,
  name: string,
  role: Role,
) {
  const now = Date.now();
  const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'user',
      data: {
        name,
        email: `${name}@example.test`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  } as never)) as { _id: string };
  const userId = await ctx.db.insert('users', {
    authUserId: account._id,
    name,
    adultConfirmedAt: 1,
  });
  await insertMembership(ctx, userId, organizationId, role);
  return { authUserId: account._id, userId };
}

async function staffOf(s: Setup, slug: string, names: string[]) {
  const { organizationId, accounts } = await s.t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: slug, slug },
      locations: [],
      leagues: [],
    });
    const accounts: Record<string, { authUserId: string; userId: Id<'users'> }> = {};
    for (const [index, name] of names.entries()) {
      accounts[name] = await addStaff(
        ctx,
        organizationId,
        name,
        index === 0 ? 'orgAdmin' : 'leagueOrganizer',
      );
    }
    return { organizationId, accounts };
  });
  return {
    organizationId,
    accounts,
    asAdmin: s.t.withIdentity(identity(accounts[names[0]].authUserId)),
  };
}

const invite = (
  s: Setup,
  email: string,
  role: Role = 'orgAdmin',
  leagueIds: Id<'leagues'>[] = [],
) =>
  s.asAdminA.action(api.invites.create, {
    organizationId: s.organizationA,
    email,
    role,
    leagueIds,
  });

const allInvites = (s: Setup) => s.t.run((ctx) => ctx.db.query('invites').collect());

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

function base64urlBytes(text: string): Uint8Array {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')), (c) =>
    c.charCodeAt(0),
  );
}

describe('invites.create', () => {
  test('stores a pending league organizer invite and returns a 256-bit token once', async () => {
    const s = await setup();
    const result = await invite(s, '  Dana@Example.COM ', 'leagueOrganizer', [s.coed]);
    expect(result.expiresAt).toBe(NOW + INVITE_LIFETIME_MS);
    expect(INVITE_LIFETIME_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(base64urlBytes(result.token)).toHaveLength(32);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = await allInvites(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: result.inviteId,
      organizationId: s.organizationA,
      email: 'dana@example.com',
      role: 'leagueOrganizer',
      leagueIds: [s.coed],
      status: 'pending',
      expiresAt: NOW + INVITE_LIFETIME_MS,
    });
    expect(rows[0].tokenHash).toBe(await sha256Hex(result.token));
    expect(JSON.stringify(rows[0])).not.toContain(result.token);
    const memberships = await s.t.run((ctx) => ctx.db.query('memberships').collect());
    expect(memberships).toHaveLength(3);
  });

  test('makes a different token for each invite', async () => {
    const s = await setup();
    const first = await invite(s, 'one@example.com');
    const second = await invite(s, 'two@example.com');
    expect(first.token).not.toBe(second.token);
    const [a, b] = await allInvites(s);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  test('accepts an org admin invite with no leagues', async () => {
    const s = await setup();
    await invite(s, 'boss@example.com', 'orgAdmin');
    expect((await allInvites(s))[0]).toMatchObject({ role: 'orgAdmin', leagueIds: [] });
  });

  test('refuses an org admin invite that carries leagues', async () => {
    const s = await setup();
    await expect(invite(s, 'boss@example.com', 'orgAdmin', [s.coed])).rejects.toThrow();
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses a league organizer invite with no league', async () => {
    const s = await setup();
    await expect(invite(s, 'x@example.com', 'leagueOrganizer', [])).rejects.toMatchObject({
      data: { field: 'leagues', code: 'leaguesEmpty', message: INVITE_MESSAGES.leaguesEmpty },
    });
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses a league of another organization and one that does not exist', async () => {
    const s = await setup();
    await expect(invite(s, 'x@example.com', 'leagueOrganizer', [s.other])).rejects.toThrow(
      /Not allowed/,
    );
    await expect(invite(s, 'x@example.com', 'leagueOrganizer', [s.coed, s.other])).rejects.toThrow(
      /Not allowed/,
    );
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses an empty or malformed email', async () => {
    const s = await setup();
    await expect(invite(s, '   ')).rejects.toMatchObject({
      data: { field: 'email', code: 'emailEmpty' },
    });
    for (const bad of ['dana', 'dana@', '@example.com', 'a b@example.com', 'dana@example']) {
      await expect(invite(s, bad)).rejects.toMatchObject({
        data: { field: 'email', code: 'emailInvalid', message: INVITE_MESSAGES.emailInvalid },
      });
    }
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses an address that belongs to a current member, whatever its case', async () => {
    const s = await setup();
    await expect(invite(s, 'Organizer-A@Example.test', 'orgAdmin')).rejects.toMatchObject({
      data: {
        field: 'email',
        code: 'alreadyMember',
        message: INVITE_MESSAGES.alreadyMember('organizer-a@example.test'),
      },
    });
    expect(await allInvites(s)).toEqual([]);
  });

  test('invites a member of another organization, and an account with no membership', async () => {
    const s = await setup();
    await invite(s, 'admin-b@example.test');
    await invite(s, 'stranger@example.test');
    expect(await allInvites(s)).toHaveLength(2);
  });

  test('refuses an address that already has a pending invite, until it is revoked', async () => {
    const s = await setup();
    const first = await invite(s, 'dana@example.com');
    await expect(invite(s, 'DANA@example.com')).rejects.toMatchObject({
      data: {
        field: 'email',
        code: 'alreadyInvited',
        message: INVITE_MESSAGES.alreadyInvited('dana@example.com'),
      },
    });
    expect(await allInvites(s)).toHaveLength(1);

    await s.asAdminA.mutation(api.invites.revoke, { inviteId: first.inviteId });
    const second = await invite(s, 'dana@example.com');
    expect(second.inviteId).not.toBe(first.inviteId);
    expect(await allInvites(s)).toHaveLength(2);
  });

  test('another organization may invite the same address', async () => {
    const s = await setup();
    await invite(s, 'dana@example.com');
    await s.asAdminB.action(api.invites.create, {
      organizationId: s.organizationB,
      email: 'dana@example.com',
      role: 'orgAdmin',
      leagueIds: [],
    });
    expect(await allInvites(s)).toHaveLength(2);
  });

  test('an invite whose expiry has passed still blocks the address until it is revoked', async () => {
    const s = await setup();
    const first = await invite(s, 'dana@example.com');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS + 1);
    await expect(invite(s, 'dana@example.com')).rejects.toMatchObject({
      data: { code: 'alreadyInvited' },
    });
    await s.asAdminA.mutation(api.invites.revoke, { inviteId: first.inviteId });
    await expect(invite(s, 'dana@example.com')).resolves.toMatchObject({
      expiresAt: NOW + INVITE_LIFETIME_MS + 1 + INVITE_LIFETIME_MS,
    });
  });

  test('refuses the unauthenticated, a league organizer, a non-member, and another organization’s admin', async () => {
    const s = await setup();
    const args = {
      organizationId: s.organizationA,
      email: 'dana@example.com',
      role: 'orgAdmin' as const,
      leagueIds: [],
    };
    await expect(s.t.action(api.invites.create, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asStranger.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asAdminB.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    expect(await allInvites(s)).toEqual([]);
  });

  test('the write is internal: no client can call it with a hash it chose', () => {
    expect('insertPending' in api.invites).toBe(false);
  });
});

describe('invites.revoke', () => {
  test('revokes a pending invite, which then leaves the pending list', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'dana@example.com');
    expect(
      await s.asAdminA.query(api.invites.listPending, { organizationId: s.organizationA }),
    ).toHaveLength(1);
    await s.asAdminA.mutation(api.invites.revoke, { inviteId });
    expect(
      await s.asAdminA.query(api.invites.listPending, { organizationId: s.organizationA }),
    ).toEqual([]);
    expect((await allInvites(s))[0].status).toBe('revoked');
  });

  test('refuses an invite that is revoked or accepted already', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'dana@example.com');
    await s.asAdminA.mutation(api.invites.revoke, { inviteId });
    await expect(s.asAdminA.mutation(api.invites.revoke, { inviteId })).rejects.toMatchObject({
      data: { code: 'notPending', message: INVITE_MESSAGES.revokeNotPending },
    });
    const accepted = await invite(s, 'erin@example.com');
    await s.t.run((ctx) => ctx.db.patch('invites', accepted.inviteId, { status: 'accepted' }));
    await expect(
      s.asAdminA.mutation(api.invites.revoke, { inviteId: accepted.inviteId }),
    ).rejects.toMatchObject({ data: { code: 'notPending' } });
  });

  test('revokes an expired invite', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'dana@example.com');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS + 1);
    await s.asAdminA.mutation(api.invites.revoke, { inviteId });
    expect((await allInvites(s))[0].status).toBe('revoked');
  });

  test('takes the organization from the stored invite, not from the caller', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'dana@example.com');
    await expect(s.asAdminB.mutation(api.invites.revoke, { inviteId })).rejects.toThrow(
      /Not allowed/,
    );
    expect((await allInvites(s))[0].status).toBe('pending');
  });

  test('refuses the unauthenticated, a league organizer, and a non-member', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'dana@example.com');
    await expect(s.t.mutation(api.invites.revoke, { inviteId })).rejects.toThrow(
      /Sign in required/,
    );
    await expect(s.asOrganizerA.mutation(api.invites.revoke, { inviteId })).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.asStranger.mutation(api.invites.revoke, { inviteId })).rejects.toThrow(
      /Not allowed/,
    );
    expect((await allInvites(s))[0].status).toBe('pending');
  });
});

async function revokedInvite(
  s: Setup,
  email: string,
  role: Role = 'orgAdmin',
  leagueIds: Id<'leagues'>[] = [],
) {
  const created = await invite(s, email, role, leagueIds);
  await s.asAdminA.mutation(api.invites.revoke, { inviteId: created.inviteId });
  return created;
}

const restore = (s: Setup, inviteId: Id<'invites'>) =>
  s.asAdminA.mutation(api.invites.restore, { inviteId });

const storedInvite = async (s: Setup, inviteId: Id<'invites'>) =>
  (await allInvites(s)).find((row) => row._id === inviteId);

const statusOf = async (s: Setup, inviteId: Id<'invites'>) =>
  (await storedInvite(s, inviteId))?.status;

async function storedRevokedAt(s: Setup, inviteId: Id<'invites'>): Promise<number> {
  const revokedAt = (await storedInvite(s, inviteId))?.revokedAt;
  if (revokedAt === undefined) throw new Error('the invite has no revokedAt');
  return revokedAt;
}

describe('invites.restore', () => {
  test('sets the invite back to pending with the same hash and expiry; the original link works again', async () => {
    const s = await setup();
    const { inviteId, token, expiresAt } = await revokedInvite(
      s,
      'dana@example.com',
      'leagueOrganizer',
      [s.coed],
    );
    const before = (await allInvites(s))[0];
    expect(await s.t.query(api.invites.getByToken, { token })).toEqual({ status: 'invalid' });

    vi.setSystemTime(NOW + 5 * 60 * 1000);
    expect(await restore(s, inviteId)).toBeNull();

    const [after] = await allInvites(s);
    expect(after).toMatchObject({
      _id: inviteId,
      status: 'pending',
      tokenHash: before.tokenHash,
      expiresAt,
      email: 'dana@example.com',
      role: 'leagueOrganizer',
      leagueIds: [s.coed],
    });
    expect(after.tokenHash).toBe(await hashInviteToken(token));
    expect(after.revokedAt).toBeUndefined();
    expect(await s.t.query(api.invites.getByToken, { token })).toMatchObject({ status: 'valid' });
    const rows = await s.asAdminA.query(api.invites.listPending, {
      organizationId: s.organizationA,
    });
    expect(rows.map((row) => row.inviteId)).toEqual([inviteId]);
  });

  test('works at exactly the end of the window and refuses one millisecond later', async () => {
    const s = await setup();
    const atEnd = await revokedInvite(s, 'dana@example.com');
    const pastEnd = await revokedInvite(s, 'erin@example.com');
    const atEndRevokedAt = await storedRevokedAt(s, atEnd.inviteId);
    const pastEndRevokedAt = await storedRevokedAt(s, pastEnd.inviteId);

    vi.setSystemTime(atEndRevokedAt + INVITE_RESTORE_WINDOW_MS);
    await restore(s, atEnd.inviteId);
    expect(await statusOf(s, atEnd.inviteId)).toBe('pending');

    vi.setSystemTime(pastEndRevokedAt + INVITE_RESTORE_WINDOW_MS + 1);
    await expect(restore(s, pastEnd.inviteId)).rejects.toMatchObject({
      data: { code: 'windowPassed' },
    });
    expect(await statusOf(s, pastEnd.inviteId)).toBe('revoked');
    expect(INVITE_RESTORE_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  test('refuses after the window and changes nothing', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    const before = await allInvites(s);
    vi.setSystemTime(NOW + 60 * 60 * 1000);
    await expect(restore(s, inviteId)).rejects.toMatchObject({
      data: { code: 'windowPassed', message: INVITE_MESSAGES.restoreWindowPassed },
    });
    expect(await allInvites(s)).toEqual(before);
  });

  test('refuses an invite that has expired, even inside the window', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'dana@example.com');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS - 1000);
    await s.asAdminA.mutation(api.invites.revoke, { inviteId });
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS + 1000);
    const before = await allInvites(s);
    await expect(restore(s, inviteId)).rejects.toMatchObject({
      data: { code: 'expired', message: INVITE_MESSAGES.restoreExpired },
    });
    expect(await allInvites(s)).toEqual(before);
  });

  test('refuses when another pending invite to the address exists, as create does', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    await invite(s, 'dana@example.com');
    const before = await allInvites(s);
    await expect(restore(s, inviteId)).rejects.toMatchObject({
      data: {
        field: 'email',
        code: 'alreadyInvited',
        message: INVITE_MESSAGES.alreadyInvited('dana@example.com'),
      },
    });
    expect(await allInvites(s)).toEqual(before);
  });

  test('refuses when the address now belongs to a current member, as create does', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'stranger@example.test');
    await s.t.run((ctx) =>
      ctx.db.insert('memberships', {
        userId: s.stranger.userId,
        organizationId: s.organizationA,
        role: 'orgAdmin',
        leagueIds: [],
      }),
    );
    const before = await allInvites(s);
    await expect(restore(s, inviteId)).rejects.toMatchObject({
      data: {
        field: 'email',
        code: 'alreadyMember',
        message: INVITE_MESSAGES.alreadyMember('stranger@example.test'),
      },
    });
    expect(await allInvites(s)).toEqual(before);
  });

  test('refuses a league organizer invite when one of its leagues no longer exists', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com', 'leagueOrganizer', [
      s.coed,
      s.sand,
    ]);
    await s.t.run((ctx) => ctx.db.delete('leagues', s.sand));
    const before = await allInvites(s);
    await expect(restore(s, inviteId)).rejects.toMatchObject({
      data: { code: 'leaguesGone', message: INVITE_MESSAGES.restoreLeaguesGone },
    });
    expect(await allInvites(s)).toEqual(before);
  });

  test('refuses a league organizer invite when a league is no longer in the organization', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com', 'leagueOrganizer', [s.coed]);
    await s.t.run((ctx) => ctx.db.patch('leagues', s.coed, { organizationId: s.organizationB }));
    await expect(restore(s, inviteId)).rejects.toMatchObject({ data: { code: 'leaguesGone' } });
    expect((await allInvites(s))[0].status).toBe('revoked');
  });

  test('refuses an invite that is pending or accepted', async () => {
    const s = await setup();
    const pending = await invite(s, 'dana@example.com');
    await expect(restore(s, pending.inviteId)).rejects.toMatchObject({
      data: { code: 'notRevoked', message: INVITE_MESSAGES.restoreNotRevoked },
    });
    await s.t.run((ctx) => ctx.db.patch('invites', pending.inviteId, { status: 'accepted' }));
    await expect(restore(s, pending.inviteId)).rejects.toMatchObject({
      data: { code: 'notRevoked' },
    });
    expect((await allInvites(s))[0].status).toBe('accepted');
  });

  test('refuses a revoked invite with no revokedAt', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    await s.t.run((ctx) => ctx.db.patch('invites', inviteId, { revokedAt: undefined }));
    const failure = await restore(s, inviteId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('has no revokedAt');
    expect((failure as { data?: unknown }).data).toBeUndefined();
    expect((await allInvites(s))[0].status).toBe('revoked');
  });

  test('a restored invite can be revoked again, which starts a new window', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    await restore(s, inviteId);
    vi.setSystemTime(NOW + 3 * INVITE_RESTORE_WINDOW_MS);
    await s.asAdminA.mutation(api.invites.revoke, { inviteId });
    expect((await allInvites(s))[0].revokedAt).toBe(NOW + 3 * INVITE_RESTORE_WINDOW_MS);
    await restore(s, inviteId);
    expect((await allInvites(s))[0].status).toBe('pending');
  });

  test('takes the organization from the stored invite; refuses the unauthenticated, a league organizer, a non-member, another organization’s admin, and an unknown invite', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    const args = { inviteId };
    await expect(s.t.mutation(api.invites.restore, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.mutation(api.invites.restore, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asStranger.mutation(api.invites.restore, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asAdminB.mutation(api.invites.restore, args)).rejects.toThrow(/Not allowed/);
    const gone = await revokedInvite(s, 'erin@example.com');
    await s.t.run((ctx) => ctx.db.delete('invites', gone.inviteId));
    await expect(restore(s, gone.inviteId)).rejects.toThrow(/Not allowed/);
    expect((await allInvites(s)).map((row) => row.status)).toEqual(['revoked']);
  });
});

describe('invites.restore: edge cases', () => {
  test('an expired pending invite to the address blocks both create and restore', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    const stale = await s.t.run((ctx) =>
      ctx.db.insert('invites', {
        organizationId: s.organizationA,
        email: 'dana@example.com',
        role: 'orgAdmin',
        leagueIds: [],
        tokenHash: 'stale',
        expiresAt: NOW - 1,
        status: 'pending',
      }),
    );
    vi.setSystemTime(NOW + 1000);
    await expect(invite(s, 'dana@example.com')).rejects.toMatchObject({
      data: { code: 'alreadyInvited' },
    });
    await expect(restore(s, inviteId)).rejects.toMatchObject({ data: { code: 'alreadyInvited' } });
    const rows = await allInvites(s);
    expect(rows.find((row) => row._id === stale)?.status).toBe('pending');
    expect(rows.find((row) => row._id === inviteId)?.status).toBe('revoked');
  });

  test('concurrent restore and create for the same address leave exactly one pending invite', async () => {
    for (let round = 0; round < 5; round++) {
      const s = await setup();
      const { inviteId } = await revokedInvite(s, 'dana@example.com');
      const results = await Promise.allSettled([
        restore(s, inviteId),
        invite(s, 'dana@example.com'),
      ]);
      const pending = (await allInvites(s)).filter((row) => row.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((result) => result.status === 'rejected');
      expect(refused).toMatchObject({ reason: { data: { code: 'alreadyInvited' } } });
    }
  });

  test('concurrent restores of two revoked invites to one address leave exactly one pending invite', async () => {
    const s = await setup();
    const first = await revokedInvite(s, 'dana@example.com');
    const second = await revokedInvite(s, 'dana@example.com');
    const results = await Promise.allSettled([
      restore(s, first.inviteId),
      restore(s, second.inviteId),
    ]);
    expect((await allInvites(s)).filter((row) => row.status === 'pending')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  test('a second restore of the same invite is refused and a refused restore keeps revokedAt', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    await restore(s, inviteId);
    await expect(restore(s, inviteId)).rejects.toMatchObject({ data: { code: 'notRevoked' } });
    const secondRevokeAt = NOW + 5 * 60 * 1000;
    vi.setSystemTime(secondRevokeAt);
    await s.asAdminA.mutation(api.invites.revoke, { inviteId });
    await invite(s, 'dana@example.com');
    const before = await allInvites(s);
    await expect(restore(s, inviteId)).rejects.toMatchObject({ data: { code: 'alreadyInvited' } });
    expect(await allInvites(s)).toEqual(before);
    expect(await storedRevokedAt(s, inviteId)).toBe(secondRevokeAt);
  });

  test('the same error for an unknown invite and another organization’s invite (neither reveals which exists)', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com');
    const gone = await revokedInvite(s, 'erin@example.com');
    await s.t.run((ctx) => ctx.db.delete('invites', gone.inviteId));
    const failure = async (id: Id<'invites'>): Promise<{ message: string; data?: unknown }> => {
      try {
        await s.asAdminB.mutation(api.invites.restore, { inviteId: id });
      } catch (error) {
        return error as { message: string; data?: unknown };
      }
      throw new Error('restore should have been refused');
    };
    const other = await failure(inviteId);
    const unknown = await failure(gone.inviteId);
    expect(other.message).toContain('Not allowed');
    expect(unknown.message).toContain('Not allowed');
    expect(other.data).toBeUndefined();
    expect(unknown.data).toBeUndefined();
  });

  test('revoke then accept is refused; restore then accept joins the organization with the original token', async () => {
    const s = await setup();
    const { inviteId, token } = await revokedInvite(s, 'stranger@example.test');
    await expect(s.asStranger.mutation(api.invites.accept, { token })).rejects.toMatchObject({
      data: { code: 'invalid' },
    });
    await restore(s, inviteId);
    await expect(s.asStranger.mutation(api.invites.accept, { token })).resolves.toMatchObject({
      organizationName: 'Org A',
      role: 'orgAdmin',
    });
    expect((await allInvites(s))[0].status).toBe('accepted');
    await expect(restore(s, inviteId)).rejects.toMatchObject({ data: { code: 'notRevoked' } });
  });

  test('a restored league organizer invite keeps all its leagues', async () => {
    const s = await setup();
    const { inviteId } = await revokedInvite(s, 'dana@example.com', 'leagueOrganizer', [
      s.coed,
      s.sand,
    ]);
    await restore(s, inviteId);
    expect((await allInvites(s))[0].leagueIds).toEqual([s.coed, s.sand]);
  });
});

describe('invites.listPending', () => {
  test('lists pending invites with league names and expiry, and no token or hash', async () => {
    const s = await setup();
    const first = await invite(s, 'dana@example.com', 'leagueOrganizer', [s.sand, s.coed]);
    const second = await invite(s, 'boss@example.com', 'orgAdmin');
    const revoked = await invite(s, 'gone@example.com');
    await s.asAdminA.mutation(api.invites.revoke, { inviteId: revoked.inviteId });
    await s.asAdminB.action(api.invites.create, {
      organizationId: s.organizationB,
      email: 'b-only@example.com',
      role: 'orgAdmin',
      leagueIds: [],
    });

    const rows = await s.asAdminA.query(api.invites.listPending, {
      organizationId: s.organizationA,
    });
    expect(rows).toEqual([
      {
        inviteId: first.inviteId,
        email: 'dana@example.com',
        role: 'leagueOrganizer',
        leagueNames: ['Sand 2s', 'Coed 7v7'],
        expiresAt: first.expiresAt,
      },
      {
        inviteId: second.inviteId,
        email: 'boss@example.com',
        role: 'orgAdmin',
        leagueNames: [],
        expiresAt: second.expiresAt,
      },
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(first.token);
    expect(text).not.toContain(await sha256Hex(first.token));
  });

  test('keeps an expired invite in the list', async () => {
    const s = await setup();
    await invite(s, 'dana@example.com');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS + 1);
    const rows = await s.asAdminA.query(api.invites.listPending, {
      organizationId: s.organizationA,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt).toBeLessThan(Date.now());
  });

  test('refuses the unauthenticated, a league organizer, a non-member, and another organization’s admin', async () => {
    const s = await setup();
    await invite(s, 'dana@example.com');
    const args = { organizationId: s.organizationA };
    await expect(s.t.query(api.invites.listPending, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.query(api.invites.listPending, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.asStranger.query(api.invites.listPending, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asAdminB.query(api.invites.listPending, args)).rejects.toThrow(/Not allowed/);
  });
});

describe('memberships.listForOrganization', () => {
  test('lists the organization’s members with name, email, role, and league names', async () => {
    const s = await setup();
    const rows = await s.asAdminA.query(api.memberships.listForOrganization, {
      organizationId: s.organizationA,
    });
    const membershipOf = (userId: Id<'users'>) =>
      s.t.run(async (ctx) => {
        const membership = await ctx.db
          .query('memberships')
          .withIndex('by_userId_and_organizationId', (q) =>
            q.eq('userId', userId).eq('organizationId', s.organizationA),
          )
          .unique();
        return membership!._id;
      });
    expect(rows).toEqual([
      {
        membershipId: await membershipOf(s.adminA.userId),
        name: 'admin-a',
        email: 'admin-a@example.test',
        role: 'orgAdmin',
        leagueNames: [],
        isYou: true,
      },
      {
        membershipId: await membershipOf(s.organizerA.userId),
        name: 'organizer-a',
        email: 'organizer-a@example.test',
        role: 'leagueOrganizer',
        leagueNames: ['Coed 7v7'],
        isYou: false,
      },
    ]);
  });

  test('gives a member whose auth user is deleted an empty email, and the others their own', async () => {
    const s = await setup();
    const { organizationId, asAdmin, accounts } = await staffOf(s, 'org-c', [
      'admin-c',
      'gone-middle',
      'organizer-c',
    ]);
    await s.t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: 'user',
          where: [{ field: '_id', value: accounts['gone-middle'].authUserId }],
        },
      } as never),
    );
    const rows = await asAdmin.query(api.memberships.listForOrganization, { organizationId });
    expect(rows.map((row) => [row.name, row.email])).toEqual([
      ['admin-c', 'admin-c@example.test'],
      ['gone-middle', ''],
      ['organizer-c', 'organizer-c@example.test'],
    ]);
  });

  test('leaves out a member whose user record is missing and keeps the others’ emails', async () => {
    const s = await setup();
    const { organizationId, asAdmin, accounts } = await staffOf(s, 'org-d', [
      'admin-c',
      'no-record',
      'organizer-c',
    ]);
    await s.t.run((ctx) => ctx.db.delete('users', accounts['no-record'].userId));
    const rows = await asAdmin.query(api.memberships.listForOrganization, { organizationId });
    expect(rows.map((row) => [row.name, row.email])).toEqual([
      ['admin-c', 'admin-c@example.test'],
      ['organizer-c', 'organizer-c@example.test'],
    ]);
  });

  test('lists the first 200 members in name order, each with their own email', async () => {
    const s = await setup();
    const extra = Array.from(
      { length: 201 },
      (_, index) => `member-${String(index + 1).padStart(3, '0')}`,
    );
    await s.t.run(async (ctx) => {
      for (const name of extra) await addStaff(ctx, s.organizationA, name, 'leagueOrganizer');
    });
    const rows = await s.asAdminA.query(api.memberships.listForOrganization, {
      organizationId: s.organizationA,
    });
    const expected = ['admin-a', ...extra.slice(0, 198), 'organizer-a'];
    expect(rows.map((row) => row.name)).toEqual(expected);
    expect(rows.map((row) => row.email)).toEqual(expected.map((name) => `${name}@example.test`));
  });

  test('carries the membership id, which stays distinct for members with no auth user', async () => {
    const s = await setup();
    for (const who of [s.adminA, s.organizerA]) {
      await s.t.run((ctx) =>
        ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: { model: 'user', where: [{ field: '_id', value: who.authUserId }] },
        } as never),
      );
    }
    const rows = await s.asAdminA.query(api.memberships.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(rows.map((row) => row.email)).toEqual(['', '']);
    const stored = await s.t.run((ctx) =>
      ctx.db
        .query('memberships')
        .withIndex('by_organizationId', (q) => q.eq('organizationId', s.organizationA))
        .collect(),
    );
    expect(rows.map((row) => row.membershipId).sort()).toEqual(stored.map((m) => m._id).sort());
    expect(new Set(rows.map((row) => row.membershipId)).size).toBe(2);
  });

  test('never lists another organization’s members', async () => {
    const s = await setup();
    const rows = await s.asAdminB.query(api.memberships.listForOrganization, {
      organizationId: s.organizationB,
    });
    expect(rows.map((row) => row.name)).toEqual(['admin-b']);
  });

  test('refuses the unauthenticated, a league organizer, a non-member, and another organization’s admin', async () => {
    const s = await setup();
    const args = { organizationId: s.organizationA };
    await expect(s.t.query(api.memberships.listForOrganization, args)).rejects.toThrow(
      /Sign in required/,
    );
    await expect(s.asOrganizerA.query(api.memberships.listForOrganization, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.asStranger.query(api.memberships.listForOrganization, args)).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.asAdminB.query(api.memberships.listForOrganization, args)).rejects.toThrow(
      /Not allowed/,
    );
  });
});
