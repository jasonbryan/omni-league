/// <reference types="vite/client" />
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { addMinorEntry, addRosterEntry, removeRosterEntry } from './lib/rosterWrites';
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

async function registered() {
  vi.useFakeTimers({ now: OPEN_NOW });
  const s = await tournamentWorld();
  const register = (who: Person, name: string, tournamentSlug?: string) =>
    s.as(who).mutation(api.teams.registerForTournament, {
      ...TOURNAMENT_SLUGS,
      ...(tournamentSlug && { tournamentSlug }),
      name,
    });
  const { teamId } = await register(s.captain, 'Sand Crabs');
  const { teamId: rivalsId } = await register(s.rival, 'Net Results');
  const { teamId: elsewhereId } = await register(s.traveller, 'Elsewhere', 'second-open');
  await s.t.run(async (ctx) => {
    const crabs = (await ctx.db.get('teams', teamId))!;
    await addRosterEntry(ctx, crabs, {
      userId: s.player.userId,
      source: 'invite',
      addedByUserId: s.captain.userId,
    });
    await addMinorEntry(ctx, (await ctx.db.get('teams', teamId))!, {
      guardianUserId: s.guardian.userId,
      minorName: 'Maya Rose',
      source: 'invite',
      addedByUserId: s.captain.userId,
    });
    const rivals = (await ctx.db.get('teams', rivalsId))!;
    await addRosterEntry(ctx, rivals, {
      userId: s.rivalPlayer.userId,
      source: 'invite',
      addedByUserId: s.rival.userId,
    });
  });
  return { s, teamId, rivalsId, elsewhereId };
}

const getForMember = (s: TournamentWorld, who: Person | null, teamId: Id<'teams'>) =>
  (who ? s.as(who) : s.t).query(api.teams.getForMember, { teamId });

const listTeams = (s: TournamentWorld, who: Person | null, teamId: Id<'teams'>) =>
  (who ? s.as(who) : s.t).query(api.teams.listForSeasonMember, { teamId });

const REFUSED = [
  ['a signed-out caller', null],
  ['a stranger on no team', 'stranger'],
  ['a player on a team in another tournament only', 'traveller'],
  ['an admin of another organization', 'foreignAdmin'],
  ['an organizer assigned to another tournament', 'otherOrganizer'],
  ['a league organizer not assigned to the tournament', 'leagueOrganizer'],
] as const;

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

describe('teams.getForMember: other teams in the tournament see a roster', () => {
  test.each([
    ['a captain of another team', 'rival'],
    ['a player on another team', 'rivalPlayer'],
  ] as const)(
    'shows %s the roster, with a minor’s name shortened and no guardian',
    async (_label, who) => {
      const { s, teamId } = await registered();
      const team = await getForMember(s, s[who], teamId);
      expect(team).toMatchObject({
        name: 'Sand Crabs',
        viewerIsCaptain: false,
        viewerCanManage: false,
        viewerOnTeam: false,
        viewerTeamName: 'Net Results',
      });
      expect(team?.roster.map((row) => [row.name, row.minor, row.isViewer])).toEqual([
        ['Name captain', null, false],
        ['Name player', null, false],
        ['Maya R.', null, false],
      ]);
      expect(team?.roster.every((row) => !row.viewerCanRename && !row.viewerCanRemove)).toBe(true);
    },
  );

  test('shows a guardian whose only entry is a minor on another team the roster', async () => {
    const { s, teamId, rivalsId } = await registered();
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.query('rosterEntries').collect()).find(
        (row) => row.userId === s.rivalPlayer.userId,
      )!;
      await removeRosterEntry(ctx, entry, s.rival.userId);
      await addMinorEntry(ctx, (await ctx.db.get('teams', rivalsId))!, {
        guardianUserId: s.rivalPlayer.userId,
        minorName: 'Kid Kline',
        source: 'invite',
        addedByUserId: s.rival.userId,
      });
    });
    expect(await getForMember(s, s.rivalPlayer, teamId)).toMatchObject({
      name: 'Sand Crabs',
      viewerOnTeam: false,
      viewerTeamName: null,
    });
  });

  test('shows the team’s own members their roster in full, and an organizer too', async () => {
    const { s, teamId } = await registered();
    for (const who of [s.player, s.guardian, s.assignedOrganizer]) {
      const team = await getForMember(s, who, teamId);
      expect(team?.roster.find((row) => row.minor)).toMatchObject({
        name: 'Maya Rose',
        minor: { guardianName: 'Name guardian' },
      });
    }
    expect((await getForMember(s, s.player, teamId))?.viewerTeamName).toBe('Sand Crabs');
  });

  test.each(REFUSED)('refuses %s as forbidden', async (_label, who) => {
    const { s, teamId } = await registered();
    const person = who && s[who];
    const failure = await getForMember(s, person, teamId).catch(refusalOf);
    expect(failure).toMatchObject({ code: FORBIDDEN_CODE });
    expect((failure as { team?: string }).team).toBe(person ? 'tournament' : undefined);
  });

  test('refuses a person removed from the other team', async () => {
    const { s, teamId } = await registered();
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.query('rosterEntries').collect()).find(
        (row) => row.userId === s.rivalPlayer.userId,
      )!;
      await removeRosterEntry(ctx, entry, s.rival.userId);
    });
    expect(await getForMember(s, s.rivalPlayer, teamId).catch(refusalOf)).toMatchObject({
      code: FORBIDDEN_CODE,
    });
  });
});

describe('teams.getForMember: who may remove', () => {
  test('marks every row a captain may remove except the captain’s own, and an organizer the same', async () => {
    const { s, teamId } = await registered();
    for (const who of [s.captain, s.assignedOrganizer, s.admin]) {
      const team = await getForMember(s, who, teamId);
      expect(team?.roster.map((row) => [row.name, row.viewerCanRemove])).toEqual([
        ['Name captain', false],
        ['Name player', true],
        ['Maya Rose', true],
      ]);
    }
  });

  test('marks a guardian’s own minor and nothing else for the guardian, and nothing for a player', async () => {
    const { s, teamId } = await registered();
    expect(
      (await getForMember(s, s.guardian, teamId))?.roster.map((row) => row.viewerCanRemove),
    ).toEqual([false, false, true]);
    expect(
      (await getForMember(s, s.player, teamId))?.roster.map((row) => row.viewerCanRemove),
    ).toEqual([false, false, false]);
  });

  test('every row marked removable is one the remove mutation accepts', async () => {
    const { s, teamId } = await registered();
    const team = await getForMember(s, s.captain, teamId);
    for (const row of team?.roster.filter((entry) => entry.viewerCanRemove) ?? []) {
      await s
        .as(s.captain)
        .mutation(api.rosterEntries.remove, { rosterEntryId: row.rosterEntryId });
    }
    expect((await getForMember(s, s.captain, teamId))?.roster.map((row) => row.name)).toEqual([
      'Name captain',
    ]);
  });
});

describe('teams.listForSeasonMember for a tournament team', () => {
  test('lists the tournament’s teams by name to a player on any of them, marking their own', async () => {
    const { s, teamId, rivalsId } = await registered();
    expect(await listTeams(s, s.rivalPlayer, teamId)).toEqual({
      rows: [
        { teamId: rivalsId, name: 'Net Results', isViewerTeam: true },
        { teamId, name: 'Sand Crabs', isViewerTeam: false },
      ],
      total: 2,
    });
    expect((await listTeams(s, s.captain, rivalsId))?.rows).toEqual([
      { teamId: rivalsId, name: 'Net Results', isViewerTeam: false },
      { teamId, name: 'Sand Crabs', isViewerTeam: true },
    ]);
  });

  test('lists them to an assigned organizer with none marked, and leaves out another tournament’s teams', async () => {
    const { s, teamId } = await registered();
    const list = await listTeams(s, s.assignedOrganizer, teamId);
    expect(list?.rows.map((row) => [row.name, row.isViewerTeam])).toEqual([
      ['Net Results', false],
      ['Sand Crabs', false],
    ]);
  });

  test.each(REFUSED)('refuses %s as forbidden', async (_label, who) => {
    const { s, teamId } = await registered();
    expect(await listTeams(s, who && s[who], teamId).catch(refusalOf)).toMatchObject({
      code: FORBIDDEN_CODE,
    });
  });

  test('answers null for an unknown or malformed team id', async () => {
    const { s } = await registered();
    expect(
      await s.as(s.captain).query(api.teams.listForSeasonMember, { teamId: 'nope' }),
    ).toBeNull();
  });
});
