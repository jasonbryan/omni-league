/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  addMinorEntry,
  addRosterEntry,
  insertFreeAgent,
  insertPlacedFreeAgent,
  insertTeamWithCaptain,
  insertTournamentTeamWithCaptain,
  promoteWaitlistEntry,
  registerTeamOrJoinWaitlist,
  registerTournamentTeamOrJoinWaitlist,
  removeRosterEntry,
} from './lib/rosterWrites';
import { insertSeason } from './lib/tenantWrites';
import { deleteUserRecord } from './lib/users';
import {
  emailOf,
  OPEN_NOW,
  TOURNAMENT_SLUGS,
  tournamentWorld,
  type Person,
  type TournamentWorld,
} from './tournamentWorld.setup';

/** The day after the Gulf Coast Beach Open's registration deadline. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const SEASON_SLUGS = { orgSlug: 'org-a', leagueSlug: 'coed-4s', seasonSlug: 'summer-2030' };

/** Reads the list in more than one batch of 100. */
const MANY = 230;

beforeEach(() => {
  vi.useFakeTimers({ now: OPEN_NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

type Who = Pick<Person, 'authUserId' | 'userId'>;

const deleteAccount = (s: TournamentWorld, who: Who) =>
  s.t.run((ctx) => deleteUserRecord(ctx, who.authUserId));

/** A user with no sign-in, for the many rows a test writes straight into the tables. */
async function bystander(s: TournamentWorld, name: string): Promise<Who> {
  const authUserId = `auth-${name}`;
  const userId = await s.t.run((ctx) =>
    ctx.db.insert('users', { authUserId, name, adultConfirmedAt: 1 }),
  );
  return { authUserId, userId };
}

const seasonTeam = (s: TournamentWorld, name: string, captain: Who) =>
  s.t.run(async (ctx) =>
    insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', s.season))!, {
      name,
      captainUserId: captain.userId,
    }),
  );

const tournamentTeam = (s: TournamentWorld, name: string, captain: Who) =>
  s.t.run(async (ctx) =>
    insertTournamentTeamWithCaptain(ctx, (await ctx.db.get('tournaments', s.gulf))!, {
      name,
      captainUserId: captain.userId,
    }),
  );

const join = (s: TournamentWorld, teamId: Id<'teams'>, who: Who) =>
  s.t.run(async (ctx) =>
    addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
      userId: who.userId,
      source: 'invite',
      addedByUserId: who.userId,
    }),
  );

const joinMinor = (s: TournamentWorld, teamId: Id<'teams'>, guardian: Who, minorName: string) =>
  s.t.run(async (ctx) =>
    addMinorEntry(ctx, (await ctx.db.get('teams', teamId))!, {
      guardianUserId: guardian.userId,
      minorName,
      source: 'guardian',
      addedByUserId: guardian.userId,
    }),
  );

const team = (s: TournamentWorld, teamId: Id<'teams'>) =>
  s.t.run((ctx) => ctx.db.get('teams', teamId));

const rosterCount = async (s: TournamentWorld, teamId: Id<'teams'>) =>
  (await team(s, teamId))?.rosterCount;

const entriesOf = (s: TournamentWorld, who: Who) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query('rosterEntries').collect()).filter((row) => row.userId === who.userId),
  );

const freeAgentsOf = (s: TournamentWorld, who: Who) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query('freeAgents').collect()).filter((row) => row.userId === who.userId),
  );

const waitlistOf = (s: TournamentWorld, who: Who) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query('waitlistEntries').collect()).filter((row) => row.userId === who.userId),
  );

const rosteredUserIds = (s: TournamentWorld, teamId: Id<'teams'>) =>
  s.t.run(async (ctx) =>
    (
      await ctx.db
        .query('rosterEntries')
        .withIndex('by_teamId_and_status', (q) => q.eq('teamId', teamId).eq('status', 'rostered'))
        .collect()
    ).map((row) => row.userId),
  );

const seasonCounters = (s: TournamentWorld) =>
  s.t.run(async (ctx) => {
    const season = (await ctx.db.get('seasons', s.season))!;
    return { teamCount: season.teamCount, waitlistCount: season.waitlistCount };
  });

const tournamentWaitlistCount = (s: TournamentWorld) =>
  s.t.run(async (ctx) => (await ctx.db.get('tournaments', s.gulf))?.waitlistCount);

const inviteBy = (s: TournamentWorld, who: Person, teamId: Id<'teams'>, email: string) =>
  s.as(who).action(api.teamInvites.create, { teamId, email });

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

/** Four teams of two players make two semifinals and a final; each team's captain is its own person, and `player` is on Sand Crabs. */
async function fourTournamentTeams(s: TournamentWorld) {
  const teamIds = {
    crabs: await tournamentTeam(s, 'Sand Crabs', s.captain),
    bombers: await tournamentTeam(s, 'Beach Bombers', s.rival),
    point: await tournamentTeam(s, 'Set Point', s.stranger),
    squad: await tournamentTeam(s, 'Spike Squad', s.traveller),
  };
  await join(s, teamIds.crabs, s.player);
  for (const [name, teamId] of [
    ['b1', teamIds.bombers],
    ['b2', teamIds.point],
    ['b3', teamIds.squad],
  ] as const) {
    await join(s, teamId, await bystander(s, name));
  }
  return teamIds;
}

async function createBracket(s: TournamentWorld) {
  vi.setSystemTime(AFTER_DEADLINE);
  await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
}

const gameOf = (s: TournamentWorld, teamId: Id<'teams'>) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query('tournamentGames').collect()).find((game) => game.teamIds.includes(teamId)),
  );

const isBracketCreated = (s: TournamentWorld) =>
  s.t.run(async (ctx) => (await ctx.db.query('tournamentGames').first()) !== null);

/** One rostered row per team, written straight into the table, for the tests that need more rows than the writers make. */
const rosterRow = (s: TournamentWorld, teamId: Id<'teams'>, userId: Id<'users'>) =>
  s.t.run((ctx) =>
    ctx.db.insert('rosterEntries', {
      organizationId: s.a,
      seasonId: s.season,
      teamId,
      userId,
      status: 'rostered',
      source: 'invite',
      addedAt: Date.now(),
      addedByUserId: userId,
    }),
  );

const bulkTeams = (s: TournamentWorld, captain: Who, count: number, rosterCount = 0) =>
  s.t.run(async (ctx) => {
    const ids: Id<'teams'>[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(
        await ctx.db.insert('teams', {
          organizationId: s.a,
          seasonId: s.season,
          name: `Bulk ${i}`,
          sortName: `bulk ${i}`,
          captainUserId: captain.userId,
          rosterCount,
          createdAt: i,
        }),
      );
    }
    return ids;
  });

describe('deleting an account removes its roster entries', () => {
  test('deletes the entry of an adult and lowers the team count by 1, leaving another player', async () => {
    const s = await tournamentWorld();
    const sharks = await seasonTeam(s, 'Sharks', s.captain);
    await join(s, sharks, s.player);
    await join(s, sharks, s.rival);
    expect(await rosterCount(s, sharks)).toBe(3);
    await deleteAccount(s, s.player);
    expect(await entriesOf(s, s.player)).toEqual([]);
    expect(await rosterCount(s, sharks)).toBe(2);
    expect(await rosteredUserIds(s, sharks)).toEqual([s.captain.userId, s.rival.userId]);
  });

  test('deletes a guardian’s own entry and both minors’ entries and lowers the count by 3', async () => {
    const s = await tournamentWorld();
    const sharks = await seasonTeam(s, 'Sharks', s.captain);
    await join(s, sharks, s.guardian);
    await joinMinor(s, sharks, s.guardian, 'Maya R.');
    await joinMinor(s, sharks, s.guardian, 'Noa R.');
    expect(await rosterCount(s, sharks)).toBe(4);
    await deleteAccount(s, s.guardian);
    expect(await entriesOf(s, s.guardian)).toEqual([]);
    expect(await rosterCount(s, sharks)).toBe(1);
  });

  test('deletes a removed entry and leaves the count as it is', async () => {
    const s = await tournamentWorld();
    const sharks = await seasonTeam(s, 'Sharks', s.captain);
    await join(s, sharks, s.player);
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.query('rosterEntries').collect()).find(
        (row) => row.userId === s.player.userId,
      )!;
      await removeRosterEntry(ctx, entry, s.captain.userId);
    });
    expect(await entriesOf(s, s.player)).toHaveLength(1);
    expect(await rosterCount(s, sharks)).toBe(1);
    await deleteAccount(s, s.player);
    expect(await entriesOf(s, s.player)).toEqual([]);
    expect(await rosterCount(s, sharks)).toBe(1);
  });

  test('frees a place on a full team so another user can accept a pending invite', async () => {
    const s = await tournamentWorld();
    await s.t.run((ctx) => ctx.db.patch('seasons', s.season, { maxRosterSize: 4 }));
    const sharks = await seasonTeam(s, 'Sharks', s.captain);
    for (const who of [s.player, s.rival]) await join(s, sharks, who);
    const { token } = await inviteBy(s, s.captain, sharks, emailOf('stranger'));
    await join(s, sharks, s.rivalPlayer);
    const accept = () => s.as(s.stranger).mutation(api.teamInvites.accept, { token });
    const refused = await accept().then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusalOf(refused)).toMatchObject({ code: 'teamFull' });
    await deleteAccount(s, s.rivalPlayer);
    await expect(accept()).resolves.toMatchObject({ teamId: sharks });
    expect(await rosterCount(s, sharks)).toBe(4);
  });

  test('deletes a tournament entry and lowers the team count, also after the bracket exists', async () => {
    const s = await tournamentWorld();
    const teams = await fourTournamentTeams(s);
    await createBracket(s);
    expect(await isBracketCreated(s)).toBe(true);
    expect(await rosterCount(s, teams.crabs)).toBe(2);
    await deleteAccount(s, s.player);
    expect(await entriesOf(s, s.player)).toEqual([]);
    expect(await rosterCount(s, teams.crabs)).toBe(1);
  });
});

describe('deleting an account removes its free agent rows', () => {
  test('deletes a waiting and a placed free agent in two seasons and the placed one’s entry', async () => {
    const s = await tournamentWorld();
    const fall = await s.t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').first())!;
      return insertSeason(
        ctx,
        league,
        {
          name: 'Fall 2030',
          slug: 'fall-2030',
          startDate: '2030-09-01',
          endDate: '2030-11-30',
          registrationDeadline: '2030-08-20',
          playersPerSide: 4,
          minimumRosterSize: 4,
        },
        'published',
      );
    });
    const fallTeam = await s.t.run(async (ctx) =>
      insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', fall))!, {
        name: 'Fall Crew',
        captainUserId: s.captain.userId,
      }),
    );
    await s.t.run(async (ctx) => {
      await insertFreeAgent(ctx, (await ctx.db.get('seasons', s.season))!, s.traveller.userId);
      await insertPlacedFreeAgent(ctx, (await ctx.db.get('teams', fallTeam))!, s.traveller.userId);
    });
    const listed = () => s.as(s.admin).query(api.freeAgents.listForOrganizer, SEASON_SLUGS);
    expect((await listed())?.rows).toHaveLength(1);
    expect(await freeAgentsOf(s, s.traveller)).toHaveLength(2);
    expect(await rosterCount(s, fallTeam)).toBe(2);

    await deleteAccount(s, s.traveller);

    expect(await freeAgentsOf(s, s.traveller)).toEqual([]);
    expect(await entriesOf(s, s.traveller)).toEqual([]);
    expect(await rosterCount(s, fallTeam)).toBe(1);
    expect((await listed())?.rows).toEqual([]);
  });
});

describe('deleting an account removes its waitlist entries', () => {
  async function fullSeasonAndTournament(s: TournamentWorld) {
    await s.t.run(async (ctx) => {
      await ctx.db.patch('seasons', s.season, { maxTeams: 1 });
      await ctx.db.patch('tournaments', s.gulf, { maximumTeams: 1 });
    });
    await seasonTeam(s, 'Sharks', s.captain);
    await tournamentTeam(s, 'Crabs', s.captain);
  }

  const joinWaitlists = (
    s: TournamentWorld,
    who: Who,
    seasonName: string,
    tournamentName: string,
  ) =>
    s.t.run(async (ctx) => {
      await registerTeamOrJoinWaitlist(ctx, (await ctx.db.get('seasons', s.season))!, {
        name: seasonName,
        captainUserId: who.userId,
      });
      await registerTournamentTeamOrJoinWaitlist(ctx, (await ctx.db.get('tournaments', s.gulf))!, {
        name: tournamentName,
        captainUserId: who.userId,
      });
    });

  test('deletes a season and a tournament entry, lowers both counts, and frees the team names', async () => {
    const s = await tournamentWorld();
    await fullSeasonAndTournament(s);
    await joinWaitlists(s, s.traveller, 'Lobsters', 'Pelicans');
    expect(await seasonCounters(s)).toMatchObject({ waitlistCount: 1 });
    expect(await tournamentWaitlistCount(s)).toBe(1);
    const asAdmin = s.as(s.admin);
    const seasonList = () => asAdmin.query(api.waitlist.listForOrganizer, SEASON_SLUGS);
    const tournamentList = () => asAdmin.query(api.waitlist.listForTournament, TOURNAMENT_SLUGS);
    expect((await seasonList())?.rows).toHaveLength(1);
    expect((await tournamentList())?.rows).toHaveLength(1);

    await deleteAccount(s, s.traveller);

    expect(await waitlistOf(s, s.traveller)).toEqual([]);
    expect(await seasonCounters(s)).toMatchObject({ waitlistCount: 0 });
    expect(await tournamentWaitlistCount(s)).toBe(0);
    expect(await seasonList()).toMatchObject({ rows: [], waitlistCount: 0 });
    expect(await tournamentList()).toMatchObject({ rows: [], waitlistCount: 0 });
    const asStranger = s.as(s.stranger);
    await expect(
      asStranger.mutation(api.teams.register, { ...SEASON_SLUGS, name: 'Lobsters' }),
    ).resolves.toMatchObject({ status: 'waitlisted' });
    await expect(
      asStranger.mutation(api.teams.registerForTournamentOrWaitlist, {
        ...TOURNAMENT_SLUGS,
        name: 'Pelicans',
      }),
    ).resolves.toMatchObject({ status: 'waitlisted' });
  });

  test('deletes a promoted entry and leaves the waitlist count as it is', async () => {
    const s = await tournamentWorld();
    await fullSeasonAndTournament(s);
    await joinWaitlists(s, s.traveller, 'Lobsters', 'Pelicans');
    await joinWaitlists(s, s.stranger, 'Gulls', 'Herons');
    await s.t.run(async (ctx) => {
      await ctx.db.patch('seasons', s.season, { maxTeams: 2 });
      const entry = (await ctx.db.query('waitlistEntries').collect()).find(
        (row) => row.userId === s.traveller.userId && row.seasonId === s.season,
      )!;
      await promoteWaitlistEntry(ctx, entry._id, s.admin.userId);
    });
    expect(await seasonCounters(s)).toMatchObject({ waitlistCount: 1 });
    expect(await waitlistOf(s, s.traveller)).toHaveLength(2);

    await deleteAccount(s, s.traveller);

    expect(await waitlistOf(s, s.traveller)).toEqual([]);
    expect(await seasonCounters(s)).toMatchObject({ waitlistCount: 1 });
    expect(await tournamentWaitlistCount(s)).toBe(1);
    expect(await waitlistOf(s, s.stranger)).toHaveLength(2);
  });
});

describe('deleting the account of a captain', () => {
  test('hands a season team to the adult rostered longest and skips a gone user and a minor', async () => {
    const s = await tournamentWorld();
    const sharks = await seasonTeam(s, 'Sharks', s.captain);
    const gone = await bystander(s, 'gone');
    await join(s, sharks, gone);
    await joinMinor(s, sharks, s.guardian, 'Maya R.');
    await join(s, sharks, s.player);
    await join(s, sharks, s.rival);
    await s.t.run((ctx) => ctx.db.delete('users', gone.userId));

    await deleteAccount(s, s.captain);

    expect((await team(s, sharks))?.captainUserId).toBe(s.player.userId);
    await expect(inviteBy(s, s.player, sharks, 'newcomer@example.test')).resolves.toMatchObject({
      token: expect.any(String) as string,
    });
    const view = await s.as(s.admin).query(api.seasons.getOrganizerView, SEASON_SLUGS);
    expect(view?.teams.map((row) => row.captainName)).toEqual([`Name ${s.player.name}`]);
  });

  test('hands a tournament team to another adult, who can then report a score for its game', async () => {
    const s = await tournamentWorld();
    const teams = await fourTournamentTeams(s);
    await createBracket(s);

    await deleteAccount(s, s.captain);

    expect((await team(s, teams.crabs))?.captainUserId).toBe(s.player.userId);
    const game = (await gameOf(s, teams.crabs))!;
    await expect(
      s.as(s.player).mutation(api.scoreReports.report, {
        gameId: game._id,
        teamId: teams.crabs,
        score: { kind: 'sets', sets: [{ a: 21, b: 18 }] },
      }),
    ).resolves.toMatchObject({ reportedAt: expect.any(Number) as number });
  });

  test('leaves a team with no other adult without a captain, and its organizer can still run it', async () => {
    const s = await tournamentWorld();
    const minorsOnly = await seasonTeam(s, 'Minors Only', s.captain);
    await joinMinor(s, minorsOnly, s.guardian, 'Maya R.');
    const alone = await seasonTeam(s, 'Alone', s.rival);

    await deleteAccount(s, s.captain);
    await deleteAccount(s, s.rival);

    expect((await team(s, minorsOnly))?.captainUserId).toBe(s.captain.userId);
    expect((await team(s, alone))?.captainUserId).toBe(s.rival.userId);
    const asAdmin = s.as(s.admin);
    await expect(inviteBy(s, s.admin, alone, 'newcomer@example.test')).resolves.toMatchObject({
      token: expect.any(String) as string,
    });
    const [minor] = await entriesOf(s, s.guardian);
    await asAdmin.mutation(api.rosterEntries.remove, { rosterEntryId: minor._id });
    expect(await rosterCount(s, minorsOnly)).toBe(0);
    const view = await asAdmin.query(api.seasons.getOrganizerView, SEASON_SLUGS);
    expect(view?.teams.map((row) => row.captainName)).toEqual(['', '']);
  });

  test('completes for an account that captains more than 100 teams with no other adult', async () => {
    const s = await tournamentWorld();
    const captain = await bystander(s, 'many');
    const teams = await bulkTeams(s, captain, MANY);
    const last = teams[teams.length - 1];
    await rosterRow(s, last, s.player.userId);

    await deleteAccount(s, captain);

    const captains = await s.t.run(async (ctx) => {
      const rows = await ctx.db.query('teams').collect();
      return rows.map((row) => row.captainUserId);
    });
    expect(captains).toHaveLength(MANY);
    expect(captains.filter((id) => id === captain.userId)).toHaveLength(MANY - 1);
    expect((await team(s, last))?.captainUserId).toBe(s.player.userId);
  });
});

describe('deleting an account with many rows', () => {
  test('deletes more than 100 roster entries and lowers every count', async () => {
    const s = await tournamentWorld();
    const captain = await bystander(s, 'host');
    const teams = await bulkTeams(s, captain, MANY, 1);
    for (const teamId of teams) await rosterRow(s, teamId, s.player.userId);

    await deleteAccount(s, s.player);

    expect(await entriesOf(s, s.player)).toEqual([]);
    const counts = await Promise.all(teams.map((teamId) => rosterCount(s, teamId)));
    expect(counts.every((count) => count === 0)).toBe(true);
  });

  test('deletes more than 100 free agent rows and waitlist entries and lowers the waitlist count', async () => {
    const s = await tournamentWorld();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('seasons', s.season, { waitlistCount: MANY });
      for (let i = 0; i < MANY; i += 1) {
        await ctx.db.insert('freeAgents', {
          organizationId: s.a,
          seasonId: s.season,
          userId: s.traveller.userId,
          status: 'waiting',
          registeredAt: i,
        });
        await ctx.db.insert('waitlistEntries', {
          organizationId: s.a,
          seasonId: s.season,
          userId: s.traveller.userId,
          teamName: `Wait ${i}`,
          sortName: `wait ${i}`,
          status: 'waiting',
          requestedAt: i,
        });
      }
    });

    await deleteAccount(s, s.traveller);

    expect(await freeAgentsOf(s, s.traveller)).toEqual([]);
    expect(await waitlistOf(s, s.traveller)).toEqual([]);
    expect(await seasonCounters(s)).toMatchObject({ waitlistCount: 0 });
  });

  test('completes when a team, a season, and a tournament are gone and a count is already 0', async () => {
    const s = await tournamentWorld();
    const host = await bystander(s, 'host');
    const [zeroCount, goneTeam] = await bulkTeams(s, host, 2, 0);
    await rosterRow(s, zeroCount, s.traveller.userId);
    await rosterRow(s, goneTeam, s.traveller.userId);
    await s.t.run(async (ctx) => {
      await ctx.db.delete('teams', goneTeam);
      const goneSeason = await insertSeason(
        ctx,
        (await ctx.db.query('leagues').first())!,
        {
          name: 'Gone 2030',
          slug: 'gone-2030',
          startDate: '2030-09-01',
          endDate: '2030-11-30',
          registrationDeadline: '2030-08-20',
          playersPerSide: 4,
          minimumRosterSize: 4,
        },
        'published',
      );
      const waiting = {
        organizationId: s.a,
        userId: s.traveller.userId,
        status: 'waiting' as const,
        requestedAt: 1,
      };
      await ctx.db.insert('waitlistEntries', {
        ...waiting,
        seasonId: goneSeason,
        teamName: 'Gone season',
        sortName: 'gone season',
      });
      await ctx.db.insert('waitlistEntries', {
        ...waiting,
        seasonId: s.season,
        teamName: 'Zero count',
        sortName: 'zero count',
      });
      await ctx.db.insert('waitlistEntries', {
        ...waiting,
        tournamentId: s.second,
        teamName: 'Gone tournament',
        sortName: 'gone tournament',
      });
      await ctx.db.patch('seasons', s.season, { waitlistCount: 0 });
      await ctx.db.delete('seasons', goneSeason);
      await ctx.db.delete('tournaments', s.second);
    });

    await deleteAccount(s, s.traveller);

    expect(await entriesOf(s, s.traveller)).toEqual([]);
    expect(await waitlistOf(s, s.traveller)).toEqual([]);
    expect(await rosterCount(s, zeroCount)).toBe(0);
    expect(await seasonCounters(s)).toMatchObject({ waitlistCount: 0 });
  });
});
