/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { deleteUserRecord } from './lib/users';
import {
  NOW,
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

const deleteAccount = (s: Setup, authUserId: string) =>
  s.t.run((ctx) => deleteUserRecord(ctx, authUserId));

const registrationsOf = (s: Setup, userId: Id<'users'>) =>
  s.t.run((ctx) =>
    ctx.db
      .query('trainingRegistrations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect(),
  );

describe('deleting an account removes its training registrations', () => {
  test('deletes the series registration of an adult and lowers each class by 1', async () => {
    const s = await setup();
    await register(s, 'alice', 'mixed', SELF);
    expect(await registeredCounts(s, 'mixed')).toEqual([1, 1, 1]);
    await deleteAccount(s, 'alice');
    expect(await registrationsOf(s, s.users['alice'])).toEqual([]);
    expect(await registeredCounts(s, 'mixed')).toEqual([0, 0, 0]);
  });

  test('lowers each class by one per row of itself and a child and keeps another account’s place', async () => {
    const s = await setup();
    await register(s, 'alice', 'mixed', SELF);
    await register(s, 'alice', 'mixed', MINOR('Maya R.'));
    await register(s, 'alice', 'youth', MINOR('Maya R.'));
    await register(s, 'bob', 'mixed', SELF);
    expect(await registeredCounts(s, 'mixed')).toEqual([3, 3, 3]);
    await deleteAccount(s, 'alice');
    expect(await registrationsOf(s, s.users['alice'])).toEqual([]);
    expect(await registeredCounts(s, 'mixed')).toEqual([1, 1, 1]);
    expect(await registeredCounts(s, 'youth')).toEqual([0, 0, 0]);
    expect(await registrationsOf(s, s.users['bob'])).toHaveLength(1);
  });

  test('never lowers a class below 0 when its count is already 0', async () => {
    const s = await setup();
    await register(s, 'alice', 'mixed', SELF);
    await register(s, 'alice', 'mixed', MINOR('Maya R.'));
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', s.trainings['mixed'].classIds[1], { registeredCount: 0 }),
    );
    await deleteAccount(s, 'alice');
    expect(await registrationsOf(s, s.users['alice'])).toEqual([]);
    expect(await registeredCounts(s, 'mixed')).toEqual([0, 0, 0]);
  });

  test('frees a place in a full series for another account to take', async () => {
    const s = await setup();
    await register(s, 'alice', 'lastPlace', SELF);
    await expect(register(s, 'bob', 'lastPlace', SELF)).rejects.toMatchObject({
      data: { code: 'classFull' },
    });
    await deleteAccount(s, 'alice');
    await register(s, 'bob', 'lastPlace', SELF);
    expect(await registeredCounts(s, 'lastPlace')).toEqual([1, 1, 1]);
  });

  test('completes when a class row is gone, deleting the registration and the users row', async () => {
    const s = await setup();
    await register(s, 'alice', 'mixed', SELF);
    await s.t.run((ctx) => ctx.db.delete('trainingClasses', s.trainings['mixed'].classIds[0]));
    await deleteAccount(s, 'alice');
    expect(await registrationsOf(s, s.users['alice'])).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.get('users', s.users['alice']))).toBeNull();
    const counts = await s.t.run(async (ctx) => {
      const rows = [];
      for (const id of s.trainings['mixed'].classIds.slice(1)) {
        rows.push((await ctx.db.get('trainingClasses', id))!.registeredCount);
      }
      return rows;
    });
    expect(counts).toEqual([0, 0]);
  });

  test('deletes an account that has no training registration', async () => {
    const s = await setup();
    await register(s, 'bob', 'mixed', SELF);
    await deleteAccount(s, 'alice');
    expect(await s.t.run((ctx) => ctx.db.get('users', s.users['alice']))).toBeNull();
    expect(await registeredCounts(s, 'mixed')).toEqual([1, 1, 1]);
  });

  test.each([99, 100, 101, 201])(
    'deletes all %i registrations of one account for one series and keeps the other account’s place',
    async (rows) => {
      const s = await setup();
      await s.t.run(async (ctx) => {
        const training = s.trainings['open'];
        for (let index = 0; index < rows; index++) {
          await ctx.db.insert('trainingRegistrations', {
            trainingId: training.trainingId,
            organizationId: s.organization,
            userId: s.users['alice'],
            participant: MINOR(`Minor ${index}`),
            participantKey: `minor:minor ${index}`,
            createdAt: NOW,
          });
        }
        for (const id of training.classIds) {
          await ctx.db.patch('trainingClasses', id, { places: 200, registeredCount: rows + 1 });
        }
      });
      await deleteAccount(s, 'alice');
      expect(await registrationsOf(s, s.users['alice'])).toEqual([]);
      expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
    },
  );
});

describe('deleting an account removes its single-class registrations', () => {
  const registerClass = (
    s: Setup,
    caller: 'alice' | 'bob',
    index: number,
    who: Participant = SELF,
  ) =>
    s[caller].mutation(api.trainingRegistrations.register, {
      trainingId: s.trainings['dropIn'].trainingId,
      classId: s.trainings['dropIn'].classIds[index],
      participant: who,
      ageConfirmed: true,
    });

  test('lowers each class by one per row and never below 0, whatever the count already is', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 0);
    await registerClass(s, 'alice', 1);
    await registerClass(s, 'alice', 1, MINOR('Maya R.'));
    await registerClass(s, 'bob', 1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 3, 0]);
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', s.trainings['dropIn'].classIds[0], { registeredCount: 0 }),
    );
    await deleteAccount(s, 'alice');
    expect(await registrationsOf(s, s.users['alice'])).toEqual([]);
    expect(await registeredCounts(s, 'dropIn')).toEqual([0, 1, 0]);
    expect(await registrationsOf(s, s.users['bob'])).toHaveLength(1);
  });

  test('frees the last place of a class for another account', async () => {
    const s = await setup();
    const single = (caller: 'alice' | 'bob') =>
      s[caller].mutation(api.trainingRegistrations.register, {
        trainingId: s.trainings['dropInLastPlace'].trainingId,
        classId: s.trainings['dropInLastPlace'].classIds[1],
        participant: SELF,
        ageConfirmed: true,
      });
    await single('alice');
    await expect(single('bob')).rejects.toMatchObject({ data: { code: 'classFull' } });
    await deleteAccount(s, 'alice');
    await single('bob');
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([0, 1, 0]);
  });

  test('completes when the class of a single-class registration is gone', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 0);
    await s.t.run((ctx) => ctx.db.delete('trainingClasses', s.trainings['dropIn'].classIds[0]));
    await deleteAccount(s, 'alice');
    expect(await registrationsOf(s, s.users['alice'])).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.get('users', s.users['alice']))).toBeNull();
  });

  test('lowers a series and a single-class registration of one account together', async () => {
    const s = await setup();
    await register(s, 'alice', 'dropIn', MINOR('Maya R.'));
    await registerClass(s, 'alice', 1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 2, 1]);
    await deleteAccount(s, 'alice');
    expect(await registeredCounts(s, 'dropIn')).toEqual([0, 0, 0]);
  });
});
