/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
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
        { name: 'Coed 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
        { name: 'Mens 2s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
        { name: 'Draft 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'], status: 'draft' },
      ],
    });
    const league = async (slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) => q.eq('organizationId', a).eq('slug', slug))
        .unique())!;
    const summer = await insertSeason(ctx, await league('coed-4s'), SUMMER, 'published');
    const fall = await insertSeason(
      ctx,
      await league('coed-4s'),
      { ...SUMMER, name: 'Fall 2030', slug: 'fall-2030' },
      'published',
    );
    await insertSeason(
      ctx,
      await league('coed-4s'),
      { ...SUMMER, name: 'Draft Season', slug: 'draft-season' },
      'draft',
    );
    // Seeded past `seasons.create`'s rules: the deadline is after the start date.
    await insertSeason(
      ctx,
      await league('coed-4s'),
      { ...SUMMER, name: 'Late', slug: 'late-deadline', registrationDeadline: '2030-06-10' },
      'published',
    );
    await insertSeason(ctx, await league('mens-2s'), { ...SUMMER, slug: 'mens-only' }, 'published');
    await insertSeason(ctx, await league('draft-4s'), SUMMER, 'published');
    const user = (authUserId: string) =>
      ctx.db.insert('users', { authUserId, name: `Name ${authUserId}`, adultConfirmedAt: 1 });
    return {
      organizationId: a,
      summer,
      fall,
      ana: await user('ana'),
      ben: await user('ben'),
      cy: await user('cy'),
    };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const as = (s: Setup, authUserId: string) => s.t.withIdentity(identity(authUserId));

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

const register = (s: Setup, authUserId: string, slugs = SLUGS) =>
  as(s, authUserId).mutation(api.freeAgents.register, slugs);

async function rows(s: Setup) {
  return s.t.run(async (ctx) => ({
    freeAgents: await ctx.db.query('freeAgents').collect(),
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
  }));
}

async function teamWithCaptain(s: Setup, authUserId: string, name: string) {
  const result = await as(s, authUserId).mutation(api.teams.register, { ...SLUGS, name });
  if (result.status !== 'registered') throw new Error('The team joined the waitlist');
  return result;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('freeAgents.register', () => {
  test('writes one waiting row for the caller, in the stored season and organization', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    expect(await register(s, 'ana')).toEqual({ status: 'waiting', registeredAt: OPEN_NOW });
    expect((await rows(s)).freeAgents).toEqual([
      expect.objectContaining({
        organizationId: s.organizationId,
        seasonId: s.summer,
        userId: s.ana,
        status: 'waiting',
        registeredAt: OPEN_NOW,
      }),
    ]);
    expect(await as(s, 'ana').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      team: null,
      freeAgent: { status: 'waiting', registeredAt: OPEN_NOW },
    });
  });

  test('a second call is refused and one row remains', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'ana');
    expect(await register(s, 'ana').catch(refusalOf)).toEqual({
      code: 'alreadyFreeAgent',
      message: 'Already registered as a free agent in this season.',
    });
    expect((await rows(s)).freeAgents).toHaveLength(1);
  });

  test('another season of the same league takes its own registration', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'ana');
    await register(s, 'ana', { ...SLUGS, seasonSlug: 'fall-2030' });
    expect((await rows(s)).freeAgents.map((row) => row.seasonId)).toEqual([s.summer, s.fall]);
  });

  test('an unauthenticated caller is refused and nothing is written; its answer has no free agent', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await expect(s.t.mutation(api.freeAgents.register, SLUGS)).rejects.toThrow();
    expect((await rows(s)).freeAgents).toEqual([]);
    expect(await s.t.query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      team: null,
      freeAgent: null,
    });
  });

  test('a caller rostered in the season is refused naming the team, and nothing is written', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await teamWithCaptain(s, 'ana', 'Sand Sharks');
    const before = await rows(s);
    expect(await register(s, 'ana').catch(refusalOf)).toEqual({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Sand Sharks',
      message: 'Already on Sand Sharks in this season.',
    });
    expect(await rows(s)).toEqual(before);
  });

  test('a removed entry does not block', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await teamWithCaptain(s, 'ana', 'Sand Sharks');
    await s.t.run(async (ctx) => {
      const entryId = await addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
        userId: s.ben,
        source: 'invite',
        addedByUserId: s.ana,
      });
      await removeRosterEntry(ctx, (await ctx.db.get('rosterEntries', entryId))!, s.ana);
    });
    await register(s, 'ben');
    expect((await rows(s)).freeAgents).toHaveLength(1);
  });

  test('a free agent has no roster entry and changes no team’s roster count', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await teamWithCaptain(s, 'ana', 'Sand Sharks');
    await register(s, 'ben');
    const { entries, teams } = await rows(s);
    expect(entries.map((entry) => entry.userId)).toEqual([s.ana]);
    expect(teams).toEqual([expect.objectContaining({ _id: teamId, rosterCount: 1 })]);
  });

  test('a waiting free agent is refused a team of their own and an invite entry, and nothing is written', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    const { teamId } = await teamWithCaptain(s, 'ana', 'Sand Sharks');
    await register(s, 'ben');
    const before = await rows(s);
    const waiting = {
      code: 'waitingFreeAgent',
      message:
        "You're registered as a free agent in this season. An organizer places free agents on teams.",
    };
    expect(await teamWithCaptain(s, 'ben', 'Net Results').catch(refusalOf)).toEqual(waiting);
    const invite = await s.t
      .run(async (ctx) =>
        addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
          userId: s.ben,
          source: 'invite',
          addedByUserId: s.ana,
        }),
      )
      .catch(refusalOf);
    expect(invite).toEqual(waiting);
    expect(await rows(s)).toEqual(before);
  });
});

describe('freeAgents.register: the registration window, with a controlled clock', () => {
  test('is refused past the deadline', async () => {
    const s = await setup();
    vi.useFakeTimers({ now: Date.parse('2030-05-21T11:59:59Z') });
    await register(s, 'ana');
    vi.setSystemTime(Date.parse('2030-05-21T12:00:00Z'));
    expect(await register(s, 'ben').catch(refusalOf)).toEqual({
      code: 'registrationClosed',
      message: 'Registration for this season is closed.',
    });
    expect((await rows(s)).freeAgents).toHaveLength(1);
  });

  test('is refused from the start date when the deadline is after it', async () => {
    const s = await setup();
    const late = { ...SLUGS, seasonSlug: 'late-deadline' };
    vi.useFakeTimers({ now: Date.parse('2030-06-01T12:00:00Z') });
    expect(await register(s, 'ana', late).catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
    expect((await rows(s)).freeAgents).toEqual([]);
  });
});

describe('freeAgents.register: a season the route cannot use', () => {
  test.each([
    ['an unknown organization slug', { ...SLUGS, orgSlug: 'no-such-org' }],
    ['an unknown league slug', { ...SLUGS, leagueSlug: 'no-such-league' }],
    ['an unknown season slug', { ...SLUGS, seasonSlug: 'no-such-season' }],
    ['a season slug of another league', { ...SLUGS, seasonSlug: 'mens-only' }],
    ['a draft season', { ...SLUGS, seasonSlug: 'draft-season' }],
    ['a published season of a draft league', { ...SLUGS, leagueSlug: 'draft-4s' }],
  ])(
    '%s: getForRegistration is null and register is refused with nothing written',
    async (_label, slugs) => {
      vi.useFakeTimers({ now: OPEN_NOW });
      const s = await setup();
      expect(await as(s, 'ana').query(api.seasons.getForRegistration, slugs)).toBeNull();
      expect(await register(s, 'ana', slugs).catch(refusalOf)).toEqual({ code: 'seasonNotFound' });
      expect((await rows(s)).freeAgents).toEqual([]);
    },
  );
});

describe('seasons.getForRegistration: the free agent', () => {
  test('each caller gets only their own row', async () => {
    vi.useFakeTimers({ now: OPEN_NOW });
    const s = await setup();
    await register(s, 'ana');
    vi.setSystemTime(OPEN_NOW + 1000);
    await register(s, 'ben');
    const forAna = await as(s, 'ana').query(api.seasons.getForRegistration, SLUGS);
    const forBen = await as(s, 'ben').query(api.seasons.getForRegistration, SLUGS);
    const forCy = await as(s, 'cy').query(api.seasons.getForRegistration, SLUGS);
    expect(forAna?.freeAgent).toEqual({ status: 'waiting', registeredAt: OPEN_NOW });
    expect(forBen?.freeAgent).toEqual({ status: 'waiting', registeredAt: OPEN_NOW + 1000 });
    expect(forCy?.freeAgent).toBeNull();
    for (const answer of [forAna, forBen]) {
      for (const id of [s.ana, s.ben, s.summer] as Id<'users' | 'seasons'>[]) {
        expect(JSON.stringify(answer)).not.toContain(id);
      }
    }
    expect(
      await as(s, 'ana').query(api.seasons.getForRegistration, {
        ...SLUGS,
        seasonSlug: 'fall-2030',
      }),
    ).toMatchObject({ freeAgent: null });
  });
});
