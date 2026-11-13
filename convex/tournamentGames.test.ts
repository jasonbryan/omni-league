/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { BRACKET_MESSAGES } from './lib/bracket';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { TEAM_MESSAGES } from './lib/teamInput';
import type { TournamentEditable } from './lib/tournamentEdit';
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

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

const ANY_ID = expect.any(String) as string;

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];

async function world(teamNames: readonly string[] = [], now = AFTER_DEADLINE) {
  vi.useFakeTimers({ now });
  const s = await tournamentWorld();
  const teamIds: Id<'teams'>[] = [];
  for (const name of teamNames) teamIds.push(await addTeam(s, name));
  return { s, teamIds };
}

let registeredAt = 1_000;

/** Straight into `teams`: the bracket reads only a team's roster count, seed, and registration time. */
function addTeam(
  s: TournamentWorld,
  name: string,
  {
    rosterCount = 2,
    tournamentId = s.gulf,
  }: { rosterCount?: number; tournamentId?: Id<'tournaments'> } = {},
) {
  registeredAt += 1;
  return s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', tournamentId))!;
    return ctx.db.insert('teams', {
      organizationId: tournament.organizationId,
      tournamentId,
      name,
      sortName: name.toLowerCase(),
      captainUserId: s.captain.userId,
      rosterCount,
      createdAt: registeredAt,
    });
  });
}

const setup = (s: TournamentWorld, who: Person = s.admin, slugs = TOURNAMENT_SLUGS) =>
  s.as(who).query(api.tournamentGames.getSetup, slugs);

const seedNames = async (s: TournamentWorld) => (await setup(s))!.seeds.map((seed) => seed.name);

const move = (
  s: TournamentWorld,
  teamId: Id<'teams'>,
  direction: 'up' | 'down',
  who: Person = s.admin,
) => s.as(who).mutation(api.tournamentGames.moveSeed, { tournamentId: s.gulf, teamId, direction });

const create = (s: TournamentWorld, replace?: boolean, who: Person = s.admin) =>
  s.as(who).mutation(api.tournamentGames.createBracket, {
    tournamentId: s.gulf,
    ...(replace !== undefined && { replace }),
  });

const games = (s: TournamentWorld, tournamentId = s.gulf) =>
  s.t.run((ctx) =>
    ctx.db
      .query('tournamentGames')
      .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', tournamentId).eq('stage', 'bracket'))
      .collect(),
  );

const teamRows = (s: TournamentWorld) => s.t.run((ctx) => ctx.db.query('teams').collect());

const HELD_AT_START: TournamentEditable = {
  startDate: '2030-06-01',
  endDate: '2030-06-02',
  registrationDeadline: '2030-05-20',
  maximumTeams: 4,
  setsPerGame: 1,
};

const EXPECTED: TournamentEditable = {
  startDate: '2030-06-01',
  endDate: '2030-06-02',
  registrationDeadline: '2030-05-31',
  maximumTeams: 4,
  setsPerGame: 1,
};

describe('tournamentGames.getSetup', () => {
  test('lists the confirmed teams in registration order', async () => {
    const { s } = await world(['Alpha', 'Bravo', 'Charlie']);
    const setupOf = (await setup(s))!;
    expect(setupOf.seeds).toEqual([
      { teamId: ANY_ID, name: 'Alpha', rosterCount: 2 },
      { teamId: ANY_ID, name: 'Bravo', rosterCount: 2 },
      { teamId: ANY_ID, name: 'Charlie', rosterCount: 2 },
    ]);
    expect(setupOf.bracket).toBeNull();
    expect(setupOf.unconfirmedCount).toBe(0);
  });

  test('leaves out a team below the minimum roster size and counts it', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    await addTeam(s, 'Short Handed', { rosterCount: 1 });
    expect(await seedNames(s)).toEqual(['Alpha', 'Bravo']);
    expect((await setup(s))!.unconfirmedCount).toBe(1);
  });

  test('counts a team that reaches the minimum as a seed, last in registration order', async () => {
    const { s } = await world(['Alpha']);
    const short = await addTeam(s, 'Short Handed', { rosterCount: 1 });
    await addTeam(s, 'Bravo');
    await s.t.run((ctx) => ctx.db.patch('teams', short, { rosterCount: 2 }));
    expect(await seedNames(s)).toEqual(['Alpha', 'Short Handed', 'Bravo']);
  });

  test('leaves out the teams of another tournament', async () => {
    const { s } = await world(['Alpha']);
    await addTeam(s, 'Elsewhere', { tournamentId: s.second });
    expect(await seedNames(s)).toEqual(['Alpha']);
  });

  test('answers null for an unknown tournament to staff, and refuses everyone else', async () => {
    const { s } = await world(['Alpha']);
    const unknown = { ...TOURNAMENT_SLUGS, tournamentSlug: 'nope' };
    expect(await setup(s, s.admin, unknown)).toBeNull();
    expect(await setup(s, s.admin, { ...unknown, orgSlug: 'nope' })).toBeNull();
    expect(await setup(s, s.stranger, unknown).catch(refusalOf)).toEqual({ code: FORBIDDEN_CODE });
  });

  test('lets an organizer assigned to the tournament read it', async () => {
    const { s } = await world(['Alpha']);
    expect(await seedNames(s)).toEqual(['Alpha']);
    expect((await setup(s, s.assignedOrganizer))!.seeds).toHaveLength(1);
  });

  test.each(['foreignAdmin', 'otherOrganizer', 'leagueOrganizer', 'stranger'] as const)(
    'refuses %s',
    async (who) => {
      const { s } = await world(['Alpha']);
      expect(await setup(s, s[who]).catch(refusalOf)).toEqual({ code: FORBIDDEN_CODE });
    },
  );

  test('refuses a signed-out caller', async () => {
    const { s } = await world(['Alpha']);
    expect(
      await s.t.query(api.tournamentGames.getSetup, TOURNAMENT_SLUGS).catch(refusalOf),
    ).toEqual({ code: FORBIDDEN_CODE });
  });
});

describe('tournamentGames.moveSeed', () => {
  test('moves a team up and saves the order, so a reload keeps it', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo', 'Charlie']);
    expect(await move(s, teamIds[2], 'up')).toEqual({ seed: 2, seedCount: 3 });
    expect(await seedNames(s)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    const seeds = Object.fromEntries((await teamRows(s)).map((team) => [team.name, team.seed]));
    expect(seeds).toEqual({ Alpha: 1, Charlie: 2, Bravo: 3 });
  });

  test('moves a team down', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo', 'Charlie']);
    expect(await move(s, teamIds[0], 'down')).toEqual({ seed: 2, seedCount: 3 });
    expect(await seedNames(s)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  test('keeps a moved order across later moves, and puts a team confirmed later last', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo', 'Charlie']);
    await move(s, teamIds[2], 'up');
    await move(s, teamIds[2], 'up');
    expect(await seedNames(s)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    await addTeam(s, 'Delta');
    expect(await seedNames(s)).toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta']);
  });

  test('refuses the first seed up and the last seed down, and writes nothing', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo']);
    const before = await teamRows(s);
    expect(await move(s, teamIds[0], 'up').catch(refusalOf)).toEqual({
      code: 'firstSeed',
      message: BRACKET_MESSAGES.firstSeed('Alpha'),
    });
    expect(await move(s, teamIds[1], 'down').catch(refusalOf)).toEqual({
      code: 'lastSeed',
      message: BRACKET_MESSAGES.lastSeed('Bravo'),
    });
    expect(await teamRows(s)).toEqual(before);
  });

  test('refuses a team below the minimum roster size', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    const short = await addTeam(s, 'Short Handed', { rosterCount: 1 });
    expect(await move(s, short, 'up').catch(refusalOf)).toEqual({
      code: 'notSeeded',
      message: BRACKET_MESSAGES.notSeeded('Short Handed'),
    });
  });

  test('refuses a team of another tournament as not allowed', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    const elsewhere = await addTeam(s, 'Elsewhere', { tournamentId: s.second });
    await expect(move(s, elsewhere, 'up')).rejects.toThrow(/Not allowed/);
  });

  test('refuses once a result is entered, and writes nothing', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo', 'Charlie']);
    await create(s);
    await enterResult(s);
    const before = await teamRows(s);
    expect(await move(s, teamIds[2], 'up').catch(refusalOf)).toEqual({
      code: 'seedsLocked',
      message: BRACKET_MESSAGES.seedsLocked,
    });
    expect(await teamRows(s)).toEqual(before);
  });

  test('moves the seeds while a bracket with no result exists', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo', 'Charlie']);
    await create(s);
    expect(await move(s, teamIds[2], 'up')).toEqual({ seed: 2, seedCount: 3 });
  });

  test('lets an organizer assigned to the tournament move a seed', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo']);
    await move(s, teamIds[1], 'up', s.assignedOrganizer);
    expect(await seedNames(s)).toEqual(['Bravo', 'Alpha']);
  });

  test.each(['foreignAdmin', 'otherOrganizer', 'leagueOrganizer', 'stranger', 'captain'] as const)(
    'refuses %s, and writes nothing',
    async (who) => {
      const { s, teamIds } = await world(['Alpha', 'Bravo']);
      const before = await teamRows(s);
      await expect(move(s, teamIds[1], 'up', s[who])).rejects.toThrow(/Not allowed/);
      expect(await teamRows(s)).toEqual(before);
    },
  );

  test('refuses a signed-out caller, and writes nothing', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo']);
    const before = await teamRows(s);
    await expect(
      s.t.mutation(api.tournamentGames.moveSeed, {
        tournamentId: s.gulf,
        teamId: teamIds[1],
        direction: 'up',
      }),
    ).rejects.toThrow();
    expect(await teamRows(s)).toEqual(before);
  });
});

async function enterResult(s: TournamentWorld) {
  await s.t.run(async (ctx) => {
    const played = (
      await ctx.db
        .query('tournamentGames')
        .withIndex(GAME_INDEX, (q) => q.eq('tournamentId', s.gulf).eq('stage', 'bracket'))
        .collect()
    ).find((game) => game.teamIds.every((id) => id !== null))!;
    await ctx.db.patch('tournamentGames', played._id, { winnerTeamId: played.teamIds[0]! });
  });
}

describe('tournamentGames.createBracket', () => {
  test('5 teams make 8 slots: seeds 1 to 3 get byes into round 2 and 4 plays 5', async () => {
    const { s, teamIds } = await world(NAMES.slice(0, 5));
    expect(await create(s)).toEqual({ gameCount: 7, replaced: false });
    const rows = await games(s);
    const at = (round: number, slot: number) =>
      rows.find((game) => game.round === round && game.slot === slot)!;
    const [a, b, c, d, e] = teamIds;
    expect(rows.map((game) => [game.round, game.slot])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 1],
      [2, 2],
      [3, 1],
    ]);
    expect(at(1, 1)).toMatchObject({ teamIds: [a, null], winnerTeamId: a, nextSide: 0 });
    expect(at(1, 2)).toMatchObject({ teamIds: [d, e], nextSide: 1 });
    expect(at(1, 2).winnerTeamId).toBeUndefined();
    expect(at(1, 3)).toMatchObject({ teamIds: [b, null], winnerTeamId: b, nextSide: 0 });
    expect(at(1, 4)).toMatchObject({ teamIds: [c, null], winnerTeamId: c, nextSide: 1 });
    expect(at(2, 1)).toMatchObject({ teamIds: [a, null], nextSide: 0 });
    expect(at(2, 2)).toMatchObject({ teamIds: [b, c], nextSide: 1 });
    expect(at(3, 1).teamIds).toEqual([null, null]);
    expect(at(1, 1).nextGameId).toBe(at(2, 1)._id);
    expect(at(1, 2).nextGameId).toBe(at(2, 1)._id);
    expect(at(1, 3).nextGameId).toBe(at(2, 2)._id);
    expect(at(2, 1).nextGameId).toBe(at(3, 1)._id);
    expect(at(2, 2).nextGameId).toBe(at(3, 1)._id);
    expect(at(3, 1).nextGameId).toBeUndefined();
    expect(at(3, 1).nextSide).toBeUndefined();
    expect(rows.every((game) => game.tournamentId === s.gulf && game.stage === 'bracket')).toBe(
      true,
    );
  });

  test('2 teams make one game, the Final', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    expect(await create(s)).toEqual({ gameCount: 1, replaced: false });
    const [game] = await games(s);
    expect(game).toMatchObject({ round: 1, slot: 1 });
    expect(game.winnerTeamId).toBeUndefined();
    expect((await setup(s))!.bracket!.rounds.map((round) => round.name)).toEqual(['Final']);
  });

  test('8 teams make 7 games with no bye, and 9 teams make 15', async () => {
    const eight = await world(NAMES.slice(0, 8));
    expect(await create(eight.s)).toEqual({ gameCount: 7, replaced: false });
    expect((await games(eight.s)).filter((game) => game.winnerTeamId !== undefined)).toHaveLength(
      0,
    );
    const nine = await world(NAMES);
    expect(await create(nine.s)).toEqual({ gameCount: 15, replaced: false });
    expect((await games(nine.s)).filter((game) => game.winnerTeamId !== undefined)).toHaveLength(7);
  });

  test('saves the seeds as 1 to the team count, in the order shown', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo', 'Charlie']);
    await move(s, teamIds[2], 'up');
    await create(s);
    const seeds = Object.fromEntries((await teamRows(s)).map((team) => [team.name, team.seed]));
    expect(seeds).toEqual({ Alpha: 1, Charlie: 2, Bravo: 3 });
    const [first, second] = await games(s);
    expect(first.teamIds).toEqual([teamIds[0], null]);
    expect(second.teamIds).toEqual([teamIds[2], teamIds[1]]);
  });

  test('leaves a team below the minimum roster size out of the bracket', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo']);
    const short = await addTeam(s, 'Short Handed', { rosterCount: 1 });
    await create(s);
    const ids = (await games(s)).flatMap((game) => game.teamIds);
    expect(ids).toEqual([teamIds[0], teamIds[1]]);
    expect(ids).not.toContain(short);
    expect((await teamRows(s)).find((team) => team._id === short)!.seed).toBeUndefined();
  });

  test('is refused before the registration deadline has passed, and writes nothing', async () => {
    const { s } = await world(['Alpha', 'Bravo'], OPEN_NOW);
    expect(await create(s).catch(refusalOf)).toEqual({
      code: 'registrationOpen',
      message: BRACKET_MESSAGES.registrationOpen('2030-05-20'),
    });
    expect(await games(s)).toEqual([]);
    expect((await teamRows(s)).every((team) => team.seed === undefined)).toBe(true);
  });

  test('is allowed on the first day after the deadline, in every time zone', async () => {
    const { s } = await world(['Alpha', 'Bravo'], Date.parse('2030-05-21T11:59:00Z'));
    expect(await create(s).catch(refusalOf)).toMatchObject({ code: 'registrationOpen' });
    vi.setSystemTime(Date.parse('2030-05-21T12:00:00Z'));
    expect(await create(s)).toEqual({ gameCount: 1, replaced: false });
  });

  test('is refused with fewer than 2 confirmed teams', async () => {
    const none = await world([]);
    expect(await create(none.s).catch(refusalOf)).toEqual({
      code: 'tooFewTeams',
      message: 'A bracket needs at least 2 confirmed teams.',
    });
    const one = await world(['Alpha']);
    await addTeam(one.s, 'Short Handed', { rosterCount: 1 });
    expect(await create(one.s).catch(refusalOf)).toMatchObject({ code: 'tooFewTeams' });
    expect(await games(one.s)).toEqual([]);
  });

  test('is refused for a bracket that exists unless it replaces it', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    await create(s);
    const before = await games(s);
    expect(await create(s).catch(refusalOf)).toEqual({
      code: 'bracketExists',
      message: BRACKET_MESSAGES.bracketExists,
    });
    expect(await create(s, false).catch(refusalOf)).toMatchObject({ code: 'bracketExists' });
    expect(await games(s)).toEqual(before);
  });

  test('recreates the bracket from the current seeds, replacing every game', async () => {
    const { s, teamIds } = await world(['Alpha', 'Bravo', 'Charlie']);
    await create(s);
    const first = await games(s);
    await move(s, teamIds[2], 'up');
    expect(await create(s, true)).toEqual({ gameCount: 3, replaced: true });
    const second = await games(s);
    expect(second).toHaveLength(3);
    expect(second.map((game) => game._id).filter((id) => first.some((g) => g._id === id))).toEqual(
      [],
    );
    expect(second[1].teamIds).toEqual([teamIds[2], teamIds[1]]);
  });

  test('keeps the games of another tournament when it recreates its own', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    await addTeam(s, 'Other One', { tournamentId: s.second });
    await addTeam(s, 'Other Two', { tournamentId: s.second });
    await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.second });
    await create(s);
    await create(s, true);
    expect(await games(s, s.second)).toHaveLength(1);
    expect(await games(s)).toHaveLength(1);
  });

  test('refuses to recreate once a result is entered, and keeps the bracket', async () => {
    const { s } = await world(['Alpha', 'Bravo', 'Charlie']);
    await create(s);
    await enterResult(s);
    const before = await games(s);
    expect(await create(s, true).catch(refusalOf)).toEqual({
      code: 'resultEntered',
      message: BRACKET_MESSAGES.resultEntered,
    });
    expect(await games(s)).toEqual(before);
  });

  test('does not count a bye as a result', async () => {
    const { s } = await world(['Alpha', 'Bravo', 'Charlie']);
    await create(s);
    expect((await games(s)).some((game) => game.winnerTeamId !== undefined)).toBe(true);
    expect(await create(s, true)).toEqual({ gameCount: 3, replaced: true });
  });

  test('lets an organizer assigned to the tournament create it', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    expect(await create(s, undefined, s.assignedOrganizer)).toEqual({
      gameCount: 1,
      replaced: false,
    });
  });

  test.each(['foreignAdmin', 'otherOrganizer', 'leagueOrganizer', 'stranger', 'captain'] as const)(
    'refuses %s, and writes nothing',
    async (who) => {
      const { s } = await world(['Alpha', 'Bravo']);
      await expect(create(s, undefined, s[who])).rejects.toThrow(/Not allowed/);
      expect(await games(s)).toEqual([]);
      expect((await teamRows(s)).every((team) => team.seed === undefined)).toBe(true);
    },
  );

  test('refuses a signed-out caller, and writes nothing', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    await expect(
      s.t.mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf }),
    ).rejects.toThrow();
    expect(await games(s)).toEqual([]);
  });
});

describe('the bracket in tournamentGames.getSetup', () => {
  test('lists the rounds by name with each game’s teams, byes included', async () => {
    const { s } = await world(NAMES.slice(0, 5));
    await create(s);
    const { bracket } = (await setup(s))!;
    expect(bracket!.hasResult).toBe(false);
    expect(bracket!.rounds.map((round) => [round.round, round.name])).toEqual([
      [1, 'Quarterfinals'],
      [2, 'Semifinals'],
      [3, 'Final'],
    ]);
    const teamNames = (round: number) =>
      bracket!.rounds[round - 1].games.map((game) => game.teams.map((team) => team?.name ?? null));
    expect(teamNames(1)).toEqual([
      ['Alpha', null],
      ['Delta', 'Echo'],
      ['Bravo', null],
      ['Charlie', null],
    ]);
    expect(teamNames(2)).toEqual([
      ['Alpha', null],
      ['Bravo', 'Charlie'],
    ]);
    expect(teamNames(3)).toEqual([[null, null]]);
    expect(bracket!.rounds[0].games[0]).toMatchObject({ slot: 1, winnerTeamId: ANY_ID });
    expect(bracket!.rounds[0].games[1]).toMatchObject({ slot: 2, winnerTeamId: null });
  });

  test('says when a result is entered', async () => {
    const { s } = await world(NAMES.slice(0, 4));
    await create(s);
    await enterResult(s);
    expect((await setup(s))!.bracket!.hasResult).toBe(true);
  });
});

describe('tournaments.getForManagement', () => {
  test('says whether the tournament has a bracket', async () => {
    const { s } = await world(['Alpha', 'Bravo']);
    const read = () => s.as(s.admin).query(api.tournaments.getForManagement, TOURNAMENT_SLUGS);
    expect((await read())!.bracketCreated).toBe(false);
    await create(s);
    expect((await read())!.bracketCreated).toBe(true);
  });
});

describe('after the bracket is created', () => {
  async function created() {
    const { s, teamIds } = await world(['Alpha', 'Bravo']);
    await create(s);
    // A later deadline reopens registration by the clock, so a refusal is the bracket's.
    await s.t.run((ctx) =>
      ctx.db.patch('tournaments', s.gulf, { registrationDeadline: '2030-05-31' }),
    );
    return { s, teamIds };
  }

  const registrationClosed = {
    code: 'registrationClosed',
    message: TEAM_MESSAGES.tournamentBracketCreated,
  };

  test('refuses registration, and writes nothing', async () => {
    const { s } = await created();
    const before = await teamRows(s);
    expect(
      await s
        .as(s.captain)
        .mutation(api.teams.registerForTournament, { ...TOURNAMENT_SLUGS, name: 'Late Lobsters' })
        .catch(refusalOf),
    ).toEqual(registrationClosed);
    expect(await teamRows(s)).toEqual(before);
  });

  test('refuses a waitlist join, and writes nothing', async () => {
    const { s } = await created();
    expect(
      await s
        .as(s.captain)
        .mutation(api.teams.registerForTournamentOrWaitlist, {
          ...TOURNAMENT_SLUGS,
          name: 'Late Lobsters',
        })
        .catch(refusalOf),
    ).toEqual(registrationClosed);
    expect(await s.t.run((ctx) => ctx.db.query('waitlistEntries').collect())).toEqual([]);
  });

  test('refuses promotion from the waitlist, and writes nothing', async () => {
    const { s } = await created();
    const entryId = await s.t.run((ctx) =>
      ctx.db.insert('waitlistEntries', {
        organizationId: s.a,
        tournamentId: s.gulf,
        userId: s.captain.userId,
        teamName: 'Late Lobsters',
        sortName: 'late lobsters',
        status: 'waiting',
        requestedAt: 1,
      }),
    );
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { maximumTeams: 8 }));
    const before = await teamRows(s);
    expect(
      await s
        .as(s.admin)
        .mutation(api.waitlist.promoteForTournament, { waitlistEntryId: entryId })
        .catch(refusalOf),
    ).toEqual({ code: 'bracketCreated', message: TEAM_MESSAGES.promoteBracketCreated });
    expect(await teamRows(s)).toEqual(before);
    expect((await s.t.run((ctx) => ctx.db.get('waitlistEntries', entryId)))!.status).toBe(
      'waiting',
    );
  });

  test('still registers a team in another tournament', async () => {
    const { s } = await created();
    await s.t.run((ctx) =>
      ctx.db.patch('tournaments', s.second, { registrationDeadline: '2030-05-31' }),
    );
    const result = await s.as(s.captain).mutation(api.teams.registerForTournament, {
      ...TOURNAMENT_SLUGS,
      tournamentSlug: 'second-open',
      name: 'Late Lobsters',
    });
    expect(result).toEqual({ teamId: ANY_ID });
  });

  describe('tournaments.updateDetails', () => {
    const update = (s: TournamentWorld, change: Partial<TournamentEditable> = {}) =>
      s.as(s.admin).mutation(api.tournaments.updateDetails, {
        tournamentId: s.gulf,
        ...EXPECTED,
        ...change,
        expected: EXPECTED,
      });

    test('refuses a change of sets per game', async () => {
      const { s } = await created();
      expect(await update(s, { setsPerGame: 3 }).catch(refusalOf)).toEqual({
        field: 'setsPerGame',
        code: 'setsPerGameLocked',
        message: BRACKET_MESSAGES.setsPerGameLocked,
      });
      expect(
        (await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!.setsPerGame,
      ).toBeUndefined();
    });

    test('still saves the other details with the sets per game it holds', async () => {
      const { s } = await created();
      const result = await update(s, { maximumTeams: 6 });
      expect(result.written).toMatchObject({ maximumTeams: 6, setsPerGame: 1 });
    });

    test('refuses an undo that would restore other sets per game', async () => {
      const { s } = await world(['Alpha', 'Bravo']);
      const saved = await s.as(s.admin).mutation(api.tournaments.updateDetails, {
        tournamentId: s.gulf,
        startDate: '2030-06-01',
        endDate: '2030-06-02',
        registrationDeadline: '2030-05-20',
        maximumTeams: 4,
        setsPerGame: 3,
        expected: HELD_AT_START,
      });
      await create(s);
      expect(
        await s
          .as(s.admin)
          .mutation(api.tournaments.undoUpdateDetails, { tournamentId: s.gulf, ...saved })
          .catch(refusalOf),
      ).toEqual({
        field: 'setsPerGame',
        code: 'setsPerGameLocked',
        message: BRACKET_MESSAGES.setsPerGameLocked,
      });
      expect((await s.t.run((ctx) => ctx.db.get('tournaments', s.gulf)))!.setsPerGame).toBe(3);
    });

    test('changes sets per game while no bracket exists', async () => {
      const { s } = await world(['Alpha', 'Bravo']);
      const result = await s.as(s.admin).mutation(api.tournaments.updateDetails, {
        tournamentId: s.gulf,
        startDate: '2030-06-01',
        endDate: '2030-06-02',
        registrationDeadline: '2030-05-20',
        maximumTeams: 4,
        setsPerGame: 3,
        expected: HELD_AT_START,
      });
      expect(result.written.setsPerGame).toBe(3);
    });
  });
});
