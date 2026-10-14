/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// Hostile and boundary inputs to `seasons.create` that a form never sends (#125, tester): the
// mutation is public, so it must refuse them on its own. Nothing is written for any of them.

const identity = {
  subject: 'admin-a',
  issuer: 'http://127.0.0.1:3211',
  email: 'admin-a@example.test',
  emailVerified: false,
  name: 'admin-a',
  sessionId: 's1',
};

async function setup() {
  const t = convexTest(schema, modules);
  const leagueId = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const userId = await ctx.db.insert('users', {
      authUserId: 'admin-a',
      name: 'admin-a',
      adultConfirmedAt: 1,
    });
    await ctx.db.insert('memberships', {
      userId,
      organizationId,
      role: 'orgAdmin',
      leagueIds: [],
    });
    const league = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', 'coed-7v7'),
      )
      .unique();
    return league!._id;
  });
  return { t, leagueId, admin: t.withIdentity(identity) };
}

const valid = (leagueId: Awaited<ReturnType<typeof setup>>['leagueId']) => ({
  leagueId,
  name: 'Fall 2026',
  slug: 'fall-2026',
  startDate: '2026-09-01',
  endDate: '2026-11-15',
  registrationDeadline: '2026-08-25',
  format: '7v7' as const,
  minimumRosterSize: 7,
});

async function fieldOf(call: Promise<unknown>): Promise<string> {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string }>).data.field;
}

describe('seasons.create refuses input a form never sends', () => {
  test.each([
    'Fall-2026',
    'FALL-2026',
    'fall_2026',
    '-fall-2026',
    'fall-2026-',
    'fall--2026',
    'fall 2026',
    ' fall-2026',
    'fall-2026 ',
    'fall-2026\n',
    'fáll-2026',
    'fall-２０２６',
    'fall/2026',
    '../fall',
    'new',
    'ab',
    'a'.repeat(61),
  ])('the slug %j', async (slug) => {
    const s = await setup();
    expect(
      await fieldOf(s.admin.mutation(api.seasons.create, { ...valid(s.leagueId), slug })),
    ).toBe('slug');
    expect(await s.t.run((ctx) => ctx.db.query('seasons').collect())).toEqual([]);
  });

  test.each(['abc', 'a'.repeat(60), 'a-b-c', '2026-fall', '123'])(
    'the slug %j is allowed',
    async (slug) => {
      const s = await setup();
      await expect(
        s.admin.mutation(api.seasons.create, { ...valid(s.leagueId), slug }),
      ).resolves.toBeDefined();
    },
  );

  const BAD_DATES = [
    '2026-02-30',
    '2026-02-29',
    '2100-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-9-1',
    '26-09-01',
    '2026/09/01',
    '2026-09-01T00:00:00Z',
    '2026-09-01 ',
    ' 2026-09-01',
    '+2026-09-01',
    '0000-01-01',
    '２０２６-09-01',
    '275760-09-13',
    '',
    'tomorrow',
  ];
  test.each(BAD_DATES)('the date %j in each of the three date fields', async (date) => {
    const s = await setup();
    for (const field of ['startDate', 'endDate', 'registrationDeadline'] as const) {
      expect(
        await fieldOf(
          s.admin.mutation(api.seasons.create, { ...valid(s.leagueId), [field]: date }),
        ),
      ).toBe(field);
    }
    expect(await s.t.run((ctx) => ctx.db.query('seasons').collect())).toEqual([]);
  });

  test('leap days: 2028-02-29 and 2000-02-29 are real dates', async () => {
    const s = await setup();
    await expect(
      s.admin.mutation(api.seasons.create, {
        ...valid(s.leagueId),
        startDate: '2028-02-29',
        endDate: '2028-03-01',
        registrationDeadline: '2000-02-29',
      }),
    ).resolves.toBeDefined();
  });

  test.each([
    -1,
    0,
    6,
    100,
    7.5,
    7.0000001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    1e21,
  ])('the minimum roster size %s for 7v7', async (minimumRosterSize) => {
    const s = await setup();
    expect(
      await fieldOf(
        s.admin.mutation(api.seasons.create, { ...valid(s.leagueId), minimumRosterSize }),
      ),
    ).toBe('minimumRosterSize');
    expect(await s.t.run((ctx) => ctx.db.query('seasons').collect())).toEqual([]);
  });

  test('the first refusal is the first field in form order', async () => {
    const s = await setup();
    expect(
      await fieldOf(
        s.admin.mutation(api.seasons.create, {
          ...valid(s.leagueId),
          name: '',
          slug: '',
          startDate: '',
          minimumRosterSize: 0,
        }),
      ),
    ).toBe('name');
  });

  test('whitespace around the name is trimmed before the length check', async () => {
    const s = await setup();
    await expect(
      s.admin.mutation(api.seasons.create, {
        ...valid(s.leagueId),
        name: `  ${'x'.repeat(100)}\t\n `,
      }),
    ).resolves.toBeDefined();
    const [row] = await s.t.run((ctx) => ctx.db.query('seasons').collect());
    expect(row?.name).toBe('x'.repeat(100));
  });

  test('two creates of one slug started together make one season and one slugTaken refusal', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.admin.mutation(api.seasons.create, valid(s.leagueId)),
      s.admin.mutation(api.seasons.create, { ...valid(s.leagueId), name: 'Same slug, other name' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected')!;
    expect((rejected.reason as ConvexError<{ code: string }>).data.code).toBe('slugTaken');
    expect(await s.t.run((ctx) => ctx.db.query('seasons').collect())).toHaveLength(1);
  });

  test('a draft season changes no count the public page reads', async () => {
    const s = await setup();
    const snapshot = () =>
      s.t.run(async (ctx) => ({
        organizations: await ctx.db.query('organizations').collect(),
        sportLocations: await ctx.db.query('sportLocations').collect(),
      }));
    const before = await snapshot();
    const pageBefore = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    await s.admin.mutation(api.seasons.create, valid(s.leagueId));
    expect(await snapshot()).toEqual(before);
    expect(await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' })).toEqual(pageBefore);
    expect(JSON.stringify(pageBefore)).not.toContain('Fall 2026');
  });
});
