/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { ORGANIZER_FREE_AGENTS_LIMIT } from './freeAgents';
import { FORBIDDEN_CODE } from './lib/forbidden';
import {
  addRosterEntry,
  insertFreeAgent,
  insertPlacedFreeAgent,
  insertTeamInvite,
  insertTeamWithCaptain,
} from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import { ORGANIZER_TEAMS_LIMIT } from './seasons';
import schema from './schema';
import { modules } from './test.setup';

const SUMMER: NewSeason = {
  name: 'Summer 2030',
  slug: 'summer-2030',
  startDate: '2030-06-01',
  endDate: '2030-08-30',
  registrationDeadline: '2030-05-20',
  playersPerSide: 4,
  minimumRosterSize: 4,
};

const OPENED = Date.parse('2030-05-02T00:00:00Z');

const SUMMER_SLUGS = { orgSlug: 'org-a', leagueSlug: 'coed-4s', seasonSlug: 'summer-2030' };
const DRAFT_SEASON = { ...SUMMER_SLUGS, seasonSlug: 'draft-season' };
const DRAFT_LEAGUE = { orgSlug: 'org-a', leagueSlug: 'draft-4s', seasonSlug: 'summer-2030' };
const OTHER_LEAGUE_SEASON = { ...SUMMER_SLUGS, seasonSlug: 'mens-only' };

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

async function person(ctx: MutationCtx, name: string): Promise<Doc<'users'>> {
  const now = Date.now();
  const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'user',
      data: {
        name,
        email: `${name}@example.test`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  } as never)) as { _id: string };
  const userId = await ctx.db.insert('users', {
    authUserId: account._id,
    name: `Name ${name}`,
    adultConfirmedAt: 1,
  });
  return (await ctx.db.get('users', userId))!;
}

async function setup() {
  vi.useFakeTimers({ now: Date.parse('2030-05-01T12:00:00Z') });
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
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
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [],
    });
    const league = async (slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) => q.eq('organizationId', a).eq('slug', slug))
        .unique())!;
    const coed = await league('coed-4s');
    const mens = await league('mens-2s');
    const summerId = await insertSeason(ctx, coed, SUMMER, 'published');
    const draftSeasonId = await insertSeason(
      ctx,
      coed,
      { ...SUMMER, name: 'Draft Season', slug: 'draft-season' },
      'draft',
    );
    await insertSeason(ctx, mens, { ...SUMMER, slug: 'mens-only' }, 'published');
    await insertSeason(ctx, await league('draft-4s'), SUMMER, 'published');

    const users: Record<string, Doc<'users'>> = {};
    for (const name of [
      'admin-a',
      'organizer-coed',
      'organizer-mens',
      'admin-b',
      'stranger',
      'cap-sharks',
      'cap-dig',
      'cap-block',
      'p1',
      'p2',
      'p3',
      'p4',
      'fa-first',
      'fa-second',
      'fa-placed',
    ]) {
      users[name] = await person(ctx, name);
    }
    const membership = async (
      name: string,
      organizationId: Id<'organizations'>,
      role: 'orgAdmin' | 'leagueOrganizer',
      leagueIds: Id<'leagues'>[] = [],
    ) => ctx.db.insert('memberships', { userId: users[name]._id, organizationId, role, leagueIds });
    await membership('admin-a', a, 'orgAdmin');
    await membership('organizer-coed', a, 'leagueOrganizer', [coed._id]);
    await membership('organizer-mens', a, 'leagueOrganizer', [mens._id]);
    await membership('admin-b', b, 'orgAdmin');
    return { users, summerId, draftSeasonId };
  });
  const as = (name: string) => t.withIdentity(identity(ids.users[name].authUserId));
  return { t, as, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function season(ctx: MutationCtx, seasonId: Id<'seasons'>) {
  return (await ctx.db.get('seasons', seasonId))!;
}

async function populate(s: Setup) {
  return s.t.run(async (ctx) => {
    const summer = await season(ctx, s.summerId);
    const team = async (name: string, captain: string) => {
      const teamId = await insertTeamWithCaptain(ctx, summer, {
        name,
        captainUserId: s.users[captain]._id,
      });
      return (await ctx.db.get('teams', teamId))!;
    };
    const sharks = await team('Sand Sharks', 'cap-sharks');
    const dig = await team('Dig Deep', 'cap-dig');
    const block = await team('block party', 'cap-block');
    for (const player of ['p1', 'p2', 'p3']) {
      await addRosterEntry(ctx, sharks, {
        userId: s.users[player]._id,
        source: 'invite',
        addedByUserId: sharks.captainUserId,
      });
    }
    await addRosterEntry(ctx, dig, {
      userId: s.users['p4']._id,
      source: 'invite',
      addedByUserId: dig.captainUserId,
    });
    for (const email of ['x@example.test', 'y@example.test']) {
      await insertTeamInvite(ctx, dig, {
        email,
        tokenHash: `hash-${email}`,
        expiresAt: Date.now() + 1000,
        invitedByUserId: dig.captainUserId,
      });
    }
    return { sharks, dig, block };
  });
}

/** Sets the date after the insert, so the expected order does not depend on the test clock. */
async function addFreeAgent(s: Setup, name: string, at: string) {
  await s.t.run(async (ctx) => {
    const { _id } = await insertFreeAgent(ctx, await season(ctx, s.summerId), s.users[name]._id);
    await ctx.db.patch('freeAgents', _id, { registeredAt: Date.parse(at) });
  });
}

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string }>).data;
}

const view = (s: Setup, name: string | null, slugs = SUMMER_SLUGS) =>
  (name === null ? s.t : s.as(name)).query(api.seasons.getOrganizerView, slugs);
const freeAgents = (s: Setup, name: string | null, slugs = SUMMER_SLUGS) =>
  (name === null ? s.t : s.as(name)).query(api.freeAgents.listForOrganizer, slugs);

afterEach(() => {
  vi.useRealTimers();
});

describe('seasons.getOrganizerView', () => {
  test('gives an org admin the season header and its teams by name, with captain, roster, and pending invites', async () => {
    const s = await setup();
    const { sharks, dig, block } = await populate(s);
    expect(await view(s, 'admin-a')).toEqual({
      seasonId: s.summerId,
      name: 'Summer 2030',
      slug: 'summer-2030',
      status: 'published',
      startDate: '2030-06-01',
      endDate: '2030-08-30',
      registrationDeadline: '2030-05-20',
      formatName: '4v4',
      minimumRosterSize: 4,
      teams: [
        {
          teamId: block._id,
          name: 'block party',
          captainName: 'Name cap-block',
          rosterCount: 1,
          pendingInviteCount: 0,
        },
        {
          teamId: dig._id,
          name: 'Dig Deep',
          captainName: 'Name cap-dig',
          rosterCount: 2,
          pendingInviteCount: 2,
        },
        {
          teamId: sharks._id,
          name: 'Sand Sharks',
          captainName: 'Name cap-sharks',
          rosterCount: 4,
          pendingInviteCount: 0,
        },
      ],
      teamCount: 3,
      largestRoster: { name: 'Sand Sharks', rosterCount: 4 },
    });
  });

  test('gives the league organizer assigned to the league the same view', async () => {
    const s = await setup();
    await populate(s);
    const result = await view(s, 'organizer-coed');
    expect(result?.teams.map((team) => team.name)).toEqual([
      'block party',
      'Dig Deep',
      'Sand Sharks',
    ]);
  });

  test('gives staff a draft season with no teams', async () => {
    const s = await setup();
    for (const name of ['admin-a', 'organizer-coed']) {
      expect(await view(s, name, DRAFT_SEASON)).toMatchObject({
        seasonId: s.draftSeasonId,
        status: 'draft',
        teams: [],
        teamCount: 0,
      });
    }
  });

  test(`shows the first ${ORGANIZER_TEAMS_LIMIT} teams by name and the true total past them`, async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const summer = await season(ctx, s.summerId);
      for (let i = 0; i <= ORGANIZER_TEAMS_LIMIT; i++) {
        const captain = await ctx.db.insert('users', {
          authUserId: `captain-${i}`,
          name: `Captain ${i}`,
          adultConfirmedAt: 1,
        });
        await insertTeamWithCaptain(ctx, summer, {
          name: `Team ${String(i).padStart(3, '0')}`,
          captainUserId: captain,
        });
      }
    });
    const result = await view(s, 'admin-a');
    expect(result?.teams).toHaveLength(ORGANIZER_TEAMS_LIMIT);
    expect(result?.teams[0]?.name).toBe('Team 000');
    expect(result?.teams.at(-1)?.name).toBe(`Team ${ORGANIZER_TEAMS_LIMIT - 1}`);
    expect(result?.teamCount).toBe(ORGANIZER_TEAMS_LIMIT + 1);
  });
});

describe('freeAgents.listForOrganizer', () => {
  test('gives an org admin the waiting free agents oldest first, with name, email, and date', async () => {
    const s = await setup();
    await addFreeAgent(s, 'fa-second', '2030-05-03T10:00:00Z');
    await addFreeAgent(s, 'fa-first', '2030-05-02T10:00:00Z');
    const result = await freeAgents(s, 'admin-a');
    expect(result).toEqual({
      rows: [
        {
          freeAgentId: expect.any(String) as string,
          name: 'Name fa-first',
          email: 'fa-first@example.test',
          registeredAt: Date.parse('2030-05-02T10:00:00Z'),
        },
        {
          freeAgentId: expect.any(String) as string,
          name: 'Name fa-second',
          email: 'fa-second@example.test',
          registeredAt: Date.parse('2030-05-03T10:00:00Z'),
        },
      ],
      hasMore: false,
    });
    expect(await freeAgents(s, 'organizer-coed')).toEqual(result);
  });

  test('leaves out a placed free agent', async () => {
    const s = await setup();
    const { sharks } = await populate(s);
    await addFreeAgent(s, 'fa-first', '2030-05-02T10:00:00Z');
    await s.t.run(async (ctx) => {
      await insertPlacedFreeAgent(ctx, sharks, s.users['fa-placed']._id);
    });
    const result = await freeAgents(s, 'admin-a');
    expect(result?.rows.map((row) => row.name)).toEqual(['Name fa-first']);
  });

  test(`reads ${ORGANIZER_FREE_AGENTS_LIMIT + 1} rows and returns ${ORGANIZER_FREE_AGENTS_LIMIT}, with hasMore`, async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const summer = await season(ctx, s.summerId);
      for (let i = 0; i <= ORGANIZER_FREE_AGENTS_LIMIT; i++) {
        const user = await person(ctx, `many-${i}`);
        const { _id } = await insertFreeAgent(ctx, summer, user._id);
        await ctx.db.patch('freeAgents', _id, {
          registeredAt: OPENED + (ORGANIZER_FREE_AGENTS_LIMIT - i),
        });
      }
    });
    const result = await freeAgents(s, 'admin-a');
    expect(result?.rows).toHaveLength(ORGANIZER_FREE_AGENTS_LIMIT);
    expect(result?.rows[0]?.name).toBe(`Name many-${ORGANIZER_FREE_AGENTS_LIMIT}`);
    expect(result?.rows.at(-1)?.name).toBe('Name many-1');
    expect(result?.hasMore).toBe(true);
    for (const row of result?.rows ?? []) {
      expect(row.email).toBe(`${row.name.replace('Name ', '')}@example.test`);
    }
  });

  test('gives a row whose Better Auth user is deleted an empty email and leaves its neighbours their own', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const summer = await season(ctx, s.summerId);
      for (const [index, name] of ['gone-first', 'gone-middle', 'gone-last'].entries()) {
        const user = await person(ctx, name);
        const { _id } = await insertFreeAgent(ctx, summer, user._id);
        await ctx.db.patch('freeAgents', _id, { registeredAt: OPENED + index });
      }
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: 'user',
          where: [{ field: 'email', value: 'gone-middle@example.test' }],
        },
      } as never);
    });
    const result = await freeAgents(s, 'admin-a');
    expect(result?.rows.map((row) => [row.name, row.email])).toEqual([
      ['Name gone-first', 'gone-first@example.test'],
      ['Name gone-middle', ''],
      ['Name gone-last', 'gone-last@example.test'],
    ]);
  });

  test(`says hasMore false at exactly ${ORGANIZER_FREE_AGENTS_LIMIT}`, async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const summer = await season(ctx, s.summerId);
      for (let i = 0; i < ORGANIZER_FREE_AGENTS_LIMIT; i++) {
        const user = await person(ctx, `exact-${i}`);
        await insertFreeAgent(ctx, summer, user._id);
      }
    });
    const result = await freeAgents(s, 'admin-a');
    expect(result?.rows).toHaveLength(ORGANIZER_FREE_AGENTS_LIMIT);
    expect(result?.hasMore).toBe(false);
  });
});

describe('both queries: who may call them', () => {
  const queries = [
    ['seasons.getOrganizerView', view],
    ['freeAgents.listForOrganizer', freeAgents],
  ] as const;

  for (const [label, call] of queries) {
    describe(label, () => {
      test('refuses an organizer of another league, a captain in the season, and a non-member with FORBIDDEN', async () => {
        const s = await setup();
        await populate(s);
        await addFreeAgent(s, 'fa-first', '2030-05-02T10:00:00Z');
        for (const name of ['organizer-mens', 'cap-sharks', 'stranger']) {
          expect(await refusal(call(s, name))).toEqual({ code: FORBIDDEN_CODE });
        }
      });

      test('refuses an unauthenticated caller and an org admin of another organization with FORBIDDEN for a published season of a published league', async () => {
        const s = await setup();
        for (const name of [null, 'admin-b']) {
          expect(await refusal(call(s, name))).toEqual({ code: FORBIDDEN_CODE });
        }
      });

      test('answers null to an unauthenticated caller and an org admin of another organization for a draft league and a draft season', async () => {
        const s = await setup();
        for (const name of [null, 'admin-b', 'stranger', 'cap-sharks']) {
          expect(await call(s, name, DRAFT_LEAGUE)).toBeNull();
          expect(await call(s, name, DRAFT_SEASON)).toBeNull();
        }
      });

      test('answers FORBIDDEN, not null, to staff who do not organize a draft season', async () => {
        const s = await setup();
        expect(await refusal(call(s, 'organizer-mens', DRAFT_SEASON))).toEqual({
          code: FORBIDDEN_CODE,
        });
      });

      test('answers null for an unknown organization, league, or season slug, and for a season slug of another league', async () => {
        const s = await setup();
        for (const slugs of [
          { ...SUMMER_SLUGS, orgSlug: 'no-such-org' },
          { ...SUMMER_SLUGS, leagueSlug: 'no-such-league' },
          { ...SUMMER_SLUGS, seasonSlug: 'no-such-season' },
          { ...SUMMER_SLUGS, seasonSlug: 'Not A Slug' },
          OTHER_LEAGUE_SEASON,
        ]) {
          expect(await call(s, 'admin-a', slugs)).toBeNull();
        }
      });
    });
  }

  test('no other caller’s result carries a free agent’s email', async () => {
    const s = await setup();
    await populate(s);
    await addFreeAgent(s, 'fa-first', '2030-05-02T10:00:00Z');
    const teamView = JSON.stringify(await view(s, 'admin-a'));
    expect(teamView).not.toContain('@');
  });
});
