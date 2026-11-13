/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MAX_MINORS_PER_GUARDIAN_IN_SEASON } from './lib/minorName';
import { addMinorEntry, addRosterEntry } from './lib/rosterWrites';
import {
  NOT_MANAGERS,
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

async function registered() {
  vi.useFakeTimers({ now: OPEN_NOW });
  const s = await tournamentWorld();
  const { teamId } = await s
    .as(s.captain)
    .mutation(api.teams.registerForTournament, { ...TOURNAMENT_SLUGS, name: 'Sand Crabs' });
  const { teamId: rivalsId } = await s
    .as(s.rival)
    .mutation(api.teams.registerForTournament, { ...TOURNAMENT_SLUGS, name: 'Net Results' });
  const entries = await s.t.run(async (ctx) => {
    const team = (await ctx.db.get('teams', teamId))!;
    const playerEntry = await addRosterEntry(ctx, team, {
      userId: s.player.userId,
      source: 'invite',
      addedByUserId: s.captain.userId,
    });
    const minorEntry = await addMinorEntry(ctx, (await ctx.db.get('teams', teamId))!, {
      guardianUserId: s.guardian.userId,
      minorName: 'Maya R.',
      source: 'invite',
      addedByUserId: s.captain.userId,
    });
    return { playerEntry, minorEntry };
  });
  return { s, teamId, rivalsId, ...entries };
}

const entryRow = (s: TournamentWorld, id: Id<'rosterEntries'>) =>
  s.t.run((ctx) => ctx.db.get('rosterEntries', id));

const teamRow = (s: TournamentWorld, id: Id<'teams'>) => s.t.run((ctx) => ctx.db.get('teams', id));

const allEntries = (s: TournamentWorld) =>
  s.t.run((ctx) => ctx.db.query('rosterEntries').collect());

const remove = (s: TournamentWorld, who: Person, rosterEntryId: Id<'rosterEntries'>) =>
  s.as(who).mutation(api.rosterEntries.remove, { rosterEntryId });

const addMinor = (s: TournamentWorld, who: Person, teamId: Id<'teams'>, minorName: string) =>
  s.as(who).mutation(api.rosterEntries.addMinor, { teamId, minorName });

describe('rosterEntries.remove for a tournament team', () => {
  test.each([
    ['the captain', 'captain'],
    ['an organizer assigned to the tournament', 'assignedOrganizer'],
    ['an admin of the organization', 'admin'],
  ] as const)('%s removes a player, keeping the row as removed', async (_label, who) => {
    const { s, teamId, playerEntry } = await registered();
    await remove(s, s[who], playerEntry);
    expect(await entryRow(s, playerEntry)).toMatchObject({
      status: 'removed',
      removedByUserId: s[who].userId,
    });
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 2 });
  });

  test('lets the player be invited to another team in the tournament after the removal', async () => {
    const { s, rivalsId, playerEntry } = await registered();
    await remove(s, s.captain, playerEntry);
    await s.t.run(async (ctx) =>
      addRosterEntry(ctx, (await ctx.db.get('teams', rivalsId))!, {
        userId: s.player.userId,
        source: 'invite',
        addedByUserId: s.rival.userId,
      }),
    );
    expect(await teamRow(s, rivalsId)).toMatchObject({ rosterCount: 2 });
  });

  test('lets the guardian remove their own minor, and an organizer remove any minor', async () => {
    const { s, minorEntry } = await registered();
    await remove(s, s.guardian, minorEntry);
    expect(await entryRow(s, minorEntry)).toMatchObject({ status: 'removed' });
    const other = await s.t.run(async (ctx) => {
      const team = (await ctx.db.query('teams').first())!;
      return addMinorEntry(ctx, team, {
        guardianUserId: s.guardian.userId,
        minorName: 'Kid K.',
        source: 'guardian',
        addedByUserId: s.guardian.userId,
      });
    });
    await remove(s, s.assignedOrganizer, other);
    expect(await entryRow(s, other)).toMatchObject({ status: 'removed' });
  });

  test.each([...NOT_MANAGERS, 'player'] as const)(
    'refuses %s, and the entry stays rostered',
    async (who) => {
      const { s, playerEntry } = await registered();
      const before = await allEntries(s);
      await expect(remove(s, s[who], playerEntry)).rejects.toThrow(/Not allowed/);
      expect(await allEntries(s)).toEqual(before);
    },
  );

  test('refuses another person’s minor to a guardian, and a signed-out caller', async () => {
    const { s, minorEntry } = await registered();
    await expect(remove(s, s.stranger, minorEntry)).rejects.toThrow(/Not allowed/);
    await expect(
      s.t.mutation(api.rosterEntries.remove, { rosterEntryId: minorEntry }),
    ).rejects.toThrow();
    expect(await entryRow(s, minorEntry)).toMatchObject({ status: 'rostered' });
  });

  test('refuses removing the captain, and an entry already removed', async () => {
    const { s, playerEntry } = await registered();
    const captainEntry = (await allEntries(s)).find((row) => row.userId === s.captain.userId)!._id;
    expect(await remove(s, s.admin, captainEntry).catch(refusalOf)).toMatchObject({
      code: 'captainRequired',
    });
    await remove(s, s.captain, playerEntry);
    expect(await remove(s, s.captain, playerEntry).catch(refusalOf)).toMatchObject({
      code: 'notRostered',
    });
  });
});

describe('rosterEntries.addMinor for a tournament team', () => {
  test.each([
    ['a player', 'player'],
    ['the captain', 'captain'],
    ['a guardian with only a minor on the team', 'guardian'],
  ] as const)('%s adds a minor under their own entry', async (_label, who) => {
    const { s, teamId } = await registered();
    const result = await addMinor(s, s[who], teamId, '  Kai   L. ');
    expect(result.minorName).toBe('Kai L.');
    const entry = await entryRow(s, result.rosterEntryId);
    expect(entry).toMatchObject({
      teamId,
      tournamentId: s.gulf,
      userId: s[who].userId,
      minorName: 'Kai L.',
      status: 'rostered',
      source: 'guardian',
      addedByUserId: s[who].userId,
    });
    expect(entry).not.toHaveProperty('seasonId');
    expect(await teamRow(s, teamId)).toMatchObject({ rosterCount: 4 });
  });

  test.each([
    ['a stranger', 'stranger'],
    ['a captain of another team', 'rival'],
    ['an admin of the organization', 'admin'],
  ] as const)('refuses %s, and writes nothing', async (_label, who) => {
    const { s, teamId } = await registered();
    const before = await allEntries(s);
    await expect(addMinor(s, s[who], teamId, 'Kai L.')).rejects.toThrow(/Not allowed/);
    expect(await allEntries(s)).toEqual(before);
  });

  test('refuses a signed-out caller', async () => {
    const { s, teamId } = await registered();
    await expect(
      s.t.mutation(api.rosterEntries.addMinor, { teamId, minorName: 'Kai L.' }),
    ).rejects.toThrow();
  });

  test('refuses a minor with the same name under the guardian, in the tournament’s words', async () => {
    const { s, teamId } = await registered();
    expect(await addMinor(s, s.guardian, teamId, 'maya  r.').catch(refusalOf)).toEqual({
      field: 'minorName',
      code: 'minorInSeason',
      minorName: 'Maya R.',
      teamName: 'Sand Crabs',
      inTournament: true,
      message: 'Maya R. is already on Sand Crabs in this tournament.',
    });
  });

  test('allows the same minor name in another tournament', async () => {
    const { s } = await registered();
    const { teamId: otherTeam } = await s.as(s.guardian).mutation(api.teams.registerForTournament, {
      ...TOURNAMENT_SLUGS,
      tournamentSlug: 'second-open',
      name: 'Guardian Gang',
    });
    await expect(addMinor(s, s.guardian, otherTeam, 'Maya R.')).resolves.toMatchObject({
      minorName: 'Maya R.',
    });
  });

  test('refuses a twenty-first minor under one guardian, removed ones included, in the tournament’s words', async () => {
    const { s, teamId } = await registered();
    for (let index = 1; index < MAX_MINORS_PER_GUARDIAN_IN_SEASON; index++) {
      await addMinor(s, s.guardian, teamId, `Kid ${index}`);
    }
    const first = (await allEntries(s)).find((row) => row.minorName === 'Kid 1')!;
    await remove(s, s.guardian, first._id);
    expect(await addMinor(s, s.guardian, teamId, 'One More').catch(refusalOf)).toEqual({
      field: 'minorName',
      code: 'minorLimit',
      message:
        'You’ve added 20 minors in this tournament, removed ones included, which is the most one guardian can add.',
    });
  });
});

describe('rosterEntries.renameMinor for a tournament team', () => {
  const rename = (
    s: TournamentWorld,
    who: Person,
    rosterEntryId: Id<'rosterEntries'>,
    minorName: string,
  ) => s.as(who).mutation(api.rosterEntries.renameMinor, { rosterEntryId, minorName });

  test.each([
    ['the guardian', 'guardian'],
    ['an organizer assigned to the tournament', 'assignedOrganizer'],
    ['an admin of the organization', 'admin'],
  ] as const)('%s renames a minor', async (_label, who) => {
    const { s, minorEntry } = await registered();
    expect(await rename(s, s[who], minorEntry, ' Maya  Rose ')).toEqual({ minorName: 'Maya Rose' });
    expect(await entryRow(s, minorEntry)).toMatchObject({ minorName: 'Maya Rose' });
  });

  test.each([...NOT_MANAGERS, 'captain', 'player'] as const)(
    'refuses %s, and the name stays',
    async (who) => {
      const { s, minorEntry } = await registered();
      await expect(rename(s, s[who], minorEntry, 'Other Name')).rejects.toThrow(/Not allowed/);
      expect(await entryRow(s, minorEntry)).toMatchObject({ minorName: 'Maya R.' });
    },
  );

  test('refuses a name another minor of the guardian already has in the tournament', async () => {
    const { s, teamId, minorEntry } = await registered();
    await addMinor(s, s.guardian, teamId, 'Kai L.');
    expect(await rename(s, s.guardian, minorEntry, 'kai l.').catch(refusalOf)).toMatchObject({
      field: 'minorName',
      code: 'minorInSeason',
      inTournament: true,
    });
    expect(await entryRow(s, minorEntry)).toMatchObject({ minorName: 'Maya R.' });
  });

  test('refuses a signed-out caller', async () => {
    const { s, minorEntry } = await registered();
    await expect(
      s.t.mutation(api.rosterEntries.renameMinor, { rosterEntryId: minorEntry, minorName: 'X Y' }),
    ).rejects.toThrow();
  });
});
