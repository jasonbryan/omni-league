/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import {
  addRosterEntry,
  insertFreeAgent,
  insertTeamWithCaptain,
  removeRosterEntry,
} from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { SEASON_TEAMS_LIMIT } from './teams';
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
      captain: await user('captain'),
      player: await user('player'),
      removed: await user('removed'),
      rivalCaptain: await user('rivalCaptain'),
      rivalPlayer: await user('rivalPlayer'),
      fallCaptain: await user('fallCaptain'),
      waiting: await user('waiting'),
      organizer: await user('organizer'),
      admin: await user('admin'),
      otherOrganizer: await user('otherOrganizer'),
      otherAdmin: await user('otherAdmin'),
      stranger: await user('stranger'),
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
    const teamDoc = async (id: Id<'teams'>) => (await ctx.db.get('teams', id))!;
    const sharks = await insertTeamWithCaptain(ctx, await seasonDoc(summer), {
      name: 'Sand Sharks',
      captainUserId: users.captain,
    });
    const party = await insertTeamWithCaptain(ctx, await seasonDoc(summer), {
      name: 'Block Party',
      captainUserId: users.rivalCaptain,
    });
    await insertTeamWithCaptain(ctx, await seasonDoc(fall), {
      name: 'Fall Team',
      captainUserId: users.fallCaptain,
    });
    for (const userId of [users.player, users.removed]) {
      await addRosterEntry(ctx, await teamDoc(sharks), {
        userId,
        source: 'invite',
        addedByUserId: users.captain,
      });
    }
    await addRosterEntry(ctx, await teamDoc(party), {
      userId: users.rivalPlayer,
      source: 'invite',
      addedByUserId: users.rivalCaptain,
    });
    const removedEntry = (await ctx.db
      .query('rosterEntries')
      .withIndex('by_seasonId_and_userId_and_minorName_and_status', (q) =>
        q.eq('seasonId', summer).eq('userId', users.removed),
      )
      .unique())!;
    await removeRosterEntry(ctx, removedEntry, users.captain);
    await insertFreeAgent(ctx, await seasonDoc(summer), users.waiting);
    return { summer, sharks, party, ...users };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const as = (s: Setup, authUserId: string) => s.t.withIdentity(identity(authUserId));

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

const REFUSED = [
  ['a rostered player of a team in another season', 'fallCaptain'],
  ['a removed player of the team', 'removed'],
  ['a waiting free agent of the season', 'waiting'],
  ['a league organizer of another league in the same organization', 'otherOrganizer'],
  ['an org admin of another organization', 'otherAdmin'],
  ['a signed-in user with no part in the season', 'stranger'],
] as const;

describe('teams.getForMember: rosters across the season', () => {
  test('a rostered player of another team in the season reads names and the captain mark, with no control or email', async () => {
    const s = await setup();
    const team = await as(s, 'rivalPlayer').query(api.teams.getForMember, { teamId: s.sharks });
    expect(team).toMatchObject({
      name: 'Sand Sharks',
      rosterCount: 2,
      viewerIsCaptain: false,
      viewerCanManage: false,
      viewerTeamName: 'Block Party',
    });
    expect(team?.roster.map((row) => [row.name, row.isCaptain, row.isViewer])).toEqual([
      ['Name captain', true, false],
      ['Name player', false, false],
    ]);
    expect(JSON.stringify(team)).not.toContain('@');
    expect(JSON.stringify(team)).not.toContain('Name removed');
  });

  test('an opponent is refused the pending invites', async () => {
    const s = await setup();
    await expect(
      as(s, 'rivalPlayer').query(api.teamInvites.listPending, { teamId: s.sharks }),
    ).rejects.toThrow('Not allowed');
  });

  test('a player of the team gets their own team name, and an organizer off the rosters gets null', async () => {
    const s = await setup();
    expect(await as(s, 'player').query(api.teams.getForMember, { teamId: s.sharks })).toMatchObject(
      { viewerTeamName: 'Sand Sharks', viewerCanManage: false },
    );
    expect(
      await as(s, 'organizer').query(api.teams.getForMember, { teamId: s.sharks }),
    ).toMatchObject({ viewerTeamName: null, viewerCanManage: true });
  });

  test.each(REFUSED)('%s is refused with FORBIDDEN', async (_label, caller) => {
    const s = await setup();
    const failure = await as(s, caller)
      .query(api.teams.getForMember, { teamId: s.sharks })
      .catch(refusalOf);
    expect(failure).toEqual({ code: FORBIDDEN_CODE });
  });

  test('an unauthenticated caller is refused with FORBIDDEN', async () => {
    const s = await setup();
    const failure = await s.t.query(api.teams.getForMember, { teamId: s.sharks }).catch(refusalOf);
    expect(failure).toEqual({ code: FORBIDDEN_CODE });
  });

  test.each([
    ['an organizer of the league', 'organizer'],
    ['an org admin of the organization', 'admin'],
  ])('%s is allowed', async (_label, caller) => {
    const s = await setup();
    expect(await as(s, caller).query(api.teams.getForMember, { teamId: s.sharks })).toMatchObject({
      name: 'Sand Sharks',
    });
  });
});

describe('teams.listForSeasonMember', () => {
  test("lists the season's teams by name, marks the caller's team, and takes the total from teamCount", async () => {
    const s = await setup();
    expect(
      await as(s, 'rivalPlayer').query(api.teams.listForSeasonMember, { teamId: s.sharks }),
    ).toEqual({
      rows: [
        { teamId: s.party, name: 'Block Party', isViewerTeam: true },
        { teamId: s.sharks, name: 'Sand Sharks', isViewerTeam: false },
      ],
      total: 2,
    });
  });

  test.each([
    ['an organizer of the league', 'organizer'],
    ['an org admin of the organization', 'admin'],
  ])('%s is allowed, with no team marked as theirs', async (_label, caller) => {
    const s = await setup();
    const list = await as(s, caller).query(api.teams.listForSeasonMember, { teamId: s.party });
    expect(list?.rows.map((row) => [row.name, row.isViewerTeam])).toEqual([
      ['Block Party', false],
      ['Sand Sharks', false],
    ]);
  });

  test.each(REFUSED)('%s is refused with FORBIDDEN', async (_label, caller) => {
    const s = await setup();
    const failure = await as(s, caller)
      .query(api.teams.listForSeasonMember, { teamId: s.sharks })
      .catch(refusalOf);
    expect(failure).toEqual({ code: FORBIDDEN_CODE });
  });

  test('an unauthenticated caller is refused with FORBIDDEN', async () => {
    const s = await setup();
    const failure = await s.t
      .query(api.teams.listForSeasonMember, { teamId: s.sharks })
      .catch(refusalOf);
    expect(failure).toEqual({ code: FORBIDDEN_CODE });
  });

  test('an unknown id and a malformed id each answer null', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.delete('teams', s.party);
    });
    expect(
      await as(s, 'captain').query(api.teams.listForSeasonMember, { teamId: s.party }),
    ).toBeNull();
    expect(
      await as(s, 'captain').query(api.teams.listForSeasonMember, { teamId: 'not-an-id' }),
    ).toBeNull();
  });

  test(`with ${SEASON_TEAMS_LIMIT + 1} teams it returns the first ${SEASON_TEAMS_LIMIT} by name and the whole total`, async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < SEASON_TEAMS_LIMIT - 1; i++) {
        const captainUserId = await ctx.db.insert('users', {
          authUserId: `bulk-${i}`,
          name: `Bulk ${i}`,
          adultConfirmedAt: 1,
        });
        await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', s.summer))!, {
          name: `Team ${String(i).padStart(3, '0')}`,
          captainUserId,
        });
      }
    });
    const list = await as(s, 'organizer').query(api.teams.listForSeasonMember, {
      teamId: s.sharks,
    });
    expect(list?.total).toBe(SEASON_TEAMS_LIMIT + 1);
    expect(list?.rows).toHaveLength(SEASON_TEAMS_LIMIT);
    expect(list?.rows[0]?.name).toBe('Block Party');
    expect(list?.rows.at(-1)?.name).toBe('Team 197');
    expect(list?.rows.map((row) => row.name)).not.toContain('Team 198');
  });
});
