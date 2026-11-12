/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { FREE_AGENTS_LIST_MINE_LIMIT } from './freeAgents';
import { insertFreeAgent, insertPlacedFreeAgent, insertTeamWithCaptain } from './lib/rosterWrites';
import { defaultDivision, insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
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

const season = (name: string, slug: string): NewSeason => ({
  name,
  slug,
  startDate: '2030-06-01',
  endDate: '2030-08-30',
  registrationDeadline: '2030-05-20',
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

const user = (ctx: MutationCtx, authUserId: string) =>
  ctx.db.insert('users', { authUserId, name: `Name ${authUserId}`, adultConfirmedAt: 1 });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const gulf = await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Coed 7v7 Rec',
          sport: 'soccer',
          locations: ['Alpha Beach'],
          division: defaultDivision('soccer'),
        },
        {
          name: 'Sunday Reverse Coed 4s',
          sport: 'beachVolleyball',
          locations: ['Alpha Beach'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const riverbend = await insertTenant(ctx, {
      organization: { name: 'Riverbend Softball Association', slug: 'riverbend' },
      locations: [{ name: 'River Park', address: '9 River Rd' }],
      leagues: [
        {
          name: 'Wednesday Coed Slow-Pitch',
          sport: 'softball',
          locations: ['River Park'],
          division: defaultDivision('softball'),
        },
      ],
    });
    const sevens = await leagueOf(ctx, gulf, 'coed-7v7-rec');
    const sunday = await leagueOf(ctx, gulf, 'sunday-reverse-coed-4s');
    const wednesday = await leagueOf(ctx, riverbend, 'wednesday-coed-slow-pitch');
    const summer = await insertSeason(
      ctx,
      sevens,
      season('Summer 2030', 'summer-2030'),
      'published',
    );
    const sundaySummer = await insertSeason(
      ctx,
      sunday,
      season('Summer 2030', 'summer-2030'),
      'published',
    );
    const spring = await insertSeason(
      ctx,
      wednesday,
      { ...season('Spring 2030', 'spring-2030'), registrationDeadline: '2030-02-15' },
      'published',
    );
    return {
      gulf,
      summer,
      sundaySummer,
      spring,
      x: await user(ctx, 'x'),
      y: await user(ctx, 'y'),
      z: await user(ctx, 'z'),
    };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const listMineAs = (s: Setup, authUserId: string) =>
  s.t.withIdentity(identity(authUserId)).query(api.freeAgents.listMine, {});

const waitIn = (s: Setup, seasonId: Id<'seasons'>, userId: Id<'users'>) =>
  s.t.run(async (ctx) => {
    await insertFreeAgent(ctx, (await ctx.db.get('seasons', seasonId))!, userId);
  });

describe('freeAgents.listMine', () => {
  test('returns the caller’s waiting row with its league, season, organization, deadline and start date', async () => {
    const s = await setup();
    await waitIn(s, s.summer, s.x);
    const [row, ...rest] = await listMineAs(s, 'x');
    expect(rest).toEqual([]);
    const [stored] = await s.t.run((ctx) => ctx.db.query('freeAgents').collect());
    expect(row).toEqual({
      freeAgentId: stored?._id,
      leagueName: 'Coed 7v7 Rec',
      seasonName: 'Summer 2030',
      organizationName: 'Gulf Coast Sport & Social',
      registrationDeadline: '2030-05-20',
      seasonStartDate: '2030-06-01',
    });
  });

  test('returns only the caller’s rows: X sees X’s and Y sees Y’s', async () => {
    const s = await setup();
    await waitIn(s, s.summer, s.x);
    await waitIn(s, s.spring, s.x);
    await waitIn(s, s.summer, s.y);
    expect((await listMineAs(s, 'x')).map((row) => row.leagueName).sort()).toEqual([
      'Coed 7v7 Rec',
      'Wednesday Coed Slow-Pitch',
    ]);
    expect((await listMineAs(s, 'y')).map((row) => row.leagueName)).toEqual(['Coed 7v7 Rec']);
    expect(await listMineAs(s, 'z')).toEqual([]);
  });

  test('returns [] with no identity and for an identity with no user row', async () => {
    const s = await setup();
    await waitIn(s, s.summer, s.x);
    expect(await s.t.query(api.freeAgents.listMine, {})).toEqual([]);
    expect(await listMineAs(s, 'no-users-row')).toEqual([]);
  });

  test('leaves out a placed row, which is on a team', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const sundaySeason = (await ctx.db.get('seasons', s.sundaySummer))!;
      const teamId = await insertTeamWithCaptain(ctx, sundaySeason, {
        name: 'Sand Sharks',
        captainUserId: s.y,
      });
      await insertPlacedFreeAgent(ctx, (await ctx.db.get('teams', teamId))!, s.x);
    });
    await waitIn(s, s.summer, s.x);
    expect((await listMineAs(s, 'x')).map((row) => row.leagueName)).toEqual(['Coed 7v7 Rec']);
  });

  test('lists the newest registration first', async () => {
    const s = await setup();
    await waitIn(s, s.summer, s.x);
    await waitIn(s, s.spring, s.x);
    await waitIn(s, s.sundaySummer, s.x);
    expect((await listMineAs(s, 'x')).map((row) => row.leagueName)).toEqual([
      'Sunday Reverse Coed 4s',
      'Wednesday Coed Slow-Pitch',
      'Coed 7v7 Rec',
    ]);
  });

  test(`returns at most ${FREE_AGENTS_LIST_MINE_LIMIT} rows, the newest`, async () => {
    const s = await setup();
    const extra = FREE_AGENTS_LIST_MINE_LIMIT + 1;
    const seasons = await s.t.run(async (ctx) => {
      const league = await leagueOf(ctx, s.gulf, 'coed-7v7-rec');
      const ids: Id<'seasons'>[] = [];
      for (let n = 1; n <= extra; n++) {
        ids.push(
          await insertSeason(ctx, league, season(`Season ${n}`, `season-${n}`), 'published'),
        );
      }
      return ids;
    });
    for (const seasonId of seasons) await waitIn(s, seasonId, s.x);
    const rows = await listMineAs(s, 'x');
    expect(rows).toHaveLength(FREE_AGENTS_LIST_MINE_LIMIT);
    expect(rows[0]?.seasonName).toBe(`Season ${extra}`);
    expect(rows.map((row) => row.seasonName)).not.toContain('Season 1');
  });
});
