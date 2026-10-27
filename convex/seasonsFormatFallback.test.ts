/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const identity = {
  subject: 'admin',
  issuer: 'http://127.0.0.1:3211',
  email: 'admin@example.test',
  emailVerified: false,
  name: 'admin',
  sessionId: 's1',
};

const DATES = {
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-30',
  minimumRosterSize: 6,
  status: 'published' as const,
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Sand 4s',
          sport: 'beachVolleyball',
          locations: ['Alpha Field'],
          division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
        },
      ],
    });
    const league = (await ctx.db.query('leagues').collect())[0];
    const userId = await ctx.db.insert('users', {
      authUserId: 'admin',
      name: 'admin',
      adultConfirmedAt: 1,
    });
    await ctx.db.insert('memberships', { userId, organizationId, role: 'orgAdmin', leagueIds: [] });
    await ctx.db.patch('leagues', league._id, { publishedSeasonCount: 2 });
    const insert = (slug: string, startDate: string, shape: object) =>
      ctx.db.insert('seasons', {
        ...DATES,
        organizationId,
        leagueId: league._id,
        name: slug,
        slug,
        startDate,
        ...shape,
      });
    await insert('only-format', '2027-06-06', { format: '4v4' });
    await insert('only-players', '2027-06-05', { playersPerSide: 4 });
    return { leagueId: league._id };
  });
  return { t, ...ids, admin: t.withIdentity(identity) };
}

describe('readers on both season shapes', () => {
  test('the organizer’s list shows the same format text and minimum for both', async () => {
    const { admin, leagueId } = await setup();
    const rows = await admin.query(api.seasons.listForOrganizer, { leagueId });
    expect(rows.map((row) => [row.slug, row.formatName, row.minimumRosterSize])).toEqual([
      ['only-format', '4v4', 6],
      ['only-players', '4v4', 6],
    ]);
  });

  test('the public league page’s season rows show the same format text for both', async () => {
    const { t } = await setup();
    const page = await t.query(api.seasons.listPublic, {
      orgSlug: 'org-a',
      leagueSlug: 'sand-4s',
      page: 1,
    });
    expect(page.rows.map((row) => [row.slug, row.formatName])).toEqual([
      ['only-format', '4v4'],
      ['only-players', '4v4'],
    ]);
  });

  test.each(['only-format', 'only-players'])(
    'the public season page for %s shows 4v4 and its minimum',
    async (seasonSlug) => {
      const { t } = await setup();
      const page = await t.query(api.seasons.getPublicPage, {
        orgSlug: 'org-a',
        leagueSlug: 'sand-4s',
        seasonSlug,
      });
      expect(page).toMatchObject({ formatName: '4v4', minimumRosterSize: 6 });
    },
  );
});

describe('seasons.create', () => {
  test('stores the players per side of the league and no format', async () => {
    const { t, admin, leagueId } = await setup();
    const { seasonId } = await admin.mutation(api.seasons.create, {
      leagueId,
      name: 'Fall',
      slug: 'fall',
      startDate: '2027-09-01',
      endDate: '2027-11-01',
      registrationDeadline: '2027-08-01',
    });
    const row = await t.run((ctx) => ctx.db.get('seasons', seasonId));
    expect(row?.playersPerSide).toBe(4);
    expect(row).not.toHaveProperty('format');
  });
});
