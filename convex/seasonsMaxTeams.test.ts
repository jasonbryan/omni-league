/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertTeamWithCaptain } from './lib/rosterWrites';
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
const OPEN_NOW = Date.parse('2030-05-20T12:00:00Z');
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');
const FULL = { code: 'seasonFull', message: 'This season is full.' };

async function setup({
  maxTeams = 2,
  teams = 2,
}: { maxTeams?: number | null; teams?: number } = {}) {
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
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [{ name: 'Coed 4s', sport: 'beachVolleyball', locations: ['B Beach'] }],
    });
    const league = async (slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) => q.eq('organizationId', a).eq('slug', slug))
        .unique())!;
    const coed = await league('coed-4s');
    const mens = await league('mens-2s');
    const seasonId = await insertSeason(
      ctx,
      coed,
      maxTeams === null ? SUMMER : { ...SUMMER, maxTeams },
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
    const captains = [await member('captain-1', null), await member('captain-2', null)];
    for (const [index, captainUserId] of captains.slice(0, teams).entries()) {
      const season = (await ctx.db.get('seasons', seasonId))!;
      await insertTeamWithCaptain(ctx, season, { name: `Team ${index + 1}`, captainUserId });
    }
    await member('admin-a', a);
    await member('organizer-coed', a, 'leagueOrganizer', [coed._id]);
    await member('organizer-mens', a, 'leagueOrganizer', [mens._id]);
    await member('admin-b', b);
    await member('stranger', null);
    await member('newcomer', null);
    return { seasonId, coedId: coed._id };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const as = (s: Setup, authUserId: string) => s.t.withIdentity(identity(authUserId));

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

async function register(s: Setup, authUserId: string, name: string) {
  return as(s, authUserId).mutation(api.teams.register, { ...SLUGS, name });
}

async function rows(s: Setup) {
  return s.t.run(async (ctx) => ({
    seasons: await ctx.db.query('seasons').collect(),
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
  }));
}

const season = (s: Setup) => s.t.run((ctx) => ctx.db.get('seasons', s.seasonId));

afterEach(() => {
  vi.useRealTimers();
});

describe('seasons.create: maximum teams', () => {
  const create = (s: Setup, maxTeams?: number) =>
    as(s, 'admin-a').mutation(api.seasons.create, {
      leagueId: s.coedId,
      name: 'Fall 2030',
      slug: 'fall-2030',
      startDate: '2030-09-01',
      endDate: '2030-11-15',
      registrationDeadline: '2030-08-25',
      ...(maxTeams !== undefined && { maxTeams }),
    });

  test('stores 8, and no limit when left out', async () => {
    const s = await setup();
    const eight = await create(s, 8);
    expect((await s.t.run((ctx) => ctx.db.get('seasons', eight.seasonId)))?.maxTeams).toBe(8);
    await s.t.run((ctx) => ctx.db.delete('seasons', eight.seasonId));
    const blank = await create(s);
    expect(await s.t.run((ctx) => ctx.db.get('seasons', blank.seasonId))).not.toHaveProperty(
      'maxTeams',
    );
  });

  test.each([1, 201, 7.5])(
    'refuses %s with the field error, and creates nothing',
    async (value) => {
      const s = await setup();
      const before = await rows(s);
      expect(await create(s, value).catch(refusalOf)).toEqual({
        field: 'maxTeams',
        code: 'maxTeamsInvalid',
        message: 'Enter a whole number from 2 to 200, or leave it blank.',
      });
      expect(await rows(s)).toEqual(before);
    },
  );
});

describe('teams.register in a full season', () => {
  test('a season at its maximum refuses another team and writes nothing', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const before = await rows(s);
    expect(await register(s, 'newcomer', 'Third Team').catch(refusalOf)).toEqual(FULL);
    expect(await rows(s)).toEqual(before);
  });

  test('a free agent can still register in a full season', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await as(s, 'newcomer').mutation(api.freeAgents.register, SLUGS);
    const { freeAgents, teams } = await s.t.run(async (ctx) => ({
      freeAgents: await ctx.db.query('freeAgents').collect(),
      teams: await ctx.db.query('teams').collect(),
    }));
    expect(freeAgents).toHaveLength(1);
    expect(teams).toHaveLength(2);
    expect((await season(s))?.teamCount).toBe(2);
  });

  test('a season with no limit takes a third team', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup({ maxTeams: null });
    await register(s, 'newcomer', 'Third Team');
    expect((await season(s))?.teamCount).toBe(3);
  });

  test('closed wins over full', async () => {
    vi.useFakeTimers({ now: AFTER_DEADLINE });
    const s = await setup();
    expect(await register(s, 'newcomer', 'Third Team').catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
  });

  test('two registrations at once for the last place get one team', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup({ teams: 1 });
    const results = await Promise.allSettled([
      register(s, 'newcomer', 'Late One'),
      register(s, 'stranger', 'Late Two'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refusalOf(refused?.reason)).toEqual(FULL);
    expect((await rows(s)).teams).toHaveLength(2);
    expect((await season(s))?.teamCount).toBe(2);
  });
});

describe('seasons.setMaxTeams', () => {
  const setMax = (s: Setup, maxTeams: number | null, authUserId = 'organizer-coed') =>
    as(s, authUserId).mutation(api.seasons.setMaxTeams, { seasonId: s.seasonId, maxTeams });

  test('raising a full season to 3 lets a third team register', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await expect(setMax(s, 3)).resolves.toBeNull();
    expect((await season(s))?.maxTeams).toBe(3);
    await register(s, 'newcomer', 'Third Team');
    expect((await season(s))?.teamCount).toBe(3);
  });

  test('lowering below the registered teams is refused and changes nothing', async () => {
    const s = await setup();
    const before = await rows(s);
    expect(await setMax(s, 1).catch(refusalOf)).toMatchObject({
      field: 'maxTeams',
      code: 'maxTeamsInvalid',
    });
    expect(await rows(s)).toEqual(before);
    await setMax(s, 3);
    await s.t.run(async (ctx) => {
      const current = (await ctx.db.get('seasons', s.seasonId))!;
      await insertTeamWithCaptain(ctx, current, {
        name: 'Team 3',
        captainUserId: (await ctx.db.query('users').collect()).find(
          (user) => user.authUserId === 'newcomer',
        )!._id,
      });
    });
    const three = await rows(s);
    expect(await setMax(s, 2).catch(refusalOf)).toEqual({
      field: 'maxTeams',
      code: 'maxTeamsBelowCount',
      message: '3 teams are already registered. Enter 3 or more, or leave it blank.',
    });
    expect(await rows(s)).toEqual(three);
  });

  test('null removes the limit', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await setMax(s, null);
    expect(await season(s)).not.toHaveProperty('maxTeams');
    await register(s, 'newcomer', 'Third Team');
  });

  test.each([1, 201, 2.5])('refuses %s as out of range', async (value) => {
    const s = await setup({ teams: 0 });
    expect(await setMax(s, value).catch(refusalOf)).toMatchObject({ code: 'maxTeamsInvalid' });
    expect((await season(s))?.maxTeams).toBe(2);
  });

  test('works on a draft season', async () => {
    const s = await setup({ teams: 0 });
    await s.t.run((ctx) => ctx.db.patch('seasons', s.seasonId, { status: 'draft' }));
    await setMax(s, 12);
    expect((await season(s))?.maxTeams).toBe(12);
  });

  test('an org admin of the organization may set it', async () => {
    const s = await setup();
    await setMax(s, 5, 'admin-a');
    expect((await season(s))?.maxTeams).toBe(5);
  });

  test.each([
    ['an organizer of another league', 'organizer-mens', 'Not allowed'],
    ['an org admin of another organization', 'admin-b', 'Not allowed'],
    ['a captain in the season', 'captain-1', 'Not allowed'],
    ['a non-member', 'stranger', 'Not allowed'],
  ])('refuses %s and changes nothing', async (_label, authUserId, message) => {
    const s = await setup();
    const before = await rows(s);
    await expect(setMax(s, 10, authUserId)).rejects.toThrow(message);
    expect(await rows(s)).toEqual(before);
  });

  test('refuses an unauthenticated caller and changes nothing', async () => {
    const s = await setup();
    const before = await rows(s);
    await expect(
      s.t.mutation(api.seasons.setMaxTeams, { seasonId: s.seasonId, maxTeams: 10 }),
    ).rejects.toThrow('Sign in required');
    expect(await rows(s)).toEqual(before);
  });

  test('refuses an unknown season id and changes nothing', async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.delete('seasons', s.seasonId));
    const before = await rows(s);
    await expect(setMax(s, 10)).rejects.toThrow('Not allowed');
    expect(await rows(s)).toEqual(before);
  });
});

describe('isFull and maxTeams on the season queries', () => {
  test('a full season answers isFull on the public page, the register query, and the organizer view', async () => {
    const s = await setup();
    expect(await s.t.query(api.seasons.getPublicPage, SLUGS)).toMatchObject({
      isFull: true,
      maxTeams: 2,
    });
    expect(await s.t.query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      isFull: true,
      maxTeams: 2,
    });
    expect(await as(s, 'organizer-coed').query(api.seasons.getOrganizerView, SLUGS)).toMatchObject({
      teamCount: 2,
      maxTeams: 2,
    });
  });

  test('a season with room or no limit is not full, and no limit has no maxTeams', async () => {
    const room = await setup({ teams: 1 });
    expect(await room.t.query(api.seasons.getPublicPage, SLUGS)).toMatchObject({ isFull: false });
    const none = await setup({ maxTeams: null });
    const page = await none.t.query(api.seasons.getPublicPage, SLUGS);
    expect(page).toMatchObject({ isFull: false });
    expect(page).not.toHaveProperty('maxTeams');
    expect(
      await as(none, 'organizer-coed').query(api.seasons.getOrganizerView, SLUGS),
    ).not.toHaveProperty('maxTeams');
  });
});
