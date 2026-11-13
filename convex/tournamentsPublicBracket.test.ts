/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { TOURNAMENT_SLUGS, tournamentWorld, type TournamentWorld } from './tournamentWorld.setup';

afterEach(() => {
  vi.useRealTimers();
});

/** The day after the Gulf Coast Beach Open's registration deadline, 2030-05-20. */
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

const GAME_INDEX = 'by_tournamentId_and_stage_and_round_and_slot';

let registeredAt = 1_000;

async function worldWithBracket(names: readonly string[]) {
  vi.useFakeTimers({ now: AFTER_DEADLINE });
  const s = await tournamentWorld();
  for (const name of names) await addTeam(s, name);
  if (names.length > 0) {
    await s.as(s.admin).mutation(api.tournamentGames.createBracket, { tournamentId: s.gulf });
  }
  return s;
}

function addTeam(s: TournamentWorld, name: string) {
  registeredAt += 1;
  return s.t.run(async (ctx) => {
    const tournament = (await ctx.db.get('tournaments', s.gulf))!;
    return ctx.db.insert('teams', {
      organizationId: tournament.organizationId,
      tournamentId: s.gulf,
      name,
      sortName: name.toLowerCase(),
      captainUserId: s.captain.userId,
      rosterCount: 2,
      createdAt: registeredAt,
    });
  });
}

const publicPage = (s: TournamentWorld) =>
  s.t.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS);

const bracketOf = async (s: TournamentWorld) => (await publicPage(s))?.bracket;

function gameAt(s: TournamentWorld, round: number, slot: number) {
  return s.t.run(
    async (ctx) =>
      (await ctx.db
        .query('tournamentGames')
        .withIndex(GAME_INDEX, (q) =>
          q.eq('tournamentId', s.gulf).eq('stage', 'bracket').eq('round', round).eq('slot', slot),
        )
        .unique())!,
  );
}

/** Stands in for the result writer: a winner among two teams in a place of the bracket. */
async function settle(
  s: TournamentWorld,
  round: number,
  slot: number,
  teamIds: [Id<'teams'>, Id<'teams'>],
  winner: 0 | 1,
) {
  const game = await gameAt(s, round, slot);
  await s.t.run((ctx) =>
    ctx.db.patch('tournamentGames', game._id, { teamIds, winnerTeamId: teamIds[winner] }),
  );
}

const teamIdOf = (s: TournamentWorld, name: string) =>
  s.t.run(
    async (ctx) => (await ctx.db.query('teams').collect()).find((team) => team.name === name)!._id,
  );

describe('tournaments.getPublicPage bracket', () => {
  test('leaves the bracket out before an organizer creates it', async () => {
    const s = await worldWithBracket([]);
    expect(await publicPage(s)).not.toHaveProperty('bracket');
  });

  test('lists the rounds with their games, seeds, and byes, top to bottom', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    const seeded = (name: string, seed: number) => ({ name, seed });
    expect(await bracketOf(s)).toEqual({
      rounds: [
        {
          name: 'Quarterfinals',
          games: [
            { teams: [seeded('Alpha', 1), null], bye: true },
            { teams: [seeded('Delta', 4), seeded('Echo', 5)], bye: false },
            { teams: [seeded('Bravo', 2), null], bye: true },
            { teams: [seeded('Charlie', 3), null], bye: true },
          ],
        },
        {
          name: 'Semifinals',
          games: [
            { teams: [seeded('Alpha', 1), null], bye: false },
            { teams: [seeded('Bravo', 2), seeded('Charlie', 3)], bye: false },
          ],
        },
        { name: 'Final', games: [{ teams: [null, null], bye: false }] },
      ],
    });
  });

  test('names the winner of a game that has a result, by its place in the game', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    await settle(s, 1, 2, [await teamIdOf(s, 'Delta'), await teamIdOf(s, 'Echo')], 1);
    const bracket = (await bracketOf(s))!;
    expect(bracket.rounds[0].games[1]).toEqual({
      teams: [
        { name: 'Delta', seed: 4 },
        { name: 'Echo', seed: 5 },
      ],
      bye: false,
      winner: 1,
    });
    expect(bracket.rounds[0].games[0]).not.toHaveProperty('winner');
    expect(bracket).not.toHaveProperty('winner');
  });

  test('names the tournament winner once the Final has a result', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo']);
    expect((await bracketOf(s))!.rounds).toHaveLength(1);
    expect(await bracketOf(s)).not.toHaveProperty('winner');
    await settle(s, 1, 1, [await teamIdOf(s, 'Alpha'), await teamIdOf(s, 'Bravo')], 0);
    const bracket = (await bracketOf(s))!;
    expect(bracket.winner).toBe('Alpha');
    expect(bracket.rounds[0].games).toEqual([
      {
        teams: [
          { name: 'Alpha', seed: 1 },
          { name: 'Bravo', seed: 2 },
        ],
        bye: false,
        winner: 0,
      },
    ]);
  });

  test('holds no ids, and gives every caller the same answer', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo', 'Charlie']);
    const bracket = await bracketOf(s);
    expect(bracket).toBeDefined();
    const idsInDatabase = await s.t.run(async (ctx) => [
      ...(await ctx.db.query('teams').collect()).map((team) => team._id),
      ...(await ctx.db.query('tournamentGames').collect()).map((game) => game._id),
      s.gulf,
    ]);
    const keys = new Set<string>();
    const json = JSON.stringify(bracket, (key, value: unknown) => {
      keys.add(key);
      return value;
    });
    for (const id of idsInDatabase) expect(json).not.toContain(id);
    expect([...keys].filter((key) => /id/i.test(key))).toEqual([]);
    for (const caller of [s.as(s.admin), s.as(s.stranger)]) {
      expect(
        (await caller.query(api.tournaments.getPublicPage, TOURNAMENT_SLUGS))?.bracket,
      ).toEqual(bracket);
    }
  });

  test('leaves a place empty when its team is gone', async () => {
    const s = await worldWithBracket(['Alpha', 'Bravo']);
    const bravo = await teamIdOf(s, 'Bravo');
    await s.t.run((ctx) => ctx.db.delete('teams', bravo));
    const bracket = (await bracketOf(s))!;
    expect(bracket.rounds[0].games[0].teams).toEqual([{ name: 'Alpha', seed: 1 }, null]);
  });
});
