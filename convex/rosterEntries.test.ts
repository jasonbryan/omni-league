/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { addRosterEntry, insertTeamWithCaptain } from './lib/rosterWrites';
import { TEAM_MESSAGES } from './lib/teamInput';
import { insertSeason, insertTenant, type NewSeason, defaultDivision } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.UTC(2030, 4, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

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

type Role = 'orgAdmin' | 'leagueOrganizer';

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
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
        {
          name: 'Mens 2s',
          sport: 'beachVolleyball',
          locations: ['Alpha Beach'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [
        {
          name: 'Coed 4s',
          sport: 'beachVolleyball',
          locations: ['B Beach'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const leagueIn = async (organizationId: Id<'organizations'>, slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!;
    const coed = await leagueIn(a, 'coed-4s');
    const mens = await leagueIn(a, 'mens-2s');
    const summerId = await insertSeason(ctx, coed, SUMMER, 'published');
    const person = async (
      authUserId: string,
      membership: {
        organizationId: Id<'organizations'>;
        role: Role;
        leagueIds?: Id<'leagues'>[];
      } | null = null,
    ) => {
      const now = Date.now();
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name: authUserId,
            email: `${authUserId}@example.test`,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      } as never)) as { _id: string };
      const userId = await ctx.db.insert('users', {
        authUserId: account._id,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (membership) {
        await ctx.db.insert('memberships', {
          userId,
          organizationId: membership.organizationId,
          role: membership.role,
          leagueIds: membership.leagueIds ?? [],
        });
      }
      return { authUserId: account._id, userId };
    };
    const people = {
      captain: await person('captain'),
      player: await person('player'),
      teammate: await person('teammate'),
      rival: await person('rival'),
      adminA: await person('admin-a', { organizationId: a, role: 'orgAdmin' }),
      organizer: await person('organizer-coed', {
        organizationId: a,
        role: 'leagueOrganizer',
        leagueIds: [coed._id],
      }),
      otherOrganizer: await person('organizer-mens', {
        organizationId: a,
        role: 'leagueOrganizer',
        leagueIds: [mens._id],
      }),
      adminB: await person('admin-b', { organizationId: b, role: 'orgAdmin' }),
    };
    const summer = async () => (await ctx.db.get('seasons', summerId))!;
    const sharks = await insertTeamWithCaptain(ctx, await summer(), {
      name: 'Sand Sharks',
      captainUserId: people.captain.userId,
    });
    for (const member of [people.player, people.teammate]) {
      await addRosterEntry(ctx, (await ctx.db.get('teams', sharks))!, {
        userId: member.userId,
        source: 'invite',
        addedByUserId: people.captain.userId,
      });
    }
    const rivals = await insertTeamWithCaptain(ctx, await summer(), {
      name: 'Rivals',
      captainUserId: people.rival.userId,
    });
    return { ...people, sharks, rivals };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return { t, ...ids, as };
}

type Setup = Awaited<ReturnType<typeof setup>>;
interface Person {
  authUserId: string;
  userId: Id<'users'>;
}

const entryOf = (s: Setup, who: Person, teamId = s.sharks) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query('rosterEntries').collect()).find(
      (row) => row.userId === who.userId && row.teamId === teamId,
    ),
  );

const remove = async (s: Setup, of: Person, by: { authUserId: string } = s.captain) =>
  s.as(by).mutation(api.rosterEntries.remove, { rosterEntryId: (await entryOf(s, of))!._id });

const teamRow = (s: Setup, teamId = s.sharks) => s.t.run((ctx) => ctx.db.get('teams', teamId));

async function expectRosterCountMatches(s: Setup, teamId = s.sharks) {
  const rostered = await s.t.run(async (ctx) =>
    (await ctx.db.query('rosterEntries').collect()).filter(
      (row) => row.teamId === teamId && row.status === 'rostered',
    ),
  );
  expect((await teamRow(s, teamId))?.rosterCount).toBe(rostered.length);
}

const rosterNames = async (s: Setup, who: { authUserId: string } = s.captain) =>
  (await s.as(who).query(api.teams.getForMember, { teamId: s.sharks }))?.roster.map(
    (row) => row.name,
  );

describe('rosterEntries.remove', () => {
  test('the captain removes a player: the entry is kept as removed, the row leaves the roster, and the count falls by 1', async () => {
    const s = await setup();
    expect((await teamRow(s))?.rosterCount).toBe(3);
    await expect(remove(s, s.player)).resolves.toBeNull();
    const removed = await entryOf(s, s.player);
    expect(removed).toMatchObject({ status: 'removed', removedByUserId: s.captain.userId });
    expect(removed?.removedAt).toBeGreaterThanOrEqual(NOW);
    expect(await rosterNames(s)).toEqual(['captain', 'teammate']);
    expect((await teamRow(s))?.rosterCount).toBe(2);
    await expectRosterCountMatches(s);
  });

  test('an organizer of the league and an org admin remove a player', async () => {
    const s = await setup();
    await remove(s, s.player, s.organizer);
    await remove(s, s.teammate, s.adminA);
    expect(await entryOf(s, s.player)).toMatchObject({
      status: 'removed',
      removedByUserId: s.organizer.userId,
    });
    expect(await entryOf(s, s.teammate)).toMatchObject({
      status: 'removed',
      removedByUserId: s.adminA.userId,
    });
    expect(await rosterNames(s)).toEqual(['captain']);
    await expectRosterCountMatches(s);
  });

  test('refuses the captain’s own entry, for the captain, an organizer, and an org admin, and changes nothing', async () => {
    const s = await setup();
    for (const who of [s.captain, s.organizer, s.adminA]) {
      await expect(remove(s, s.captain, who)).rejects.toMatchObject({
        data: { code: 'captainRequired', message: TEAM_MESSAGES.captainRequired },
      });
    }
    expect(await entryOf(s, s.captain)).toMatchObject({ status: 'rostered' });
    expect((await teamRow(s))?.rosterCount).toBe(3);
  });

  test('refuses a rostered non-captain, another team’s captain, another league’s organizer, another organization’s admin, and the unauthenticated, and changes nothing', async () => {
    const s = await setup();
    for (const who of [s.teammate, s.rival, s.otherOrganizer, s.adminB]) {
      await expect(remove(s, s.player, who)).rejects.toThrow(/Not allowed/);
    }
    const rosterEntryId = (await entryOf(s, s.player))!._id;
    await expect(s.t.mutation(api.rosterEntries.remove, { rosterEntryId })).rejects.toThrow(
      /Sign in required/,
    );
    await expect(remove(s, s.player, s.player)).rejects.toThrow(/Not allowed/);
    expect(await entryOf(s, s.player)).toMatchObject({ status: 'rostered' });
    expect((await teamRow(s))?.rosterCount).toBe(3);
  });

  test('the captain of another team cannot remove from this one, and this captain cannot remove from theirs', async () => {
    const s = await setup();
    const rivalEntry = (await entryOf(s, s.rival, s.rivals))!;
    await expect(
      s.as(s.captain).mutation(api.rosterEntries.remove, { rosterEntryId: rivalEntry._id }),
    ).rejects.toThrow(/Not allowed/);
    expect((await teamRow(s, s.rivals))?.rosterCount).toBe(1);
  });

  test('refuses a removed entry, which stays as removed, and leaves the count as it is', async () => {
    const s = await setup();
    await remove(s, s.player);
    await expect(remove(s, s.player)).rejects.toMatchObject({
      data: { code: 'notRostered', message: TEAM_MESSAGES.notRostered },
    });
    await expect(remove(s, s.player, s.organizer)).rejects.toMatchObject({
      data: { code: 'notRostered' },
    });
    expect(await entryOf(s, s.player)).toMatchObject({
      status: 'removed',
      removedByUserId: s.captain.userId,
    });
    expect((await teamRow(s))?.rosterCount).toBe(2);
    await expectRosterCountMatches(s);
  });

  test('a removed player loses the team from their list and their access to its page, and can be invited again', async () => {
    const s = await setup();
    expect(await s.as(s.player).query(api.teams.listMine, {})).toHaveLength(1);
    await remove(s, s.player);
    expect(await s.as(s.player).query(api.teams.listMine, {})).toEqual([]);
    await expect(
      s.as(s.player).query(api.teams.getForMember, { teamId: s.sharks }),
    ).rejects.toMatchObject({ data: { code: FORBIDDEN_CODE } });
    const invited = await s.as(s.captain).action(api.teamInvites.create, {
      teamId: s.sharks,
      email: 'player@example.test',
    });
    expect(typeof invited.inviteId).toBe('string');
  });

  test('the count equals a recount of rostered entries after removals and a rejoin', async () => {
    const s = await setup();
    await remove(s, s.player);
    await remove(s, s.teammate, s.organizer);
    await expectRosterCountMatches(s);
    await s.t.run(async (ctx) => {
      await addRosterEntry(ctx, (await ctx.db.get('teams', s.sharks))!, {
        userId: s.player.userId,
        source: 'invite',
        addedByUserId: s.captain.userId,
      });
    });
    expect((await teamRow(s))?.rosterCount).toBe(2);
    await expectRosterCountMatches(s);
    await expectRosterCountMatches(s, s.rivals);
  });
});
