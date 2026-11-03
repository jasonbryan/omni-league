/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { addRosterEntry, insertFreeAgent, insertTeamWithCaptain } from './lib/rosterWrites';
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

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [{ name: 'Coed 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'] }],
    });
    const league = (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', 'coed-4s'),
      )
      .unique())!;
    const summerId = await insertSeason(ctx, league, SUMMER, 'published');
    const fallId = await insertSeason(
      ctx,
      league,
      { ...SUMMER, name: 'Fall 2030', slug: 'fall-2030', startDate: '2030-09-01' },
      'published',
    );
    const person = async (name: string) => {
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
        name: name === 'captain' ? 'Tasha Greene' : name,
        adultConfirmedAt: 1,
      });
      return { authUserId: account._id, userId };
    };
    const people = {
      captain: await person('captain'),
      player: await person('player'),
      newcomer: await person('newcomer'),
      rival: await person('rival'),
      fallCaptain: await person('fall-captain'),
    };
    const sharks = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', summerId))!, {
      name: 'Sand Sharks',
      captainUserId: people.captain.userId,
    });
    await addRosterEntry(ctx, (await ctx.db.get('teams', sharks))!, {
      userId: people.player.userId,
      source: 'invite',
      addedByUserId: people.captain.userId,
    });
    const rivals = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', summerId))!, {
      name: 'Rivals',
      captainUserId: people.rival.userId,
    });
    const fallCrew = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', fallId))!, {
      name: 'Fall Crew',
      captainUserId: people.fallCaptain.userId,
    });
    return { ...people, organizationId, summerId, sharks, rivals, fallCrew };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return { t, ...ids, as };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const invite = (s: Setup, email: string, teamId: Id<'teams'> = s.sharks, from = s.captain) =>
  s.as(from).action(api.teamInvites.create, { teamId, email });

const getByToken = (s: Setup, token: string) => s.t.query(api.teamInvites.getByToken, { token });

const accept = (s: Setup, who: { authUserId: string }, token: string) =>
  s.as(who).mutation(api.teamInvites.accept, { token });

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

async function snapshot(s: Setup) {
  return s.t.run(async (ctx) => ({
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
    invites: await ctx.db.query('teamInvites').collect(),
    freeAgents: await ctx.db.query('freeAgents').collect(),
  }));
}

const teamRow = (s: Setup, teamId: Id<'teams'> = s.sharks) =>
  s.t.run((ctx) => ctx.db.get('teams', teamId));

const VALID_KEYS = [
  'expiresAt',
  'leagueName',
  'organizationName',
  'seasonName',
  'status',
  'teamName',
] as const;

describe('teamInvites.getByToken', () => {
  test('answers a usable token with exactly the team, season, league, organization, and expiry', async () => {
    const s = await setup();
    const { token, expiresAt } = await invite(s, 'newcomer@example.test');
    const answer = await getByToken(s, token);
    expect(answer).toEqual({
      status: 'valid',
      teamName: 'Sand Sharks',
      seasonName: 'Summer 2030',
      leagueName: 'Coed 4s',
      organizationName: 'Gulf Coast Sport & Social',
      expiresAt,
    });
    expect(Object.keys(answer).sort()).toEqual([...VALID_KEYS]);
    const text = JSON.stringify(answer);
    for (const secret of ['newcomer@example.test', token, await hashInviteToken(token)]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('Tasha Greene');
    expect(text).not.toContain(s.sharks);
  });

  test('answers revoked, accepted, expired, unknown, and empty tokens, and a draft season, with exactly { status: invalid }', async () => {
    const s = await setup();
    const revoked = await invite(s, 'revoked@example.test');
    await s.as(s.captain).mutation(api.teamInvites.revoke, { inviteId: revoked.inviteId });
    const accepted = await invite(s, 'newcomer@example.test');
    await accept(s, s.newcomer, accepted.token);
    const expiring = await invite(s, 'late@example.test');
    const drafted = await invite(s, 'drafted@example.test', s.rivals, s.rival);
    await s.t.run((ctx) => ctx.db.patch('seasons', s.summerId, { status: 'draft' }));
    vi.setSystemTime(expiring.expiresAt);
    for (const token of [
      revoked.token,
      accepted.token,
      expiring.token,
      drafted.token,
      generateInviteToken(),
      '',
      'x'.repeat(129),
    ]) {
      expect(await getByToken(s, token)).toEqual({ status: 'invalid' });
    }
  });

  test('answers a staff invite token with { status: invalid }', async () => {
    const s = await setup();
    const token = generateInviteToken();
    await s.t.run(async (ctx) => {
      await ctx.db.insert('invites', {
        organizationId: s.organizationId,
        email: 'newcomer@example.test',
        role: 'orgAdmin',
        leagueIds: [],
        tokenHash: await hashInviteToken(token),
        expiresAt: NOW + INVITE_LIFETIME_MS,
        status: 'pending',
      });
    });
    expect(await getByToken(s, token)).toEqual({ status: 'invalid' });
    await expect(accept(s, s.newcomer, token)).rejects.toMatchObject({
      data: { code: 'invalid' },
    });
    const teamToken = (await invite(s, 'newcomer@example.test')).token;
    expect(await s.t.query(api.invites.getByToken, { token: teamToken })).toEqual({
      status: 'invalid',
    });
  });
});

describe('teamInvites.accept', () => {
  test('rosters the invited person, raises the roster count, lowers the pending count, records the inviter, and returns the team', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'Newcomer@Example.test');
    expect(await teamRow(s)).toMatchObject({ rosterCount: 2, pendingInviteCount: 1 });

    const result = await accept(s, s.newcomer, token);
    expect(result).toEqual({
      teamId: s.sharks,
      teamName: 'Sand Sharks',
      seasonName: 'Summer 2030',
      captainName: 'Tasha Greene',
      joinedSelf: true,
      minorName: null,
    });

    const { entries, invites } = await snapshot(s);
    const entry = entries.find((row) => row.userId === s.newcomer.userId);
    expect(entry).toMatchObject({
      teamId: s.sharks,
      seasonId: s.summerId,
      organizationId: s.organizationId,
      status: 'rostered',
      source: 'invite',
      addedByUserId: s.captain.userId,
    });
    expect(entry!.addedAt - NOW).toBeLessThan(1000);
    expect(invites.find((row) => row._id === inviteId)?.status).toBe('accepted');
    expect(await teamRow(s)).toMatchObject({ rosterCount: 3, pendingInviteCount: 0 });
    await expect(
      s.as(s.newcomer).query(api.teams.getForMember, { teamId: s.sharks }),
    ).resolves.toMatchObject({ name: 'Sand Sharks', rosterCount: 3 });
  });

  test('records the inviter, not the captain, when an organizer sent the invite', async () => {
    const s = await setup();
    const { token } = await invite(s, 'newcomer@example.test');
    await s.t.run(async (ctx) => {
      const row = (await ctx.db.query('teamInvites').collect())[0];
      await ctx.db.patch('teamInvites', row._id, { invitedByUserId: s.rival.userId });
    });
    await accept(s, s.newcomer, token);
    const { entries } = await snapshot(s);
    expect(entries.find((row) => row.userId === s.newcomer.userId)?.addedByUserId).toBe(
      s.rival.userId,
    );
  });

  test('refuses an account with another email, and writes nothing', async () => {
    const s = await setup();
    const { token } = await invite(s, 'someone.else@example.test');
    const before = await snapshot(s);
    expect(await accept(s, s.newcomer, token).catch(refusalOf)).toEqual({
      code: 'emailMismatch',
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test('refuses revoked, accepted, expired, and unknown tokens, and a draft season, and writes nothing', async () => {
    const s = await setup();
    const revoked = await invite(s, 'newcomer@example.test');
    await s.as(s.captain).mutation(api.teamInvites.revoke, { inviteId: revoked.inviteId });
    const accepted = await invite(s, 'newcomer@example.test');
    await accept(s, s.newcomer, accepted.token);
    const expired = await invite(s, 'newcomer@example.test', s.fallCrew, s.fallCaptain);
    const drafted = await invite(s, 'player@example.test', s.rivals, s.rival);
    await s.t.run((ctx) => ctx.db.patch('seasons', s.summerId, { status: 'draft' }));
    vi.setSystemTime(expired.expiresAt);
    const before = await snapshot(s);
    for (const [who, token] of [
      [s.newcomer, revoked.token],
      [s.newcomer, accepted.token],
      [s.newcomer, expired.token],
      [s.player, drafted.token],
      [s.newcomer, generateInviteToken()],
    ] as const) {
      expect(await accept(s, who, token).catch(refusalOf)).toEqual({ code: 'invalid' });
    }
    expect(await snapshot(s)).toEqual(before);
  });

  test('refuses someone already rostered on the team: they keep one entry and the invite stays pending', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'newcomer@example.test');
    await s.t.run(async (ctx) =>
      addRosterEntry(ctx, (await ctx.db.get('teams', s.sharks))!, {
        userId: s.newcomer.userId,
        source: 'captain',
        addedByUserId: s.captain.userId,
      }),
    );
    const before = await snapshot(s);
    expect(await accept(s, s.newcomer, token).catch(refusalOf)).toEqual({
      code: 'alreadyOnTeam',
      teamName: 'Sand Sharks',
      teamId: s.sharks,
    });
    expect(await snapshot(s)).toEqual(before);
    const { entries, invites } = before;
    expect(entries.filter((row) => row.userId === s.newcomer.userId)).toHaveLength(1);
    expect(invites.find((row) => row._id === inviteId)?.status).toBe('pending');
  });

  test('refuses someone rostered on another team of the season, naming it, and writes nothing', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'rival@example.test');
    const before = await snapshot(s);
    expect(await accept(s, s.rival, token).catch(refusalOf)).toMatchObject({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Rivals',
    });
    expect(await snapshot(s)).toEqual(before);
    expect(before.invites.find((row) => row._id === inviteId)?.status).toBe('pending');
  });

  test('refuses a waiting free agent of the season, and writes nothing', async () => {
    const s = await setup();
    await s.t.run(async (ctx) =>
      insertFreeAgent(ctx, (await ctx.db.get('seasons', s.summerId))!, s.newcomer.userId),
    );
    const { token, inviteId } = await invite(s, 'newcomer@example.test');
    const before = await snapshot(s);
    expect(await accept(s, s.newcomer, token).catch(refusalOf)).toEqual({
      code: 'waitingFreeAgent',
      message:
        "You're registered as a free agent in this season. An organizer places free agents on teams.",
    });
    expect(await snapshot(s)).toEqual(before);
    expect(before.invites.find((row) => row._id === inviteId)?.status).toBe('pending');
    expect(await teamRow(s)).toMatchObject({ rosterCount: 2, pendingInviteCount: 1 });
  });

  test('accepts someone rostered on a team in another season', async () => {
    const s = await setup();
    const { token } = await invite(s, 'fall-captain@example.test');
    await expect(accept(s, s.fallCaptain, token)).resolves.toMatchObject({ teamId: s.sharks });
    expect(await teamRow(s)).toMatchObject({ rosterCount: 3, pendingInviteCount: 0 });
    expect(await teamRow(s, s.fallCrew)).toMatchObject({ rosterCount: 1 });
  });

  test('refuses an unauthenticated caller, and writes nothing', async () => {
    const s = await setup();
    const { token } = await invite(s, 'newcomer@example.test');
    const before = await snapshot(s);
    await expect(s.t.mutation(api.teamInvites.accept, { token })).rejects.toThrow(
      /Sign in required/,
    );
    expect(await snapshot(s)).toEqual(before);
  });

  test('of two accepts of one invite, the second is refused as invalid and the counts move once', async () => {
    const s = await setup();
    const { token } = await invite(s, 'newcomer@example.test');
    await Promise.allSettled([accept(s, s.newcomer, token), accept(s, s.newcomer, token)]);
    expect(await teamRow(s)).toMatchObject({ rosterCount: 3, pendingInviteCount: 0 });
    const { entries } = await snapshot(s);
    expect(entries.filter((row) => row.userId === s.newcomer.userId)).toHaveLength(1);
  });
});
