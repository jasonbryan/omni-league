/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { tournamentWorld, OPEN_NOW, emailOf } from '../tournamentWorld.setup';
import { canManageTeamOf, organizesTeam, requireTeamManager } from './access';
import { hashInviteToken } from './inviteToken';
import { findUsableTeamInvite, publishedTeamParent, teamParentName } from './inviteLookup';
import {
  addMinorEntry,
  addRosterEntry,
  adultEntryInTeamParent,
  insertTeamInvite,
  insertTeamWithCaptain,
  removeRosterEntry,
  rosteredEntriesInTeamParent,
  rosteredEntriesInTournament,
} from './rosterWrites';

const NOW = OPEN_NOW;

async function teams() {
  const s = await tournamentWorld();
  const ids = await s.t.run(async (ctx) => {
    const crabs = await ctx.db.insert('teams', {
      organizationId: s.a,
      tournamentId: s.gulf,
      name: 'Sand Crabs',
      sortName: 'sand crabs',
      captainUserId: s.captain.userId,
      rosterCount: 0,
      pendingInviteCount: 0,
      createdAt: NOW,
    });
    await addRosterEntry(ctx, (await ctx.db.get('teams', crabs))!, {
      userId: s.captain.userId,
      source: 'captain',
      addedByUserId: s.captain.userId,
    });
    const sharks = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', s.season))!, {
      name: 'Season Sharks',
      captainUserId: s.rival.userId,
    });
    return { crabs, sharks };
  });
  return { s, ...ids };
}

describe('insertTeamInvite', () => {
  test('keeps the season on a season team’s invite and leaves it off a tournament team’s', async () => {
    const { s, crabs, sharks } = await teams();
    const invites = await s.t.run(async (ctx) => {
      for (const [id, tokenHash] of [
        [sharks, 'season-hash'],
        [crabs, 'tournament-hash'],
      ] as const) {
        await insertTeamInvite(ctx, (await ctx.db.get('teams', id))!, {
          email: 'x@example.test',
          tokenHash,
          expiresAt: NOW + 1000,
          invitedByUserId: s.captain.userId,
        });
      }
      return ctx.db.query('teamInvites').collect();
    });
    const byHash = (hash: string) => invites.find((row) => row.tokenHash === hash)!;
    expect(byHash('season-hash').seasonId).toBe(s.season);
    expect(byHash('tournament-hash')).not.toHaveProperty('seasonId');
  });

  test('refuses a team that plays in neither, and writes nothing', async () => {
    const { s, crabs } = await teams();
    await expect(
      s.t.run(async (ctx) => {
        await ctx.db.patch('teams', crabs, { tournamentId: undefined });
        await insertTeamInvite(ctx, (await ctx.db.get('teams', crabs))!, {
          email: 'x@example.test',
          tokenHash: 'h',
          expiresAt: NOW + 1000,
          invitedByUserId: s.captain.userId,
        });
      }),
    ).rejects.toThrow(/Not allowed/);
    expect(await s.t.run((ctx) => ctx.db.query('teamInvites').collect())).toEqual([]);
  });
});

describe('publishedTeamParent and teamParentName', () => {
  test('names the season of a season team and the tournament’s program of a tournament team', async () => {
    const { s, crabs, sharks } = await teams();
    const season = await s.t.run(async (ctx) =>
      publishedTeamParent(ctx, (await ctx.db.get('teams', sharks))!),
    );
    expect(season).toMatchObject({ kind: 'season', season: { name: 'Summer 2030' } });
    expect(season && teamParentName(season)).toBe('Summer 2030');
    const tournament = await s.t.run(async (ctx) =>
      publishedTeamParent(ctx, (await ctx.db.get('teams', crabs))!),
    );
    expect(tournament).toMatchObject({
      kind: 'tournament',
      program: { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
    });
    expect(tournament && teamParentName(tournament)).toBe('Gulf Coast Beach Open');
  });

  test('answers null while the season or the tournament is a draft, or the team has neither', async () => {
    const { s, crabs, sharks } = await teams();
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', s.gulf))!;
      await ctx.db.patch('programs', tournament.programId, { status: 'draft' });
      await ctx.db.patch('seasons', s.season, { status: 'draft' });
    });
    for (const id of [crabs, sharks]) {
      expect(
        await s.t.run(async (ctx) => publishedTeamParent(ctx, (await ctx.db.get('teams', id))!)),
      ).toBeNull();
    }
    await s.t.run((ctx) => ctx.db.patch('teams', sharks, { seasonId: undefined }));
    expect(
      await s.t.run(async (ctx) => publishedTeamParent(ctx, (await ctx.db.get('teams', sharks))!)),
    ).toBeNull();
  });
});

describe('findUsableTeamInvite', () => {
  async function invited(
    id: Id<'teams'>,
    s: Awaited<ReturnType<typeof teams>>['s'],
    extra: { withSeason?: Id<'seasons'> } = {},
  ) {
    const tokenHash = await hashInviteToken('a-token');
    await s.t.run(async (ctx) => {
      const row = await ctx.db.get('teams', id);
      await ctx.db.insert('teamInvites', {
        organizationId: s.a,
        ...(extra.withSeason && { seasonId: extra.withSeason }),
        teamId: id,
        email: 'x@example.test',
        tokenHash,
        expiresAt: NOW + 1000,
        status: 'pending',
        invitedByUserId: row!.captainUserId,
        createdAt: NOW,
      });
    });
  }
  const find = (s: Awaited<ReturnType<typeof teams>>['s'], now = NOW) =>
    s.t.run((ctx) => findUsableTeamInvite(ctx, 'a-token', now));

  test('finds a tournament invite that holds no season, with the tournament as its parent', async () => {
    const { s, crabs } = await teams();
    await invited(crabs, s);
    expect(await find(s)).toMatchObject({
      team: { name: 'Sand Crabs' },
      parent: { kind: 'tournament', program: { name: 'Gulf Coast Beach Open' } },
    });
  });

  test('finds an invite written with its season, as every season invite before tournaments was', async () => {
    const { s, sharks } = await teams();
    await invited(sharks, s, { withSeason: s.season });
    expect(await find(s)).toMatchObject({
      team: { name: 'Season Sharks' },
      parent: { kind: 'season', season: { name: 'Summer 2030' } },
    });
  });

  test('finds nothing once the invite expired, or while its tournament is a draft', async () => {
    const { s, crabs } = await teams();
    await invited(crabs, s);
    expect(await find(s, NOW + 1000)).toBeNull();
    await s.t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', s.gulf))!;
      await ctx.db.patch('programs', tournament.programId, { status: 'draft' });
    });
    expect(await find(s)).toBeNull();
  });
});

describe('entries in the season or tournament a team plays in', () => {
  test('rosteredEntriesInTournament lists the person’s own entry first and the rostered minors, never a removed one', async () => {
    const { s, crabs } = await teams();
    const entries = await s.t.run(async (ctx) => {
      const crabsDoc = async () => (await ctx.db.get('teams', crabs))!;
      await addMinorEntry(ctx, await crabsDoc(), {
        guardianUserId: s.captain.userId,
        minorName: 'Kid One',
        source: 'guardian',
        addedByUserId: s.captain.userId,
      });
      const second = await addMinorEntry(ctx, await crabsDoc(), {
        guardianUserId: s.captain.userId,
        minorName: 'Kid Two',
        source: 'guardian',
        addedByUserId: s.captain.userId,
      });
      await removeRosterEntry(ctx, (await ctx.db.get('rosterEntries', second))!, s.captain.userId);
      return rosteredEntriesInTournament(ctx, s.gulf, s.captain.userId);
    });
    expect(entries.map((entry) => entry.minorName)).toEqual([undefined, 'Kid One']);
  });

  test('rosteredEntriesInTournament lists a guardian with only a minor, and nobody else’s entries', async () => {
    const { s, crabs } = await teams();
    await s.t.run(async (ctx) =>
      addMinorEntry(ctx, (await ctx.db.get('teams', crabs))!, {
        guardianUserId: s.guardian.userId,
        minorName: 'Maya R.',
        source: 'invite',
        addedByUserId: s.captain.userId,
      }),
    );
    expect(
      (await s.t.run((ctx) => rosteredEntriesInTournament(ctx, s.gulf, s.guardian.userId))).map(
        (entry) => entry.minorName,
      ),
    ).toEqual(['Maya R.']);
    expect(
      await s.t.run((ctx) => rosteredEntriesInTournament(ctx, s.gulf, s.stranger.userId)),
    ).toEqual([]);
    expect(
      await s.t.run((ctx) => rosteredEntriesInTournament(ctx, s.second, s.captain.userId)),
    ).toEqual([]);
  });

  test('finds a guardian’s minors, for the duplicate and limit checks, past a hundred adult re-entries', async () => {
    const { s, crabs } = await teams();
    const addAdultRounds = (rounds: number) =>
      s.t.run(async (ctx) => {
        const team = (await ctx.db.get('teams', crabs))!;
        for (let round = 0; round < rounds; round++) {
          await ctx.db.insert('rosterEntries', {
            organizationId: s.a,
            tournamentId: s.gulf,
            teamId: team._id,
            userId: s.guardian.userId,
            status: 'removed',
            source: 'invite',
            addedAt: NOW,
            addedByUserId: s.captain.userId,
          });
        }
      });
    await s.t.run(async (ctx) =>
      addMinorEntry(ctx, (await ctx.db.get('teams', crabs))!, {
        guardianUserId: s.guardian.userId,
        minorName: 'Maya R.',
        source: 'guardian',
        addedByUserId: s.guardian.userId,
      }),
    );
    await addAdultRounds(120);
    await expect(
      s.t.run(async (ctx) =>
        addMinorEntry(ctx, (await ctx.db.get('teams', crabs))!, {
          guardianUserId: s.guardian.userId,
          minorName: 'maya r.',
          source: 'guardian',
          addedByUserId: s.guardian.userId,
        }),
      ),
    ).rejects.toMatchObject({ data: { code: 'minorInSeason', inTournament: true } });
    expect(
      (await s.t.run((ctx) => rosteredEntriesInTournament(ctx, s.gulf, s.guardian.userId))).map(
        (entry) => entry.minorName,
      ),
    ).toEqual(['Maya R.']);
  });

  test('read the tournament for a tournament team and the season for a season team', async () => {
    const { s, crabs, sharks } = await teams();
    const read = (id: Id<'teams'>, userId: Id<'users'>) =>
      s.t.run(async (ctx) => {
        const row = (await ctx.db.get('teams', id))!;
        return {
          adult: await adultEntryInTeamParent(ctx, row, userId),
          all: await rosteredEntriesInTeamParent(ctx, row, userId),
        };
      });
    expect((await read(crabs, s.captain.userId)).adult?.tournamentId).toBe(s.gulf);
    expect((await read(sharks, s.rival.userId)).adult?.seasonId).toBe(s.season);
    expect((await read(crabs, s.rival.userId)).all).toEqual([]);
    expect((await read(sharks, s.captain.userId)).all).toEqual([]);
  });
});

describe('who runs a team', () => {
  const people = [
    'captain',
    'rival',
    'admin',
    'assignedOrganizer',
    'otherOrganizer',
    'leagueOrganizer',
    'foreignAdmin',
    'stranger',
  ] as const;

  test('a tournament team is run by its captain, an admin, and an organizer assigned to the tournament only', async () => {
    const { s, crabs } = await teams();
    const run = (who: (typeof people)[number]) =>
      s.t.run(async (ctx) => {
        const row = (await ctx.db.get('teams', crabs))!;
        return [
          await organizesTeam(ctx, s[who].userId, row),
          await canManageTeamOf(ctx, s[who].userId, row),
        ];
      });
    expect(
      Object.fromEntries(await Promise.all(people.map(async (who) => [who, await run(who)]))),
    ).toEqual({
      captain: [false, true],
      rival: [false, false],
      admin: [true, true],
      assignedOrganizer: [true, true],
      otherOrganizer: [false, false],
      leagueOrganizer: [false, false],
      foreignAdmin: [false, false],
      stranger: [false, false],
    });
  });

  test('a season team is run by its captain, an admin, and an organizer of its league only', async () => {
    const { s, sharks } = await teams();
    const run = (who: (typeof people)[number]) =>
      s.t.run(async (ctx) =>
        canManageTeamOf(ctx, s[who].userId, (await ctx.db.get('teams', sharks))!),
      );
    expect(
      Object.fromEntries(await Promise.all(people.map(async (who) => [who, await run(who)]))),
    ).toEqual({
      captain: false,
      rival: true,
      admin: true,
      assignedOrganizer: false,
      otherOrganizer: false,
      leagueOrganizer: true,
      foreignAdmin: false,
      stranger: false,
    });
  });

  test('requireTeamManager passes the captain of a tournament team and refuses the signed-out and an unassigned organizer', async () => {
    const { s, crabs } = await teams();
    const manager = (who: (typeof people)[number] | null) =>
      (who ? s.as(s[who]) : s.t).run(async (ctx) =>
        requireTeamManager(ctx, (await ctx.db.get('teams', crabs))!),
      );
    await expect(manager('captain')).resolves.toMatchObject({ _id: s.captain.userId });
    await expect(manager('assignedOrganizer')).resolves.toMatchObject({
      _id: s.assignedOrganizer.userId,
    });
    await expect(manager('leagueOrganizer')).rejects.toThrow(/Not allowed/);
    await expect(manager(null)).rejects.toThrow(/Sign in required/);
  });
});

test('the world’s season invite still reaches the join page’s query with no tournament fields', async () => {
  const { s, sharks } = await teams();
  await s.t.run(async (ctx) =>
    ctx.db.insert('teamInvites', {
      organizationId: s.a,
      seasonId: s.season,
      teamId: sharks,
      email: emailOf('player'),
      tokenHash: await hashInviteToken('season-token'),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
      status: 'pending',
      invitedByUserId: s.rival.userId,
      createdAt: Date.now(),
    }),
  );
  const answer = await s.t.query(api.teamInvites.getByToken, { token: 'season-token' });
  expect(answer).toEqual({
    status: 'valid',
    teamName: 'Season Sharks',
    seasonName: 'Summer 2030',
    leagueName: 'Coed 4s',
    organizationName: 'Org A',
    expiresAt: answer.status === 'valid' ? answer.expiresAt : 0,
  });
});
