/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const seasonsSource = readFileSync(new URL('./seasons.ts', import.meta.url), 'utf8');

function season(slug: string, registrationDeadline: string, overrides: Partial<NewSeason> = {}) {
  return {
    name: slug.toUpperCase(),
    slug,
    startDate: '2030-06-01',
    endDate: '2030-08-30',
    registrationDeadline,
    playersPerSide: 7,
    minimumRosterSize: 7,
    ...overrides,
  } satisfies NewSeason;
}

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [
        { name: 'Alpha Field', address: '1 Alpha St' },
        { name: 'Beta Field', address: '2 Beta St' },
      ],
      leagues: [
        {
          name: 'Coed 7v7',
          sport: 'soccer',
          locations: ['Alpha Field', 'Beta Field'],
          division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
        },
        { name: 'Slow Pitch', sport: 'softball', locations: ['Beta Field'] },
        { name: 'Draft League', sport: 'soccer', locations: ['Alpha Field'], status: 'draft' },
      ],
    });
    await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['B Field'] }],
    });
  });
  return t;
}

type T = Awaited<ReturnType<typeof setup>>;

async function add(
  t: T,
  orgSlug: string,
  leagueSlug: string,
  seasons: NewSeason[],
  status: 'draft' | 'published' = 'published',
): Promise<void> {
  await t.run(async (ctx) => {
    const organization = (await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique())!;
    const league = (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organization._id).eq('slug', leagueSlug),
      )
      .unique())!;
    for (const next of seasons) {
      const current = (await ctx.db.get('leagues', league._id))!;
      await insertSeason(ctx, current, next, status);
    }
  });
}

const open = (t: T, orgSlug = 'org-a', sport?: 'soccer' | 'softball') =>
  t.query(api.seasons.listOpenForOrganization, { orgSlug, ...(sport && { sport }) });

describe('seasons.listOpenForOrganization', () => {
  test('returns the card fields of a published season of a published league', async () => {
    const t = await setup();
    await add(t, 'org-a', 'coed-7v7', [season('summer-2030', '2030-05-19')]);
    expect(await open(t)).toEqual([
      {
        name: 'SUMMER-2030',
        slug: 'summer-2030',
        startDate: '2030-06-01',
        endDate: '2030-08-30',
        registrationDeadline: '2030-05-19',
        minimumRosterSize: 7,
        league: {
          name: 'Coed 7v7',
          slug: 'coed-7v7',
          sportName: 'Soccer',
          divisionLabel: 'Coed · 7v7 · Rec',
          locationNames: ['Alpha Field', 'Beta Field'],
        },
      },
    ]);
  });

  test('leaves out the division label of a league that has none', async () => {
    const t = await setup();
    await add(t, 'org-a', 'slow-pitch', [season('summer-2030', '2030-05-19')]);
    const [row] = await open(t);
    expect(row?.league).not.toHaveProperty('divisionLabel');
  });

  test('never returns a draft season or a season of a draft league', async () => {
    const t = await setup();
    await add(t, 'org-a', 'coed-7v7', [season('draft-season', '2030-05-30')], 'draft');
    await add(t, 'org-a', 'draft-league', [season('league-draft', '2030-05-29')]);
    await add(t, 'org-a', 'coed-7v7', [season('published', '2030-05-01')]);
    expect((await open(t)).map((row) => row.slug)).toEqual(['published']);
  });

  test("never returns another organization's season", async () => {
    const t = await setup();
    await add(t, 'org-b', 'coed-7v7', [season('b-season', '2030-05-30')]);
    await add(t, 'org-a', 'coed-7v7', [season('a-season', '2030-05-01')]);
    expect((await open(t, 'org-a')).map((row) => row.slug)).toEqual(['a-season']);
    expect((await open(t, 'org-b')).map((row) => row.slug)).toEqual(['b-season']);
  });

  test('is empty for an unknown organization and for a value that is no slug', async () => {
    const t = await setup();
    expect(await open(t, 'no-such-org')).toEqual([]);
    expect(await open(t, 'No Such')).toEqual([]);
  });

  test("with a sport, returns only that sport's seasons", async () => {
    const t = await setup();
    await add(t, 'org-a', 'coed-7v7', [season('soccer-season', '2030-05-10')]);
    await add(t, 'org-a', 'slow-pitch', [season('softball-season', '2030-05-20')]);
    expect((await open(t, 'org-a', 'softball')).map((row) => row.slug)).toEqual([
      'softball-season',
    ]);
    expect((await open(t, 'org-a', 'soccer')).map((row) => row.slug)).toEqual(['soccer-season']);
    expect((await open(t)).map((row) => row.slug)).toEqual(['softball-season', 'soccer-season']);
  });

  test('returns the 50 seasons with the latest deadlines, latest first', async () => {
    const t = await setup();
    const day = (n: number) =>
      `2030-${String(1 + Math.floor((n - 1) / 28)).padStart(2, '0')}-${String(1 + ((n - 1) % 28)).padStart(2, '0')}`;
    await add(
      t,
      'org-a',
      'coed-7v7',
      Array.from({ length: 60 }, (_, i) => season(`season-${i + 1}`, day(i + 1))),
    );
    const rows = await open(t);
    expect(rows).toHaveLength(50);
    expect(rows[0]?.slug).toBe('season-60');
    expect(rows[49]?.slug).toBe('season-11');
  });

  test('reads no time, so the result stays the same as the clock moves', () => {
    const start = seasonsSource.indexOf('export const listOpenForOrganization');
    const end = seasonsSource.indexOf('\nexport const', start + 1);
    const body = seasonsSource.slice(start, end === -1 ? undefined : end);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/Date\.now\(|new Date\(|Date\.parse\(/);
  });
});
