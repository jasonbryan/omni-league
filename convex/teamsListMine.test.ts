/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { addRosterEntry, insertTeamWithCaptain, removeRosterEntry } from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { TEAMS_LIST_MINE_LIMIT } from './teams';
import { modules } from './test.setup';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const season = (name: string, slug: string, startDate: string): NewSeason => ({
  name,
  slug,
  startDate,
  endDate: '2031-12-30',
  registrationDeadline: '2030-01-10',
  playersPerSide: 4,
  minimumRosterSize: 4,
});

async function leagueOf(ctx: MutationCtx, organizationId: Id<'organizations'>, slug: string) {
  return (await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organizationId).eq('slug', slug),
    )
    .unique())!;
}

async function user(ctx: MutationCtx, authUserId: string): Promise<Id<'users'>> {
  return ctx.db.insert('users', { authUserId, name: `Name ${authUserId}`, adultConfirmedAt: 1 });
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const gulf = await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        { name: 'Sunday Reverse Coed 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
      ],
    });
    const riverbend = await insertTenant(ctx, {
      organization: { name: 'Riverbend Softball Association', slug: 'riverbend' },
      locations: [{ name: 'River Park', address: '9 River Rd' }],
      leagues: [
        { name: 'Wednesday Coed Slow-Pitch', sport: 'softball', locations: ['River Park'] },
      ],
    });
    const sunday = await leagueOf(ctx, gulf, 'sunday-reverse-coed-4s');
    const summer = await insertSeason(
      ctx,
      sunday,
      season('Summer 2030', 'summer-2030', '2030-06-01'),
      'published',
    );
    const wednesday = await leagueOf(ctx, riverbend, 'wednesday-coed-slow-pitch');
    const spring = await insertSeason(
      ctx,
      wednesday,
      season('Spring 2030', 'spring-2030', '2030-03-01'),
      'published',
    );
    const x = await user(ctx, 'x');
    const y = await user(ctx, 'y');
    const captainB = await user(ctx, 'captain-b');
    const sandSharks = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', summer))!, {
      name: 'Sand Sharks',
      captainUserId: x,
    });
    const rattlers = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', spring))!, {
      name: 'Riverbend Rattlers',
      captainUserId: captainB,
    });
    await addRosterEntry(ctx, (await ctx.db.get('teams', rattlers))!, {
      userId: x,
      source: 'invite',
      addedByUserId: captainB,
    });
    const blockParty = await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', summer))!, {
      name: 'Block Party',
      captainUserId: y,
    });
    return { x, y, captainB, summer, spring, sandSharks, rattlers, blockParty };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const listMineAs = (s: Setup, authUserId: string) =>
  s.t.withIdentity(identity(authUserId)).query(api.teams.listMine, {});

describe('teams.listMine', () => {
  test('lists the caller’s teams with their roles, newest season first', async () => {
    const s = await setup();
    expect(await listMineAs(s, 'x')).toEqual([
      {
        teamId: s.sandSharks,
        teamName: 'Sand Sharks',
        seasonName: 'Summer 2030',
        leagueName: 'Sunday Reverse Coed 4s',
        organizationName: 'Gulf Coast Sport & Social',
        role: 'captain',
      },
      {
        teamId: s.rattlers,
        teamName: 'Riverbend Rattlers',
        seasonName: 'Spring 2030',
        leagueName: 'Wednesday Coed Slow-Pitch',
        organizationName: 'Riverbend Softball Association',
        role: 'player',
      },
    ]);
  });

  test('another user gets only their own teams, never the caller’s', async () => {
    const s = await setup();
    expect((await listMineAs(s, 'y')).map((row) => row.teamId)).toEqual([s.blockParty]);
    expect((await listMineAs(s, 'x')).map((row) => row.teamId)).not.toContain(s.blockParty);
  });

  test('an unauthenticated caller gets []', async () => {
    const s = await setup();
    expect(await s.t.query(api.teams.listMine, {})).toEqual([]);
  });

  test('a signed-in caller with no users row, or on no team, gets []', async () => {
    const s = await setup();
    expect(await listMineAs(s, 'no-users-row')).toEqual([]);
    await s.t.run(async (ctx) => {
      await user(ctx, 'teamless');
    });
    expect(await listMineAs(s, 'teamless')).toEqual([]);
  });

  test('a team whose entry for the caller was removed is not listed', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const entry = (
        await ctx.db
          .query('rosterEntries')
          .withIndex('by_userId_and_status', (q) => q.eq('userId', s.x).eq('status', 'rostered'))
          .collect()
      ).find((row) => row.teamId === s.rattlers)!;
      await removeRosterEntry(ctx, entry, s.captainB);
    });
    expect((await listMineAs(s, 'x')).map((row) => row.teamName)).toEqual(['Sand Sharks']);
  });

  test(`returns the ${TEAMS_LIST_MINE_LIMIT} most recently added entries, sorted by season start, newest first`, async () => {
    const s = await setup();
    const count = TEAMS_LIST_MINE_LIMIT + 1;
    const names = await s.t.run(async (ctx) => {
      const many = await user(ctx, 'many');
      const owner = (await ctx.db.get(
        'organizations',
        (await ctx.db.get('seasons', s.summer))!.organizationId,
      ))!;
      const league = await leagueOf(ctx, owner._id, 'sunday-reverse-coed-4s');
      const added: { name: string; startDate: string }[] = [];
      for (let index = 0; index < count; index++) {
        // The first entry added has the latest season, so a cut made after sorting would keep it.
        const startDate =
          index === 0
            ? '2040-01-01'
            : new Date(Date.UTC(2031, 0, index)).toISOString().slice(0, 10);
        const seasonId = await insertSeason(
          ctx,
          (await ctx.db.get('leagues', league._id))!,
          season(`Season ${index}`, `season-${index}`, startDate),
          'published',
        );
        const name = `Team ${index}`;
        await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', seasonId))!, {
          name,
          captainUserId: many,
        });
        added.push({ name, startDate });
      }
      return added;
    });
    const expected = names
      .slice(1)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))
      .map((row) => row.name);
    const rows = await listMineAs(s, 'many');
    expect(rows).toHaveLength(TEAMS_LIST_MINE_LIMIT);
    expect(rows.map((row) => row.teamName)).toEqual(expected);
  });
});
