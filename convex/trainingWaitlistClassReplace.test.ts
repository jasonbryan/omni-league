/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { insertTrainingWaitlistEntry } from './lib/trainingWaitlistWrites';
import {
  NOW,
  refusal,
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
const SAM: Participant = { kind: 'minor', minorName: 'Sam R.' };
const LAST = 'dropInLastPlace';
const OPEN = 'dropIn';
const PAST_CLASS = 0;
const LIVE_CLASS = 1;
const CANCELLED_CLASS = 2;

type Caller = Pick<Setup['t'], 'mutation' | 'query'>;

const trainingOf = (s: Setup, key: string) => s.trainings[key].trainingId;
const classOf = (s: Setup, key: string, index: number) => s.trainings[key].classIds[index];
const later = () => vi.setSystemTime(Date.now() + 1000);

const joinClass = (
  caller: Caller,
  s: Setup,
  key: string,
  index: number,
  participant: Participant = SELF,
) =>
  caller.mutation(api.trainingWaitlist.join, {
    trainingId: trainingOf(s, key),
    classId: classOf(s, key, index),
    participant,
    ageConfirmed: true,
  });

const joinSeries = (caller: Caller, s: Setup, key: string, participant: Participant = SELF) =>
  caller.mutation(api.trainingWaitlist.join, {
    trainingId: trainingOf(s, key),
    participant,
    ageConfirmed: true,
  });

const registerSeries = (caller: Caller, s: Setup, key: string) =>
  caller.mutation(api.trainingRegistrations.register, {
    trainingId: trainingOf(s, key),
    participant: SELF,
    ageConfirmed: true,
  });

const registerClass = (caller: Caller, s: Setup, key: string, index: number) =>
  caller.mutation(api.trainingRegistrations.register, {
    trainingId: trainingOf(s, key),
    classId: classOf(s, key, index),
    participant: SELF,
    ageConfirmed: true,
  });

const promote = (caller: Caller, id: Id<'trainingWaitlistEntries'>) =>
  caller.mutation(api.trainingWaitlist.promote, { trainingWaitlistEntryId: id });

const listFor = (caller: Caller, s: Setup, key: string) =>
  caller.query(api.trainingWaitlist.listForTraining, { trainingId: trainingOf(s, key) });

const SLUG: Record<string, string> = {
  dropIn: 'drop-in-clinic',
  dropInLastPlace: 'drop-in-last-place-clinic',
};

const mine = (caller: Caller, key: string) =>
  caller.query(api.trainingWaitlist.listMineForClasses, {
    orgSlug: 'org-a',
    trainingSlug: SLUG[key],
  });

const mineSeries = (caller: Caller, key: string) =>
  caller.query(api.trainingWaitlist.listMineForTraining, {
    orgSlug: 'org-a',
    trainingSlug: SLUG[key],
  });

const entriesOf = (s: Setup, key: string) =>
  s.t.run((ctx) =>
    ctx.db
      .query('trainingWaitlistEntries')
      .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
        q.eq('trainingId', trainingOf(s, key)),
      )
      .collect(),
  );

/** Skips the rules of joining, so a class can wait with a place free. */
async function seedEntry(
  s: Setup,
  key: string,
  userId: Id<'users'>,
  classIndex: number | undefined,
  participant: Participant = SELF,
): Promise<Id<'trainingWaitlistEntries'>> {
  return s.t.run(async (ctx) => {
    const training = (await ctx.db.get('trainings', trainingOf(s, key)))!;
    return insertTrainingWaitlistEntry(ctx, training, {
      userId,
      participant,
      ...(classIndex !== undefined && { classId: classOf(s, key, classIndex) }),
    });
  });
}

async function setPlaces(s: Setup, key: string, index: number, places: number): Promise<void> {
  await s.admin.mutation(api.trainingClasses.updatePlaces, {
    trainingClassId: classOf(s, key, index),
    places,
  });
}

/** One class has passed and one is cancelled, which the queue and the lists leave out. */
async function pastAndCancelled(s: Setup, key: string): Promise<void> {
  await s.t.run(async (ctx) => {
    await ctx.db.patch('trainingClasses', classOf(s, key, PAST_CLASS), { date: '2027-01-30' });
    await ctx.db.patch('trainingClasses', classOf(s, key, CANCELLED_CLASS), {
      status: 'cancelled',
    });
  });
}

describe('one waiting entry for each of two classes', () => {
  test('each entry is next, and promotable, once its own class has a free place', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await registerClass(s.alice, s, LAST, 1);
    const bob = await joinClass(s.bob, s, LAST, 0);
    later();
    const carol = await joinClass(s.carol, s, LAST, 1);
    expect((await listFor(s.admin, s, LAST)).map((row) => [row.hasPlace, row.canPromote])).toEqual([
      [false, false],
      [false, false],
    ]);

    await setPlaces(s, LAST, 1, 2);
    expect((await listFor(s.admin, s, LAST)).map((row) => [row.hasPlace, row.canPromote])).toEqual([
      [false, false],
      [true, true],
    ]);
    const early = await refusal(promote(s.admin, bob.trainingWaitlistEntryId));
    expect(early.code).toBe('noFreePlace');
    await expect(promote(s.admin, carol.trainingWaitlistEntryId)).resolves.toMatchObject({});
    expect(await registeredCounts(s, LAST)).toEqual([1, 2, 0]);

    await setPlaces(s, LAST, 0, 2);
    expect((await listFor(s.admin, s, LAST)).map((row) => row.canPromote)).toEqual([true]);
    await expect(promote(s.admin, bob.trainingWaitlistEntryId)).resolves.toMatchObject({});
    expect(await registeredCounts(s, LAST)).toEqual([2, 2, 0]);
    expect(await listFor(s.admin, s, LAST)).toEqual([]);
  });
});

describe('promoting a participant who already holds the place', () => {
  test('refuses a class entry whose participant holds the series, changes nothing, and leaves the next entry promotable', async () => {
    const s = await setup();
    await registerSeries(s.alice, s, LAST);
    const held = await seedEntry(s, LAST, s.users['alice'], LIVE_CLASS);
    later();
    const next = await joinClass(s.bob, s, LAST, LIVE_CLASS);
    await setPlaces(s, LAST, LIVE_CLASS, 3);
    expect((await listFor(s.admin, s, LAST)).map((row) => row.canPromote)).toEqual([false, true]);
    const data = await refusal(promote(s.admin, held));
    expect(data.code).toBe('alreadyRegistered');
    expect(await registeredCounts(s, LAST)).toEqual([1, 1, 1]);
    expect(await entriesOf(s, LAST)).toHaveLength(2);
    await expect(promote(s.admin, next.trainingWaitlistEntryId)).resolves.toMatchObject({});
    expect(await registeredCounts(s, LAST)).toEqual([1, 2, 1]);
  });
});

describe('a series replaces class entries of classes that have passed or are cancelled', () => {
  test('registering for the series deletes only the participant’s entries, past and cancelled included', async () => {
    const s = await setup();
    const past = await seedEntry(s, OPEN, s.users['alice'], PAST_CLASS);
    const live = await seedEntry(s, OPEN, s.users['alice'], LIVE_CLASS);
    const cancelled = await seedEntry(s, OPEN, s.users['alice'], CANCELLED_CLASS);
    const others = [
      await seedEntry(s, OPEN, s.users['bob'], PAST_CLASS),
      await seedEntry(s, OPEN, s.users['alice'], PAST_CLASS, SAM),
    ];
    await pastAndCancelled(s, OPEN);
    await registerSeries(s.alice, s, OPEN);
    const left = (await entriesOf(s, OPEN)).map((row) => row._id);
    expect(left.sort()).toEqual([...others].sort());
    for (const gone of [past, live, cancelled]) expect(left).not.toContain(gone);
    expect(await registeredCounts(s, OPEN)).toEqual([0, 1, 0]);
    expect(await mine(s.alice, OPEN)).toEqual([]);
  });

  test('joining the series waitlist deletes them too, and the positions after are exact', async () => {
    const s = await setup();
    await registerSeries(s.alice, s, LAST);
    await joinClass(s.bob, s, LAST, PAST_CLASS);
    later();
    const bobLive = await joinClass(s.bob, s, LAST, LIVE_CLASS);
    later();
    await joinClass(s.bob, s, LAST, CANCELLED_CLASS);
    later();
    const sam = await joinClass(s.bob, s, LAST, LIVE_CLASS, SAM);
    later();
    const carol = await joinClass(s.carol, s, LAST, LIVE_CLASS);
    expect([bobLive.position, sam.position, carol.position]).toEqual([1, 2, 3]);
    await pastAndCancelled(s, LAST);
    const joined = await joinSeries(s.bob, s, LAST);
    expect(joined.position).toBe(3);
    const rows = await entriesOf(s, LAST);
    expect(rows.map((row) => row._id).sort()).toEqual(
      [
        sam.trainingWaitlistEntryId,
        carol.trainingWaitlistEntryId,
        joined.trainingWaitlistEntryId,
      ].sort(),
    );
    expect(await mine(s.bob, LAST)).toEqual([
      { classId: classOf(s, LAST, LIVE_CLASS), participant: SAM, position: 1 },
    ]);
    expect(await mine(s.carol, LAST)).toEqual([
      { classId: classOf(s, LAST, LIVE_CLASS), participant: SELF, position: 2 },
    ]);
    expect(await mineSeries(s.bob, LAST)).toEqual([{ participant: SELF, position: 3 }]);
    expect(await registeredCounts(s, LAST)).toEqual([1, 1, 1]);
  });

  test('promoting a series entry deletes them too, and the entries behind are numbered from the new queue', async () => {
    const s = await setup();
    await registerSeries(s.alice, s, LAST);
    const series = await seedEntry(s, LAST, s.users['bob'], undefined);
    later();
    const past = await seedEntry(s, LAST, s.users['bob'], PAST_CLASS);
    const live = await seedEntry(s, LAST, s.users['bob'], LIVE_CLASS);
    later();
    const carol = await seedEntry(s, LAST, s.users['carol'], LIVE_CLASS);
    await pastAndCancelled(s, LAST);
    await s.t.run(async (ctx) => {
      for (const index of [LIVE_CLASS, CANCELLED_CLASS]) {
        await ctx.db.patch('trainingClasses', classOf(s, LAST, index), { places: 2 });
      }
    });
    await expect(promote(s.admin, series)).resolves.toMatchObject({});
    expect(await registeredCounts(s, LAST)).toEqual([1, 2, 1]);
    expect(await s.t.run((ctx) => ctx.db.get('trainingWaitlistEntries', past))).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.get('trainingWaitlistEntries', live))).toBeNull();
    expect((await entriesOf(s, LAST)).filter((row) => row.status === 'waiting')).toMatchObject([
      { _id: carol },
    ]);
    expect(await mine(s.carol, LAST)).toEqual([
      { classId: classOf(s, LAST, LIVE_CLASS), participant: SELF, position: 1 },
    ]);
    expect((await listFor(s.admin, s, LAST)).map((row) => row.canPromote)).toEqual([false]);
  });
});

describe('an entry whose account is gone', () => {
  test('is listed without a name error and skipped, and its position still counts nobody twice', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, LIVE_CLASS);
    const ghost = await joinClass(s.bob, s, LAST, LIVE_CLASS);
    later();
    const next = await joinClass(s.carol, s, LAST, LIVE_CLASS);
    await s.t.run((ctx) => ctx.db.delete('users', s.users['bob']));
    await setPlaces(s, LAST, LIVE_CLASS, 2);
    const rows = await listFor(s.admin, s, LAST);
    expect(rows.map((row) => [row.trainingWaitlistEntryId, row.canPromote])).toEqual([
      [ghost.trainingWaitlistEntryId, false],
      [next.trainingWaitlistEntryId, true],
    ]);
    expect((await refusal(promote(s.admin, ghost.trainingWaitlistEntryId))).code).toBe(
      'accountGone',
    );
    await expect(promote(s.admin, next.trainingWaitlistEntryId)).resolves.toMatchObject({});
  });
});

describe('another guardian', () => {
  test('waits for the same child name as a separate entry and never sees the first guardian’s entry', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, LIVE_CLASS);
    const first = await joinClass(s.bob, s, LAST, LIVE_CLASS, SAM);
    later();
    const second = await joinClass(s.carol, s, LAST, LIVE_CLASS, SAM);
    expect([first.position, second.position]).toEqual([1, 2]);
    expect(await mine(s.bob, LAST)).toEqual([
      { classId: classOf(s, LAST, LIVE_CLASS), participant: SAM, position: 1 },
    ]);
    expect(await mine(s.carol, LAST)).toEqual([
      { classId: classOf(s, LAST, LIVE_CLASS), participant: SAM, position: 2 },
    ]);
    await expect(listFor(s.bob, s, LAST)).rejects.toThrow();
    await expect(listFor(s.carol, s, LAST)).rejects.toThrow();
    await expect(promote(s.bob, second.trainingWaitlistEntryId)).rejects.toThrow();
  });
});
