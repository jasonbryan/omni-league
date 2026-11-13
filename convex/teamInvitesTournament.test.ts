/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { TEAM_INVITE_MESSAGES } from './lib/teamInviteInput';
import {
  emailOf,
  NOT_MANAGERS,
  OPEN_NOW,
  TOURNAMENT_SLUGS,
  tournamentWorld,
  type Person,
  type TournamentWorld,
} from './tournamentWorld.setup';
import { addRosterEntry } from './lib/rosterWrites';

afterEach(() => {
  vi.useRealTimers();
});

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

async function registered() {
  vi.useFakeTimers({ now: OPEN_NOW });
  const s = await tournamentWorld();
  const { teamId } = await s
    .as(s.captain)
    .mutation(api.teams.registerForTournament, { ...TOURNAMENT_SLUGS, name: 'Sand Crabs' });
  const { teamId: rivalsId } = await s
    .as(s.rival)
    .mutation(api.teams.registerForTournament, { ...TOURNAMENT_SLUGS, name: 'Net Results' });
  return { s, teamId, rivalsId };
}

const invite = (s: TournamentWorld, who: Person, teamId: Id<'teams'>, email: string) =>
  s.as(who).action(api.teamInvites.create, { teamId, email });

const accept = (
  s: TournamentWorld,
  who: Person,
  token: string,
  choices: { joinSelf?: boolean; minorName?: string } = {},
) => s.as(who).mutation(api.teamInvites.accept, { token, ...choices });

const snapshot = (s: TournamentWorld) =>
  s.t.run(async (ctx) => ({
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
    invites: await ctx.db.query('teamInvites').collect(),
  }));

const teamRow = (s: TournamentWorld, teamId: Id<'teams'>) =>
  s.t.run((ctx) => ctx.db.get('teams', teamId));

describe('teamInvites.create for a tournament team', () => {
  test.each([
    ['the captain', 'captain'],
    ['an organizer assigned to the tournament', 'assignedOrganizer'],
    ['an admin of the organization', 'admin'],
  ] as const)('%s invites by email, and the invite holds no season', async (_label, who) => {
    const { s, teamId } = await registered();
    const result = await invite(s, s[who], teamId, ' Newcomer@Example.com ');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { invites, entries } = await snapshot(s);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      _id: result.inviteId,
      teamId,
      email: 'newcomer@example.com',
      status: 'pending',
      invitedByUserId: s[who].userId,
      organizationId: (await teamRow(s, teamId))?.organizationId,
    });
    expect(invites[0]).not.toHaveProperty('seasonId');
    expect(invites[0].expiresAt - invites[0].createdAt).toBe(INVITE_LIFETIME_MS);
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 1, pendingInviteCount: 1 });
    expect(entries).toHaveLength(2);
  });

  test.each(NOT_MANAGERS)('refuses %s, and writes nothing', async (who) => {
    const { s, teamId } = await registered();
    const before = await snapshot(s);
    await expect(invite(s, s[who], teamId, 'newcomer@example.com')).rejects.toThrow(/Not allowed/);
    expect(await snapshot(s)).toEqual(before);
  });

  test('refuses a signed-out caller, and writes nothing', async () => {
    const { s, teamId } = await registered();
    const before = await snapshot(s);
    await expect(
      s.t.action(api.teamInvites.create, { teamId, email: 'newcomer@example.com' }),
    ).rejects.toThrow(/Sign in required/);
    expect(await snapshot(s)).toEqual(before);
  });

  test('refuses an invite while the tournament is not published', async () => {
    const { s, teamId } = await registered();
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', s.gulf))!;
      await ctx.db.patch('programs', tournament.programId, { status: 'draft' });
    });
    await expect(invite(s, s.captain, teamId, 'newcomer@example.com')).rejects.toThrow(
      /Not allowed/,
    );
    expect((await snapshot(s)).invites).toEqual([]);
  });

  test('refuses a rostered member of the team, whatever the case, with the field error', async () => {
    const { s, teamId } = await registered();
    await s.t.run(async (ctx) =>
      addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.player.userId,
        source: 'invite',
        addedByUserId: s.captain.userId,
      }),
    );
    for (const [email, stored] of [
      ['Player@Example.test', 'player@example.test'],
      ['captain@example.test', 'captain@example.test'],
    ]) {
      await expect(invite(s, s.captain, teamId, email)).rejects.toMatchObject({
        data: {
          field: 'email',
          code: 'alreadyOnTeam',
          message: TEAM_INVITE_MESSAGES.alreadyOnTeam(stored),
        },
      });
    }
    expect((await snapshot(s)).invites).toEqual([]);
  });

  test('refuses an address already invited, and invites someone on another team in the tournament', async () => {
    const { s, teamId } = await registered();
    await invite(s, s.captain, teamId, 'x@example.com');
    await expect(invite(s, s.captain, teamId, 'X@Example.com')).rejects.toMatchObject({
      data: { field: 'email', code: 'alreadyInvited' },
    });
    await expect(invite(s, s.captain, teamId, emailOf('rival'))).resolves.toBeDefined();
    expect((await snapshot(s)).invites).toHaveLength(2);
    expect(await teamRow(s, teamId)).toMatchObject({ pendingInviteCount: 2 });
  });

  test('a captain of another team in the tournament cannot invite to this team, though they can to their own', async () => {
    const { s, teamId, rivalsId } = await registered();
    await expect(invite(s, s.rival, teamId, 'x@example.com')).rejects.toThrow(/Not allowed/);
    await expect(invite(s, s.rival, rivalsId, 'x@example.com')).resolves.toBeDefined();
  });
});

describe('teamInvites.listPending and revoke for a tournament team', () => {
  test('lists the pending invites to the captain and to an assigned organizer, and an organizer revokes one', async () => {
    const { s, teamId } = await registered();
    const { inviteId } = await invite(s, s.captain, teamId, 'x@example.com');
    for (const who of [s.captain, s.assignedOrganizer, s.admin]) {
      const listed = await s.as(who).query(api.teamInvites.listPending, { teamId });
      expect(listed).toEqual({
        rows: [{ inviteId, email: 'x@example.com', expiresAt: listed.rows[0].expiresAt }],
        total: 1,
      });
    }
    await s.as(s.assignedOrganizer).mutation(api.teamInvites.revoke, { inviteId });
    expect(await s.as(s.captain).query(api.teamInvites.listPending, { teamId })).toEqual({
      rows: [],
      total: 0,
    });
    expect(await teamRow(s, teamId)).toMatchObject({ pendingInviteCount: 0 });
  });

  test.each(NOT_MANAGERS)('refuses %s the list and the revoke', async (who) => {
    const { s, teamId } = await registered();
    const { inviteId } = await invite(s, s.captain, teamId, 'x@example.com');
    await expect(s.as(s[who]).query(api.teamInvites.listPending, { teamId })).rejects.toThrow(
      /Not allowed/,
    );
    await expect(s.as(s[who]).mutation(api.teamInvites.revoke, { inviteId })).rejects.toThrow(
      /Not allowed/,
    );
    expect((await snapshot(s)).invites[0].status).toBe('pending');
  });

  test('refuses a signed-out caller the list and the revoke', async () => {
    const { s, teamId } = await registered();
    const { inviteId } = await invite(s, s.captain, teamId, 'x@example.com');
    await expect(s.t.query(api.teamInvites.listPending, { teamId })).rejects.toThrow();
    await expect(s.t.mutation(api.teamInvites.revoke, { inviteId })).rejects.toThrow();
  });
});

describe('teamInvites.getByToken for a tournament team', () => {
  test('names the tournament and its page, with the season and league fields the previous frontend reads', async () => {
    const { s, teamId } = await registered();
    const { token } = await invite(s, s.captain, teamId, 'x@example.com');
    const answer = await s.t.query(api.teamInvites.getByToken, { token });
    expect(answer).toEqual({
      status: 'valid',
      teamName: 'Sand Crabs',
      seasonName: 'Gulf Coast Beach Open',
      leagueName: 'Org A',
      organizationName: 'Org A',
      expiresAt: answer.status === 'valid' ? answer.expiresAt : 0,
      tournamentName: 'Gulf Coast Beach Open',
      tournamentSlug: 'gulf-coast-beach-open',
      organizationSlug: 'org-a',
    });
  });

  test('answers invalid once the invite expired, was revoked, or its tournament is not published', async () => {
    const { s, teamId } = await registered();
    const first = await invite(s, s.captain, teamId, 'a@example.com');
    const second = await invite(s, s.captain, teamId, 'b@example.com');
    const third = await invite(s, s.captain, teamId, 'c@example.com');
    await s.as(s.captain).mutation(api.teamInvites.revoke, { inviteId: second.inviteId });
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', s.gulf))!;
      await ctx.db.patch('programs', tournament.programId, { status: 'draft' });
    });
    for (const { token } of [first, second, third]) {
      expect(await s.t.query(api.teamInvites.getByToken, { token })).toEqual({
        status: 'invalid',
      });
    }
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', s.gulf))!;
      await ctx.db.patch('programs', tournament.programId, { status: 'published' });
    });
    vi.setSystemTime(OPEN_NOW + INVITE_LIFETIME_MS + 1);
    expect(await s.t.query(api.teamInvites.getByToken, { token: first.token })).toEqual({
      status: 'invalid',
    });
  });
});

describe('teamInvites.accept for a tournament team', () => {
  test('rosters the player on the team in the tournament, and no season', async () => {
    const { s, teamId } = await registered();
    const { token, inviteId } = await invite(s, s.captain, teamId, emailOf('player'));
    expect(await accept(s, s.player, token)).toEqual({
      teamId,
      teamName: 'Sand Crabs',
      seasonName: 'Gulf Coast Beach Open',
      captainName: 'Name captain',
      joinedSelf: true,
      minorName: null,
    });
    const { entries, invites } = await snapshot(s);
    const entry = entries.find((row) => row.userId === s.player.userId);
    expect(entry).toMatchObject({
      teamId,
      tournamentId: s.gulf,
      status: 'rostered',
      source: 'invite',
      addedByUserId: s.captain.userId,
    });
    expect(entry).not.toHaveProperty('seasonId');
    expect(invites.find((row) => row._id === inviteId)?.status).toBe('accepted');
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 2, pendingInviteCount: 0 });
    expect(await s.t.query(api.teamInvites.getByToken, { token })).toEqual({
      status: 'invalid',
    });
  });

  test('refuses a player on another team in the tournament, naming it, and writes nothing', async () => {
    const { s, teamId } = await registered();
    const { token, inviteId } = await invite(s, s.captain, teamId, emailOf('rival'));
    const before = await snapshot(s);
    expect(await accept(s, s.rival, token).catch(refusalOf)).toEqual({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Net Results',
      message: 'Already on Net Results in this tournament.',
    });
    expect(await snapshot(s)).toEqual(before);
    expect(before.invites.find((row) => row._id === inviteId)?.status).toBe('pending');
  });

  test('refuses a player already on the team, with the team id, and writes nothing', async () => {
    const { s, teamId } = await registered();
    const { token } = await invite(s, s.captain, teamId, emailOf('player'));
    await s.t.run(async (ctx) =>
      addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.player.userId,
        source: 'invite',
        addedByUserId: s.captain.userId,
      }),
    );
    const before = await snapshot(s);
    expect(await accept(s, s.player, token).catch(refusalOf)).toEqual({
      code: 'alreadyOnTeam',
      teamName: 'Sand Crabs',
      teamId,
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test('accepts a player on a team in another tournament', async () => {
    const { s, teamId } = await registered();
    await s.as(s.player).mutation(api.teams.registerForTournament, {
      ...TOURNAMENT_SLUGS,
      tournamentSlug: 'second-open',
      name: 'Beach Boys',
    });
    const { token } = await invite(s, s.captain, teamId, emailOf('player'));
    await expect(accept(s, s.player, token)).resolves.toMatchObject({ teamId });
  });

  test('puts a guardian’s minor on the roster under the guardian, who need not join', async () => {
    const { s, teamId } = await registered();
    const { token } = await invite(s, s.captain, teamId, emailOf('guardian'));
    expect(
      await accept(s, s.guardian, token, { joinSelf: false, minorName: ' Maya   R. ' }),
    ).toMatchObject({ teamId, joinedSelf: false, minorName: 'Maya R.' });
    const { entries } = await snapshot(s);
    const minor = entries.find((row) => row.minorName === 'Maya R.');
    expect(minor).toMatchObject({
      teamId,
      tournamentId: s.gulf,
      userId: s.guardian.userId,
      status: 'rostered',
      source: 'invite',
    });
    expect(minor).not.toHaveProperty('seasonId');
    expect(entries.filter((row) => row.userId === s.guardian.userId)).toHaveLength(1);
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 2, pendingInviteCount: 0 });
  });

  test('puts the guardian and the minor on the roster in one accept', async () => {
    const { s, teamId } = await registered();
    const { token } = await invite(s, s.captain, teamId, emailOf('guardian'));
    await accept(s, s.guardian, token, { minorName: 'Maya R.' });
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 3 });
  });

  test('lets a guardian on another team in the tournament add only a minor', async () => {
    const { s, teamId } = await registered();
    const { token } = await invite(s, s.captain, teamId, emailOf('rival'));
    await expect(
      accept(s, s.rival, token, { joinSelf: false, minorName: 'Kid K.' }),
    ).resolves.toMatchObject({ joinedSelf: false, minorName: 'Kid K.' });
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 2 });
  });

  test('refuses a minor already on a team in the tournament under the guardian, in the tournament’s words, and writes nothing', async () => {
    const { s, teamId, rivalsId } = await registered();
    await s.t.run(async (ctx) => {
      await ctx.db.insert('rosterEntries', {
        organizationId: (await ctx.db.get('teams', teamId))!.organizationId,
        tournamentId: s.gulf,
        teamId: rivalsId,
        userId: s.guardian.userId,
        minorName: 'maya r.',
        status: 'rostered',
        source: 'guardian',
        addedAt: 1,
        addedByUserId: s.guardian.userId,
      });
    });
    const { token } = await invite(s, s.captain, teamId, emailOf('guardian'));
    const before = await snapshot(s);
    expect(
      await accept(s, s.guardian, token, { joinSelf: false, minorName: 'Maya R.' }).catch(
        refusalOf,
      ),
    ).toEqual({
      field: 'minorName',
      code: 'minorInSeason',
      minorName: 'maya r.',
      teamName: 'Net Results',
      inTournament: true,
      message: 'maya r. is already on Net Results in this tournament.',
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test('refuses nothing chosen, a wrong address, an expired or revoked invite, and a signed-out caller', async () => {
    const { s, teamId } = await registered();
    const first = await invite(s, s.captain, teamId, emailOf('player'));
    const before = await snapshot(s);
    await expect(accept(s, s.player, first.token, { joinSelf: false })).rejects.toMatchObject({
      data: { code: 'nothingChosen' },
    });
    expect(await accept(s, s.stranger, first.token).catch(refusalOf)).toEqual({
      code: 'emailMismatch',
    });
    await expect(s.t.mutation(api.teamInvites.accept, { token: first.token })).rejects.toThrow(
      /Sign in required/,
    );
    expect(await snapshot(s)).toEqual(before);
    await s.as(s.captain).mutation(api.teamInvites.revoke, { inviteId: first.inviteId });
    expect(await accept(s, s.player, first.token).catch(refusalOf)).toEqual({ code: 'invalid' });
    const second = await invite(s, s.captain, teamId, emailOf('player'));
    vi.setSystemTime(OPEN_NOW + INVITE_LIFETIME_MS + 1);
    expect(await accept(s, s.player, second.token).catch(refusalOf)).toEqual({ code: 'invalid' });
  });

  test('of two accepts of one invite, the entry and the counts move once', async () => {
    const { s, teamId } = await registered();
    const { token } = await invite(s, s.captain, teamId, emailOf('player'));
    await Promise.allSettled([accept(s, s.player, token), accept(s, s.player, token)]);
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 2, pendingInviteCount: 0 });
    const { entries } = await snapshot(s);
    expect(entries.filter((row) => row.userId === s.player.userId)).toHaveLength(1);
  });
});
