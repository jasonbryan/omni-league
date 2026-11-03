/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { INVITE_LIFETIME_MS, INVITE_MESSAGES } from './lib/inviteInput';
import {
  addRosterEntry,
  insertTeamInvite,
  insertTeamWithCaptain,
  removeRosterEntry,
} from './lib/rosterWrites';
import { TEAM_INVITE_LIST_LIMIT, TEAM_INVITE_MESSAGES } from './lib/teamInviteInput';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.UTC(2030, 4, 1, 12, 0, 0);

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

const SUMMER: NewSeason = {
  name: 'Summer 2030',
  slug: 'summer-2030',
  startDate: '2030-06-01',
  endDate: '2030-08-30',
  registrationDeadline: '2030-05-20',
  playersPerSide: 4,
  minimumRosterSize: 4,
};

type Role = 'orgAdmin' | 'leagueOrganizer';

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        { name: 'Coed 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
        { name: 'Mens 2s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [{ name: 'Coed 4s', sport: 'beachVolleyball', locations: ['B Beach'] }],
    });
    const leagueIn = async (organizationId: Id<'organizations'>, slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!;
    const coed = await leagueIn(a, 'coed-4s');
    const mens = await leagueIn(a, 'mens-2s');
    const summerId = await insertSeason(ctx, coed, SUMMER, 'published');
    const draftId = await insertSeason(
      ctx,
      (await ctx.db.get('leagues', coed._id))!,
      { ...SUMMER, name: 'Draft', slug: 'draft' },
      'draft',
    );
    const person = async (
      authUserId: string,
      membership: {
        organizationId: Id<'organizations'>;
        role: Role;
        leagueIds?: Id<'leagues'>[];
      } | null = null,
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
    const captain = await person('captain');
    const player = await person('player');
    const rival = await person('rival');
    const people = {
      captain,
      player,
      rival,
      adminA: await person('admin-a', { organizationId: a, role: 'orgAdmin' }),
      organizer: await person('organizer-coed', {
        organizationId: a,
        role: 'leagueOrganizer',
        leagueIds: [coed._id],
      }),
      otherOrganizer: await person('organizer-mens', {
        organizationId: a,
        role: 'leagueOrganizer',
        leagueIds: [mens._id],
      }),
      adminB: await person('admin-b', { organizationId: b, role: 'orgAdmin' }),
      draftCaptain: await person('draft-captain'),
    };
    const summer = (await ctx.db.get('seasons', summerId))!;
    const sharks = await insertTeamWithCaptain(ctx, summer, {
      name: 'Sand Sharks',
      captainUserId: captain.userId,
    });
    await addRosterEntry(ctx, (await ctx.db.get('teams', sharks))!, {
      userId: player.userId,
      source: 'invite',
      addedByUserId: captain.userId,
    });
    const rivals = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', summerId))!, {
      name: 'Rivals',
      captainUserId: rival.userId,
    });
    const draftTeam = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', draftId))!, {
      name: 'Draft Team',
      captainUserId: people.draftCaptain.userId,
    });
    return { ...people, sharks, rivals, draftTeam };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return { t, ...ids, as };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const invite = (
  s: Setup,
  email: string,
  who: { authUserId: string } = s.captain,
  teamId = s.sharks,
) => s.as(who).action(api.teamInvites.create, { teamId, email });

const revoke = (s: Setup, inviteId: Id<'teamInvites'>, who: { authUserId: string } = s.captain) =>
  s.as(who).mutation(api.teamInvites.revoke, { inviteId });

const listPending = (s: Setup, who: { authUserId: string } = s.captain, teamId = s.sharks) =>
  s.as(who).query(api.teamInvites.listPending, { teamId });

const allInvites = (s: Setup) => s.t.run((ctx) => ctx.db.query('teamInvites').collect());

const teamRow = (s: Setup, teamId = s.sharks) => s.t.run((ctx) => ctx.db.get('teams', teamId));

const rosterEntries = (s: Setup) => s.t.run((ctx) => ctx.db.query('rosterEntries').collect());

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

async function expectPendingCountMatches(s: Setup) {
  const pending = (await allInvites(s)).filter(
    (row) => row.teamId === s.sharks && row.status === 'pending',
  );
  expect((await teamRow(s))?.pendingInviteCount).toBe(pending.length);
}

describe('teamInvites.create', () => {
  test('stores a pending invite with only the hash of a 256-bit token, expiring in 14 days, and adds no roster entry', async () => {
    const s = await setup();
    const entriesBefore = await rosterEntries(s);
    const result = await invite(s, '  X@Example.com ');
    expect(INVITE_LIFETIME_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(base64urlBytes(result.token)).toHaveLength(32);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = await allInvites(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: result.inviteId,
      teamId: s.sharks,
      email: 'x@example.com',
      status: 'pending',
      invitedByUserId: s.captain.userId,
    });
    expect(rows[0].createdAt - NOW).toBeLessThan(1000);
    expect(rows[0].expiresAt).toBe(rows[0].createdAt + INVITE_LIFETIME_MS);
    expect(result.expiresAt).toBe(rows[0].expiresAt);
    expect(rows[0].tokenHash).toBe(await sha256Hex(result.token));
    expect(JSON.stringify(rows[0])).not.toContain(result.token);
    const team = await teamRow(s);
    expect(rows[0]).toMatchObject({
      organizationId: team?.organizationId,
      seasonId: team?.seasonId,
    });
    expect(team).toMatchObject({ rosterCount: 2, pendingInviteCount: 1 });
    expect(await rosterEntries(s)).toEqual(entriesBefore);
  });

  test('makes a different token for each invite', async () => {
    const s = await setup();
    const first = await invite(s, 'one@example.com');
    const second = await invite(s, 'two@example.com');
    expect(first.token).not.toBe(second.token);
    const [a, b] = await allInvites(s);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  test('refuses an empty or malformed address with the field error, and writes nothing', async () => {
    const s = await setup();
    for (const empty of ['', '   ']) {
      await expect(invite(s, empty)).rejects.toMatchObject({
        data: { field: 'email', code: 'emailEmpty', message: INVITE_MESSAGES.emailEmpty },
      });
    }
    for (const bad of ['x@', 'not-an-email']) {
      await expect(invite(s, bad)).rejects.toMatchObject({
        data: { field: 'email', code: 'emailInvalid', message: INVITE_MESSAGES.emailInvalid },
      });
    }
    expect(await allInvites(s)).toEqual([]);
    expect((await teamRow(s))?.pendingInviteCount).toBe(0);
  });

  test('refuses an address that differs from a pending one only in case and spaces', async () => {
    const s = await setup();
    await invite(s, 'x@example.com');
    await expect(invite(s, 'X@Example.com ')).rejects.toMatchObject({
      data: {
        field: 'email',
        code: 'alreadyInvited',
        message: TEAM_INVITE_MESSAGES.alreadyInvited('x@example.com'),
      },
    });
    expect(await allInvites(s)).toHaveLength(1);
  });

  test('refuses a rostered member of the team, whatever the case, and the captain', async () => {
    const s = await setup();
    for (const [email, stored] of [
      ['Player@Example.test', 'player@example.test'],
      ['captain@example.test', 'captain@example.test'],
    ]) {
      await expect(invite(s, email)).rejects.toMatchObject({
        data: {
          field: 'email',
          code: 'alreadyOnTeam',
          message: TEAM_INVITE_MESSAGES.alreadyOnTeam(stored),
        },
      });
    }
    expect(await allInvites(s)).toEqual([]);
  });

  test('invites a removed member, someone on another team of the season, and an address with no account', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.query('rosterEntries').collect()).find(
        (row) => row.userId === s.player.userId,
      )!;
      await removeRosterEntry(ctx, entry, s.captain.userId);
    });
    await invite(s, 'player@example.test');
    await invite(s, 'rival@example.test');
    await invite(s, 'nobody@example.com');
    expect(await allInvites(s)).toHaveLength(3);
  });

  test('a pending invite, expired included, blocks the address until it is revoked', async () => {
    const s = await setup();
    const first = await invite(s, 'x@example.com');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS + 1);
    await expect(invite(s, 'x@example.com')).rejects.toMatchObject({
      data: { code: 'alreadyInvited' },
    });
    await revoke(s, first.inviteId);
    await expect(invite(s, 'x@example.com')).resolves.toMatchObject({
      expiresAt: NOW + INVITE_LIFETIME_MS + 1 + INVITE_LIFETIME_MS,
    });
    await expectPendingCountMatches(s);
  });

  test('another team may invite the same address', async () => {
    const s = await setup();
    await invite(s, 'x@example.com');
    await invite(s, 'x@example.com', s.rival, s.rivals);
    expect(await allInvites(s)).toHaveLength(2);
  });

  test('an organizer of the league and an org admin invite and revoke', async () => {
    const s = await setup();
    for (const who of [s.organizer, s.adminA]) {
      const { inviteId } = await invite(s, 'x@example.com', who);
      expect((await allInvites(s)).find((row) => row._id === inviteId)).toMatchObject({
        invitedByUserId: who.userId,
      });
      await revoke(s, inviteId, who);
    }
    expect((await allInvites(s)).map((row) => row.status)).toEqual(['revoked', 'revoked']);
    await expectPendingCountMatches(s);
  });

  test('refuses a team in a season that is not published', async () => {
    const s = await setup();
    await expect(invite(s, 'x@example.com', s.draftCaptain, s.draftTeam)).rejects.toThrow(
      /Not allowed/,
    );
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses a member, another captain, another league’s organizer, another organization’s admin, and the unauthenticated, and writes nothing', async () => {
    const s = await setup();
    for (const who of [s.player, s.rival, s.otherOrganizer, s.adminB]) {
      await expect(invite(s, 'x@example.com', who)).rejects.toThrow(/Not allowed/);
    }
    await expect(
      s.t.action(api.teamInvites.create, { teamId: s.sharks, email: 'x@example.com' }),
    ).rejects.toThrow(/Sign in required/);
    expect(await allInvites(s)).toEqual([]);
    expect((await teamRow(s))?.pendingInviteCount).toBe(0);
  });

  test('the checks and the insert are in the internal mutation, which refuses a caller who cannot manage the team', async () => {
    const s = await setup();
    const args = { teamId: s.sharks, email: 'x@example.com', tokenHash: 'a'.repeat(64) };
    for (const who of [s.player, s.rival, s.otherOrganizer, s.adminB]) {
      await expect(s.as(who).mutation(internal.teamInvites.insertPending, args)).rejects.toThrow(
        /Not allowed/,
      );
    }
    await expect(s.t.mutation(internal.teamInvites.insertPending, args)).rejects.toThrow(
      /Sign in required/,
    );
    expect(await allInvites(s)).toEqual([]);
    expect('insertPending' in api.teamInvites).toBe(false);
  });
});

describe('teamInvites.revoke', () => {
  test('revokes a pending invite, which leaves the list, and lowers the count', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'x@example.com');
    await invite(s, 'y@example.com');
    await revoke(s, inviteId);
    expect(await listPending(s)).toMatchObject({ rows: [{ email: 'y@example.com' }], total: 1 });
    await expectPendingCountMatches(s);
  });

  test('refuses an invite that is revoked or accepted already', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'x@example.com');
    await revoke(s, inviteId);
    await expect(revoke(s, inviteId)).rejects.toThrow(/Only a pending invite/);
    const accepted = await invite(s, 'y@example.com');
    await s.t.run((ctx) => ctx.db.patch('teamInvites', accepted.inviteId, { status: 'accepted' }));
    await expect(revoke(s, accepted.inviteId)).rejects.toThrow(/Only a pending invite/);
  });

  test('refuses a member, another captain, another league’s organizer, another organization’s admin, and the unauthenticated, and changes nothing', async () => {
    const s = await setup();
    const { inviteId } = await invite(s, 'x@example.com');
    for (const who of [s.player, s.rival, s.otherOrganizer, s.adminB]) {
      await expect(revoke(s, inviteId, who)).rejects.toThrow(/Not allowed/);
    }
    await expect(s.t.mutation(api.teamInvites.revoke, { inviteId })).rejects.toThrow(
      /Sign in required/,
    );
    expect((await allInvites(s))[0].status).toBe('pending');
    expect((await teamRow(s))?.pendingInviteCount).toBe(1);
  });
});

describe('teamInvites.listPending', () => {
  test('lists pending invites oldest first, expired included, with no token or hash', async () => {
    const s = await setup();
    const first = await invite(s, 'old@example.com');
    vi.setSystemTime(NOW + 1000);
    const second = await invite(s, 'new@example.com');
    vi.setSystemTime(NOW + INVITE_LIFETIME_MS + 1);
    const list = await listPending(s);
    expect(list).toEqual({
      rows: [
        { inviteId: first.inviteId, email: 'old@example.com', expiresAt: first.expiresAt },
        { inviteId: second.inviteId, email: 'new@example.com', expiresAt: second.expiresAt },
      ],
      total: 2,
    });
    expect(JSON.stringify(list)).not.toContain(first.token);
    expect(await listPending(s, s.organizer)).toEqual(list);
  });

  test('returns at most 200 rows, oldest first, with every pending invite as the total', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i <= TEAM_INVITE_LIST_LIMIT; i++) {
        const team = (await ctx.db.get('teams', s.sharks))!;
        await insertTeamInvite(ctx, team, {
          email: `p${String(i).padStart(3, '0')}@example.com`,
          tokenHash: `hash-${i}`,
          expiresAt: NOW + INVITE_LIFETIME_MS,
          invitedByUserId: s.captain.userId,
        });
      }
    });
    const { rows, total } = await listPending(s);
    expect(TEAM_INVITE_LIST_LIMIT).toBe(200);
    expect(total).toBe(201);
    expect(rows).toHaveLength(200);
    expect(rows[0].email).toBe('p000@example.com');
    expect(rows[199].email).toBe('p199@example.com');
  });

  test('refuses a member, another captain, another league’s organizer, another organization’s admin, and the unauthenticated', async () => {
    const s = await setup();
    await invite(s, 'x@example.com');
    for (const who of [s.player, s.rival, s.otherOrganizer, s.adminB]) {
      await expect(listPending(s, who)).rejects.toThrow(/Not allowed/);
    }
    await expect(s.t.query(api.teamInvites.listPending, { teamId: s.sharks })).rejects.toThrow(
      /Sign in required/,
    );
  });
});

describe('teams.getForMember: viewerCanManage', () => {
  test('is true for the captain, an organizer of the league, and an org admin, and false for a member', async () => {
    const s = await setup();
    const canManage = async (who: { authUserId: string }) =>
      (await s.as(who).query(api.teams.getForMember, { teamId: s.sharks }))?.viewerCanManage;
    expect(await canManage(s.captain)).toBe(true);
    expect(await canManage(s.organizer)).toBe(true);
    expect(await canManage(s.adminA)).toBe(true);
    expect(await canManage(s.player)).toBe(false);
  });
});
