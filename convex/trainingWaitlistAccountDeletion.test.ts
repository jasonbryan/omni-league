/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { deleteUserRecord } from './lib/users';
import {
  NOW,
  registeredCounts,
  setupWithPeople as setup,
  type SetupWithPeople as Setup,
} from './trainingRegistrations.setup';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const SELF: Participant = { kind: 'self' };
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

const join = (caller: Setup['alice'], s: Setup, participant: Participant = SELF) =>
  caller.mutation(api.trainingWaitlist.join, {
    trainingId: s.trainings['lastPlace'].trainingId,
    participant,
    ageConfirmed: true,
  });

const entriesOf = (s: Setup, userId: Id<'users'>) =>
  s.t.run((ctx) =>
    ctx.db
      .query('trainingWaitlistEntries')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect(),
  );

const deleteAccount = (s: Setup, authUserId: string) =>
  s.t.run((ctx) => deleteUserRecord(ctx, authUserId));

async function fillSeries(s: Setup) {
  await s.alice.mutation(api.trainingRegistrations.register, {
    trainingId: s.trainings['lastPlace'].trainingId,
    participant: SELF,
    ageConfirmed: true,
  });
}

describe('deleting an account removes its training waitlist entries', () => {
  test('deletes waiting and promoted entries of the account and a child, and keeps another account’s entry', async () => {
    const s = await setup();
    await fillSeries(s);
    await join(s.bob, s);
    vi.setSystemTime(NOW + 1000);
    await join(s.bob, s, MINOR('Maya R.'));
    vi.setSystemTime(NOW + 2000);
    await join(s.carol, s);
    for (const trainingClassId of s.trainings['lastPlace'].classIds) {
      await s.admin.mutation(api.trainingClasses.updatePlaces, { trainingClassId, places: 2 });
    }
    const [first] = await entriesOf(s, s.users['bob']);
    await s.admin.mutation(api.trainingWaitlist.promote, { trainingWaitlistEntryId: first._id });
    expect((await entriesOf(s, s.users['bob'])).map((entry) => entry.status).sort()).toEqual([
      'promoted',
      'waiting',
    ]);
    await deleteAccount(s, 'bob');
    expect(await entriesOf(s, s.users['bob'])).toEqual([]);
    expect(await entriesOf(s, s.users['carol'])).toHaveLength(1);
    expect(await s.t.run((ctx) => ctx.db.get('users', s.users['bob']))).toBeNull();
  });

  test('leaves no entry holding the id of a deleted registration', async () => {
    const s = await setup();
    await fillSeries(s);
    await join(s.bob, s);
    for (const trainingClassId of s.trainings['lastPlace'].classIds) {
      await s.admin.mutation(api.trainingClasses.updatePlaces, { trainingClassId, places: 2 });
    }
    const [entry] = await entriesOf(s, s.users['bob']);
    await s.admin.mutation(api.trainingWaitlist.promote, { trainingWaitlistEntryId: entry._id });
    await deleteAccount(s, 'bob');
    const dangling = await s.t.run(async (ctx) => {
      const entries = await ctx.db.query('trainingWaitlistEntries').collect();
      const held = [];
      for (const row of entries) {
        if (
          row.registrationId &&
          !(await ctx.db.get('trainingRegistrations', row.registrationId))
        ) {
          held.push(row._id);
        }
      }
      return held;
    });
    expect(dangling).toEqual([]);
  });

  test('moves the entries behind a deleted one up, and lets the next be promoted', async () => {
    const s = await setup();
    await fillSeries(s);
    await join(s.bob, s);
    vi.setSystemTime(NOW + 1000);
    const next = await join(s.carol, s);
    expect(next.position).toBe(2);
    await deleteAccount(s, 'bob');
    expect(
      await s.carol.query(api.trainingWaitlist.listMineForTraining, {
        orgSlug: 'org-a',
        trainingSlug: 'last-place-clinic',
      }),
    ).toEqual([{ participant: SELF, position: 1 }]);
    for (const trainingClassId of s.trainings['lastPlace'].classIds) {
      await s.admin.mutation(api.trainingClasses.updatePlaces, { trainingClassId, places: 2 });
    }
    await s.admin.mutation(api.trainingWaitlist.promote, {
      trainingWaitlistEntryId: next.trainingWaitlistEntryId,
    });
    expect(await registeredCounts(s, 'lastPlace')).toEqual([2, 2, 2]);
  });

  test('takes registrations again once the only waiting account is deleted', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', s.trainings['open'].trainingId))!;
      await ctx.db.insert('trainingWaitlistEntries', {
        trainingId: training._id,
        organizationId: training.organizationId,
        userId: s.users['bob'],
        participant: SELF,
        participantKey: 'self',
        status: 'waiting',
        requestedAt: NOW,
      });
    });
    const register = () =>
      s.carol.mutation(api.trainingRegistrations.register, {
        trainingId: s.trainings['open'].trainingId,
        participant: SELF,
        ageConfirmed: true,
      });
    await expect(register()).rejects.toMatchObject({ data: { code: 'classFull' } });
    await deleteAccount(s, 'bob');
    await expect(register()).resolves.toMatchObject({});
  });

  test('deletes more entries than one batch holds', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', s.trainings['open'].trainingId))!;
      for (let index = 0; index < 130; index++) {
        await ctx.db.insert('trainingWaitlistEntries', {
          trainingId: training._id,
          organizationId: training.organizationId,
          userId: s.users['bob'],
          participant: MINOR(`Child ${index}`),
          participantKey: `minor:child ${index}`,
          status: 'waiting',
          requestedAt: NOW + index,
        });
      }
    });
    await deleteAccount(s, 'bob');
    expect(await entriesOf(s, s.users['bob'])).toEqual([]);
  });

  test('leaves entries alone when no users row matches', async () => {
    const s = await setup();
    await fillSeries(s);
    await join(s.bob, s);
    await deleteAccount(s, 'nobody');
    expect(await entriesOf(s, s.users['bob'])).toHaveLength(1);
  });
});
