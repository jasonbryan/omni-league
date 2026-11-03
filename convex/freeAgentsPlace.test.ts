/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  addRosterEntry,
  insertFreeAgent,
  insertTeamWithCaptain,
  removeRosterEntry,
} from './lib/rosterWrites';
import { TEAM_MESSAGES } from './lib/teamInput';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
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

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenant = (slug: string, leagues: string[]) =>
      insertTenant(ctx, {
        organization: { name: slug, slug },
        locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
        leagues: leagues.map((name) => ({
          name,
          sport: 'beachVolleyball' as const,
          locations: ['Alpha Beach'],
        })),
      });
    const a = await tenant('org-a', ['Coed 4s', 'Mens 2s']);
    const b = await tenant('org-b', ['Other 4s']);
    const league = async (organizationId: Id<'organizations'>, slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!;
    const coed = await league(a, 'coed-4s');
    const mens = await league(a, 'mens-2s');
    const summer = await insertSeason(ctx, coed, SUMMER, 'published');
    const fall = await insertSeason(
      ctx,
      coed,
      { ...SUMMER, name: 'Fall 2030', slug: 'fall-2030' },
      'published',
    );
    const user = (authUserId: string) =>
      ctx.db.insert('users', { authUserId, name: `Name ${authUserId}`, adultConfirmedAt: 1 });
    const users = {
      organizer: await user('organizer'),
      admin: await user('admin'),
      otherOrganizer: await user('otherOrganizer'),
      otherAdmin: await user('otherAdmin'),
      captain: await user('captain'),
      fallCaptain: await user('fallCaptain'),
      waiting: await user('waiting'),
      rostered: await user('rostered'),
    };
    const member = (
      userId: Id<'users'>,
      organizationId: Id<'organizations'>,
      role: 'orgAdmin' | 'leagueOrganizer',
      leagueIds: Id<'leagues'>[],
    ) => ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
    await member(users.organizer, a, 'leagueOrganizer', [coed._id]);
    await member(users.admin, a, 'orgAdmin', []);
    await member(users.otherOrganizer, a, 'leagueOrganizer', [mens._id]);
    await member(users.otherAdmin, b, 'orgAdmin', []);
    const seasonDoc = async (id: Id<'seasons'>) => (await ctx.db.get('seasons', id))!;
    const team = await insertTeamWithCaptain(ctx, await seasonDoc(summer), {
      name: 'Dig Deep',
      captainUserId: users.captain,
    });
    const fallTeam = await insertTeamWithCaptain(ctx, await seasonDoc(fall), {
      name: 'Fall Team',
      captainUserId: users.fallCaptain,
    });
    const freeAgent = (await insertFreeAgent(ctx, await seasonDoc(summer), users.waiting))._id;
    return { summer, team, fallTeam, freeAgent, ...users };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const as = (s: Setup, authUserId: string) => s.t.withIdentity(identity(authUserId));

const place = (
  s: Setup,
  authUserId: string,
  args: { freeAgentId: Id<'freeAgents'>; teamId: Id<'teams'> } = {
    freeAgentId: s.freeAgent,
    teamId: s.team,
  },
) => as(s, authUserId).mutation(api.freeAgents.place, args);

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

async function rows(s: Setup) {
  return s.t.run(async (ctx) => ({
    freeAgents: await ctx.db.query('freeAgents').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
    teams: await ctx.db.query('teams').collect(),
  }));
}

async function expectRosterCountsMatchRecount(s: Setup): Promise<void> {
  const { entries, teams } = await rows(s);
  for (const team of teams) {
    const rostered = entries.filter((e) => e.teamId === team._id && e.status === 'rostered');
    expect({ team: team.name, count: team.rosterCount }).toEqual({
      team: team.name,
      count: rostered.length,
    });
  }
}

/** Ids no row holds: a row inserted and deleted again. */
async function deletedIds(s: Setup) {
  return s.t.run(async (ctx: MutationCtx) => {
    const freeAgentId = await ctx.db.insert('freeAgents', {
      organizationId: (await ctx.db.get('freeAgents', s.freeAgent))!.organizationId,
      seasonId: s.summer,
      userId: s.rostered,
      status: 'waiting',
      registeredAt: 1,
    });
    await ctx.db.delete('freeAgents', freeAgentId);
    const team = (await ctx.db.get('teams', s.team))!;
    const teamId = await ctx.db.insert('teams', {
      organizationId: team.organizationId,
      leagueId: team.leagueId,
      seasonId: team.seasonId,
      name: 'Gone',
      sortName: 'gone',
      captainUserId: team.captainUserId,
      rosterCount: 0,
      pendingInviteCount: 0,
      createdAt: 1,
    });
    await ctx.db.delete('teams', teamId);
    return { freeAgentId, teamId };
  });
}

describe('freeAgents.place', () => {
  test.each(['organizer', 'admin'])(
    'a %s places a waiting free agent: one placement entry, the row placed, the count recounted',
    async (caller) => {
      const s = await setup();
      const before = Date.now();
      expect(await place(s, caller)).toBeNull();
      const { freeAgents, entries, teams } = await rows(s);
      expect(freeAgents).toEqual([
        expect.objectContaining({ _id: s.freeAgent, status: 'placed', placedTeamId: s.team }),
      ]);
      expect(freeAgents[0].placedAt).toBeGreaterThanOrEqual(before);
      expect(entries.filter((entry) => entry.userId === s.waiting)).toEqual([
        expect.objectContaining({
          teamId: s.team,
          seasonId: s.summer,
          status: 'rostered',
          source: 'placement',
          addedByUserId: s[caller as 'organizer' | 'admin'],
        }),
      ]);
      expect(teams.find((team) => team._id === s.team)?.rosterCount).toBe(2);
      await expectRosterCountsMatchRecount(s);
    },
  );

  test('the placed free agent sees the team on the register route', async () => {
    const s = await setup();
    await place(s, 'organizer');
    const registration = await as(s, 'waiting').query(api.seasons.getForRegistration, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-4s',
      seasonSlug: 'summer-2030',
    });
    expect(registration).toMatchObject({
      team: { teamId: s.team, name: 'Dig Deep', isCaptain: false },
      freeAgent: { status: 'placed' },
    });
  });

  test('refuses a free agent who is already placed, and writes nothing', async () => {
    const s = await setup();
    await place(s, 'organizer');
    const before = await rows(s);
    const failure = await place(s, 'admin').catch((error: unknown) => error);
    expect(refusalOf(failure)).toEqual({
      code: 'alreadyPlaced',
      message: TEAM_MESSAGES.alreadyPlaced,
    });
    expect(await rows(s)).toEqual(before);
  });

  test('refuses a free agent who holds a rostered entry in the season, and writes nothing', async () => {
    const s = await setup();
    // The writer lets a waiting free agent hold only a placement entry, so one stands in for the rostered entry.
    const otherTeam = await s.t.run(async (ctx) => {
      const id = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', s.summer))!, {
        name: 'Sand Sharks',
        captainUserId: s.rostered,
      });
      await addRosterEntry(ctx, (await ctx.db.get('teams', id))!, {
        userId: s.waiting,
        source: 'placement',
        addedByUserId: s.rostered,
      });
      return id;
    });
    const before = await rows(s);
    const failure = await place(s, 'organizer').catch((error: unknown) => error);
    expect(refusalOf(failure)).toEqual({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Sand Sharks',
      message: TEAM_MESSAGES.alreadyOnAnotherTeam('Sand Sharks'),
    });
    expect(await rows(s)).toEqual(before);
    expect(before.teams.find((team) => team._id === otherTeam)?.rosterCount).toBe(2);
  });

  test('refuses a team of another season, an unknown free agent, and an unknown team, and writes nothing', async () => {
    const s = await setup();
    const gone = await deletedIds(s);
    const before = await rows(s);
    const cases = [
      { freeAgentId: s.freeAgent, teamId: s.fallTeam },
      { freeAgentId: gone.freeAgentId, teamId: s.team },
      { freeAgentId: s.freeAgent, teamId: gone.teamId },
    ];
    for (const args of cases) {
      await expect(place(s, 'organizer', args)).rejects.toThrow();
    }
    expect(await rows(s)).toEqual(before);
  });

  test.each(['otherOrganizer', 'captain', 'waiting', 'otherAdmin'])(
    'refuses %s, and writes nothing',
    async (caller) => {
      const s = await setup();
      const before = await rows(s);
      await expect(place(s, caller)).rejects.toThrow('Not allowed');
      expect(await rows(s)).toEqual(before);
    },
  );

  test('refuses an unauthenticated caller, and writes nothing', async () => {
    const s = await setup();
    const before = await rows(s);
    await expect(
      s.t.mutation(api.freeAgents.place, { freeAgentId: s.freeAgent, teamId: s.team }),
    ).rejects.toThrow('Sign in required');
    expect(await rows(s)).toEqual(before);
  });
});

describe('a placed free agent removed from the team', () => {
  test('waits again, with no team, and the organizer can place them on another', async () => {
    const s = await setup();
    await place(s, 'organizer');
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.query('rosterEntries').collect()).find(
        (row) => row.userId === s.waiting,
      )!;
      await removeRosterEntry(ctx, entry, s.captain);
    });
    const { freeAgents } = await rows(s);
    expect(freeAgents).toEqual([expect.objectContaining({ _id: s.freeAgent, status: 'waiting' })]);
    expect(freeAgents[0]).not.toHaveProperty('placedTeamId');
    expect(freeAgents[0]).not.toHaveProperty('placedAt');
    const registration = await as(s, 'waiting').query(api.seasons.getForRegistration, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-4s',
      seasonSlug: 'summer-2030',
    });
    expect(registration).toMatchObject({ team: null, freeAgent: { status: 'waiting' } });

    await place(s, 'organizer');
    expect((await rows(s)).freeAgents[0]).toMatchObject({ status: 'placed', placedTeamId: s.team });
    await expectRosterCountsMatchRecount(s);
  });
});
