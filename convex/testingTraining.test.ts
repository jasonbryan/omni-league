/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

const TENANT = {
  organization: { name: 'E2E Org t7k2', slug: 'e2e-org-t7k2' },
  locations: [{ name: 'Field One', address: '1 Test Road' }],
  leagues: [],
};

const TRAINING = {
  organizationSlug: 'e2e-org-t7k2',
  name: 'Tuesday Serving Clinic',
  slug: 'tuesday-serving-clinic',
  sport: 'beachVolleyball' as const,
  locationNames: ['Field One'],
  coachName: 'Dana Ruiz',
};

async function seeded() {
  vi.stubEnv('IS_TEST', 'true');
  const t = convexTest(schema, modules);
  await t.mutation(internal.testing.seedTenant, TENANT);
  return t;
}

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => vi.unstubAllEnvs());

describe('testing:seedTraining', () => {
  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await seeded();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedTraining, TRAINING)).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('trainings').collect())).toEqual([]);
  });

  test('inserts a draft training program and its program of type training, with the ages it is given', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedTraining, { ...TRAINING, minimumAge: 16 }),
    ).resolves.toEqual({ slug: 'tuesday-serving-clinic' });
    const programs = await t.run((ctx) => ctx.db.query('programs').collect());
    expect(programs).toEqual([
      expect.objectContaining({ type: 'training', name: TRAINING.name, status: 'draft' }),
    ]);
    const [training] = await t.run((ctx) => ctx.db.query('trainings').collect());
    expect(training).toMatchObject({
      coachName: 'Dana Ruiz',
      minimumAge: 16,
      programId: programs[0]?._id,
    });
    expect(training).not.toHaveProperty('maximumAge');
  });

  test('refuses an unknown organization, a location it does not have, and a taken web address', async () => {
    const t = await seeded();
    await expect(
      t.mutation(internal.testing.seedTraining, { ...TRAINING, organizationSlug: 'nowhere' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedTraining, { ...TRAINING, locationNames: ['Nowhere'] }),
    ).rejects.toThrow(/No location/);
    await t.mutation(internal.testing.seedTraining, TRAINING);
    await expect(t.mutation(internal.testing.seedTraining, TRAINING)).rejects.toThrow(
      /web address/,
    );
  });
});
