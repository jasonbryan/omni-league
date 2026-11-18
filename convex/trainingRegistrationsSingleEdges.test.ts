/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { classParticipantKey } from './lib/trainingRegistration';
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
const PROGRAM = 'dropIn';

async function setup() {
  const s = await baseSetup();
  betterAuthTest.register(s.t, 'betterAuth');
  return s;
}

const classOf = (s: Setup, index: number) => s.trainings[PROGRAM].classIds[index];

const registerClass = (s: Setup, caller: 'alice' | 'bob', index: number) =>
  s[caller].mutation(api.trainingRegistrations.register, {
    trainingId: s.trainings[PROGRAM].trainingId,
    classId: classOf(s, index),
    participant: SELF,
    ageConfirmed: true,
  });

const registerSeries = (s: Setup, caller: 'alice' | 'bob') =>
  s[caller].mutation(api.trainingRegistrations.register, {
    trainingId: s.trainings[PROGRAM].trainingId,
    participant: SELF,
    ageConfirmed: true,
  });

const rowsOf = (s: Setup, userId: Id<'users'>) =>
  s.t.run((ctx) =>
    ctx.db
      .query('trainingRegistrations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect(),
  );

describe('the series replacing single-class registrations in a class that has passed or is cancelled', () => {
  test('frees the places of those classes too, and counts the classes to come once', async () => {
    const s = await setup();
    for (const index of [0, 1, 2]) await registerClass(s, 'alice', index);
    await registerClass(s, 'bob', 0);
    expect(await registeredCounts(s, PROGRAM)).toEqual([2, 1, 1]);
    await s.t.run(async (ctx) => {
      await ctx.db.patch('trainingClasses', classOf(s, 0), { date: '2027-01-20' });
      await ctx.db.patch('trainingClasses', classOf(s, 1), { status: 'cancelled' });
    });

    await registerSeries(s, 'alice');

    expect(await registeredCounts(s, PROGRAM)).toEqual([1, 0, 1]);
    const mine = await rowsOf(s, s.users['alice']);
    expect(mine.map((row) => row.participantKey)).toEqual(['self']);
  });
});

describe('trainingClasses.restore with more rows than one read takes', () => {
  test('counts exactly the series registrations when single-class rows of other classes outnumber them', async () => {
    const s = await setup();
    const SERIES_ROWS = 250;
    const SINGLE_ROWS = 450;
    await s.t.run(async (ctx) => {
      await ctx.db.patch('trainingClasses', classOf(s, 1), { status: 'cancelled' });
      const base = {
        trainingId: s.trainings[PROGRAM].trainingId,
        organizationId: s.organization,
        userId: s.users['alice'],
        createdAt: NOW,
      };
      for (let index = 0; index < SINGLE_ROWS; index++) {
        const participant = MINOR(`Single ${String(index).padStart(3, '0')}`);
        await ctx.db.insert('trainingRegistrations', {
          ...base,
          classId: classOf(s, 2),
          participant,
          participantKey: classParticipantKey(classOf(s, 2), participant),
        });
      }
      for (let index = 0; index < SERIES_ROWS; index++) {
        const name = `Series ${String(index).padStart(3, '0')}`;
        await ctx.db.insert('trainingRegistrations', {
          ...base,
          participant: MINOR(name),
          participantKey: `minor:${name.toLowerCase()}`,
        });
      }
    });

    await s.admin.mutation(api.trainingClasses.restore, { trainingClassId: classOf(s, 1) });

    expect((await registeredCounts(s, PROGRAM))[1]).toBe(SERIES_ROWS);
  });
});

describe('deleting an account with more single-class rows than one batch', () => {
  test('lowers each class by its rows, clamped at 0, and leaves another account’s place', async () => {
    const s = await setup();
    await registerClass(s, 'bob', 2);
    const FIRST_CLASS_ROWS = 130;
    const SECOND_CLASS_ROWS = 120;
    await s.t.run(async (ctx) => {
      const base = {
        trainingId: s.trainings[PROGRAM].trainingId,
        organizationId: s.organization,
        userId: s.users['alice'],
        createdAt: NOW,
      };
      const insertRows = async (index: number, rows: number) => {
        for (let row = 0; row < rows; row++) {
          const participant = MINOR(`Child ${index}-${row}`);
          await ctx.db.insert('trainingRegistrations', {
            ...base,
            classId: classOf(s, index),
            participant,
            participantKey: classParticipantKey(classOf(s, index), participant),
          });
        }
      };
      await insertRows(0, FIRST_CLASS_ROWS);
      await insertRows(1, SECOND_CLASS_ROWS);
      await ctx.db.patch('trainingClasses', classOf(s, 0), { registeredCount: FIRST_CLASS_ROWS });
      await ctx.db.patch('trainingClasses', classOf(s, 1), { registeredCount: 100 });
    });

    await s.t.run((ctx) => deleteUserRecord(ctx, 'alice'));

    expect(await rowsOf(s, s.users['alice'])).toEqual([]);
    expect(await registeredCounts(s, PROGRAM)).toEqual([0, 0, 1]);
    expect(await rowsOf(s, s.users['bob'])).toHaveLength(1);
  });
});

describe('the series when a child holds the last place of a class', () => {
  test('registers that child, and refuses the guardian themself, whose own place is not in the class', async () => {
    const s = await setup();
    const trainingId = s.trainings['dropInLastPlace'].trainingId;
    const classId = s.trainings['dropInLastPlace'].classIds[1];
    await s.alice.mutation(api.trainingRegistrations.register, {
      trainingId,
      classId,
      participant: MINOR('Maya R.'),
      ageConfirmed: true,
    });
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([0, 1, 0]);

    await expect(
      s.alice.mutation(api.trainingRegistrations.register, {
        trainingId,
        participant: SELF,
        ageConfirmed: true,
      }),
    ).rejects.toMatchObject({ data: { code: 'classFull' } });

    await s.alice.mutation(api.trainingRegistrations.register, {
      trainingId,
      participant: MINOR('Maya R.'),
      ageConfirmed: true,
    });
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([1, 1, 1]);
  });

  test('registers the adult for the series when their own place fills a class', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 2);
    await s.t.run((ctx) => ctx.db.patch('trainingClasses', classOf(s, 2), { registeredCount: 12 }));
    await registerSeries(s, 'alice');
    expect(await registeredCounts(s, PROGRAM)).toEqual([1, 1, 12]);
  });
});
