/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { deleteUserRecord } from './lib/users';
import {
  NOW,
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

const register = (s: Setup, caller: 'alice' | 'bob' | 'carol', participant: Participant) =>
  s[caller].mutation(api.trainingRegistrations.register, {
    trainingId: s.trainings['open'].trainingId,
    participant,
    ageConfirmed: false,
  });

const middleClass = (s: Setup) => s.trainings['open'].classIds[1];

const patchClass = (s: Setup, id: Id<'trainingClasses'>, fields: object) =>
  s.t.run((ctx) => ctx.db.patch('trainingClasses', id, fields));

const statusOf = (s: Setup, id: Id<'trainingClasses'>) =>
  s.t.run(async (ctx) => (await ctx.db.get('trainingClasses', id))!.status);

async function threeRegistrationsAroundACancelledClass(s: Setup) {
  await patchClass(s, middleClass(s), { status: 'cancelled' });
  await register(s, 'alice', SELF);
  await register(s, 'alice', MINOR('Maya R.'));
  await register(s, 'bob', SELF);
  expect(await registeredCounts(s, 'open')).toEqual([3, 0, 3]);
}

const restore = (s: Setup) =>
  s.admin.mutation(api.trainingClasses.restore, { trainingClassId: middleClass(s) });

describe('trainingClasses.restore with series registrations', () => {
  test('counts every series registration, a child included, so the places left are right', async () => {
    const s = await setup();
    await threeRegistrationsAroundACancelledClass(s);
    await restore(s);
    expect(await statusOf(s, middleClass(s))).toBe('scheduled');
    expect(await registeredCounts(s, 'open')).toEqual([3, 3, 3]);
    const page = await s.t.query(api.trainings.getPublicPage, {
      orgSlug: 'org-a',
      trainingSlug: 'tuesday-serving-clinic',
    });
    expect(page?.classes.map((row) => row.placesLeft)).toEqual([9, 9, 9]);
  });

  test('sets a count that holds no registrant to 0 and ignores a registration of one class', async () => {
    const s = await setup();
    await patchClass(s, middleClass(s), { status: 'cancelled' });
    await restore(s);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
    await s.t.run((ctx) =>
      ctx.db.insert('trainingRegistrations', {
        trainingId: s.trainings['open'].trainingId,
        classId: s.trainings['open'].classIds[0],
        organizationId: s.organization,
        userId: s.users['alice'],
        participant: SELF,
        participantKey: 'self',
        createdAt: NOW,
      }),
    );
    await patchClass(s, middleClass(s), { status: 'cancelled' });
    await restore(s);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
  });

  test('counts only the registrations of that program', async () => {
    const s = await setup();
    await patchClass(s, middleClass(s), { status: 'cancelled' });
    await s.alice.mutation(api.trainingRegistrations.register, {
      trainingId: s.trainings['mixed'].trainingId,
      participant: SELF,
      ageConfirmed: true,
    });
    await restore(s);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
  });

  test('leaves a class that is already scheduled as it is', async () => {
    const s = await setup();
    await register(s, 'alice', SELF);
    await restore(s);
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
  });

  test('may show more registered than places, which the organizer fixes by raising places', async () => {
    const s = await setup();
    await patchClass(s, middleClass(s), { status: 'cancelled' });
    await register(s, 'alice', SELF);
    await register(s, 'alice', MINOR('Maya R.'));
    await register(s, 'bob', SELF);
    await s.admin.mutation(api.trainingClasses.updatePlaces, {
      trainingClassId: middleClass(s),
      places: 2,
    });
    await restore(s);
    expect(await registeredCounts(s, 'open')).toEqual([3, 3, 3]);

    const full = await refusal(register(s, 'carol', SELF));
    expect(full).toMatchObject({ code: 'classFull' });
    const below = await refusal(
      s.admin.mutation(api.trainingClasses.updatePlaces, {
        trainingClassId: middleClass(s),
        places: 2,
      }),
    );
    expect(below).toMatchObject({ code: 'placesBelowRegistered' });
    await s.admin.mutation(api.trainingClasses.updatePlaces, {
      trainingClassId: middleClass(s),
      places: 3,
    });
    expect(await registeredCounts(s, 'open')).toEqual([3, 3, 3]);
    await s.admin.mutation(api.trainingClasses.updatePlaces, {
      trainingClassId: middleClass(s),
      places: 4,
    });
    await s.admin.mutation(api.trainingClasses.updateAllPlaces, {
      trainingId: s.trainings['open'].trainingId,
      places: 4,
    });
    await register(s, 'carol', SELF);
    expect(await registeredCounts(s, 'open')).toEqual([4, 4, 4]);
  });

  test('cannot cancel the class again while registrations hold it', async () => {
    const s = await setup();
    await threeRegistrationsAroundACancelledClass(s);
    await restore(s);
    const data = await refusal(
      s.admin.mutation(api.trainingClasses.cancel, { trainingClassId: middleClass(s) }),
    );
    expect(data).toMatchObject({ code: 'hasRegistrations' });
  });

  test('refuses a caller who is not an organizer and changes nothing', async () => {
    const s = await setup();
    await threeRegistrationsAroundACancelledClass(s);
    await expect(
      s.alice.mutation(api.trainingClasses.restore, { trainingClassId: middleClass(s) }),
    ).rejects.toThrow();
    expect(await statusOf(s, middleClass(s))).toBe('cancelled');
    expect(await registeredCounts(s, 'open')).toEqual([3, 0, 3]);
  });
});

describe('deleting an account after a class was restored', () => {
  const deleteAccount = (s: Setup, authUserId: string) =>
    s.t.run((ctx) => deleteUserRecord(ctx, authUserId));

  test('lowers every class, the restored one included, so the counts stay exact', async () => {
    const s = await setup();
    await threeRegistrationsAroundACancelledClass(s);
    await restore(s);
    await deleteAccount(s, 'alice');
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
    await deleteAccount(s, 'bob');
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
  });

  test('frees a place in the restored class for another account when it was the last', async () => {
    const s = await setup();
    await patchClass(s, middleClass(s), { status: 'cancelled' });
    await s.admin.mutation(api.trainingClasses.updateAllPlaces, {
      trainingId: s.trainings['open'].trainingId,
      places: 2,
    });
    await register(s, 'alice', SELF);
    await register(s, 'bob', SELF);
    await restore(s);
    expect(await refusal(register(s, 'carol', SELF))).toMatchObject({ code: 'classFull' });
    await deleteAccount(s, 'alice');
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
    await register(s, 'carol', SELF);
    expect(await registeredCounts(s, 'open')).toEqual([2, 2, 2]);
  });
});

describe('restorePlaces (Undo) after a class was restored', () => {
  const previous = (s: Setup, places: number) =>
    s.trainings['open'].classIds.map((trainingClassId) => ({ trainingClassId, places }));

  test('puts the places back when they are not below the registered count', async () => {
    const s = await setup();
    await threeRegistrationsAroundACancelledClass(s);
    await restore(s);
    const changed = await s.admin.mutation(api.trainingClasses.updateAllPlaces, {
      trainingId: s.trainings['open'].trainingId,
      places: 3,
    });
    expect(changed.previous.map((row) => row.places)).toEqual([12, 12, 12]);
    await s.admin.mutation(api.trainingClasses.restorePlaces, {
      trainingId: s.trainings['open'].trainingId,
      classes: changed.previous,
    });
    const places = await s.t.run(async (ctx) => {
      const rows = [];
      for (const id of s.trainings['open'].classIds) {
        rows.push((await ctx.db.get('trainingClasses', id))!.places);
      }
      return rows;
    });
    expect(places).toEqual([12, 12, 12]);
  });

  test('refuses places below the restored class’s count, naming it, and changes nothing', async () => {
    const s = await setup();
    await threeRegistrationsAroundACancelledClass(s);
    await restore(s);
    const data = await refusal(
      s.admin.mutation(api.trainingClasses.restorePlaces, {
        trainingId: s.trainings['open'].trainingId,
        classes: [
          { trainingClassId: s.trainings['open'].classIds[0], places: 5 },
          { trainingClassId: middleClass(s), places: 2 },
        ],
      }),
    );
    expect(data).toMatchObject({ code: 'placesBelowRegistered' });
    const places = await s.t.run(
      async (ctx) => (await ctx.db.get('trainingClasses', s.trainings['open'].classIds[0]))!.places,
    );
    expect(places).toBe(12);
    await s.admin.mutation(api.trainingClasses.restorePlaces, {
      trainingId: s.trainings['open'].trainingId,
      classes: previous(s, 3),
    });
  });
});
