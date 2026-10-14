/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { isChoosableSlug } from './lib/slugs';
import { backfillTenantFields, insertLeague, insertTenant } from './lib/tenantWrites';
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

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [
        { name: 'bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Sand 2s', sport: 'beachVolleyball', locations: ['B Field'] }],
    });
    const locationIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds: [] });
      }
    };
    await member('admin-a', organizationA);
    await member('organizer-a', organizationA, 'leagueOrganizer');
    await member('admin-b', organizationB);
    await member('stranger', null);
    return {
      organizationA,
      organizationB,
      alpha: await locationIn(organizationA, 'Alpha Field'),
      bravo: await locationIn(organizationA, 'bravo Beach'),
      bField: await locationIn(organizationB, 'B Field'),
    };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    adminB: t.withIdentity(identity('admin-b')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const snapshot = (t: Setup['t']) =>
  t.run(async (ctx) => ({
    leagues: await ctx.db.query('leagues').collect(),
    organizations: await ctx.db.query('organizations').collect(),
    sportLocations: await ctx.db.query('sportLocations').collect(),
  }));

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
    ['league organizer of A', s.t.withIdentity(identity('organizer-a')), 'Not allowed'],
    ['org admin of B', s.adminB, 'Not allowed'],
    ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
  ] as const;
}

const valid = (s: Setup) => ({
  organizationId: s.organizationA,
  name: 'Sunday Reverse Coed 4s',
  slug: 'sunday-reverse-coed-4s',
  sport: 'beachVolleyball' as const,
  locationIds: [s.bravo],
});

describe('leagues.create', () => {
  test('inserts a draft with its sortName, in the right organization', async () => {
    const s = await setup();
    const { leagueId } = await s.adminA.mutation(api.leagues.create, valid(s));
    const league = await s.t.run((ctx) => ctx.db.get('leagues', leagueId));
    expect(league).toMatchObject({
      organizationId: s.organizationA,
      name: 'Sunday Reverse Coed 4s',
      slug: 'sunday-reverse-coed-4s',
      sport: 'beachVolleyball',
      locationIds: [s.bravo],
      status: 'draft',
      sortName: 'sunday reverse coed 4s',
    });
  });

  test('trims the name and keeps each location once', async () => {
    const s = await setup();
    const { leagueId } = await s.adminA.mutation(api.leagues.create, {
      ...valid(s),
      name: '  Padded Name  ',
      locationIds: [s.bravo, s.alpha, s.bravo],
    });
    const league = await s.t.run((ctx) => ctx.db.get('leagues', leagueId));
    expect(league?.name).toBe('Padded Name');
    expect(league?.locationIds).toEqual([s.bravo, s.alpha]);
  });

  test('a draft changes no counter and writes no sportLocations row', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.leagues.create, {
      ...valid(s),
      sport: 'soccer',
      locationIds: [s.bravo],
    });
    const after = await snapshot(s.t);
    expect(after.organizations).toEqual(before.organizations);
    expect(after.sportLocations).toEqual(before.sportLocations);
    expect(after.leagues).toHaveLength(before.leagues.length + 1);
  });

  test('refuses an empty name, one of only spaces, and one over 100 characters', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const name of ['', '   ']) {
      expect(await refusal(s.adminA.mutation(api.leagues.create, { ...valid(s), name }))).toEqual({
        field: 'name',
        code: 'nameEmpty',
        message: 'Enter the league’s name.',
      });
    }
    expect(
      await refusal(s.adminA.mutation(api.leagues.create, { ...valid(s), name: 'x'.repeat(101) })),
    ).toEqual({
      field: 'name',
      code: 'nameTooLong',
      message: 'Use 100 characters or fewer. This name has 101.',
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('accepts a name of exactly 100 characters', async () => {
    const s = await setup();
    await expect(
      s.adminA.mutation(api.leagues.create, { ...valid(s), name: 'x'.repeat(100) }),
    ).resolves.toBeDefined();
  });

  test('refuses an empty slug and a malformed, too short, too long, or reserved one', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    expect(
      await refusal(s.adminA.mutation(api.leagues.create, { ...valid(s), slug: '' })),
    ).toMatchObject({ field: 'slug', code: 'slugEmpty', message: 'Enter a slug for the league.' });
    for (const slug of [
      'Upper',
      'has space',
      '-lead',
      'trail-',
      'dou--ble',
      'ab',
      'a'.repeat(61),
      'new',
      'under_score',
    ]) {
      expect(
        await refusal(s.adminA.mutation(api.leagues.create, { ...valid(s), slug })),
        slug,
      ).toMatchObject({ field: 'slug', code: 'slugInvalid' });
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('accepts a slug of 3 and of 60 characters', async () => {
    const s = await setup();
    for (const slug of ['abc', 'a'.repeat(60)]) {
      await expect(
        s.adminA.mutation(api.leagues.create, { ...valid(s), slug }),
      ).resolves.toBeDefined();
    }
  });

  test('refuses a slug used in the organization, and allows the same slug in another one', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    expect(
      await refusal(s.adminA.mutation(api.leagues.create, { ...valid(s), slug: 'coed-7v7' })),
    ).toEqual({
      field: 'slug',
      code: 'slugTaken',
      message: 'coed-7v7 is already used by another league here. Choose another slug.',
    });
    expect(await snapshot(s.t)).toEqual(before);
    await expect(
      s.adminA.mutation(api.leagues.create, { ...valid(s), slug: 'sand-2s' }),
    ).resolves.toBeDefined();
  });

  test('a draft keeps its slug against a second create, so slugs stay unique', async () => {
    const s = await setup();
    await s.adminA.mutation(api.leagues.create, valid(s));
    expect(await refusal(s.adminA.mutation(api.leagues.create, valid(s)))).toMatchObject({
      field: 'slug',
      code: 'slugTaken',
    });
  });

  test('refuses a sport key outside the sport configuration', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await expect(
      s.adminA.mutation(api.leagues.create, {
        ...valid(s),
        // @ts-expect-error -- a key outside convex/lib/sports.ts
        sport: 'cricket',
      }),
    ).rejects.toThrow();
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses no location', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    expect(
      await refusal(s.adminA.mutation(api.leagues.create, { ...valid(s), locationIds: [] })),
    ).toEqual({
      field: 'locations',
      code: 'locationsEmpty',
      message: 'Choose at least one location.',
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test("refuses another organization's location, alone or among its own", async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const locationIds of [[s.bField], [s.bravo, s.bField]]) {
      await expect(
        s.adminA.mutation(api.leagues.create, { ...valid(s), locationIds }),
      ).rejects.toThrow('Not allowed');
    }
    await expect(
      s.adminB.mutation(api.leagues.create, {
        ...valid(s),
        organizationId: s.organizationB,
        locationIds: [s.alpha],
      }),
    ).rejects.toThrow('Not allowed');
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.mutation(api.leagues.create, valid(s)), label).rejects.toThrow(message);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });
});

describe('leagues.listForAdmin', () => {
  test('lists drafts and published leagues by name ignoring case, with sport name, status, and location names', async () => {
    const s = await setup();
    await s.adminA.mutation(api.leagues.create, {
      organizationId: s.organizationA,
      name: 'beta 4s',
      slug: 'beta-4s',
      sport: 'beachVolleyball',
      locationIds: [s.bravo, s.alpha],
    });
    await s.adminA.mutation(api.leagues.create, {
      organizationId: s.organizationA,
      name: 'Alpha Slow-Pitch',
      slug: 'alpha-slow-pitch',
      sport: 'softball',
      locationIds: [s.bravo],
    });
    const rows = await s.adminA.query(api.leagues.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(
      rows.map(({ leagueId, ...rest }) => (typeof leagueId === 'string' ? rest : null)),
    ).toEqual([
      {
        name: 'Alpha Slow-Pitch',
        slug: 'alpha-slow-pitch',
        sportName: 'Softball',
        status: 'draft',
        locationNames: ['bravo Beach'],
      },
      {
        name: 'beta 4s',
        slug: 'beta-4s',
        sportName: 'Beach volleyball',
        status: 'draft',
        locationNames: ['bravo Beach', 'Alpha Field'],
      },
      {
        name: 'Coed 7v7',
        slug: 'coed-7v7',
        sportName: 'Soccer',
        status: 'published',
        locationNames: ['Alpha Field'],
      },
    ]);
  });

  test("never returns another organization's leagues, and drops a location id of another organization", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const { leagueId } = await insertLeague(ctx, s.organizationA, {
        name: 'Crossed',
        sport: 'soccer',
        locations: [],
      });
      await ctx.db.patch('leagues', leagueId, { locationIds: [s.alpha, s.bField] });
    });
    const rows = await s.adminA.query(api.leagues.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(rows.map((row) => row.name)).toEqual(['Coed 7v7', 'Crossed']);
    expect(rows[1]?.locationNames).toEqual(['Alpha Field']);
  });

  test('returns [] for an organization with no leagues', async () => {
    const s = await setup();
    const rows = await s.adminB.query(api.leagues.listForAdmin, {
      organizationId: s.organizationB,
    });
    expect(rows.map((row) => row.name)).toEqual(['Sand 2s']);
    const empty = await s.t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', { name: 'E', slug: 'e-org' });
      const userId = await ctx.db.insert('users', {
        authUserId: 'empty-admin',
        name: 'x',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId,
        role: 'orgAdmin',
        leagueIds: [],
      });
      return organizationId;
    });
    await expect(
      s.t
        .withIdentity(identity('empty-admin'))
        .query(api.leagues.listForAdmin, { organizationId: empty }),
    ).resolves.toEqual([]);
  });

  test('a league row with no status is listed as a draft, never as published', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.insert('leagues', {
        organizationId: s.organizationA,
        name: 'Legacy',
        slug: 'legacy',
        sport: 'soccer',
        locationIds: [],
        sortName: 'legacy',
      }),
    );
    const rows = await s.adminA.query(api.leagues.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(rows.find((row) => row.name === 'Legacy')?.status).toBe('draft');
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.leagues.listForAdmin, { organizationId: s.organizationA }),
        label,
      ).rejects.toThrow(message);
    }
  });
});

describe('drafts stay off the public page (#66)', () => {
  test('listPublicLeagues returns only the published league and getPublicPage counts one', async () => {
    const s = await setup();
    await s.adminA.mutation(api.leagues.create, valid(s));
    const list = await s.t.query(api.organizations.listPublicLeagues, { slug: 'org-a', page: 1 });
    expect(list).toEqual({
      rows: [
        { name: 'Coed 7v7', slug: 'coed-7v7', sportName: 'Soccer', locationNames: ['Alpha Field'] },
      ],
      page: 1,
      pageCount: 1,
      total: 1,
    });
    const page = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    expect(page).toMatchObject({ leagueCount: 1, sportCount: 1 });
  });

  test("a draft of a sport leaves the sport list, the sport's leagues, and the sportLocations rows unchanged", async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    const pageBefore = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    await s.adminA.mutation(api.leagues.create, {
      ...valid(s),
      sport: 'soccer',
      locationIds: [s.bravo],
    });
    expect(await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' })).toEqual(pageBefore);
    expect(
      await s.t.query(api.organizations.listPublicLeagues, {
        slug: 'org-a',
        page: 1,
        sport: 'soccer',
      }),
    ).toMatchObject({ total: 1, rows: [{ name: 'Coed 7v7' }] });
    expect((await snapshot(s.t)).sportLocations).toEqual(before.sportLocations);
  });

  test('a draft of a sport with no published league does not add the sport', async () => {
    const s = await setup();
    await s.adminA.mutation(api.leagues.create, valid(s));
    const page = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    expect(page?.sports.map((sport) => sport.key)).toEqual(['soccer']);
    expect(
      await s.t.query(api.organizations.listPublicLeagues, {
        slug: 'org-a',
        page: 1,
        sport: 'beachVolleyball',
      }),
    ).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
  });

  test('drafts never take a place in a public page of published leagues', async () => {
    const s = await setup();
    for (let n = 0; n < 11; n++) {
      await s.adminA.mutation(api.leagues.create, {
        ...valid(s),
        name: `Aaa ${n}`,
        slug: `aaa-${n}`,
      });
    }
    expect(
      await s.t.query(api.organizations.listPublicLeagues, { slug: 'org-a', page: 1 }),
    ).toMatchObject({ rows: [{ name: 'Coed 7v7' }], total: 1 });
  });
});

describe('tenantWrites league slugs and status (#66)', () => {
  test('a generated league slug is always one a user could choose', async () => {
    const s = await setup();
    const slugs = await s.t.run(async (ctx) => {
      const made: string[] = [];
      for (const name of ['New', 'new', 'A', '5k', '!!!', 'Ab', 'x'.repeat(80), 'Coed 7v7']) {
        const { slug } = await insertLeague(ctx, s.organizationA, {
          name,
          sport: 'soccer',
          locations: ['Alpha Field'],
        });
        made.push(slug);
      }
      return made;
    });
    for (const slug of slugs) expect(isChoosableSlug(slug), slug).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs[0]).not.toBe('new');
  });

  test('a seed league is published and counted; a seed draft is neither counted nor listed', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await insertLeague(ctx, s.organizationA, {
        name: 'Published Seed',
        sport: 'softball',
        locations: ['bravo Beach'],
        status: 'published',
      });
      await insertLeague(ctx, s.organizationA, {
        name: 'Draft Seed',
        sport: 'softball',
        locations: ['bravo Beach'],
        status: 'draft',
      });
    });
    const organization = await s.t.run((ctx) => ctx.db.get('organizations', s.organizationA));
    expect(organization).toMatchObject({
      leagueCount: 2,
      sportLeagueCounts: { soccer: 1, softball: 1 },
      sportLocationCounts: { soccer: 1, softball: 1 },
    });
    const rows = await s.adminA.query(api.leagues.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(rows.map((row) => [row.name, row.status])).toEqual([
      ['Coed 7v7', 'published'],
      ['Draft Seed', 'draft'],
      ['Published Seed', 'published'],
    ]);
  });

  test('the backfill sets published on a league without a status, and recounts only published leagues', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert('organizations', { name: 'Old', slug: 'old-org' });
      const locationId = await ctx.db.insert('locations', {
        organizationId,
        name: 'Field',
        address: '1 Road',
        sortName: 'field',
      });
      const legacy = await ctx.db.insert('leagues', {
        organizationId,
        name: 'Legacy',
        slug: 'legacy',
        sport: 'soccer',
        locationIds: [locationId],
        sortName: 'legacy',
      });
      await ctx.db.insert('leagues', {
        organizationId,
        name: 'Fresh Draft',
        slug: 'fresh-draft',
        sport: 'soccer',
        locationIds: [locationId],
        sortName: 'fresh draft',
        status: 'draft',
      });
      return { organizationId, legacy };
    });
    const backfilled = await t.run((ctx) => backfillTenantFields(ctx));
    expect(backfilled).toEqual({ organizations: 1, locations: 0, leagues: 2 });
    await t.run(async (ctx) => {
      expect((await ctx.db.get('leagues', ids.legacy))?.status).toBe('published');
      const organization = await ctx.db.get('organizations', ids.organizationId);
      expect(organization).toMatchObject({
        leagueCount: 1,
        locationCount: 1,
        sportLeagueCounts: { soccer: 1 },
        sportLocationCounts: { soccer: 1 },
      });
      const rows = await ctx.db.query('sportLocations').collect();
      expect(rows.map((row) => row.leagueCount)).toEqual([1]);
    });
    expect(await t.run((ctx) => backfillTenantFields(ctx))).toEqual({
      organizations: 0,
      locations: 0,
      leagues: 0,
    });
  });
});

describe('tester probes (#66)', () => {
  test('two creates of the same slug at once leave one league and one refusal', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.adminA.mutation(api.leagues.create, valid(s)),
      s.adminA.mutation(api.leagues.create, { ...valid(s), name: 'Other Name' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const taken = results.find((r) => r.status === 'rejected');
    expect(taken?.status === 'rejected' && taken.reason).toBeInstanceOf(ConvexError);
    const rows = await s.t.run((ctx) =>
      ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', s.organizationA).eq('slug', 'sunday-reverse-coed-4s'),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });

  test('a name that slugifies to a reserved or unchoosable slug gets the next free suffix', async () => {
    const s = await setup();
    const slugs = await s.t.run(async (ctx) => {
      const made: Record<string, string> = {};
      for (const name of ['New', 'A', '5k', 'Gulf Coast Sport Social']) {
        made[name] = (
          await insertLeague(ctx, s.organizationA, {
            name,
            sport: 'soccer',
            locations: ['Alpha Field'],
          })
        ).slug;
      }
      made['New again'] = (
        await insertLeague(ctx, s.organizationA, {
          name: 'New',
          sport: 'soccer',
          locations: ['Alpha Field'],
        })
      ).slug;
      return made;
    });
    expect(slugs).toEqual({
      New: 'new-2',
      A: 'a-2',
      '5k': '5k-2',
      'Gulf Coast Sport Social': 'gulf-coast-sport-social-2',
      'New again': 'new-3',
    });
  });

  test('listPublicLeagues pages by sport and by status with drafts interleaved', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let n = 1; n <= 7; n++) {
        await insertLeague(ctx, s.organizationA, {
          name: `Soft ${n}`,
          sport: 'softball',
          locations: ['bravo Beach'],
        });
        await insertLeague(ctx, s.organizationA, {
          name: `Soft ${n} draft`,
          sport: 'softball',
          locations: ['bravo Beach'],
          status: 'draft',
        });
      }
    });
    const list = (sport?: 'softball' | 'soccer', page = 1) =>
      s.t.query(api.organizations.listPublicLeagues, { slug: 'org-a', page, sport });
    const names = (r: { rows: { name: string }[] }) => r.rows.map((row) => row.name);

    const p1 = await list('softball', 1);
    const p2 = await list('softball', 2);
    expect(names(p1)).toEqual(['Soft 1', 'Soft 2', 'Soft 3', 'Soft 4', 'Soft 5']);
    expect(names(p2)).toEqual(['Soft 6', 'Soft 7']);
    expect([p1.total, p1.pageCount, p2.total, p2.pageCount]).toEqual([7, 2, 7, 2]);
    expect(await list('soccer')).toMatchObject({ total: 1, pageCount: 1 });

    const all = [...names(await list(undefined, 1)), ...names(await list(undefined, 2))];
    expect(all).toEqual(['Coed 7v7', ...[1, 2, 3, 4, 5, 6, 7].map((n) => `Soft ${n}`)]);
    expect((await list(undefined, 1)).total).toBe(8);
    const page = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    expect(page).toMatchObject({ leagueCount: 8 });
    const admin = await s.adminA.query(api.leagues.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(admin).toHaveLength(15);
    expect(admin.filter((row) => row.status === 'draft')).toHaveLength(7);
  });
});
