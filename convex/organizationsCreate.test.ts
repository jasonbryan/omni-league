import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { DEMO_ORGANIZATION_SLUGS } from './lib/slugs';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// `organizations.create` and `organizations.listMine` (#64). Identities are faked the way ADR 0008
// "Testing" shows.

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
  await t.run(async (ctx) => {
    for (const authUserId of ['user-a', 'user-b']) {
      await ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    }
  });
  return { t, a: t.withIdentity(identity('user-a')), b: t.withIdentity(identity('user-b')) };
}

type T = Awaited<ReturnType<typeof setup>>['t'];

const counts = (t: T) =>
  t.run(async (ctx) => ({
    organizations: (await ctx.db.query('organizations').collect()).length,
    memberships: (await ctx.db.query('memberships').collect()).length,
    sportLocations: (await ctx.db.query('sportLocations').collect()).length,
  }));

/** The `ConvexError` data a refused call carries, or fails the test. */
async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

const FORMAT_MESSAGE =
  'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.';

describe('organizations.create', () => {
  test('creates the organization with its counters, and the caller as its org admin', async () => {
    const { t, a } = await setup();
    const result = await a.mutation(api.organizations.create, {
      name: '  Coastal Bend Rec Club  ',
      slug: 'coastal-bend-rec-club',
    });
    expect(result).toEqual({ slug: 'coastal-bend-rec-club' });
    await t.run(async (ctx) => {
      const organizations = await ctx.db.query('organizations').collect();
      expect(organizations).toHaveLength(1);
      const organization = organizations[0];
      // The writer contract (#100, #101): the counters exist from the first write.
      expect(organization).toMatchObject({
        name: 'Coastal Bend Rec Club',
        slug: 'coastal-bend-rec-club',
        leagueCount: 0,
        locationCount: 0,
        sportLeagueCounts: {},
        sportLocationCounts: {},
      });
      expect(await ctx.db.query('sportLocations').collect()).toHaveLength(0);
      const user = await ctx.db
        .query('users')
        .withIndex('by_authUserId', (q) => q.eq('authUserId', 'user-a'))
        .unique();
      const memberships = await ctx.db.query('memberships').collect();
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({
        userId: user!._id,
        organizationId: organization._id,
        role: 'orgAdmin',
        leagueIds: [],
      });
    });
  });

  test('the new organization has a public page with empty totals', async () => {
    const { t, a } = await setup();
    await a.mutation(api.organizations.create, { name: 'Empty Org', slug: 'empty-org' });
    await expect(t.query(api.organizations.getPublicPage, { slug: 'empty-org' })).resolves.toEqual({
      name: 'Empty Org',
      slug: 'empty-org',
      leagueCount: 0,
      locationCount: 0,
      sportCount: 0,
      sports: [],
    });
  });

  test('refuses a slug already taken, by a created or a seeded organization, and creates nothing', async () => {
    const { t, a, b } = await setup();
    await a.mutation(api.organizations.create, { name: 'First', slug: 'first-org' });
    await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Seeded', slug: 'seeded-org' },
        locations: [],
        leagues: [],
      }),
    );
    const before = await counts(t);
    for (const slug of ['first-org', 'seeded-org']) {
      const data = await refusal(b.mutation(api.organizations.create, { name: 'Second', slug }));
      expect(data).toEqual({
        field: 'slug',
        code: 'slugTaken',
        message: `${slug} is already taken. Choose another slug.`,
      });
    }
    expect(await counts(t)).toEqual(before);
  });

  test('refuses malformed, too short or long, and reserved slugs with the format message', async () => {
    const { t, a } = await setup();
    const slugs = [
      'ab',
      'Bad-Slug',
      'a--b',
      '-ab',
      'ab-',
      'a b',
      ' abc',
      'new',
      'a'.repeat(61),
      ...DEMO_ORGANIZATION_SLUGS,
    ];
    expect(slugs).toHaveLength(14);
    for (const slug of slugs) {
      const data = await refusal(a.mutation(api.organizations.create, { name: 'Org', slug }));
      expect(data, slug).toEqual({ field: 'slug', code: 'slugInvalid', message: FORMAT_MESSAGE });
    }
    expect(await counts(t)).toEqual({ organizations: 0, memberships: 0, sportLocations: 0 });
  });

  test('refuses an empty slug with its own message', async () => {
    const { t, a } = await setup();
    const data = await refusal(a.mutation(api.organizations.create, { name: 'Org', slug: '' }));
    expect(data).toEqual({
      field: 'slug',
      code: 'slugEmpty',
      message: 'Enter a slug for your public page’s address.',
    });
    expect((await counts(t)).organizations).toBe(0);
  });

  test('accepts a 3-character and a 60-character slug', async () => {
    const { t, a } = await setup();
    await a.mutation(api.organizations.create, { name: 'Short', slug: 'abc' });
    await a.mutation(api.organizations.create, { name: 'Long', slug: 'a'.repeat(60) });
    expect((await counts(t)).organizations).toBe(2);
  });

  test('refuses an empty, whitespace-only, and 101-character name, and creates nothing', async () => {
    const { t, a } = await setup();
    for (const name of ['', '   ', ' \t\n ']) {
      const data = await refusal(
        a.mutation(api.organizations.create, { name, slug: 'valid-slug' }),
      );
      expect(data, JSON.stringify(name)).toEqual({
        field: 'name',
        code: 'nameEmpty',
        message: 'Enter your organization’s name.',
      });
    }
    const long = await refusal(
      a.mutation(api.organizations.create, { name: 'n'.repeat(101), slug: 'valid-slug' }),
    );
    expect(long).toEqual({
      field: 'name',
      code: 'nameTooLong',
      message: 'Use 100 characters or fewer. This name has 101.',
    });
    expect(await counts(t)).toEqual({ organizations: 0, memberships: 0, sportLocations: 0 });
  });

  test('counts the name after trimming: 100 characters with spaces around pass', async () => {
    const { t, a } = await setup();
    await a.mutation(api.organizations.create, {
      name: ` ${'n'.repeat(100)} `,
      slug: 'valid-slug',
    });
    expect((await counts(t)).organizations).toBe(1);
  });

  test('checks the name before the slug', async () => {
    const { a } = await setup();
    const data = await refusal(a.mutation(api.organizations.create, { name: '', slug: 'new' }));
    expect(data.field).toBe('name');
  });

  test('throws for an unauthenticated caller and writes nothing', async () => {
    const { t } = await setup();
    await expect(
      t.mutation(api.organizations.create, { name: 'Org', slug: 'valid-slug' }),
    ).rejects.toThrow('Sign in required');
    expect(await counts(t)).toEqual({ organizations: 0, memberships: 0, sportLocations: 0 });
  });

  test('throws for an identity with no users row and writes nothing', async () => {
    const { t } = await setup();
    await expect(
      t
        .withIdentity(identity('ghost'))
        .mutation(api.organizations.create, { name: 'Org', slug: 'valid-slug' }),
    ).rejects.toThrow('Sign in required');
    expect((await counts(t)).organizations).toBe(0);
  });
});

describe('organizations.listMine', () => {
  test('returns [] with no identity, and for a user with no membership', async () => {
    const { t, a } = await setup();
    await expect(t.query(api.organizations.listMine, {})).resolves.toEqual([]);
    await expect(a.query(api.organizations.listMine, {})).resolves.toEqual([]);
    await expect(
      t.withIdentity(identity('ghost')).query(api.organizations.listMine, {}),
    ).resolves.toEqual([]);
  });

  test("lists only the caller's own memberships, with role, sorted by name ignoring case", async () => {
    const { t, a, b } = await setup();
    await a.mutation(api.organizations.create, { name: 'zebra Club', slug: 'zebra-club' });
    await a.mutation(api.organizations.create, { name: 'Alpha Club', slug: 'alpha-club' });
    await a.mutation(api.organizations.create, { name: 'beta Club', slug: 'beta-club' });
    await b.mutation(api.organizations.create, { name: 'Bob Club', slug: 'bob-club' });

    // A league organizer membership of user A in B's organization.
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_authUserId', (q) => q.eq('authUserId', 'user-a'))
        .unique();
      const organization = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'bob-club'))
        .unique();
      await ctx.db.insert('memberships', {
        userId: user!._id,
        organizationId: organization!._id,
        role: 'leagueOrganizer',
        leagueIds: [],
      });
    });

    await expect(a.query(api.organizations.listMine, {})).resolves.toEqual([
      { name: 'Alpha Club', slug: 'alpha-club', role: 'orgAdmin' },
      { name: 'beta Club', slug: 'beta-club', role: 'orgAdmin' },
      { name: 'Bob Club', slug: 'bob-club', role: 'leagueOrganizer' },
      { name: 'zebra Club', slug: 'zebra-club', role: 'orgAdmin' },
    ]);
    await expect(b.query(api.organizations.listMine, {})).resolves.toEqual([
      { name: 'Bob Club', slug: 'bob-club', role: 'orgAdmin' },
    ]);
  });

  test('takes no argument that could name another user', async () => {
    const { a } = await setup();
    await expect(
      a.query(api.organizations.listMine, { userId: 'x' } as unknown as Record<string, never>),
    ).rejects.toThrow(/userId/);
  });
});

describe('organizations.create, edge cases (tester)', () => {
  test('two simultaneous calls for one slug create exactly one organization and one membership', async () => {
    const { t, a, b } = await setup();
    const results = await Promise.allSettled([
      a.mutation(api.organizations.create, { name: 'Race A', slug: 'race-slug' }),
      b.mutation(api.organizations.create, { name: 'Race B', slug: 'race-slug' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await counts(t)).toEqual({ organizations: 1, memberships: 1, sportLocations: 0 });
  });

  test('one user may create several organizations; each membership is its own row', async () => {
    const { t, a } = await setup();
    await a.mutation(api.organizations.create, { name: 'One', slug: 'one-org' });
    await a.mutation(api.organizations.create, { name: 'Two', slug: 'two-org' });
    expect((await counts(t)).memberships).toBe(2);
  });

  test('a slug with uppercase, unicode, a slash, or a dot is refused and nothing is created', async () => {
    const { t, a } = await setup();
    for (const slug of ['ABC', 'caf\u00e9', 'a/b', 'a.b', 'a_b', 'abc\n', '../x']) {
      const data = await refusal(a.mutation(api.organizations.create, { name: 'Org', slug }));
      expect(data.code, JSON.stringify(slug)).toBe('slugInvalid');
    }
    expect((await counts(t)).organizations).toBe(0);
  });

  test('listMine skips a membership whose organization no longer exists', async () => {
    const { t, a } = await setup();
    await a.mutation(api.organizations.create, { name: 'Gone', slug: 'gone-org' });
    await a.mutation(api.organizations.create, { name: 'Kept', slug: 'kept-org' });
    await t.run(async (ctx) => {
      const gone = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'gone-org'))
        .unique();
      await ctx.db.delete('organizations', gone!._id);
    });
    await expect(a.query(api.organizations.listMine, {})).resolves.toEqual([
      { name: 'Kept', slug: 'kept-org', role: 'orgAdmin' },
    ]);
  });
});
