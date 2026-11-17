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

describe('testing:setTrainingClassRegistered', () => {
  const REGISTER = {
    organizationSlug: 'e2e-org-t7k2',
    trainingSlug: 'tuesday-serving-clinic',
    date: '2027-01-12',
    registeredCount: 5,
  };

  async function seededWithClasses() {
    const t = await seeded();
    await t.mutation(internal.testing.seedTraining, TRAINING);
    await t.run(async (ctx) => {
      const [training] = await ctx.db.query('trainings').collect();
      for (const date of ['2027-01-05', '2027-01-12']) {
        await ctx.db.insert('trainingClasses', {
          trainingId: training._id,
          organizationId: training.organizationId,
          date,
          startTime: '18:00',
          endTime: '19:00',
          places: 12,
          registeredCount: 0,
          status: 'scheduled',
        });
      }
    });
    return t;
  }

  const registeredByDate = (t: Awaited<ReturnType<typeof seeded>>) =>
    t.run(async (ctx) =>
      Object.fromEntries(
        (await ctx.db.query('trainingClasses').collect()).map((row) => [
          row.date,
          row.registeredCount,
        ]),
      ),
    );

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('throws with IS_TEST %s and changes nothing', async (_, value) => {
    const t = await seededWithClasses();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.setTrainingClassRegistered, REGISTER)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await registeredByDate(t)).toEqual({ '2027-01-05': 0, '2027-01-12': 0 });
  });

  test('sets the registered count of the class on that date, and no other', async () => {
    const t = await seededWithClasses();
    await t.mutation(internal.testing.setTrainingClassRegistered, REGISTER);
    expect(await registeredByDate(t)).toEqual({ '2027-01-05': 0, '2027-01-12': 5 });
  });

  test('refuses an unknown training program and a date with no class', async () => {
    const t = await seededWithClasses();
    await expect(
      t.mutation(internal.testing.setTrainingClassRegistered, {
        ...REGISTER,
        trainingSlug: 'nowhere',
      }),
    ).rejects.toThrow(/No training program/);
    await expect(
      t.mutation(internal.testing.setTrainingClassRegistered, { ...REGISTER, date: '2027-02-02' }),
    ).rejects.toThrow(/No class/);
  });
});

describe('testing:seedTrainingClasses and testing:publishSeededTraining', () => {
  const CLASSES = {
    organizationSlug: 'e2e-org-t7k2',
    trainingSlug: 'tuesday-serving-clinic',
    weekday: 2,
    startTime: '18:00',
    endTime: '19:00',
    firstDate: '2020-01-07',
    weeks: 3,
    placesPerClass: 12,
    registrationDeadline: '2020-01-01',
  };

  async function seededTraining() {
    const t = await seeded();
    await t.mutation(internal.testing.seedTraining, TRAINING);
    return t;
  }

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('throw with IS_TEST %s and change nothing', async (_, value) => {
    const t = await seededTraining();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedTrainingClasses, CLASSES)).rejects.toThrow(
      /IS_TEST/,
    );
    await expect(
      t.mutation(internal.testing.publishSeededTraining, {
        organizationSlug: CLASSES.organizationSlug,
        trainingSlug: CLASSES.trainingSlug,
      }),
    ).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('trainingClasses').collect())).toEqual([]);
    expect((await t.run((ctx) => ctx.db.query('programs').collect()))[0]?.status).toBe('draft');
  });

  test('seeds classes that have passed, keeping the training row’s last class date, and publishes without the rules', async () => {
    const t = await seededTraining();
    await expect(t.mutation(internal.testing.seedTrainingClasses, CLASSES)).resolves.toEqual({
      classCount: 3,
    });
    await t.mutation(internal.testing.publishSeededTraining, {
      organizationSlug: CLASSES.organizationSlug,
      trainingSlug: CLASSES.trainingSlug,
    });
    const [training] = await t.run((ctx) => ctx.db.query('trainings').collect());
    expect(training).toMatchObject({ status: 'published', lastClassDate: '2020-01-21' });
    const [program] = await t.run((ctx) => ctx.db.query('programs').collect());
    expect(program?.status).toBe('published');
  });

  test('refuse an unknown training program', async () => {
    const t = await seededTraining();
    await expect(
      t.mutation(internal.testing.seedTrainingClasses, { ...CLASSES, trainingSlug: 'nowhere' }),
    ).rejects.toThrow(/No training program/);
    await expect(
      t.mutation(internal.testing.publishSeededTraining, {
        organizationSlug: CLASSES.organizationSlug,
        trainingSlug: 'nowhere',
      }),
    ).rejects.toThrow(/No training program/);
  });
});
