/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { addRosterEntry, insertTeamWithCaptain } from './lib/rosterWrites';
import {
  defaultDivision,
  insertDraftTournament,
  insertSeason,
  insertTenant,
  publishTournament,
} from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const SLUGS = { orgSlug: 'org-a', tournamentSlug: 'gulf-coast-beach-open' };
/** 12:00 UTC on the deadline day, well inside registration. */
const OPEN_NOW = Date.parse('2030-05-20T12:00:00Z');

const NEW_TOURNAMENT = {
  sport: 'beachVolleyball' as const,
  division: {
    gender: 'coed' as const,
    playersPerSide: 2,
    level: 'open' as const,
    ageGroup: 'adult' as const,
  },
  startDate: '2030-06-01',
  endDate: '2030-06-02',
  registrationDeadline: '2030-05-20',
  maximumTeams: 4,
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Coed 4s',
          sport: 'beachVolleyball',
          locations: ['Alpha Beach'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [],
    });
    const location = async (organizationId: Id<'organizations'>) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
        .first())!._id;
    const tournament = async (
      organizationId: Id<'organizations'>,
      name: string,
      slug: string,
      overrides: Partial<typeof NEW_TOURNAMENT> = {},
      status: 'draft' | 'published' = 'published',
    ) => {
      const id = await insertDraftTournament(ctx, organizationId, {
        ...NEW_TOURNAMENT,
        ...overrides,
        name,
        slug,
        locationIds: [await location(organizationId)],
      });
      if (status === 'published')
        await publishTournament(ctx, (await ctx.db.get('tournaments', id))!);
      return id;
    };
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      organizer?: { programIds: Id<'programs'>[] },
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: `Name ${authUserId}`,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', {
          userId,
          organizationId,
          role: organizer ? 'leagueOrganizer' : 'orgAdmin',
          leagueIds: [],
          ...(organizer && { programIds: organizer.programIds }),
        });
      }
      return userId;
    };
    const league = (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', a).eq('slug', 'coed-4s'),
      )
      .unique())!;
    const season = await insertSeason(
      ctx,
      league,
      {
        name: 'Summer 2030',
        slug: 'summer-2030',
        startDate: '2030-06-01',
        endDate: '2030-08-30',
        registrationDeadline: '2030-05-20',
        playersPerSide: 4,
        minimumRosterSize: 4,
      },
      'published',
    );
    const gulf = await tournament(a, 'Gulf Coast Beach Open', 'gulf-coast-beach-open');
    const tiny = await tournament(a, 'Tiny Open', 'tiny-open', { maximumTeams: 2 });
    const programOf = async (id: Id<'tournaments'>) =>
      (await ctx.db.get('tournaments', id))!.programId;
    return {
      season,
      gulf,
      tiny,
      second: await tournament(a, 'Second Open', 'second-open'),
      draft: await tournament(a, 'Draft Open', 'draft-open', {}, 'draft'),
      pastDeadline: await tournament(a, 'Past Deadline Open', 'past-deadline-open', {
        registrationDeadline: '2030-05-19',
      }),
      lateDeadline: await tournament(a, 'Late Deadline Open', 'late-deadline-open', {
        registrationDeadline: '2030-06-10',
      }),
      otherOrg: await tournament(b, 'Gulf Coast Beach Open', 'gulf-coast-beach-open'),
      captain: await member('captain', null),
      player: await member('player', null),
      rival: await member('rival', null),
      admin: await member('admin-a', a),
      foreignAdmin: await member('admin-b', b),
      stranger: await member('stranger', null),
      assignedOrganizer: await member('organizer-assigned', a, {
        programIds: [await programOf(gulf)],
      }),
      otherOrganizer: await member('organizer-other', a, { programIds: [await programOf(tiny)] }),
      unassignedOrganizer: await member('organizer-none', a, { programIds: [] }),
    };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const as = (s: Setup, authUserId: string) => s.t.withIdentity(identity(authUserId));

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

function register(s: Setup, authUserId: string, name: string, slugs = SLUGS) {
  return as(s, authUserId).mutation(api.teams.registerForTournament, { ...slugs, name });
}

async function rows(s: Setup) {
  return s.t.run(async (ctx) => ({
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
  }));
}

const tournamentRow = (s: Setup, id: Id<'tournaments'>) =>
  s.t.run((ctx) => ctx.db.get('tournaments', id));

async function expectCountersMatchRecount(s: Setup): Promise<void> {
  await s.t.run(async (ctx) => {
    const teams = await ctx.db.query('teams').collect();
    const entries = await ctx.db.query('rosterEntries').collect();
    for (const team of teams) {
      const rostered = entries.filter((e) => e.teamId === team._id && e.status === 'rostered');
      expect(team.rosterCount).toBe(rostered.length);
    }
    for (const tournament of await ctx.db.query('tournaments').collect()) {
      const count = teams.filter((team) => team.tournamentId === tournament._id).length;
      expect(tournament.teamCount ?? 0).toBe(count);
    }
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('teams.registerForTournament', () => {
  test('registers the team in the tournament with the caller as captain and only roster entry', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', '  Sand   Crabs ');
    const { teams, entries } = await rows(s);
    expect(teams).toEqual([
      expect.objectContaining({
        _id: teamId,
        name: 'Sand Crabs',
        sortName: 'sand crabs',
        tournamentId: s.gulf,
        captainUserId: s.captain,
        rosterCount: 1,
      }),
    ]);
    expect(teams[0]).not.toHaveProperty('seasonId');
    expect(teams[0]).not.toHaveProperty('leagueId');
    expect(entries).toEqual([
      expect.objectContaining({
        teamId,
        userId: s.captain,
        tournamentId: s.gulf,
        status: 'rostered',
        source: 'captain',
      }),
    ]);
    expect(entries[0]).not.toHaveProperty('seasonId');
    expect((await tournamentRow(s, s.gulf))?.teamCount).toBe(1);
    await expectCountersMatchRecount(s);
  });

  test('refuses a second registration by a person already on a team in the tournament, with the reason, and writes nothing', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'Sand Crabs');
    const before = await rows(s);
    expect(await register(s, 'captain', 'Net Results').catch(refusalOf)).toEqual({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Sand Crabs',
      message: 'Already on Sand Crabs in this tournament.',
    });
    expect(await rows(s)).toEqual(before);
    expect((await tournamentRow(s, s.gulf))?.teamCount).toBe(1);
  });

  test('refuses a person on a team the captain added, as the one team per person holds for every entry', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Crabs');
    await s.t.run(async (ctx) => {
      await addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.player,
        source: 'invite',
        addedByUserId: s.captain,
      });
    });
    expect(await register(s, 'player', 'Net Results').catch(refusalOf)).toMatchObject({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Sand Crabs',
    });
  });

  test('allows one person a team in each of two tournaments, and one in a season', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'Sand Crabs');
    await register(s, 'captain', 'Sand Crabs', { ...SLUGS, tournamentSlug: 'second-open' });
    await s.t.run(async (ctx) => {
      await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', s.season))!, {
        name: 'Season Crabs',
        captainUserId: s.player,
      });
    });
    await register(s, 'player', 'Beach Boys');
    expect((await rows(s)).teams.filter((team) => team.tournamentId)).toHaveLength(3);
    await expectCountersMatchRecount(s);
  });

  test('refuses a name taken in the tournament ignoring case and spaces, and allows it in another tournament', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'sand crabs');
    expect(await register(s, 'rival', 'Sand  Crabs').catch(refusalOf)).toEqual({
      field: 'name',
      code: 'nameTaken',
      message: 'sand crabs is already registered in this tournament. Choose another name.',
    });
    expect((await rows(s)).teams).toHaveLength(1);
    await register(s, 'rival', 'Sand  Crabs', { ...SLUGS, tournamentSlug: 'second-open' });
    expect((await rows(s)).teams).toHaveLength(2);
    await expectCountersMatchRecount(s);
  });

  test.each([
    ['empty', '', 'nameEmpty', 'Enter a team name.'],
    [
      '61 characters',
      'a'.repeat(61),
      'nameTooLong',
      'Use 60 characters or fewer. This name has 61.',
    ],
  ])('refuses a %s name with the field error', async (_label, name, code, message) => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    expect(await register(s, 'captain', name).catch(refusalOf)).toEqual({
      field: 'name',
      code,
      message,
    });
    expect(await rows(s)).toEqual({ teams: [], entries: [] });
  });

  test('a signed-out caller is refused and nothing is written', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await expect(
      s.t.mutation(api.teams.registerForTournament, { ...SLUGS, name: 'Sand Crabs' }),
    ).rejects.toThrow();
    expect(await rows(s)).toEqual({ teams: [], entries: [] });
    expect((await tournamentRow(s, s.gulf))?.teamCount).toBeUndefined();
  });
});

describe('the published and open rules', () => {
  test.each([
    ['an unknown organization', { ...SLUGS, orgSlug: 'no-such-org' }],
    ['an unknown tournament', { ...SLUGS, tournamentSlug: 'no-such-tournament' }],
    ['a draft tournament', { ...SLUGS, tournamentSlug: 'draft-open' }],
    ['a league slug', { ...SLUGS, tournamentSlug: 'coed-4s' }],
    ['a malformed slug', { ...SLUGS, tournamentSlug: 'Not A Slug' }],
    [
      'another organization’s tournament under this organization',
      { ...SLUGS, orgSlug: 'org-b', tournamentSlug: 'tiny-open' },
    ],
  ])('refuses %s as not found and writes nothing', async (_label, slugs) => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    expect(await register(s, 'captain', 'Sand Crabs', slugs).catch(refusalOf)).toEqual({
      code: 'tournamentNotFound',
    });
    expect(await rows(s)).toEqual({ teams: [], entries: [] });
  });

  test('registers in the organization whose slug the path names when two organizations share a tournament slug', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'Sand Crabs', { ...SLUGS, orgSlug: 'org-b' });
    expect((await rows(s)).teams).toEqual([expect.objectContaining({ tournamentId: s.otherOrg })]);
    expect((await tournamentRow(s, s.gulf))?.teamCount).toBeUndefined();
  });

  test('refuses past the deadline, with the reason, and writes nothing', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    expect(
      await register(s, 'captain', 'Sand Crabs', {
        ...SLUGS,
        tournamentSlug: 'past-deadline-open',
      }).catch(refusalOf),
    ).toEqual({
      code: 'registrationClosed',
      message: 'Registration for this tournament is closed.',
    });
    expect(await rows(s)).toEqual({ teams: [], entries: [] });
  });

  test('is open at the end of the deadline day at UTC-12 and closed after it', async () => {
    const s = await setup();
    vi.useFakeTimers({ now: Date.parse('2030-05-21T11:59:59Z') });
    await register(s, 'captain', 'Sand Crabs');
    vi.setSystemTime(Date.parse('2030-05-21T12:00:00Z'));
    expect(await register(s, 'rival', 'Net Results').catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
    expect((await rows(s)).teams).toHaveLength(1);
  });

  test('a deadline after the start date closes registration at the start', async () => {
    const s = await setup();
    const late = { ...SLUGS, tournamentSlug: 'late-deadline-open' };
    vi.useFakeTimers({ now: Date.parse('2030-06-01T11:59:59Z') });
    await register(s, 'captain', 'Sand Crabs', late);
    vi.setSystemTime(Date.parse('2030-06-01T12:00:00Z'));
    expect(await register(s, 'rival', 'Net Results', late).catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
  });

  test('refuses a full tournament, with the reason, and writes nothing', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const tiny = { ...SLUGS, tournamentSlug: 'tiny-open' };
    await register(s, 'captain', 'One', tiny);
    await register(s, 'rival', 'Two', tiny);
    const before = await rows(s);
    expect(await register(s, 'player', 'Three', tiny).catch(refusalOf)).toEqual({
      code: 'tournamentFull',
      message: 'This tournament is full.',
    });
    expect(await rows(s)).toEqual(before);
    expect((await tournamentRow(s, s.tiny))?.teamCount).toBe(2);
  });

  test('closed wins over full', async () => {
    const s = await setup();
    const tiny = { ...SLUGS, tournamentSlug: 'tiny-open' };
    vi.useFakeTimers({ now: OPEN_NOW });
    await register(s, 'captain', 'One', tiny);
    await register(s, 'rival', 'Two', tiny);
    vi.setSystemTime(Date.parse('2030-05-21T12:00:00Z'));
    expect(await register(s, 'player', 'Three', tiny).catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
  });

  test('a team counts only toward its own tournament’s places', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'One', { ...SLUGS, tournamentSlug: 'tiny-open' });
    expect((await tournamentRow(s, s.second))?.teamCount).toBeUndefined();
    await register(s, 'rival', 'Two', { ...SLUGS, tournamentSlug: 'tiny-open' });
    await expectCountersMatchRecount(s);
  });
});

describe('two registrations at once', () => {
  test('for the last place, exactly one succeeds and the other is refused as full', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const tiny = { ...SLUGS, tournamentSlug: 'tiny-open' };
    await register(s, 'captain', 'One', tiny);
    const results = await Promise.allSettled([
      register(s, 'rival', 'Late One', tiny),
      register(s, 'player', 'Late Two', tiny),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refusalOf(refused?.reason)).toMatchObject({ code: 'tournamentFull' });
    expect((await rows(s)).teams).toHaveLength(2);
    expect((await tournamentRow(s, s.tiny))?.teamCount).toBe(2);
    await expectCountersMatchRecount(s);
  });

  test('one caller submitting two names at once gets one team', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const results = await Promise.allSettled([
      register(s, 'captain', 'Sand Crabs'),
      register(s, 'captain', 'Net Results'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await rows(s)).teams).toHaveLength(1);
    expect((await rows(s)).entries).toHaveLength(1);
    await expectCountersMatchRecount(s);
  });
});

describe('tournaments.getForRegistration', () => {
  const ask = (s: Setup, authUserId: string | null, slugs = SLUGS) =>
    (authUserId ? as(s, authUserId) : s.t).query(api.tournaments.getForRegistration, slugs);

  test('answers a published tournament’s public fields to a signed-out caller, with no team', async () => {
    const s = await setup();
    expect(await ask(s, null)).toEqual({
      organizationName: 'Org A',
      name: 'Gulf Coast Beach Open',
      divisionLabel: 'Coed · 2v2 · Open',
      startDate: '2030-06-01',
      endDate: '2030-06-02',
      registrationDeadline: '2030-05-20',
      minimumRosterSize: 2,
      maximumTeams: 4,
      isFull: false,
      team: null,
      waitlist: null,
    });
  });

  test.each([
    ['a draft', { ...SLUGS, tournamentSlug: 'draft-open' }],
    ['an unknown', { ...SLUGS, tournamentSlug: 'no-such-tournament' }],
    ['another organization’s', { ...SLUGS, orgSlug: 'org-b', tournamentSlug: 'tiny-open' }],
  ])('answers null for %s tournament', async (_label, slugs) => {
    const s = await setup();
    expect(await ask(s, null, slugs)).toBeNull();
    expect(await ask(s, 'captain', slugs)).toBeNull();
  });

  test('returns the caller’s own team and no other', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Crabs');
    await register(s, 'rival', 'Net Results');
    expect((await ask(s, 'captain'))?.team).toEqual({
      teamId,
      name: 'Sand Crabs',
      isCaptain: true,
      rosterCount: 1,
    });
    expect((await ask(s, 'stranger'))?.team).toBeNull();
    expect((await ask(s, null))?.team).toBeNull();
  });

  test('says full at the maximum teams', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const tiny = { ...SLUGS, tournamentSlug: 'tiny-open' };
    await register(s, 'captain', 'One', tiny);
    expect((await ask(s, null, tiny))?.isFull).toBe(false);
    await register(s, 'rival', 'Two', tiny);
    expect((await ask(s, null, tiny))?.isFull).toBe(true);
  });
});

describe('tournaments.getPublicPage', () => {
  test('reports a full tournament, and not a tournament with room', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const tiny = { ...SLUGS, tournamentSlug: 'tiny-open' };
    expect((await s.t.query(api.tournaments.getPublicPage, tiny))?.isFull).toBe(false);
    await register(s, 'captain', 'One', tiny);
    await register(s, 'rival', 'Two', tiny);
    expect((await s.t.query(api.tournaments.getPublicPage, tiny))?.isFull).toBe(true);
    expect((await s.t.query(api.tournaments.getPublicPage, SLUGS))?.isFull).toBe(false);
  });
});

describe('teams.getForMember for a tournament team', () => {
  async function registered() {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Crabs');
    const { teamId: otherTeamId } = await register(s, 'rival', 'Net Results');
    return { s, teamId, otherTeamId };
  }

  test('gives the captain the team with its tournament and no season or league', async () => {
    const { s, teamId } = await registered();
    const team = await as(s, 'captain').query(api.teams.getForMember, { teamId });
    expect(team).toMatchObject({
      name: 'Sand Crabs',
      organization: { name: 'Org A', slug: 'org-a' },
      tournament: { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
      minimumRosterSize: 2,
      rosterCount: 1,
      viewerIsCaptain: true,
      viewerCanManage: true,
      viewerOnTeam: true,
      roster: [expect.objectContaining({ name: 'Name captain', isCaptain: true, isViewer: true })],
    });
    expect(team).toMatchObject({
      season: { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
      league: { name: 'Org A', slug: 'org-a' },
    });
    expect(team).not.toHaveProperty('maxRosterSize');
  });

  test('gives the tournament its sport and sets per game, which a best of 3 changes', async () => {
    const { s, teamId } = await registered();
    const tournament = () =>
      as(s, 'captain')
        .query(api.teams.getForMember, { teamId })
        .then((team) => team?.tournament);
    expect(await tournament()).toEqual({
      name: 'Gulf Coast Beach Open',
      slug: 'gulf-coast-beach-open',
      sport: 'beachVolleyball',
      setsPerGame: 1,
    });
    await s.t.run((ctx) => ctx.db.patch('tournaments', s.gulf, { setsPerGame: 3 }));
    expect(await tournament()).toMatchObject({ setsPerGame: 3 });
  });

  test('gives an admin of the organization the team', async () => {
    const { s, teamId } = await registered();
    expect(await as(s, 'admin-a').query(api.teams.getForMember, { teamId })).toMatchObject({
      name: 'Sand Crabs',
      viewerIsCaptain: false,
      viewerCanManage: true,
      viewerOnTeam: false,
    });
  });

  test('gives an organizer assigned to the tournament the team, and manage rights', async () => {
    const { s, teamId } = await registered();
    expect(
      await as(s, 'organizer-assigned').query(api.teams.getForMember, { teamId }),
    ).toMatchObject({
      name: 'Sand Crabs',
      viewerIsCaptain: false,
      viewerCanManage: true,
      viewerOnTeam: false,
    });
  });

  test('answers an admin of the organization with the stand-in season and league too', async () => {
    const { s, teamId } = await registered();
    expect(await as(s, 'admin-a').query(api.teams.getForMember, { teamId })).toMatchObject({
      season: { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
      league: { name: 'Org A', slug: 'org-a' },
      tournament: { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
    });
  });

  test.each([
    ['a signed-out caller', null],
    ['a stranger', 'stranger'],
    ['an admin of another organization', 'admin-b'],
    ['an organizer assigned to another tournament', 'organizer-other'],
    ['an organizer assigned to no program', 'organizer-none'],
  ])('refuses %s as forbidden', async (_label, authUserId) => {
    const { s, teamId } = await registered();
    const caller = authUserId ? as(s, authUserId) : s.t;
    const failure = await caller.query(api.teams.getForMember, { teamId }).catch(refusalOf);
    expect(failure).toMatchObject({ code: FORBIDDEN_CODE });
    expect((failure as { team?: string }).team).toBe(
      authUserId === null ? undefined : 'tournament',
    );
  });
});

describe('teams.listMine for a tournament team', () => {
  test('lists it with the tournament’s name and dates, and the season fields the previous frontend reads', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Crabs');
    expect(await as(s, 'captain').query(api.teams.listMine, {})).toEqual([
      {
        teamId,
        teamName: 'Sand Crabs',
        tournamentName: 'Gulf Coast Beach Open',
        seasonName: 'Gulf Coast Beach Open',
        leagueName: 'Org A',
        organizationName: 'Org A',
        role: 'captain',
        seasonStartDate: '2030-06-01',
        seasonEndDate: '2030-06-02',
        registrationDeadline: '2030-05-20',
        minimumRosterSize: 2,
        rosterCount: 1,
      },
    ]);
    expect(await as(s, 'stranger').query(api.teams.listMine, {})).toEqual([]);
  });
});

describe('the roster writer keeps a tournament team out of seasons', () => {
  test('a person added to a tournament team is rostered in the tournament, never in a season', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Crabs');
    await s.t.run(async (ctx) => {
      await addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.player,
        source: 'invite',
        addedByUserId: s.captain,
      });
    });
    const { entries } = await rows(s);
    expect(entries.map((entry) => entry.tournamentId)).toEqual([s.gulf, s.gulf]);
    expect(entries.some((entry) => 'seasonId' in entry)).toBe(false);
    await expectCountersMatchRecount(s);
  });
});
