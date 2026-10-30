import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { matchesValidator } from '../src/app/core/data/convex/matches-validator';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import type { AgeGroup, Gender, StandardLevel } from './lib/divisions';
import { publicLeagueFacetsValidator } from './lib/publicPage';
import {
  insertCustomLevel,
  insertLeague,
  insertSeason,
  insertTenant,
  type LeagueSeed,
} from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

type Division = [Gender, number, StandardLevel, AgeGroup?];

const beach = (name: string, [gender, players, level, ageGroup]: Division): LeagueSeed => ({
  name,
  sport: 'beachVolleyball',
  locations: ['Sand'],
  division: { gender, playersPerSide: players, level, ageGroup: ageGroup ?? 'adult' },
});

const SAND: LeagueSeed[] = [
  beach('Monday Coed 4s', ['coed', 4, 'bb']),
  beach('Wednesday Reverse Coed 4s', ['coed', 4, 'b']),
  beach('Saturday Coed 6s', ['coed', 6, 'rec']),
  beach('Friday Coed 6s', ['coed', 6, 'b']),
  beach("Sunday Women's 6s", ['womens', 6, 'a']),
  beach("Tuesday Women's 2s", ['womens', 2, 'a']),
  beach("Thursday Men's 4s", ['mens', 4, 'aa']),
];

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Sand Org', slug: 'sand' },
      locations: [{ name: 'Sand', address: '1 Sand St' }],
      leagues: [...SAND, { ...beach('Draft Coed 4s', ['coed', 4, 'bb']), status: 'draft' }],
    });
    await insertTenant(ctx, {
      organization: { name: 'Other Org', slug: 'other' },
      locations: [{ name: 'Sand', address: '9 Other St' }],
      leagues: [beach('Other Coed 4s', ['coed', 4, 'bb'])],
    });
  });
  return t;
}

type T = Awaited<ReturnType<typeof setup>>;

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

async function allFilteredNames(t: T, args: Record<string, unknown>) {
  const first = await t.query(api.organizations.listPublicLeagues, {
    slug: 'sand',
    page: 1,
    ...args,
  });
  const found = [...names(first.rows)];
  for (let page = 2; page <= first.pageCount; page++) {
    const next = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page,
      ...args,
    });
    found.push(...names(next.rows));
  }
  return { total: first.total, pageCount: first.pageCount, found };
}

async function orgByslug(ctx: MutationCtx, slug: string): Promise<Doc<'organizations'>> {
  const organization = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
  if (!organization) throw new Error(slug);
  return organization;
}

describe('organizations.listPublicLeagues with division filters', () => {
  test.each([
    [{ gender: ['coed'], playersPerSide: [4] }, ['Monday Coed 4s', 'Wednesday Reverse Coed 4s']],
    [
      { playersPerSide: [4, 6] },
      [
        'Friday Coed 6s',
        'Monday Coed 4s',
        'Saturday Coed 6s',
        "Sunday Women's 6s",
        "Thursday Men's 4s",
        'Wednesday Reverse Coed 4s',
      ],
    ],
    [{ level: ['a'] }, ["Sunday Women's 6s", "Tuesday Women's 2s"]],
    [{ gender: ['mens'], playersPerSide: [6] }, []],
    [
      { ageGroup: ['adult'], gender: ['womens', 'mens'] },
      SAND.filter((l) => !l.name.includes('Coed'))
        .map((l) => l.name)
        .sort(),
    ],
  ])(
    'rows and total of %j match a direct count of the published leagues',
    async (args, expected) => {
      const t = await setup();
      const { total, found } = await allFilteredNames(t, args);
      expect(total).toBe(expected.length);
      expect(found).toEqual(expected);
      expect(found).not.toContain('Draft Coed 4s');
      expect(found).not.toContain('Other Coed 4s');
    },
  );

  test('pages the filtered rows 5 at a time, and a page past the last is page 1', async () => {
    const t = await setup();
    const args = { slug: 'sand', playersPerSide: [4, 6] };
    const first = await t.query(api.organizations.listPublicLeagues, { ...args, page: 1 });
    const second = await t.query(api.organizations.listPublicLeagues, { ...args, page: 2 });
    const beyond = await t.query(api.organizations.listPublicLeagues, { ...args, page: 3 });
    expect(first.rows).toHaveLength(5);
    expect(second).toMatchObject({ page: 2, pageCount: 2, total: 6 });
    expect(names(second.rows)).toEqual(['Wednesday Reverse Coed 4s']);
    expect(beyond.page).toBe(1);
  });

  test('empty filter arrays give the unfiltered result', async () => {
    const t = await setup();
    const unfiltered = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
    });
    const empty = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
      gender: [],
      playersPerSide: [],
      level: [],
      ageGroup: [],
    });
    expect(empty).toEqual(unfiltered);
    expect(unfiltered.total).toBe(7);
  });

  test('with a sport, filters within that sport', async () => {
    const t = await setup();
    const result = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
      sport: 'beachVolleyball',
      gender: ['mens'],
    });
    expect(names(result.rows)).toEqual(["Thursday Men's 4s"]);
    expect(result.total).toBe(1);
  });

  test('a published league with no division matches no filter and still counts unfiltered', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = await orgByslug(ctx, 'sand');
      await insertLeague(ctx, organization._id, {
        name: 'Undivided',
        sport: 'beachVolleyball',
        locations: ['Sand'],
      });
    });
    const unfiltered = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
    });
    expect(unfiltered.total).toBe(8);
    for (const filter of [
      { gender: ['coed', 'mens', 'womens'] as Gender[] },
      { playersPerSide: [2, 3, 4, 5, 6] },
      { level: ['rec', 'b', 'bb', 'a', 'aa', 'open'] as StandardLevel[] },
      { ageGroup: ['adult'] as AgeGroup[] },
    ]) {
      const { found } = await allFilteredNames(t, filter);
      expect(found, JSON.stringify(filter)).not.toContain('Undivided');
    }
  });

  test('a custom level matches through the standard level it maps to and keeps its own label', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = await orgByslug(ctx, 'sand');
      await insertCustomLevel(ctx, organization._id, {
        sport: 'beachVolleyball',
        name: 'D',
        standardLevel: 'rec',
      });
      await insertLeague(ctx, organization._id, {
        ...beach('D League', ['coed', 2, 'rec']),
        division: {
          gender: 'coed',
          playersPerSide: 2,
          level: 'rec',
          customLevel: 'D',
          ageGroup: 'adult',
        },
      });
    });
    const result = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
      level: ['rec'],
    });
    expect(result.rows.map((row) => [row.name, row.divisionLabel])).toEqual([
      ['D League', 'Coed · 2v2 · D (Rec)'],
      ['Saturday Coed 6s', 'Coed · 6v6 · Rec'],
    ]);
    const facets = await t.query(api.organizations.listPublicLeagueFacets, { slug: 'sand' });
    expect(facets.map((facet) => facet.level)).toContain('rec');
    expect(JSON.stringify(facets)).not.toContain('"D"');
  });

  test('reads no further than the 200 rows a list can reach', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = await orgByslug(ctx, 'sand');
      for (let i = 0; i < 200; i++) {
        await insertLeague(
          ctx,
          organization._id,
          beach(`A${String(i).padStart(3, '0')}`, ['womens', 2, 'b']),
        );
      }
    });
    const result = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
      gender: ['mens'],
    });
    expect(result.total).toBe(0);
  });
});

describe('the several-sports rule', () => {
  async function twoSports() {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = await orgByslug(ctx, 'sand');
      await insertLeague(ctx, organization._id, {
        name: 'Coed 7v7 Rec',
        sport: 'soccer',
        locations: ['Sand'],
        division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
      });
      const league = (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organization._id).eq('slug', 'monday-coed-4s'),
        )
        .unique())!;
      await insertSeason(
        ctx,
        league,
        {
          name: 'Open',
          slug: 'open',
          startDate: '2030-06-01',
          endDate: '2030-08-01',
          registrationDeadline: '2030-05-01',
          playersPerSide: 4,
          minimumRosterSize: 4,
        },
        'published',
      );
    });
    return t;
  }

  test.each([{ playersPerSide: [4] }, { level: ['bb'] as StandardLevel[] }])(
    'with no sport and leagues of several sports, %j is ignored',
    async (filter) => {
      const t = await twoSports();
      const unfiltered = await t.query(api.organizations.listPublicLeagues, {
        slug: 'sand',
        page: 1,
      });
      const filtered = await t.query(api.organizations.listPublicLeagues, {
        slug: 'sand',
        page: 1,
        ...filter,
      });
      expect(filtered).toEqual(unfiltered);
      const open = await t.query(api.seasons.listOpenForOrganization, { orgSlug: 'sand' });
      const openFiltered = await t.query(api.seasons.listOpenForOrganization, {
        orgSlug: 'sand',
        ...filter,
      });
      expect(openFiltered).toEqual(open);
    },
  );

  test('a gender filter still applies with no sport and several sports', async () => {
    const t = await twoSports();
    const result = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
      gender: ['mens'],
    });
    expect(result.total).toBe(1);
  });

  test("with one sport and no sport given, a format outside that sport's range is ignored", async () => {
    const t = await setup();
    const unfiltered = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
    });
    const outside = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
      playersPerSide: [11],
      level: ['competitive'],
    });
    expect(outside).toEqual(unfiltered);
    const inside = await t.query(api.organizations.listPublicLeagues, {
      slug: 'sand',
      page: 1,
      playersPerSide: [2, 11],
    });
    expect(names(inside.rows)).toEqual(["Tuesday Women's 2s"]);
  });
});

describe('organizations.listPublicLeagueFacets', () => {
  test("returns each published league's division values and passes its validator", async () => {
    const t = await setup();
    const facets = await t.query(api.organizations.listPublicLeagueFacets, { slug: 'sand' });
    expect(facets).toHaveLength(7);
    expect(facets).toContainEqual({
      gender: 'mens',
      playersPerSide: 4,
      level: 'aa',
      ageGroup: 'adult',
    });
    expect(matchesValidator(facets, publicLeagueFacetsValidator)).toBe(true);
    for (const facet of facets) {
      expect(Object.keys(facet).sort()).toEqual(['ageGroup', 'gender', 'level', 'playersPerSide']);
    }
  });

  test('leaves out drafts, other organizations, and leagues with no division', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = await orgByslug(ctx, 'sand');
      await insertLeague(ctx, organization._id, {
        name: 'Undivided',
        sport: 'beachVolleyball',
        locations: ['Sand'],
      });
    });
    const facets = await t.query(api.organizations.listPublicLeagueFacets, { slug: 'sand' });
    expect(facets).toHaveLength(7);
  });

  test("with a sport, returns only that sport's leagues", async () => {
    const t = await setup();
    expect(
      await t.query(api.organizations.listPublicLeagueFacets, { slug: 'sand', sport: 'soccer' }),
    ).toEqual([]);
    expect(
      await t.query(api.organizations.listPublicLeagueFacets, {
        slug: 'sand',
        sport: 'beachVolleyball',
      }),
    ).toHaveLength(7);
  });

  test('is empty for an unknown organization', async () => {
    const t = await setup();
    expect(await t.query(api.organizations.listPublicLeagueFacets, { slug: 'nope' })).toEqual([]);
  });

  test('returns at most 200 leagues', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = await orgByslug(ctx, 'sand');
      for (let i = 0; i < 200; i++) {
        await insertLeague(
          ctx,
          organization._id,
          beach(`A${String(i).padStart(3, '0')}`, ['womens', 2, 'b']),
        );
      }
    });
    const facets = await t.query(api.organizations.listPublicLeagueFacets, { slug: 'sand' });
    expect(facets).toHaveLength(200);
  });
});

describe('seasons.listOpenForOrganization with division filters', () => {
  async function withOpenSeasons() {
    const t = await setup();
    await t.run(async (ctx) => {
      const organization = await orgByslug(ctx, 'sand');
      for (const slug of ['monday-coed-4s', 'saturday-coed-6s']) {
        const league = (await ctx.db
          .query('leagues')
          .withIndex('by_organizationId_and_slug', (q) =>
            q.eq('organizationId', organization._id).eq('slug', slug),
          )
          .unique())!;
        await insertSeason(
          ctx,
          league,
          {
            name: `${slug} summer`,
            slug: 'summer',
            startDate: '2030-06-01',
            endDate: '2030-08-01',
            registrationDeadline: '2030-05-01',
            playersPerSide: league.playersPerSide ?? 4,
            minimumRosterSize: 4,
          },
          'published',
        );
      }
    });
    return t;
  }

  test('returns only open seasons of matching leagues', async () => {
    const t = await withOpenSeasons();
    const all = await t.query(api.seasons.listOpenForOrganization, { orgSlug: 'sand' });
    expect(all.map((season) => season.league.name).sort()).toEqual([
      'Monday Coed 4s',
      'Saturday Coed 6s',
    ]);
    const fours = await t.query(api.seasons.listOpenForOrganization, {
      orgSlug: 'sand',
      playersPerSide: [4],
    });
    expect(fours.map((season) => season.league.name)).toEqual(['Monday Coed 4s']);
    const none = await t.query(api.seasons.listOpenForOrganization, {
      orgSlug: 'sand',
      gender: ['mens'],
      playersPerSide: [6],
    });
    expect(none).toEqual([]);
  });
});
