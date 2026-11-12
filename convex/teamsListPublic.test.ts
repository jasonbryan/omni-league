/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { publicTeamsValidator } from './lib/publicPage';
import { PUBLIC_LIST_MAX_PAGE } from './lib/publicList';
import { insertTeamWithCaptain } from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason, defaultDivision } from './lib/tenantWrites';
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

/** Inserted out of name order, with mixed case, so the order the page shows comes from `sortName`. */
const SEVEN_TEAMS = [
  'pier pressure',
  'Block Party',
  'Net Gains',
  'Zero Chill',
  'ace of spades',
  'Dig Deep',
  'Bump Set Sunburn',
];
const BY_NAME = [
  'ace of spades',
  'Block Party',
  'Bump Set Sunburn',
  'Dig Deep',
  'Net Gains',
  'pier pressure',
  'Zero Chill',
];

const SLUGS = { orgSlug: 'gulf-coast', leagueSlug: 'coed-4s', seasonSlug: 'summer-2030' };

async function leagueOf(ctx: MutationCtx, organizationId: Id<'organizations'>, slug: string) {
  return (await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organizationId).eq('slug', slug),
    )
    .unique())!;
}

async function addTeams(ctx: MutationCtx, seasonId: Id<'seasons'>, names: readonly string[]) {
  for (const name of names) {
    const captainUserId = await ctx.db.insert('users', {
      authUserId: `captain-${seasonId}-${name}`,
      name: `Captain of ${name}`,
      adultConfirmedAt: 1,
    });
    await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', seasonId))!, {
      name,
      captainUserId,
    });
  }
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const gulf = await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
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
        {
          name: 'Draft 4s',
          sport: 'beachVolleyball',
          locations: ['Alpha Beach'],
          status: 'draft',
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const coed = await leagueOf(ctx, gulf, 'coed-4s');
    const summer = await insertSeason(ctx, coed, season('Summer 2030', 'summer-2030'), 'published');
    const fall = await insertSeason(
      ctx,
      (await ctx.db.get('leagues', coed._id))!,
      season('Fall 2030', 'fall-2030'),
      'published',
    );
    const draft = await insertSeason(
      ctx,
      (await ctx.db.get('leagues', coed._id))!,
      season('Draft Season', 'draft-season'),
      'draft',
    );
    const mens = await leagueOf(ctx, gulf, 'mens-2s');
    const mensOnly = await insertSeason(ctx, mens, season('Mens Only', 'mens-only'), 'published');
    const draftLeague = await leagueOf(ctx, gulf, 'draft-4s');
    const ofDraftLeague = await insertSeason(
      ctx,
      draftLeague,
      season('Summer 2030', 'summer-2030'),
      'published',
    );
    await addTeams(ctx, summer, SEVEN_TEAMS);
    await addTeams(ctx, fall, ['Fall Only']);
    await addTeams(ctx, draft, ['Draft Team']);
    await addTeams(ctx, mensOnly, ['Mens Team']);
    await addTeams(ctx, ofDraftLeague, ['Draft League Team']);
    return { summer, fall };
  });
  return { t, ...ids };
}

describe('teams.listPublic', () => {
  test('returns 5 names a page by name ignoring case, with the page, page count, and total', async () => {
    const { t } = await setup();
    const first = await t.query(api.teams.listPublic, { ...SLUGS, page: 1 });
    expect(first).toEqual({
      rows: BY_NAME.slice(0, 5).map((name) => ({ name })),
      page: 1,
      pageCount: 2,
      total: 7,
    });
    const second = await t.query(api.teams.listPublic, { ...SLUGS, page: 2 });
    expect(second).toEqual({
      rows: BY_NAME.slice(5).map((name) => ({ name })),
      page: 2,
      pageCount: 2,
      total: 7,
    });
  });

  test('returns team names only, which the returns validator accepts: no id, captain, player, or email', async () => {
    const { t } = await setup();
    const result = await t.query(api.teams.listPublic, { ...SLUGS, page: 1 });
    for (const row of result.rows) expect(Object.keys(row)).toEqual(['name']);
    expect(Object.keys(result).sort()).toEqual(['page', 'pageCount', 'rows', 'total']);
    expect(JSON.stringify(result)).not.toMatch(/captain|@example\.test|"_id"|teamId/i);
    expect(publicTeamsValidator.kind).toBe('object');
    expect(Object.keys(publicTeamsValidator.fields.rows.element.fields)).toEqual(['name']);
  });

  test('a signed-in caller gets the same result as an anonymous one', async () => {
    const { t } = await setup();
    const anonymous = await t.query(api.teams.listPublic, { ...SLUGS, page: 2 });
    const signedIn = await t
      .withIdentity(identity('captain-x'))
      .query(api.teams.listPublic, { ...SLUGS, page: 2 });
    expect(signedIn).toEqual(anonymous);
  });

  test.each([0, -1, 3, 9, PUBLIC_LIST_MAX_PAGE + 1, 1.5, Number.NaN])(
    'page %s, outside 1 to the page count or not a whole number, returns page 1',
    async (page) => {
      const { t } = await setup();
      const result = await t.query(api.teams.listPublic, { ...SLUGS, page });
      expect(result.page).toBe(1);
      expect(result.rows.map((row) => row.name)).toEqual(BY_NAME.slice(0, 5));
      expect(result.total).toBe(7);
    },
  );

  test('lists only the season’s own teams', async () => {
    const { t } = await setup();
    const fall = await t.query(api.teams.listPublic, {
      ...SLUGS,
      seasonSlug: 'fall-2030',
      page: 1,
    });
    expect(fall).toEqual({ rows: [{ name: 'Fall Only' }], page: 1, pageCount: 1, total: 1 });
  });

  test.each([
    ['a draft season', { ...SLUGS, seasonSlug: 'draft-season' }],
    ['a published season of a draft league', { ...SLUGS, leagueSlug: 'draft-4s' }],
    ['an unknown season slug', { ...SLUGS, seasonSlug: 'no-such-season' }],
    ['an unknown league slug', { ...SLUGS, leagueSlug: 'no-such-league' }],
    ['an unknown organization slug', { ...SLUGS, orgSlug: 'no-such-org' }],
    ['a season slug of another league', { ...SLUGS, seasonSlug: 'mens-only' }],
    ['a malformed slug', { ...SLUGS, seasonSlug: 'Summer 2030!' }],
  ])('%s gives no rows and a total of 0', async (_label, slugs) => {
    const { t } = await setup();
    for (const page of [1, 2]) {
      expect(await t.query(api.teams.listPublic, { ...slugs, page })).toEqual({
        rows: [],
        page: 1,
        pageCount: 0,
        total: 0,
      });
    }
  });

  test('a published season with no team gives no rows and a total of 0', async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      const organization = (await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'gulf-coast'))
        .unique())!;
      const coed = await leagueOf(ctx, organization._id, 'coed-4s');
      await insertSeason(ctx, coed, season('Winter 2030', 'winter-2030'), 'published');
    });
    expect(
      await t.query(api.teams.listPublic, { ...SLUGS, seasonSlug: 'winter-2030', page: 1 }),
    ).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test('a team that registers is in the next result, and the total counts it', async () => {
    const { t, summer } = await setup();
    await t.run((ctx) => addTeams(ctx, summer, ['Aardvarks']));
    const result = await t.query(api.teams.listPublic, { ...SLUGS, page: 1 });
    expect(result.total).toBe(8);
    expect(result.rows[0]).toEqual({ name: 'Aardvarks' });
  });
});
