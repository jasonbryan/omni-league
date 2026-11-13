/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { addRosterEntry, insertTournamentTeamWithCaptain } from './lib/rosterWrites';
import { TEAM_MESSAGES } from './lib/teamInput';
import {
  OPEN_NOW,
  TOURNAMENT_SLUGS,
  tournamentWorld,
  type Person,
  type TournamentWorld,
} from './tournamentWorld.setup';

afterEach(() => {
  vi.useRealTimers();
});

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

const MAXIMUM_TEAMS = 4;
const ANY_ID = expect.any(String) as string;
const ANY_TIME = expect.any(Number) as number;

const join = (s: TournamentWorld, who: Person, name: string, slugs = TOURNAMENT_SLUGS) =>
  s.as(who).mutation(api.teams.registerForTournamentOrWaitlist, { ...slugs, name });

/** Four teams fill the Gulf Coast Beach Open to its maximum. */
async function fullTournament() {
  vi.useFakeTimers({ now: OPEN_NOW });
  const s = await tournamentWorld();
  const fillers = await s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', s.gulf))!;
    const names = ['Net Results', 'Block Party', 'Dig Dynasty', 'Sand Sharks'];
    const people = [s.rival, s.rivalPlayer, s.guardian, s.traveller];
    for (const [index, name] of names.entries()) {
      await insertTournamentTeamWithCaptain(ctx, tournament, {
        name,
        captainUserId: people[index].userId,
      });
    }
    return names.length;
  });
  expect(fillers).toBe(MAXIMUM_TEAMS);
  return s;
}

const raiseMaximumTeams = (s: TournamentWorld, maximumTeams: number) =>
  s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { maximumTeams }));

const snapshot = (s: TournamentWorld) =>
  s.t.run(async (ctx) => ({
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
    waiting: await ctx.db.query('waitlistEntries').collect(),
    tournament: await ctx.db.get('tournaments', s.gulf),
  }));

describe('teams.registerForTournamentOrWaitlist', () => {
  test('registers the team when the tournament has room', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await tournamentWorld();
    const result = await join(s, s.captain, 'Sand Crabs');
    expect(result).toEqual({ status: 'registered', teamId: ANY_ID });
    const { teams, waiting, tournament } = await snapshot(s);
    expect(teams).toHaveLength(1);
    expect(waiting).toHaveLength(0);
    expect(tournament?.teamCount).toBe(1);
  });

  test('puts the captain of a full tournament on its waitlist, with no team and no roster entry', async () => {
    const s = await fullTournament();
    const before = await snapshot(s);
    expect(await join(s, s.captain, ' Late  Lobsters ')).toEqual({
      status: 'waitlisted',
      position: 1,
    });
    const after = await snapshot(s);
    expect(after.teams).toEqual(before.teams);
    expect(after.entries).toEqual(before.entries);
    expect(after.waiting).toHaveLength(1);
    expect(after.waiting[0]).toMatchObject({
      organizationId: s.a,
      tournamentId: s.gulf,
      userId: s.captain.userId,
      teamName: 'Late Lobsters',
      sortName: 'late lobsters',
      status: 'waiting',
    });
    expect(after.waiting[0]).not.toHaveProperty('seasonId');
    expect(after.tournament).toMatchObject({ teamCount: MAXIMUM_TEAMS, waitlistCount: 1 });
  });

  test('numbers the waiting teams in the order they joined', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    vi.advanceTimersByTime(1000);
    expect(await join(s, s.player, 'Later Larks')).toEqual({ status: 'waitlisted', position: 2 });
    expect((await snapshot(s)).tournament?.waitlistCount).toBe(2);
  });

  test('keeps a new team behind a waiting one when the maximum is raised', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    vi.advanceTimersByTime(1000);
    expect(await join(s, s.player, 'Later Larks')).toEqual({ status: 'waitlisted', position: 2 });
    expect((await snapshot(s)).teams).toHaveLength(MAXIMUM_TEAMS);
  });

  test('counts a waitlist whose counter was never set, from the waiting entries', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { waitlistCount: undefined }));
    vi.advanceTimersByTime(1000);
    await join(s, s.player, 'Later Larks');
    expect((await snapshot(s)).tournament?.waitlistCount).toBe(2);
  });

  test('refuses a name that a team or a waiting team already holds, ignoring case and spacing', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    for (const name of ['net results', '  LATE   lobsters']) {
      const failure = await join(s, s.player, name).catch(refusalOf);
      expect(failure).toMatchObject({ field: 'name', code: 'nameTaken' });
    }
    expect((await snapshot(s)).waiting).toHaveLength(1);
  });

  test('refuses a name that is empty or too long', async () => {
    const s = await fullTournament();
    expect(await join(s, s.captain, '   ').catch(refusalOf)).toMatchObject({ code: 'nameEmpty' });
    expect(await join(s, s.captain, 'x'.repeat(61)).catch(refusalOf)).toMatchObject({
      code: 'nameTooLong',
    });
  });

  test('refuses a captain who is already waiting, with the waiting team and its position', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    expect(await join(s, s.captain, 'Another Name').catch(refusalOf)).toEqual({
      code: 'onWaitlist',
      teamName: 'Late Lobsters',
      position: 1,
      message: TEAM_MESSAGES.onTournamentWaitlist('Late Lobsters'),
    });
    expect((await snapshot(s)).waiting).toHaveLength(1);
  });

  test('refuses a captain who is already on a team in the tournament', async () => {
    const s = await fullTournament();
    expect(await join(s, s.rival, 'Another Name').catch(refusalOf)).toMatchObject({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Net Results',
    });
  });

  test('refuses once registration has closed, an unknown tournament, and a draft', async () => {
    const s = await fullTournament();
    expect(
      await join(s, s.captain, 'Late', { ...TOURNAMENT_SLUGS, tournamentSlug: 'draft-open' }).catch(
        refusalOf,
      ),
    ).toEqual({ code: 'tournamentNotFound' });
    expect(
      await join(s, s.captain, 'Late', { ...TOURNAMENT_SLUGS, tournamentSlug: 'nope' }).catch(
        refusalOf,
      ),
    ).toEqual({ code: 'tournamentNotFound' });
    vi.setSystemTime(Date.parse('2030-05-22T12:00:00Z'));
    expect(await join(s, s.captain, 'Late').catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
    expect((await snapshot(s)).waiting).toHaveLength(0);
  });

  test('refuses a signed-out caller, and writes nothing', async () => {
    const s = await fullTournament();
    const before = await snapshot(s);
    await expect(
      s.t.mutation(api.teams.registerForTournamentOrWaitlist, {
        ...TOURNAMENT_SLUGS,
        name: 'Late Lobsters',
      }),
    ).rejects.toThrow();
    expect(await snapshot(s)).toEqual(before);
  });

  test('leaves the season registration of the same person alone', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    const result = await s.as(s.captain).mutation(api.teams.register, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-4s',
      seasonSlug: 'summer-2030',
      name: 'Late Lobsters',
    });
    expect(result.status).toBe('registered');
  });
});

describe('teams.registerForTournament with a waitlist', () => {
  test('still refuses a full tournament with the full code the previous frontend reads', async () => {
    const s = await fullTournament();
    expect(
      await s
        .as(s.captain)
        .mutation(api.teams.registerForTournament, { ...TOURNAMENT_SLUGS, name: 'Late Lobsters' })
        .catch(refusalOf),
    ).toEqual({ code: 'tournamentFull', message: TEAM_MESSAGES.tournamentFull });
  });

  test('refuses a direct registration while a team waits, even with room', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    expect(
      await s
        .as(s.player)
        .mutation(api.teams.registerForTournament, { ...TOURNAMENT_SLUGS, name: 'Later Larks' })
        .catch(refusalOf),
    ).toMatchObject({ code: 'tournamentFull' });
  });
});

describe('a waiting captain', () => {
  test('cannot be added to a roster in the tournament', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    const failure = await s.t
      .run(async (ctx) => {
        const team = (await ctx.db
          .query('teams')
          .withIndex('by_tournamentId_and_sortName', (q) => q.eq('tournamentId', s.gulf))
          .first())!;
        return addRosterEntry(ctx, team, {
          userId: s.captain.userId,
          source: 'invite',
          addedByUserId: s.rival.userId,
        });
      })
      .catch(refusalOf);
    expect(failure).toMatchObject({ code: 'onWaitlist', teamName: 'Late Lobsters', position: 1 });
  });
});

describe('tournaments.getForRegistration with a waitlist', () => {
  test('reads full while a team waits, and gives the waiting caller their place', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    const own = await s.as(s.captain).query(api.tournaments.getForRegistration, TOURNAMENT_SLUGS);
    expect(own).toMatchObject({
      isFull: true,
      team: null,
      waitlist: { teamName: 'Late Lobsters', position: 1 },
    });
    const other = await s.as(s.player).query(api.tournaments.getForRegistration, TOURNAMENT_SLUGS);
    expect(other).toMatchObject({ isFull: true, waitlist: null });
    const signedOut = await s.t.query(api.tournaments.getForRegistration, TOURNAMENT_SLUGS);
    expect(signedOut).toMatchObject({ isFull: true, waitlist: null });
  });

  test('answers null for a captain who has been promoted', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    const { rows } = (await s.as(s.admin).query(api.waitlist.listForTournament, TOURNAMENT_SLUGS))!;
    await s.as(s.admin).mutation(api.waitlist.promoteForTournament, {
      waitlistEntryId: rows[0].waitlistEntryId,
    });
    const own = await s.as(s.captain).query(api.tournaments.getForRegistration, TOURNAMENT_SLUGS);
    expect(own).toMatchObject({ waitlist: null, team: { name: 'Late Lobsters', isCaptain: true } });
  });

  test('marks the public page full while a team waits', async () => {
    const s = await fullTournament();
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    expect(await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS)).toMatchObject({
      isFull: false,
    });
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { maximumTeams: MAXIMUM_TEAMS }));
    await join(s, s.captain, 'Late Lobsters');
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    expect(await s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS)).toMatchObject({
      isFull: true,
    });
  });
});

describe('waitlist.listForTournament', () => {
  test('lists the waiting teams oldest first with the captain and the count, to an organizer', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    vi.advanceTimersByTime(1000);
    await join(s, s.player, 'Later Larks');
    for (const who of [s.admin, s.assignedOrganizer]) {
      const list = await s.as(who).query(api.waitlist.listForTournament, TOURNAMENT_SLUGS);
      expect(list).toEqual({
        rows: [
          {
            waitlistEntryId: ANY_ID,
            teamName: 'Late Lobsters',
            captainName: 'Name captain',
            captainEmail: 'captain@example.test',
            requestedAt: ANY_TIME,
          },
          {
            waitlistEntryId: ANY_ID,
            teamName: 'Later Larks',
            captainName: 'Name player',
            captainEmail: 'player@example.test',
            requestedAt: ANY_TIME,
          },
        ],
        waitlistCount: 2,
      });
    }
  });

  test('lists nothing for a tournament nobody waits on', async () => {
    const s = await fullTournament();
    expect(await s.as(s.admin).query(api.waitlist.listForTournament, TOURNAMENT_SLUGS)).toEqual({
      rows: [],
      waitlistCount: 0,
    });
  });

  test('lists another tournament of the organization separately', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    const other = { ...TOURNAMENT_SLUGS, tournamentSlug: 'second-open' };
    expect(await s.as(s.admin).query(api.waitlist.listForTournament, other)).toEqual({
      rows: [],
      waitlistCount: 0,
    });
  });

  test.each(['foreignAdmin', 'otherOrganizer', 'leagueOrganizer', 'stranger'] as const)(
    'refuses %s',
    async (who) => {
      const s = await fullTournament();
      await join(s, s.captain, 'Late Lobsters');
      expect(
        await s.as(s[who]).query(api.waitlist.listForTournament, TOURNAMENT_SLUGS).catch(refusalOf),
      ).toEqual({ code: FORBIDDEN_CODE });
    },
  );

  test('refuses a signed-out caller', async () => {
    const s = await fullTournament();
    expect(
      await s.t.query(api.waitlist.listForTournament, TOURNAMENT_SLUGS).catch(refusalOf),
    ).toEqual({ code: FORBIDDEN_CODE });
  });

  test('answers null for an unknown tournament to staff, and refuses everyone else', async () => {
    const s = await fullTournament();
    const unknown = { ...TOURNAMENT_SLUGS, tournamentSlug: 'nope' };
    expect(await s.as(s.admin).query(api.waitlist.listForTournament, unknown)).toBeNull();
    expect(
      await s.as(s.stranger).query(api.waitlist.listForTournament, unknown).catch(refusalOf),
    ).toEqual({ code: FORBIDDEN_CODE });
    expect(
      await s.as(s.admin).query(api.waitlist.listForTournament, { ...unknown, orgSlug: 'nope' }),
    ).toBeNull();
  });
});

describe('waitlist.promoteForTournament', () => {
  async function waiting() {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    vi.advanceTimersByTime(1000);
    await join(s, s.player, 'Later Larks');
    const { rows } = (await s.as(s.admin).query(api.waitlist.listForTournament, TOURNAMENT_SLUGS))!;
    return { s, first: rows[0].waitlistEntryId, second: rows[1].waitlistEntryId };
  }

  const promote = (s: TournamentWorld, who: Person, waitlistEntryId: Id<'waitlistEntries'>) =>
    s.as(who).mutation(api.waitlist.promoteForTournament, { waitlistEntryId });

  test('is refused while the tournament has no room, and writes nothing', async () => {
    const { s, first } = await waiting();
    const before = await snapshot(s);
    expect(await promote(s, s.admin, first).catch(refusalOf)).toEqual({
      code: 'noRoom',
      message: TEAM_MESSAGES.noRoomInTournament,
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test('creates the team with the captain as its first roster entry once the maximum is raised by one', async () => {
    const { s, first } = await waiting();
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    const result = await promote(s, s.admin, first);
    expect(result).toEqual({
      teamId: ANY_ID,
      teamCount: MAXIMUM_TEAMS + 1,
      maxTeams: MAXIMUM_TEAMS + 1,
    });
    const after = await snapshot(s);
    const team = after.teams.find((row) => row._id === result.teamId)!;
    expect(team).toMatchObject({
      tournamentId: s.gulf,
      name: 'Late Lobsters',
      captainUserId: s.captain.userId,
      rosterCount: 1,
    });
    expect(team).not.toHaveProperty('seasonId');
    const entries = after.entries.filter((row) => row.teamId === team._id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: s.captain.userId,
      source: 'captain',
      status: 'rostered',
      tournamentId: s.gulf,
    });
    const entry = after.waiting.find((row) => row._id === first)!;
    expect(entry).toMatchObject({
      status: 'promoted',
      promotedTeamId: team._id,
      promotedByUserId: s.admin.userId,
    });
    expect(after.tournament).toMatchObject({ teamCount: MAXIMUM_TEAMS + 1, waitlistCount: 1 });
    expect(after.waiting.find((row) => row._id !== first)?.status).toBe('waiting');
  });

  test('is refused again once the team fills the room', async () => {
    const { s, first, second } = await waiting();
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    await promote(s, s.admin, first);
    expect(await promote(s, s.admin, second).catch(refusalOf)).toMatchObject({ code: 'noRoom' });
  });

  test('may promote out of order', async () => {
    const { s, second } = await waiting();
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    const { teamId } = await promote(s, s.assignedOrganizer, second);
    const team = (await snapshot(s)).teams.find((row) => row._id === teamId);
    expect(team?.name).toBe('Later Larks');
  });

  test('refuses an entry that was already promoted', async () => {
    const { s, first } = await waiting();
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 2);
    await promote(s, s.admin, first);
    expect(await promote(s, s.admin, first).catch(refusalOf)).toMatchObject({
      code: 'alreadyPromoted',
    });
  });

  test.each(['foreignAdmin', 'otherOrganizer', 'leagueOrganizer', 'stranger', 'captain'] as const)(
    'refuses %s, and writes nothing',
    async (who) => {
      const { s, first } = await waiting();
      await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
      const before = await snapshot(s);
      await expect(promote(s, s[who], first)).rejects.toThrow(/Not allowed/);
      expect(await snapshot(s)).toEqual(before);
    },
  );

  test('refuses a signed-out caller, and writes nothing', async () => {
    const { s, first } = await waiting();
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    const before = await snapshot(s);
    await expect(
      s.t.mutation(api.waitlist.promoteForTournament, { waitlistEntryId: first }),
    ).rejects.toThrow();
    expect(await snapshot(s)).toEqual(before);
  });

  test('refuses a season waitlist entry', async () => {
    const { s } = await waiting();
    const seasonEntry = await s.t.run((ctx) =>
      ctx.db.insert('waitlistEntries', {
        organizationId: s.a,
        seasonId: s.season,
        userId: s.stranger.userId,
        teamName: 'Season Team',
        sortName: 'season team',
        status: 'waiting',
        requestedAt: Date.now(),
      }),
    );
    await expect(promote(s, s.admin, seasonEntry)).rejects.toThrow(/Not allowed/);
  });
});

describe('waitlist.promote with a tournament entry', () => {
  test('refuses it, because the season function finds no season', async () => {
    const s = await fullTournament();
    await join(s, s.captain, 'Late Lobsters');
    const { rows } = (await s.as(s.admin).query(api.waitlist.listForTournament, TOURNAMENT_SLUGS))!;
    await raiseMaximumTeams(s, MAXIMUM_TEAMS + 1);
    await expect(
      s.as(s.admin).mutation(api.waitlist.promote, { waitlistEntryId: rows[0].waitlistEntryId }),
    ).rejects.toThrow(/Not allowed/);
    expect((await snapshot(s)).waiting[0]?.status).toBe('waiting');
  });
});
