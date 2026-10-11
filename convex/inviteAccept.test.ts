/// <reference types="vite/client" />
// `invites.getByToken` and `invites.accept` (#70). Identities are faked the way ADR 0008
// "Testing" shows; accounts exist in the Better Auth component too, because the invited address is
// matched against the account's email.
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { insertTenant } from './lib/tenantWrites';
import { requireLeagueOrganizer, requireOrgAdmin } from './lib/access';
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

/**
 * Organization A (`org-a`, leagues Coed 7v7 and Sand 2s) and organization B (`org-b`, league
 * Other Sand). `admin-a` is an org admin of A and sends the invites. `dana`, `eli`, and `fran` have
 * accounts and no membership; `dana@example.test` is the address most tests invite.
 */
async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] },
        { name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Alpha Field'] },
      ],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Other Sand', sport: 'beachVolleyball', locations: ['B Field'] }],
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
      membership: { organizationId: Id<'organizations'>; role: Role } | null,
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
          leagueIds: [],
        });
      }
      return { authUserId: account._id, userId };
    };
    return {
      organizationA,
      organizationB,
      coed: await leagueIn(organizationA, 'Coed 7v7'),
      sand: await leagueIn(organizationA, 'Sand 2s'),
      other: await leagueIn(organizationB, 'Other Sand'),
      adminA: await person('admin-a', { organizationId: organizationA, role: 'orgAdmin' }),
      dana: await person('dana', null),
      eli: await person('eli', null),
      fran: await person('fran', { organizationId: organizationA, role: 'leagueOrganizer' }),
    };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return {
    t,
    ...ids,
    asAdminA: as(ids.adminA),
    asDana: as(ids.dana),
    asEli: as(ids.eli),
    asFran: as(ids.fran),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Invites `email` to organization A as an admin of A, and returns the invite id and token. */
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

const membershipsOf = (s: Setup, userId: Id<'users'>) =>
  s.t.run((ctx) =>
    ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', userId))
      .collect(),
  );

const inviteRow = (s: Setup, inviteId: Id<'invites'>) =>
  s.t.run((ctx) => ctx.db.get('invites', inviteId));

/** The code of the `ConvexError` a promise rejects with. */
async function refusalCode(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError);
    return (e as ConvexError<{ code: string }>).data.code;
  }
  throw new Error('Expected a refusal');
}

describe('invites.getByToken', () => {
  test('a pending invite answers with the organization, role, leagues, and expiry only', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', 'leagueOrganizer', [s.coed, s.sand]);
    const answer = await s.t.query(api.invites.getByToken, { token });
    expect(answer).toEqual({
      status: 'valid',
      organizationName: 'Org A',
      role: 'leagueOrganizer',
      leagueNames: ['Coed 7v7', 'Sand 2s'],
      expiresAt: NOW + INVITE_LIFETIME_MS,
    });
  });

  test('an org admin invite lists no leagues', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    expect(await s.t.query(api.invites.getByToken, { token })).toMatchObject({
      status: 'valid',
      role: 'orgAdmin',
      leagueNames: [],
    });
  });

  test('it is public: a signed-in caller gets the same answer as an anonymous one', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    expect(await s.asEli.query(api.invites.getByToken, { token })).toEqual(
      await s.t.query(api.invites.getByToken, { token }),
    );
  });

  test('unknown, revoked, expired, and accepted tokens each answer exactly { status: invalid }', async () => {
    const s = await setup();
    const unknown = await s.t.query(api.invites.getByToken, { token: 'nope' });

    const revoked = await invite(s, 'dana@example.test');
    await s.asAdminA.mutation(api.invites.revoke, { inviteId: revoked.inviteId });

    const expired = await invite(s, 'eli@example.test');
    const accepted = await invite(s, 'fran-new@example.test');
    await s.t.run((ctx) => ctx.db.patch('invites', accepted.inviteId, { status: 'accepted' }));

    vi.setSystemTime(NOW + INVITE_LIFETIME_MS + 1);
    const answers = [
      unknown,
      await s.t.query(api.invites.getByToken, { token: revoked.token }),
      await s.t.query(api.invites.getByToken, { token: expired.token }),
      await s.t.query(api.invites.getByToken, { token: accepted.token }),
    ];
    for (const answer of answers) expect(answer).toStrictEqual({ status: 'invalid' });
  });

  test('an invite is valid until its expiry and invalid from it (controlled clock)', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS - 1);
    expect(await s.t.query(api.invites.getByToken, { token })).toMatchObject({ status: 'valid' });
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS);
    expect(await s.t.query(api.invites.getByToken, { token })).toStrictEqual({
      status: 'invalid',
    });
  });

  test('a huge or empty token is invalid and is not hashed', async () => {
    const s = await setup();
    expect(await s.t.query(api.invites.getByToken, { token: '' })).toStrictEqual({
      status: 'invalid',
    });
    expect(await s.t.query(api.invites.getByToken, { token: 'a'.repeat(10_000) })).toStrictEqual({
      status: 'invalid',
    });
  });

  test('the answer holds no email, id, or hash', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    const text = JSON.stringify(await s.t.query(api.invites.getByToken, { token }));
    expect(text).not.toContain('dana@example.test');
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/tokenHash|inviteId|organizationId|"_id"/);
  });
});

describe('invites.accept', () => {
  test('a league organizer invite creates a membership for its leagues only, and marks the invite accepted', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'dana@example.test', 'leagueOrganizer', [s.coed]);
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect(result).toEqual({
      organizationName: 'Org A',
      role: 'leagueOrganizer',
      leagueNames: ['Coed 7v7'],
    });
    const rows = await membershipsOf(s, s.dana.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: s.organizationA,
      role: 'leagueOrganizer',
      leagueIds: [s.coed],
    });
    expect((await inviteRow(s, inviteId))?.status).toBe('accepted');

    // requireLeagueOrganizer passes for the assigned league and fails for another.
    await s.asDana.run(async (ctx) => {
      await expect(requireLeagueOrganizer(ctx, s.coed)).resolves.toBeDefined();
      await expect(requireLeagueOrganizer(ctx, s.sand)).rejects.toThrow('Not allowed');
      await expect(requireLeagueOrganizer(ctx, s.other)).rejects.toThrow('Not allowed');
      await expect(requireOrgAdmin(ctx, s.organizationA)).rejects.toThrow('Not allowed');
    });
  });

  test('an org admin invite makes the caller an org admin, which requireOrgAdmin accepts', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    await s.asDana.mutation(api.invites.accept, { token });
    const rows = await membershipsOf(s, s.dana.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'orgAdmin', leagueIds: [] });
    await s.asDana.run(async (ctx) => {
      await expect(requireOrgAdmin(ctx, s.organizationA)).resolves.toBeDefined();
      await expect(requireOrgAdmin(ctx, s.organizationB)).rejects.toThrow('Not allowed');
    });
  });

  test('the account email matches the invite case-insensitively', async () => {
    const s = await setup();
    const { token } = await invite(s, '  DANA@Example.TEST ');
    await s.asDana.mutation(api.invites.accept, { token });
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(1);
  });

  test('a different email is refused, nothing is written, and the invite stays pending', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'dana@example.test');
    expect(await refusalCode(s.asEli.mutation(api.invites.accept, { token }))).toBe(
      'emailMismatch',
    );
    expect(await membershipsOf(s, s.eli.userId)).toHaveLength(0);
    expect((await inviteRow(s, inviteId))?.status).toBe('pending');
    // The invited person can still accept it.
    await s.asDana.mutation(api.invites.accept, { token });
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(1);
  });

  test('a revoked invite is refused', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'dana@example.test');
    await s.asAdminA.mutation(api.invites.revoke, { inviteId });
    expect(await refusalCode(s.asDana.mutation(api.invites.accept, { token }))).toBe('invalid');
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(0);
  });

  test('an expired invite (over 14 days) is refused', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'dana@example.test');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS);
    expect(await refusalCode(s.asDana.mutation(api.invites.accept, { token }))).toBe('invalid');
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(0);
    expect((await inviteRow(s, inviteId))?.status).toBe('pending');
  });

  test('an unknown token is refused', async () => {
    const s = await setup();
    expect(await refusalCode(s.asDana.mutation(api.invites.accept, { token: 'nope' }))).toBe(
      'invalid',
    );
  });

  test('an invite already accepted is refused, so a second accept never adds a membership', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    await s.asDana.mutation(api.invites.accept, { token });
    expect(await refusalCode(s.asDana.mutation(api.invites.accept, { token }))).toBe('invalid');
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(1);
  });

  test('two accepts at once create one membership', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    const results = await Promise.allSettled([
      s.asDana.mutation(api.invites.accept, { token }),
      s.asDana.mutation(api.invites.accept, { token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(1);
  });

  test('a caller who is already a member is refused, keeps one membership, and the invite stays pending', async () => {
    const s = await setup();
    // fran already organizes in A; an admin invite for fran's address cannot be created, so the
    // invite is written first and fran joins afterwards.
    const { token, inviteId } = await invite(s, 'newcomer@example.test');
    await s.t.run((ctx) => ctx.db.patch('invites', inviteId, { email: 'fran@example.test' }));
    expect(await refusalCode(s.asFran.mutation(api.invites.accept, { token }))).toBe(
      'alreadyMember',
    );
    const rows = await membershipsOf(s, s.fran.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('leagueOrganizer');
    expect((await inviteRow(s, inviteId))?.status).toBe('pending');
  });

  test('a member of another organization can accept: one membership per organization', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.insert('memberships', {
        userId: s.dana.userId,
        organizationId: s.organizationB,
        role: 'orgAdmin',
        leagueIds: [],
      }),
    );
    const { token } = await invite(s, 'dana@example.test');
    await s.asDana.mutation(api.invites.accept, { token });
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(2);
  });

  test('leagues deleted since the invite are left out of the membership', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', 'leagueOrganizer', [s.coed, s.sand]);
    await s.t.run((ctx) => ctx.db.delete('leagues', s.sand));
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect(result.leagueNames).toEqual(['Coed 7v7']);
    expect((await membershipsOf(s, s.dana.userId))[0]?.leagueIds).toEqual([s.coed]);
  });

  test('an unauthenticated caller throws and nothing is written', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'dana@example.test');
    await expect(s.t.mutation(api.invites.accept, { token })).rejects.toThrow('Sign in required');
    expect(await membershipsOf(s, s.dana.userId)).toHaveLength(0);
    expect((await inviteRow(s, inviteId))?.status).toBe('pending');
  });

  test('a signed-in identity with no users row throws', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test');
    await expect(
      s.t.withIdentity(identity('ghost')).mutation(api.invites.accept, { token }),
    ).rejects.toThrow('Sign in required');
  });
});
