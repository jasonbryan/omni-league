/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Participant } from './lib/individualRegistration';
import { insertMembership } from './lib/memberships';
import { deleteUserRecord } from './lib/users';
import {
  NOW,
  identity,
  refusal,
  registeredCounts,
  setup as baseSetup,
  type Setup,
} from './trainingRegistrations.setup';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const SELF: Participant = { kind: 'self' };
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

async function setup() {
  const s = await baseSetup();
  betterAuthTest.register(s.t, 'betterAuth');
  return s;
}

const register = (s: Setup, caller: 'alice' | 'bob' | 'carol', key: string, who: Participant) =>
  s[caller].mutation(api.trainingRegistrations.register, {
    trainingId: s.trainings[key].trainingId,
    participant: who,
    ageConfirmed: true,
  });

const placesOf = (s: Setup, key: string) =>
  s.t.run(async (ctx) => {
    const places: number[] = [];
    for (const id of s.trainings[key].classIds) {
      places.push((await ctx.db.get('trainingClasses', id))!.places);
    }
    return places;
  });

describe('a registration racing an organizer changing places', () => {
  test('keeps every class at or under its places whichever of the two runs first', async () => {
    for (const order of ['registrationFirst', 'placesFirst'] as const) {
      const s = await setup();
      await s.t.run(async (ctx) => {
        for (const id of s.trainings['open'].classIds)
          await ctx.db.patch('trainingClasses', id, { places: 2 });
      });
      await register(s, 'alice', 'open', SELF);
      const registration = () => register(s, 'bob', 'open', SELF);
      const lowering = () =>
        s.admin.mutation(api.trainingClasses.updateAllPlaces, {
          trainingId: s.trainings['open'].trainingId,
          places: 1,
        });
      const calls =
        order === 'registrationFirst' ? [registration(), lowering()] : [lowering(), registration()];
      await Promise.allSettled(calls);
      const counts = await registeredCounts(s, 'open');
      const places = await placesOf(s, 'open');
      counts.forEach((count, index) => expect(count).toBeLessThanOrEqual(places[index]));
      expect(counts[0]).toBe(counts[2]);
    }
  });

  test('refuses the registration once places were lowered to the count, and the lowering once the registration took the place', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (const id of s.trainings['open'].classIds)
        await ctx.db.patch('trainingClasses', id, { places: 2 });
    });
    await register(s, 'alice', 'open', SELF);
    await s.admin.mutation(api.trainingClasses.updateAllPlaces, {
      trainingId: s.trainings['open'].trainingId,
      places: 1,
    });
    expect(await refusal(register(s, 'bob', 'open', SELF))).toMatchObject({ code: 'classFull' });
    await s.admin.mutation(api.trainingClasses.updateAllPlaces, {
      trainingId: s.trainings['open'].trainingId,
      places: 2,
    });
    await register(s, 'bob', 'open', SELF);
    expect(
      await refusal(
        s.admin.mutation(api.trainingClasses.updateAllPlaces, {
          trainingId: s.trainings['open'].trainingId,
          places: 1,
        }),
      ),
    ).toMatchObject({ code: 'placesBelowRegistered' });
    expect(await registeredCounts(s, 'open')).toEqual([2, 2, 2]);
    expect(await placesOf(s, 'open')).toEqual([2, 2, 2]);
  });
});

describe('who may change a class or read a registration', () => {
  test('refuses a guardian, a non-member, another organization’s admin, and a signed-out caller, changing nothing', async () => {
    const s = await setup();
    await register(s, 'alice', 'open', SELF);
    await s.t.run(async (ctx) => {
      const id = await ctx.db.insert('users', {
        authUserId: 'zed',
        name: 'zed',
        adultConfirmedAt: 1,
      });
      await insertMembership(ctx, id, s.otherOrganization, 'orgAdmin');
    });
    const otherAdmin = s.t.withIdentity(identity('zed'));
    const classId = s.trainings['open'].classIds[0];
    const trainingId = s.trainings['open'].trainingId;
    const calls = [
      (c: typeof s.alice) =>
        c.mutation(api.trainingClasses.updatePlaces, { trainingClassId: classId, places: 50 }),
      (c: typeof s.alice) =>
        c.mutation(api.trainingClasses.updateAllPlaces, { trainingId, places: 50 }),
      (c: typeof s.alice) =>
        c.mutation(api.trainingClasses.restorePlaces, {
          trainingId,
          classes: [{ trainingClassId: classId, places: 50 }],
        }),
      (c: typeof s.alice) => c.mutation(api.trainingClasses.cancel, { trainingClassId: classId }),
      (c: typeof s.alice) => c.mutation(api.trainingClasses.restore, { trainingClassId: classId }),
    ];
    for (const caller of [s.alice, s.bob, otherAdmin, s.t]) {
      for (const call of calls) await expect(call(caller)).rejects.toThrow();
    }
    expect(await placesOf(s, 'open')).toEqual([12, 12, 12]);
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
  });

  test('refuses a signed-out caller registering, and shows another guardian none of a guardian’s children', async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.trainingRegistrations.register, {
        trainingId: s.trainings['open'].trainingId,
        participant: SELF,
        ageConfirmed: true,
      }),
    ).rejects.toThrow();
    await register(s, 'alice', 'open', MINOR('Maya R.'));
    const mine = (caller: typeof s.alice) =>
      caller.query(api.trainingRegistrations.listMineForTraining, {
        orgSlug: 'org-a',
        trainingSlug: 'tuesday-serving-clinic',
      });
    expect(await mine(s.alice)).toEqual({ self: false, minorNames: ['Maya R.'] });
    expect(await mine(s.bob)).toEqual({ self: false, minorNames: [] });
    expect(await mine(s.t as unknown as typeof s.alice)).toEqual({ self: false, minorNames: [] });
  });
});

describe('the holder of a place while a class is full', () => {
  test('reads registered for the holder and not registered for others, with the full class named', async () => {
    const s = await setup();
    await register(s, 'alice', 'lastPlace', SELF);
    const ask = (caller: typeof s.alice) =>
      caller.query(api.trainingRegistrations.getForRegistration, {
        orgSlug: 'org-a',
        trainingSlug: 'last-place-clinic',
      });
    expect(await ask(s.alice)).toMatchObject({
      registered: true,
      placesLeft: 0,
      fullClassDate: '2027-02-02',
    });
    expect(await ask(s.bob)).toMatchObject({
      registered: false,
      placesLeft: 0,
      fullClassDate: '2027-02-02',
    });
    expect(await refusal(register(s, 'alice', 'lastPlace', SELF))).toMatchObject({
      code: 'alreadyRegistered',
    });
  });
});

describe('deleting a guardian after a restore', () => {
  test('lowers the restored class with the others, for the guardian and the child, and keeps another account’s place', async () => {
    const s = await setup();
    const middle = s.trainings['open'].classIds[1];
    await s.t.run((ctx) => ctx.db.patch('trainingClasses', middle, { status: 'cancelled' }));
    await register(s, 'alice', 'open', SELF);
    await register(s, 'alice', 'open', MINOR('Maya R.'));
    await register(s, 'alice', 'open', MINOR('Noah R.'));
    await register(s, 'bob', 'open', SELF);
    expect(await registeredCounts(s, 'open')).toEqual([4, 0, 4]);
    await s.admin.mutation(api.trainingClasses.restore, { trainingClassId: middle });
    expect(await registeredCounts(s, 'open')).toEqual([4, 4, 4]);
    await s.t.run((ctx) => deleteUserRecord(ctx, 'alice'));
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
    const left = await s.t.run((ctx) => ctx.db.query('trainingRegistrations').collect());
    expect(left.map((row) => row.userId)).toEqual([s.users['bob']]);
  });
});
