/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { components, internal } from './_generated/api';
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

describe('testing:seedCampSession', () => {
  const SESSION = {
    organizationSlug: 'e2e-org-c4m9',
    campSlug: 'junior-beach-volleyball-camp',
    name: 'Week 1',
    startDate: '2027-07-05',
    endDate: '2027-07-09',
    dailyStartTime: '09:00',
    dailyEndTime: '12:00',
    places: 20,
    registrationDeadline: '2027-07-01',
  };

  async function withCamp() {
    const t = await seeded();
    await t.mutation(internal.testing.seedCamp, CAMP);
    return t;
  }

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await withCamp();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedCampSession, SESSION)).rejects.toThrow(/IS_TEST/);
    expect(await t.run((ctx) => ctx.db.query('campSessions').collect())).toEqual([]);
  });

  test('inserts a session of the camp, with no registrations unless the seed says so', async () => {
    const t = await withCamp();
    await t.mutation(internal.testing.seedCampSession, SESSION);
    await t.mutation(internal.testing.seedCampSession, {
      ...SESSION,
      name: 'Week 2',
      registeredCount: 4,
    });
    expect(await t.run((ctx) => ctx.db.query('campSessions').collect())).toEqual([
      expect.objectContaining({ name: 'Week 1', places: 20, registeredCount: 0 }),
      expect.objectContaining({ name: 'Week 2', registeredCount: 4 }),
    ]);
  });

  test('refuses an unknown organization and a camp it does not have', async () => {
    const t = await withCamp();
    await expect(
      t.mutation(internal.testing.seedCampSession, { ...SESSION, organizationSlug: 'nowhere' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.seedCampSession, { ...SESSION, campSlug: 'nowhere' }),
    ).rejects.toThrow(/No camp/);
  });
});

describe('testing:publishSeededCamp', () => {
  const PUBLISH = { organizationSlug: 'e2e-org-c4m9', campSlug: 'junior-beach-volleyball-camp' };

  async function withCamp() {
    const t = await seeded();
    await t.mutation(internal.testing.seedCamp, CAMP);
    return t;
  }

  const statuses = (t: Awaited<ReturnType<typeof seeded>>) =>
    t.run(async (ctx) => (await ctx.db.query('programs').collect()).map((row) => row.status));

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and publishes nothing', async (_, value) => {
    const t = await withCamp();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.publishSeededCamp, PUBLISH)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await statuses(t)).toEqual(['draft']);
  });

  test('publishes the camp even when it has no session', async () => {
    const t = await withCamp();
    await t.mutation(internal.testing.publishSeededCamp, PUBLISH);
    expect(await statuses(t)).toEqual(['published']);
  });

  test('refuses an unknown organization and a camp it does not have', async () => {
    const t = await withCamp();
    await expect(
      t.mutation(internal.testing.publishSeededCamp, { ...PUBLISH, organizationSlug: 'nowhere' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.publishSeededCamp, { ...PUBLISH, campSlug: 'nowhere' }),
    ).rejects.toThrow(/No camp/);
  });
});

describe('testing:seedCampRegistration', () => {
  const EMAIL = 'guardian@example.test';
  const REGISTRATION = {
    organizationSlug: 'e2e-org-c4m9',
    campSlug: 'junior-beach-volleyball-camp',
    sessionName: 'Week 1',
    email: EMAIL,
    participant: { kind: 'minor', minorName: 'Maya R.' } as const,
  };

  async function withSession() {
    const t = await seeded();
    betterAuthTest.register(t, 'betterAuth');
    await t.mutation(internal.testing.seedCamp, CAMP);
    await t.mutation(internal.testing.seedCampSession, {
      organizationSlug: CAMP.organizationSlug,
      campSlug: CAMP.slug,
      name: 'Week 1',
      startDate: '2027-07-05',
      endDate: '2027-07-09',
      places: 20,
      registrationDeadline: '2027-07-01',
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

  test.each([
    ['unset', undefined],
    ['"false"', 'false'],
  ])('throws with IS_TEST %s and writes nothing', async (_, value) => {
    const t = await withSession();
    vi.stubEnv('IS_TEST', value);
    await expect(t.mutation(internal.testing.seedCampRegistration, REGISTRATION)).rejects.toThrow(
      /IS_TEST/,
    );
    expect(await t.run((ctx) => ctx.db.query('campRegistrations').collect())).toEqual([]);
  });

  test('registers the account in the session and counts the place', async () => {
    const t = await withSession();
    await t.mutation(internal.testing.seedCampRegistration, REGISTRATION);
    expect(await t.run((ctx) => ctx.db.query('campRegistrations').collect())).toEqual([
      expect.objectContaining({
        participant: { kind: 'minor', minorName: 'Maya R.' },
        participantKey: 'minor:maya r.',
      }),
    ]);
    expect(
      await t.run(async (ctx) => (await ctx.db.query('campSessions').first())!.registeredCount),
    ).toBe(1);
  });

  test('refuses an unknown account, a session the camp does not have, and a camp it does not have', async () => {
    const t = await withSession();
    await expect(
      t.mutation(internal.testing.seedCampRegistration, {
        ...REGISTRATION,
        email: 'no@example.test',
      }),
    ).rejects.toThrow(/No account/);
    await expect(
      t.mutation(internal.testing.seedCampRegistration, { ...REGISTRATION, sessionName: 'Week 9' }),
    ).rejects.toThrow(/No session/);
    await expect(
      t.mutation(internal.testing.seedCampRegistration, { ...REGISTRATION, campSlug: 'nowhere' }),
    ).rejects.toThrow(/No camp/);
  });
});
