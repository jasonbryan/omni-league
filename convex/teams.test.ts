/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { addRosterEntry, removeRosterEntry } from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
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

const SUMMER: NewSeason = {
  name: 'Summer 2030',
  slug: 'summer-2030',
  startDate: '2030-06-01',
  endDate: '2030-08-30',
  registrationDeadline: '2030-05-20',
  playersPerSide: 4,
  minimumRosterSize: 4,
};
const SLUGS = { orgSlug: 'org-a', leagueSlug: 'coed-4s', seasonSlug: 'summer-2030' };
/** 12:00 UTC on the deadline day, well inside registration. */
const OPEN_NOW = Date.parse('2030-05-20T12:00:00Z');

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
          division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
        },
        { name: 'Mens 2s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
        { name: 'Draft 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'], status: 'draft' },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [{ name: 'Coed 4s', sport: 'beachVolleyball', locations: ['B Beach'] }],
    });
    const league = async (organizationId: Id<'organizations'>, slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!;
    const coed = await league(a, 'coed-4s');
    const mens = await league(a, 'mens-2s');
    const draftLeague = await league(a, 'draft-4s');
    const summer = await insertSeason(ctx, coed, SUMMER, 'published');
    const fall = await insertSeason(
      ctx,
      (await ctx.db.get('leagues', coed._id))!,
      { ...SUMMER, name: 'Fall 2030', slug: 'fall-2030' },
      'published',
    );
    await insertSeason(
      ctx,
      (await ctx.db.get('leagues', coed._id))!,
      { ...SUMMER, name: 'Draft Season', slug: 'draft-season' },
      'draft',
    );
    await insertSeason(ctx, mens, { ...SUMMER, slug: 'mens-only' }, 'published');
    await insertSeason(ctx, draftLeague, SUMMER, 'published');
    // Seeded past `seasons.create`'s rules: the deadline is after the start date.
    await insertSeason(
      ctx,
      (await ctx.db.get('leagues', coed._id))!,
      {
        ...SUMMER,
        name: 'Late Deadline',
        slug: 'late-deadline',
        registrationDeadline: '2030-06-10',
      },
      'published',
    );
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
      leagueIds: Id<'leagues'>[] = [],
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: `Name ${authUserId}`,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
      }
      return userId;
    };
    return {
      summer,
      fall,
      captain: await member('captain', null),
      player: await member('player', null),
      rival: await member('rival', null),
      admin: await member('admin-a', a),
      organizer: await member('organizer-coed', a, 'leagueOrganizer', [coed._id]),
      otherOrganizer: await member('organizer-mens', a, 'leagueOrganizer', [mens._id]),
      foreignAdmin: await member('admin-b', b),
      stranger: await member('stranger', null),
    };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const as = (s: Setup, authUserId: string) => s.t.withIdentity(identity(authUserId));

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

async function register(s: Setup, authUserId: string, name: string, slugs = SLUGS) {
  return as(s, authUserId).mutation(api.teams.register, { ...slugs, name });
}

async function rows(s: Setup) {
  return s.t.run(async (ctx) => ({
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
  }));
}

async function expectCountersMatchRecount(s: Setup): Promise<void> {
  await s.t.run(async (ctx) => {
    const teams = await ctx.db.query('teams').collect();
    const entries = await ctx.db.query('rosterEntries').collect();
    for (const team of teams) {
      const rostered = entries.filter((e) => e.teamId === team._id && e.status === 'rostered');
      expect(team.rosterCount).toBe(rostered.length);
    }
    for (const season of await ctx.db.query('seasons').collect()) {
      expect(season.teamCount).toBe(teams.filter((team) => team.seasonId === season._id).length);
    }
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('teams.register', () => {
  test('registers the team with the caller as captain and only roster entry', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const result = await register(s, 'captain', '  Sand   Sharks ');
    expect(result.status).toBe('registered');
    const { teams, entries } = await rows(s);
    expect(teams).toEqual([
      expect.objectContaining({
        _id: result.teamId,
        name: 'Sand Sharks',
        sortName: 'sand sharks',
        seasonId: s.summer,
        captainUserId: s.captain,
        rosterCount: 1,
      }),
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        teamId: result.teamId,
        userId: s.captain,
        status: 'rostered',
        source: 'captain',
      }),
    ]);
    await expectCountersMatchRecount(s);
  });

  test('refuses a name taken in the season ignoring case and repeated spaces, and allows it in another season', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'sand sharks');
    const failure = await register(s, 'rival', 'Sand  Sharks').catch(refusalOf);
    expect(failure).toEqual({
      field: 'name',
      code: 'nameTaken',
      message: 'sand sharks is already registered in this season. Choose another name.',
    });
    expect((await rows(s)).teams).toHaveLength(1);
    await register(s, 'rival', 'Sand  Sharks', { ...SLUGS, seasonSlug: 'fall-2030' });
    expect((await rows(s)).teams.map((team) => team.name)).toEqual(['sand sharks', 'Sand Sharks']);
    await expectCountersMatchRecount(s);
  });

  test.each([
    ['empty', '', 'nameEmpty', 'Enter a team name.'],
    ['whitespace only', ' \t  ', 'nameEmpty', 'Enter a team name.'],
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

  test('accepts a name of exactly 60 characters', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'a'.repeat(60));
    expect((await rows(s)).teams).toHaveLength(1);
  });

  test('an unauthenticated caller is refused and nothing is written', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await expect(
      s.t.mutation(api.teams.register, { ...SLUGS, name: 'Sand Sharks' }),
    ).rejects.toThrow();
    expect(await rows(s)).toEqual({ teams: [], entries: [] });
  });

  test('refuses a caller rostered on another team of the season, naming it, and writes nothing', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'Sand Sharks');
    const before = await rows(s);
    expect(await register(s, 'captain', 'Net Results').catch(refusalOf)).toEqual({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Sand Sharks',
      message: 'Already on Sand Sharks in this season.',
    });
    expect(await rows(s)).toEqual(before);
    await expectCountersMatchRecount(s);
  });

  test('registers a caller whose only entry in the season was removed', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Sharks');
    await s.t.run(async (ctx) => {
      const team = (await ctx.db.get('teams', teamId))!;
      const entryId = await addRosterEntry(ctx, team, {
        userId: s.player,
        source: 'invite',
        addedByUserId: s.captain,
      });
      await removeRosterEntry(ctx, (await ctx.db.get('rosterEntries', entryId))!, s.captain);
    });
    await register(s, 'player', 'Net Results');
    expect((await rows(s)).teams).toHaveLength(2);
    await expectCountersMatchRecount(s);
  });
});

describe('the registration window, with a controlled clock', () => {
  test('is open at 23:59 UTC-12 on the deadline day and closed at 00:00 UTC-12 the next day', async () => {
    const s = await setup();
    vi.useFakeTimers({ now: Date.parse('2030-05-21T11:59:59Z') });
    await register(s, 'captain', 'Sand Sharks');
    vi.setSystemTime(Date.parse('2030-05-21T12:00:00Z'));
    expect(await register(s, 'rival', 'Net Results').catch(refusalOf)).toEqual({
      code: 'registrationClosed',
      message: 'Registration for this season is closed.',
    });
    expect((await rows(s)).teams).toHaveLength(1);
  });

  test('a season whose deadline is after its start date is closed from the start date', async () => {
    const s = await setup();
    const late = { ...SLUGS, seasonSlug: 'late-deadline' };
    vi.useFakeTimers({ now: Date.parse('2030-06-01T11:59:59Z') });
    await register(s, 'captain', 'Sand Sharks', late);
    vi.setSystemTime(Date.parse('2030-06-01T12:00:00Z'));
    expect(await register(s, 'rival', 'Net Results', late).catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
    expect((await rows(s)).teams).toHaveLength(1);
  });
});

describe('a season the register routes cannot use', () => {
  test.each([
    ['an unknown organization slug', { ...SLUGS, orgSlug: 'no-such-org' }],
    ['an unknown league slug', { ...SLUGS, leagueSlug: 'no-such-league' }],
    ['an unknown season slug', { ...SLUGS, seasonSlug: 'no-such-season' }],
    ['a season slug of another league', { ...SLUGS, seasonSlug: 'mens-only' }],
    ['a draft season', { ...SLUGS, seasonSlug: 'draft-season' }],
    ['a published season of a draft league', { ...SLUGS, leagueSlug: 'draft-4s' }],
    ['a malformed slug', { ...SLUGS, seasonSlug: 'Not A Slug' }],
  ])(
    '%s: getForRegistration is null and register is refused with nothing written',
    async (_label, slugs) => {
      vi.useFakeTimers({ now: OPEN_NOW });
      const s = await setup();
      expect(await as(s, 'captain').query(api.seasons.getForRegistration, slugs)).toBeNull();
      expect(await s.t.query(api.seasons.getForRegistration, slugs)).toBeNull();
      expect(await register(s, 'captain', 'Sand Sharks', slugs).catch(refusalOf)).toEqual({
        code: 'seasonNotFound',
      });
      expect(await rows(s)).toEqual({ teams: [], entries: [] });
    },
  );
});

describe('seasons.getForRegistration', () => {
  const SEASON_FIELDS = {
    organizationName: 'Org A',
    leagueName: 'Coed 4s',
    seasonName: 'Summer 2030',
    startDate: '2030-06-01',
    endDate: '2030-08-30',
    registrationDeadline: '2030-05-20',
    formatName: '4v4',
    minimumRosterSize: 4,
  };

  test('an unauthenticated caller gets the season with no team', async () => {
    const s = await setup();
    expect(await s.t.query(api.seasons.getForRegistration, SLUGS)).toEqual({
      ...SEASON_FIELDS,
      team: null,
    });
  });

  test('a signed-in caller gets their rostered team in the season, and no season id', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Sharks');
    await s.t.run(async (ctx) => {
      await addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.player,
        source: 'invite',
        addedByUserId: s.captain,
      });
    });
    const forCaptain = await as(s, 'captain').query(api.seasons.getForRegistration, SLUGS);
    expect(forCaptain).toEqual({
      ...SEASON_FIELDS,
      team: { teamId, name: 'Sand Sharks', isCaptain: true },
    });
    expect(JSON.stringify(forCaptain)).not.toContain(s.summer);
    expect(await as(s, 'player').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      team: { teamId, name: 'Sand Sharks', isCaptain: false },
    });
    expect(await as(s, 'rival').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      team: null,
    });
    expect(
      await as(s, 'captain').query(api.seasons.getForRegistration, {
        ...SLUGS,
        seasonSlug: 'fall-2030',
      }),
    ).toMatchObject({ team: null });
  });

  test('a removed entry is no team', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Sharks');
    await s.t.run(async (ctx) => {
      const entryId = await addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.player,
        source: 'invite',
        addedByUserId: s.captain,
      });
      await removeRosterEntry(ctx, (await ctx.db.get('rosterEntries', entryId))!, s.captain);
    });
    expect(await as(s, 'player').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      team: null,
    });
  });
});

describe('teams.getForMember', () => {
  async function withTeam() {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Sharks');
    await register(s, 'rival', 'Net Results');
    await s.t.run(async (ctx) => {
      await addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.player,
        source: 'invite',
        addedByUserId: s.captain,
      });
    });
    return { s, teamId };
  }

  test('the captain gets the team with its roster, captain first', async () => {
    const { s, teamId } = await withTeam();
    const team = await as(s, 'captain').query(api.teams.getForMember, { teamId });
    const entryOf = (userId: string) =>
      s.t.run(async (ctx) =>
        (await ctx.db.query('rosterEntries').collect()).find((entry) => entry.userId === userId),
      );
    const [captainEntry, playerEntry] = [await entryOf(s.captain), await entryOf(s.player)];
    expect(team).toEqual({
      name: 'Sand Sharks',
      organization: { name: 'Org A', slug: 'org-a' },
      league: { name: 'Coed 4s', slug: 'coed-4s' },
      season: { name: 'Summer 2030', slug: 'summer-2030' },
      minimumRosterSize: 4,
      rosterCount: 2,
      roster: [
        {
          rosterEntryId: captainEntry?._id,
          name: 'Name captain',
          isCaptain: true,
          isViewer: true,
        },
        {
          rosterEntryId: playerEntry?._id,
          name: 'Name player',
          isCaptain: false,
          isViewer: false,
        },
      ],
      viewerIsCaptain: true,
    });
    expect(JSON.stringify(team)).not.toContain('@');
  });

  test.each([
    ['a rostered player of the team', 'player', false],
    ['an org admin of the organization', 'admin-a', false],
    ['an organizer of the league', 'organizer-coed', false],
  ])('%s is allowed', async (_label, caller, isCaptain) => {
    const { s, teamId } = await withTeam();
    expect(await as(s, caller).query(api.teams.getForMember, { teamId })).toMatchObject({
      name: 'Sand Sharks',
      viewerIsCaptain: isCaptain,
    });
  });

  test.each([
    ['a rostered player of another team in the season', 'rival'],
    ['a league organizer of another league in the organization', 'organizer-mens'],
    ['an org admin of another organization', 'admin-b'],
    ['a signed-in user with no part in it', 'stranger'],
  ])('%s is refused with FORBIDDEN', async (_label, caller) => {
    const { s, teamId } = await withTeam();
    const failure = await as(s, caller).query(api.teams.getForMember, { teamId }).catch(refusalOf);
    expect(failure).toEqual({ code: FORBIDDEN_CODE });
  });

  test('an unauthenticated caller is refused with FORBIDDEN', async () => {
    const { s, teamId } = await withTeam();
    const failure = await s.t.query(api.teams.getForMember, { teamId }).catch(refusalOf);
    expect(failure).toEqual({ code: FORBIDDEN_CODE });
  });

  test('a removed player is refused', async () => {
    const { s, teamId } = await withTeam();
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.query('rosterEntries').collect()).find(
        (e) => e.userId === s.player,
      )!;
      await removeRosterEntry(ctx, entry, s.captain);
    });
    const failure = await as(s, 'player')
      .query(api.teams.getForMember, { teamId })
      .catch(refusalOf);
    expect(failure).toEqual({ code: FORBIDDEN_CODE });
    expect(await as(s, 'captain').query(api.teams.getForMember, { teamId })).toMatchObject({
      rosterCount: 1,
      roster: [expect.objectContaining({ name: 'Name captain' })],
    });
  });

  test('lists the captain first, then the other players in the order they joined', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await register(s, 'captain', 'Sand Sharks');
    await s.t.run(async (ctx) => {
      for (const userId of [s.stranger, s.player, s.organizer]) {
        await addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
          userId,
          source: 'invite',
          addedByUserId: s.captain,
        });
      }
      // The last player to join becomes captain, so the captain is not first in join order.
      await ctx.db.patch('teams', teamId, { captainUserId: s.organizer });
    });
    const team = await as(s, 'player').query(api.teams.getForMember, { teamId });
    expect(team?.roster.map((row) => [row.name, row.isCaptain])).toEqual([
      ['Name organizer-coed', true],
      ['Name captain', false],
      ['Name stranger', false],
      ['Name player', false],
    ]);
  });

  test('an unknown id and a malformed id each answer null', async () => {
    const { s, teamId } = await withTeam();
    await s.t.run(async (ctx) => {
      await ctx.db.delete('teams', teamId);
    });
    expect(await as(s, 'captain').query(api.teams.getForMember, { teamId })).toBeNull();
    expect(
      await as(s, 'captain').query(api.teams.getForMember, { teamId: 'not-an-id' }),
    ).toBeNull();
    expect(await s.t.query(api.teams.getForMember, { teamId: 'not-an-id' })).toBeNull();
  });
});

describe('two registrations at once', () => {
  test('one caller submitting two names at once gets one team, and the other submit is refused', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const results = await Promise.allSettled([
      register(s, 'captain', 'Sand Sharks'),
      register(s, 'captain', 'Net Results'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refusalOf(refused?.reason)).toMatchObject({ code: 'alreadyOnAnotherTeam' });
    const { teams, entries } = await rows(s);
    expect(teams).toHaveLength(1);
    expect(entries).toHaveLength(1);
    await expectCountersMatchRecount(s);
  });

  test('two callers submitting the same name at once get one team', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const results = await Promise.allSettled([
      register(s, 'captain', 'Sand Sharks'),
      register(s, 'rival', 'sand  sharks'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refusalOf(refused?.reason)).toMatchObject({ field: 'name', code: 'nameTaken' });
    expect((await rows(s)).teams).toHaveLength(1);
    await expectCountersMatchRecount(s);
  });

  test('the captain submitting the same name again is refused as taken and writes nothing', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'Sand Sharks');
    const before = await rows(s);
    expect(await register(s, 'captain', 'Sand Sharks').catch(refusalOf)).toMatchObject({
      code: 'nameTaken',
    });
    expect(await rows(s)).toEqual(before);
    await expectCountersMatchRecount(s);
  });
});

describe('a refused registration leaves the counters alone', () => {
  test('a closed season, a draft season, and an empty name each leave every counter equal to a recount', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'captain', 'Sand Sharks');
    await register(s, 'rival', '').catch(refusalOf);
    await register(s, 'rival', 'Net Results', { ...SLUGS, seasonSlug: 'draft-season' }).catch(
      refusalOf,
    );
    vi.setSystemTime(Date.parse('2030-05-21T12:00:00Z'));
    await register(s, 'rival', 'Net Results').catch(refusalOf);
    const { teams, entries } = await rows(s);
    expect(teams).toHaveLength(1);
    expect(entries).toHaveLength(1);
    await expectCountersMatchRecount(s);
  });
});
