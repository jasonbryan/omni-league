/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import type { Doc, Id } from './_generated/dataModel';
import {
  insertDraftLeague,
  insertLeague,
  insertTenant,
  MAX_LEAGUES_SEARCH_UPDATED,
  publishLeague,
  restoreLeague,
  updateLeague,
  updateLocation,
  updateOrganizationCityState,
} from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const DIVISION = { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' } as const;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: {
        name: 'Gulf Coast Sport & Social',
        slug: 'gulf',
        cityState: 'Corpus Christi, TX',
      },
      locations: [
        { name: 'North Beach Sand Courts', address: '1 Beach Rd' },
        { name: 'Harbor Fields', address: '2 Harbor Rd' },
      ],
      leagues: [
        {
          name: 'Sunday Reverse Coed 4s',
          sport: 'beachVolleyball',
          locations: ['North Beach Sand Courts'],
        },
        {
          name: 'Wednesday Coed Slow-Pitch',
          sport: 'softball',
          locations: ['Harbor Fields', 'North Beach Sand Courts'],
        },
        { name: 'Soccer Draft', sport: 'soccer', locations: ['Harbor Fields'], status: 'draft' },
      ],
    });
    const other = await insertTenant(ctx, {
      organization: { name: 'Lakeshore Sand League', slug: 'lakeshore', cityState: 'Chicago, IL' },
      locations: [{ name: 'North Beach Sand Courts', address: '9 Lake Rd' }],
      leagues: [
        {
          name: 'Saturday Coed 6s',
          sport: 'beachVolleyball',
          locations: ['North Beach Sand Courts'],
        },
      ],
    });
    return { organizationId, other };
  });
  return { t, ...ids };
}

type T = Awaited<ReturnType<typeof setup>>['t'];

const searchTexts = (t: T, organizationId: Id<'organizations'>) =>
  t.run(async (ctx) => {
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
      .collect();
    return Object.fromEntries(leagues.map((league) => [league.slug, league.searchText]));
  });

const locationNamed = (t: T, organizationId: Id<'organizations'>, name: string) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!,
  );

const leagueSlugged = (t: T, organizationId: Id<'organizations'>, slug: string) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!,
  );

describe('searchText upkeep', () => {
  test('a league inserted by a tenant writer holds its name, organization, locations, and City, state, drafts included', async () => {
    const { t, organizationId } = await setup();
    expect(await searchTexts(t, organizationId)).toEqual({
      'sunday-reverse-coed-4s':
        'Sunday Reverse Coed 4s Gulf Coast Sport & Social North Beach Sand Courts Corpus Christi, TX',
      'wednesday-coed-slow-pitch':
        'Wednesday Coed Slow-Pitch Gulf Coast Sport & Social Harbor Fields North Beach Sand Courts Corpus Christi, TX',
      'soccer-draft': 'Soccer Draft Gulf Coast Sport & Social Harbor Fields Corpus Christi, TX',
    });
  });

  test('an organization without City, state leaves it out', async () => {
    const t = convexTest(schema, modules);
    const organizationId = await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Bare Org', slug: 'bare' },
        locations: [{ name: 'Field', address: '1 St' }],
        leagues: [{ name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Field'] }],
      }),
    );
    expect(await searchTexts(t, organizationId)).toEqual({ 'sand-2s': 'Sand 2s Bare Org Field' });
  });

  test('a draft league inserted by the organizer form holds it', async () => {
    const { t, organizationId } = await setup();
    const location = await locationNamed(t, organizationId, 'Harbor Fields');
    await t.run((ctx) =>
      insertDraftLeague(ctx, organizationId, {
        name: 'New Sand',
        slug: 'new-sand',
        sport: 'beachVolleyball',
        locationIds: [location._id],
        division: DIVISION,
      }),
    );
    expect((await searchTexts(t, organizationId))['new-sand']).toBe(
      'New Sand Gulf Coast Sport & Social Harbor Fields Corpus Christi, TX',
    );
  });

  test('a league inserted into an existing organization holds it', async () => {
    const { t, organizationId } = await setup();
    await t.run((ctx) =>
      insertLeague(ctx, organizationId, {
        name: 'Late Add',
        sport: 'soccer',
        locations: ['Harbor Fields'],
      }),
    );
    expect((await searchTexts(t, organizationId))['late-add']).toBe(
      'Late Add Gulf Coast Sport & Social Harbor Fields Corpus Christi, TX',
    );
  });

  test('renaming a location rewrites the leagues held there and no other', async () => {
    const { t, organizationId, other } = await setup();
    const location = await locationNamed(t, organizationId, 'North Beach Sand Courts');
    await t.run((ctx) =>
      updateLocation(ctx, location, { name: 'South Shore Courts', address: location.address }),
    );
    const texts = await searchTexts(t, organizationId);
    expect(texts['sunday-reverse-coed-4s']).toBe(
      'Sunday Reverse Coed 4s Gulf Coast Sport & Social South Shore Courts Corpus Christi, TX',
    );
    expect(texts['wednesday-coed-slow-pitch']).toBe(
      'Wednesday Coed Slow-Pitch Gulf Coast Sport & Social Harbor Fields South Shore Courts Corpus Christi, TX',
    );
    expect(texts['soccer-draft']).toBe(
      'Soccer Draft Gulf Coast Sport & Social Harbor Fields Corpus Christi, TX',
    );
    expect(await searchTexts(t, other)).toEqual({
      'saturday-coed-6s':
        'Saturday Coed 6s Lakeshore Sand League North Beach Sand Courts Chicago, IL',
    });
  });

  test('changing only a location’s address leaves the text as it was', async () => {
    const { t, organizationId } = await setup();
    const before = await searchTexts(t, organizationId);
    const location = await locationNamed(t, organizationId, 'Harbor Fields');
    await t.run((ctx) =>
      updateLocation(ctx, location, { name: location.name, address: '77 Elsewhere Rd' }),
    );
    expect(await searchTexts(t, organizationId)).toEqual(before);
  });

  test('changing City, state rewrites every league of the organization, and clearing it removes the words', async () => {
    const { t, organizationId, other } = await setup();
    await t.run((ctx) => updateOrganizationCityState(ctx, organizationId, 'Galveston, TX'));
    const texts = await searchTexts(t, organizationId);
    expect(Object.values(texts).every((text) => text?.endsWith(' Galveston, TX'))).toBe(true);
    expect(Object.values(texts).some((text) => text?.includes('Corpus'))).toBe(false);

    await t.run((ctx) => updateOrganizationCityState(ctx, organizationId, null));
    expect((await searchTexts(t, organizationId))['soccer-draft']).toBe(
      'Soccer Draft Gulf Coast Sport & Social Harbor Fields',
    );
    expect(Object.values(await searchTexts(t, other))[0]).toContain('Chicago, IL');
  });

  test('renaming a league rewrites its text, and undoing the rename puts the old name back', async () => {
    const { t, organizationId } = await setup();
    const league = await leagueSlugged(t, organizationId, 'sunday-reverse-coed-4s');
    const earlier = await t.run((ctx) =>
      updateLeague(ctx, league, {
        name: 'Sunday Sand Fours',
        division: { ...DIVISION, minimumRosterSize: undefined },
      }),
    );
    expect((await searchTexts(t, organizationId))['sunday-reverse-coed-4s']).toBe(
      'Sunday Sand Fours Gulf Coast Sport & Social North Beach Sand Courts Corpus Christi, TX',
    );

    const renamed = await leagueSlugged(t, organizationId, 'sunday-reverse-coed-4s');
    await t.run((ctx) => restoreLeague(ctx, renamed, earlier));
    expect((await searchTexts(t, organizationId))['sunday-reverse-coed-4s']).toBe(
      'Sunday Reverse Coed 4s Gulf Coast Sport & Social North Beach Sand Courts Corpus Christi, TX',
    );
  });

  test('publishing a league that has no text yet sets it', async () => {
    const { t, organizationId } = await setup();
    const draft = await leagueSlugged(t, organizationId, 'soccer-draft');
    await t.run((ctx) => ctx.db.patch('leagues', draft._id, { searchText: undefined }));
    const bare: Doc<'leagues'> = await leagueSlugged(t, organizationId, 'soccer-draft');
    expect(bare.searchText).toBeUndefined();

    await t.run((ctx) => publishLeague(ctx, bare));
    const published = await leagueSlugged(t, organizationId, 'soccer-draft');
    expect(published.status).toBe('published');
    expect(published.searchText).toBe(
      'Soccer Draft Gulf Coast Sport & Social Harbor Fields Corpus Christi, TX',
    );
  });

  test('a location of another organization named on a league is left out of its text', async () => {
    const { t, organizationId, other } = await setup();
    const foreign = await locationNamed(t, other, 'North Beach Sand Courts');
    const harbor = await locationNamed(t, organizationId, 'Harbor Fields');
    const league = await leagueSlugged(t, organizationId, 'soccer-draft');
    await t.run((ctx) =>
      ctx.db.patch('leagues', league._id, { locationIds: [foreign._id, harbor._id] }),
    );
    await t.run((ctx) => updateOrganizationCityState(ctx, organizationId, 'Galveston, TX'));
    expect((await searchTexts(t, organizationId))['soccer-draft']).toBe(
      'Soccer Draft Gulf Coast Sport & Social Harbor Fields Galveston, TX',
    );
  });

  test('refuses a rename that would need more than the bound of leagues rewritten, and writes nothing', async () => {
    const { t, organizationId } = await setup();
    const location = await locationNamed(t, organizationId, 'Harbor Fields');
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_LEAGUES_SEARCH_UPDATED; i++) {
        await ctx.db.insert('leagues', {
          organizationId,
          name: `Bulk ${String(i).padStart(3, '0')}`,
          slug: `bulk-${i}`,
          sport: 'soccer',
          locationIds: [location._id],
          status: 'draft',
        });
      }
    });
    await expect(
      t.run((ctx) =>
        updateLocation(ctx, location, { name: 'Harbor Fields 2', address: '2 Harbor Rd' }),
      ),
    ).rejects.toThrow(/more than 200 leagues/);
    expect((await locationNamed(t, organizationId, 'Harbor Fields')).name).toBe('Harbor Fields');
  });
});
