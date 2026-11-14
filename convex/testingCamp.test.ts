/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

const TENANT = {
  organization: { name: 'E2E Org c4m9', slug: 'e2e-org-c4m9' },
  locations: [{ name: 'Field One', address: '1 Test Road' }],
  leagues: [],
};

const CAMP = {
  organizationSlug: 'e2e-org-c4m9',
  name: 'Junior Beach Volleyball Camp',
  slug: 'junior-beach-volleyball-camp',
  sport: 'beachVolleyball' as const,
  locationNames: ['Field One'],
  minimumAge: 9,
  maximumAge: 14,
};

async function seeded() {
  vi.stubEnv('IS_TEST', 'true');
  const t = convexTest(schema, modules);
  await t.mutation(internal.testing.seedTenant, TENANT);
  return t;
}

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => vi.unstubAllEnvs());

describe('testing:seedCamp', () => {
  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await seeded();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedCamp, CAMP)).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('camps').collect())).toEqual([]);
  });

  test('inserts a draft camp and its program of type camp', async () => {
    const t = await seeded();
    await expect(t.mutation(internal.testing.seedCamp, CAMP)).resolves.toEqual({
      slug: 'junior-beach-volleyball-camp',
    });
    const programs = await t.run((ctx) => ctx.db.query('programs').collect());
    expect(programs).toEqual([
      expect.objectContaining({ type: 'camp', name: CAMP.name, status: 'draft' }),
    ]);
    expect(await t.run((ctx) => ctx.db.query('camps').collect())).toEqual([
      expect.objectContaining({ minimumAge: 9, maximumAge: 14, programId: programs[0]._id }),
    ]);
  });

  test('refuses an unknown organization, a location it does not have, and a taken web address', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedCamp, { ...CAMP, organizationSlug: 'nowhere' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedCamp, { ...CAMP, locationNames: ['Nowhere'] }),
    ).rejects.toThrow(/No location/);
    await t.mutation(internal.testing.seedCamp, CAMP);
    await expect(t.mutation(internal.testing.seedCamp, CAMP)).rejects.toThrow(/web address/);
  });
});
