/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertTenant, publishLeague, defaultDivision } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const leagueNames = async (t: T, q: string) =>
  (await t.query(api.search.leagues, { q })).rows.map((row) => row.name);

const organizationNames = async (t: T) =>
  (await t.query(api.search.organizations, { page: 1 })).rows.map((row) => row.name);

async function seedOrganization(t: T, status?: 'draft'): Promise<void> {
  await t.run((ctx) =>
    insertTenant(ctx, {
      organization: { name: 'Older Org', slug: 'older-org', cityState: 'Austin, TX' },
      locations: [{ name: 'Old Field', address: '1 Old St' }],
      leagues: [
        {
          name: 'Old Sand',
          sport: 'beachVolleyball',
          locations: ['Old Field'],
          ...(status && { status }),
          division: defaultDivision('beachVolleyball'),
        },
      ],
    }),
  );
}

describe('league search words beside the organizations list fields', () => {
  test('a published league is found by its sport words, and its organization is listed', async () => {
    const t = setup();
    await seedOrganization(t);
    expect(await leagueNames(t, 'beach volleyball')).toEqual(['Old Sand']);
    expect(await leagueNames(t, 'austin')).toEqual(['Old Sand']);
    expect(await organizationNames(t)).toEqual(['Older Org']);
  });

  test('publishing a draft league makes it found by its sport words and lists its organization', async () => {
    const t = setup();
    await seedOrganization(t, 'draft');
    expect(await leagueNames(t, 'beach volleyball')).toEqual([]);
    expect(await organizationNames(t)).toEqual([]);

    await t.run(async (ctx) => {
      const draft = await ctx.db.query('leagues').first();
      await publishLeague(ctx, draft!);
    });
    expect(await leagueNames(t, 'beach volleyball')).toEqual(['Old Sand']);
    expect(await organizationNames(t)).toEqual(['Older Org']);
  });
});
