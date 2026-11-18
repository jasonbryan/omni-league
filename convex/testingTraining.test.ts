/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { components, internal } from './_generated/api';
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

describe('testing:cancelSeededTrainingClasses', () => {
  const CANCEL = { organizationSlug: 'e2e-org-t7k2', trainingSlug: 'tuesday-serving-clinic' };

  async function publishedWithClasses() {
    const t = await seeded();
    await t.mutation(internal.testing.seedTraining, TRAINING);
    await t.mutation(internal.testing.seedTrainingClasses, {
      ...CANCEL,
      weekday: 2,
      startTime: '18:00',
      endTime: '19:00',
      firstDate: '2099-01-06',
      weeks: 3,
      placesPerClass: 12,
      registrationDeadline: '2099-01-01',
    });
    await t.mutation(internal.testing.publishSeededTraining, CANCEL);
    return t;
  }

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
    ['empty', ''],
  ])('throws with IS_TEST %s and changes nothing', async (_, value) => {
    const t = await publishedWithClasses();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.cancelSeededTrainingClasses, CANCEL)).rejects.toThrow(
      /IS_TEST/,
    );
    const rows = await t.run((ctx) => ctx.db.query('trainingClasses').collect());
    expect(rows.every((row) => row.status === 'scheduled')).toBe(true);
  });

  test('cancels every class and clears the training row’s last class date', async () => {
    const t = await publishedWithClasses();
    await t.mutation(internal.testing.cancelSeededTrainingClasses, CANCEL);
    const rows = await t.run((ctx) => ctx.db.query('trainingClasses').collect());
    expect(rows.map((row) => row.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    const [training] = await t.run((ctx) => ctx.db.query('trainings').collect());
    expect(training).not.toHaveProperty('lastClassDate');
  });

  test('refuses an unknown training program', async () => {
    const t = await publishedWithClasses();
    await expect(
      t.mutation(internal.testing.cancelSeededTrainingClasses, {
        ...CANCEL,
        trainingSlug: 'nowhere',
      }),
    ).rejects.toThrow(/No training program/);
  });
});

describe('testing:seedTrainingRegistration', () => {
  const EMAIL = 'guardian@example.test';
  const REGISTRATION = {
    organizationSlug: 'e2e-org-t7k2',
    trainingSlug: 'tuesday-serving-clinic',
    email: EMAIL,
    participant: { kind: 'minor', minorName: 'Maya R.' } as const,
  };

  async function withClasses() {
    const t = await seeded();
    betterAuthTest.register(t, 'betterAuth');
    await t.mutation(internal.testing.seedTraining, TRAINING);
    await t.mutation(internal.testing.seedTrainingClasses, {
      organizationSlug: REGISTRATION.organizationSlug,
      trainingSlug: REGISTRATION.trainingSlug,
      weekday: 2,
      startTime: '18:00',
      endTime: '19:00',
      firstDate: '2020-01-07',
      weeks: 3,
      placesPerClass: 12,
      registrationDeadline: '2020-01-01',
    });
    await t.run(async (ctx) => {
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name: 'Demo Guardian',
            email: EMAIL,
            emailVerified: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      } as never)) as { _id: string };
      await ctx.db.insert('users', {
        authUserId: account._id,
        name: 'Demo Guardian',
        adultConfirmedAt: 1,
      });
    });
    return t;
  }

  const countsByDate = (t: Awaited<ReturnType<typeof seeded>>) =>
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
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await withClasses();
    vi.stubEnv('IS_TEST', value);
    await expect(
      t.mutation(internal.testing.seedTrainingRegistration, REGISTRATION),
    ).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('trainingRegistrations').collect())).toEqual([]);
  });

  test('registers the series, which holds a place in every class, passed ones included', async () => {
    const t = await withClasses();
    await t.mutation(internal.testing.seedTrainingRegistration, REGISTRATION);
    expect(await t.run((ctx) => ctx.db.query('trainingRegistrations').collect())).toEqual([
      expect.objectContaining({
        participant: { kind: 'minor', minorName: 'Maya R.' },
        participantKey: 'minor:maya r.',
      }),
    ]);
    expect(await countsByDate(t)).toEqual({ '2020-01-07': 1, '2020-01-14': 1, '2020-01-21': 1 });
  });

  test('registers one class when given its date, and counts that class only', async () => {
    const t = await withClasses();
    await t.mutation(internal.testing.seedTrainingRegistration, {
      ...REGISTRATION,
      date: '2020-01-14',
    });
    const [row] = await t.run((ctx) => ctx.db.query('trainingRegistrations').collect());
    expect(row?.classId).toBeDefined();
    expect(row?.participantKey).toBe(`class:${row?.classId}:minor:maya r.`);
    expect(await countsByDate(t)).toEqual({ '2020-01-07': 0, '2020-01-14': 1, '2020-01-21': 0 });
  });

  test('refuses an unknown account, a date with no class, and a training program it does not have', async () => {
    const t = await withClasses();
    await expect(
      t.mutation(internal.testing.seedTrainingRegistration, {
        ...REGISTRATION,
        email: 'no@example.test',
      }),
    ).rejects.toThrow(/No account/);
    await expect(
      t.mutation(internal.testing.seedTrainingRegistration, {
        ...REGISTRATION,
        date: '2020-02-02',
      }),
    ).rejects.toThrow(/No class/);
    await expect(
      t.mutation(internal.testing.seedTrainingRegistration, {
        ...REGISTRATION,
        trainingSlug: 'nowhere',
      }),
    ).rejects.toThrow(/No training program/);
  });
});

describe('testing:seedTrainingWaitlistEntry', () => {
  const EMAIL = 'guardian@example.test';
  const ENTRY = {
    organizationSlug: 'e2e-org-t7k2',
    trainingSlug: 'tuesday-serving-clinic',
    email: EMAIL,
    participant: { kind: 'minor', minorName: 'Maya R.' } as const,
  };

  async function withAccount() {
    const t = await seeded();
    betterAuthTest.register(t, 'betterAuth');
    await t.mutation(internal.testing.seedTraining, TRAINING);
    await t.run(async (ctx) => {
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name: 'Demo Guardian',
            email: EMAIL,
            emailVerified: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      } as never)) as { _id: string };
      await ctx.db.insert('users', {
        authUserId: account._id,
        name: 'Demo Guardian',
        adultConfirmedAt: 1,
      });
    });
    return t;
  }

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await withAccount();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedTrainingWaitlistEntry, ENTRY)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await t.run((ctx) => ctx.db.query('trainingWaitlistEntries').collect())).toEqual([]);
  });

  test('puts the participant on the series waitlist with no class, whether or not a class is full', async () => {
    const t = await withAccount();
    await t.mutation(internal.testing.seedTrainingWaitlistEntry, ENTRY);
    const rows = await t.run((ctx) => ctx.db.query('trainingWaitlistEntries').collect());
    expect(rows).toEqual([
      expect.objectContaining({
        participant: { kind: 'minor', minorName: 'Maya R.' },
        participantKey: 'minor:maya r.',
        status: 'waiting',
      }),
    ]);
    expect(rows[0]).not.toHaveProperty('classId');
  });

  test('refuses an unknown account and a training program it does not have', async () => {
    const t = await withAccount();
    await expect(
      t.mutation(internal.testing.seedTrainingWaitlistEntry, {
        ...ENTRY,
        email: 'no@example.test',
      }),
    ).rejects.toThrow(/No account/);
    await expect(
      t.mutation(internal.testing.seedTrainingWaitlistEntry, { ...ENTRY, trainingSlug: 'nowhere' }),
    ).rejects.toThrow(/No training program/);
  });
});
