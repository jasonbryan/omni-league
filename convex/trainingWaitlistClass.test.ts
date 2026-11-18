/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MAX_MINORS_PER_SESSION, type Participant } from './lib/individualRegistration';
import { TRAINING_PATTERN_MESSAGES } from './lib/trainingPattern';
import { TRAINING_WAITLIST_MESSAGES } from './lib/trainingWaitlist';
import { insertTrainingWaitlistEntry } from './lib/trainingWaitlistWrites';
import { deleteUserRecord } from './lib/users';
import {
  NOW,
  identity,
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
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

type Caller = Pick<Setup['t'], 'mutation' | 'query'>;

const LAST = 'dropInLastPlace';
const OPEN = 'dropIn';
const SLUGS: Record<string, string> = {
  [LAST]: 'drop-in-last-place-clinic',
  [OPEN]: 'drop-in-clinic',
};

const trainingOf = (s: Setup, key: string) => s.trainings[key].trainingId;
const classOf = (s: Setup, key: string, index: number) => s.trainings[key].classIds[index];

const registerClass = (
  caller: Caller,
  s: Setup,
  key: string,
  index: number,
  participant: Participant = SELF,
) =>
  caller.mutation(api.trainingRegistrations.register, {
    trainingId: trainingOf(s, key),
    classId: classOf(s, key, index),
    participant,
    ageConfirmed: true,
  });

const registerSeries = (caller: Caller, s: Setup, key: string, participant: Participant = SELF) =>
  caller.mutation(api.trainingRegistrations.register, {
    trainingId: trainingOf(s, key),
    participant,
    ageConfirmed: true,
  });

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

const promote = (caller: Caller, id: Id<'trainingWaitlistEntries'>) =>
  caller.mutation(api.trainingWaitlist.promote, { trainingWaitlistEntryId: id });

const listFor = (caller: Caller, s: Setup, key: string) =>
  caller.query(api.trainingWaitlist.listForTraining, { trainingId: trainingOf(s, key) });

const later = (ms = 1000) => vi.setSystemTime(Date.now() + ms);

const entry = (s: Setup, id: Id<'trainingWaitlistEntries'>) =>
  s.t.run((ctx) => ctx.db.get('trainingWaitlistEntries', id));

const entriesOf = (s: Setup, key: string) =>
  s.t.run((ctx) =>
    ctx.db
      .query('trainingWaitlistEntries')
      .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
        q.eq('trainingId', trainingOf(s, key)),
      )
      .collect(),
  );

async function setPlaces(s: Setup, key: string, index: number, places: number): Promise<void> {
  await s.admin.mutation(api.trainingClasses.updatePlaces, {
    trainingClassId: classOf(s, key, index),
    places,
  });
}

async function raiseAll(s: Setup, key: string, by: number): Promise<void> {
  for (const index of s.trainings[key].classIds.keys()) {
    const row = await s.t.run((ctx) => ctx.db.get('trainingClasses', classOf(s, key, index)));
    await setPlaces(s, key, index, row!.places + by);
  }
}

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

async function fillSeries(s: Setup) {
  await registerSeries(s.alice, s, LAST);
  expect(await registeredCounts(s, LAST)).toEqual([1, 1, 1]);
}

describe('joining the waitlist of one class', () => {
  test('puts a person on the waitlist of a full class without taking a place, at position 1', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 1);
    const result = await joinClass(s.bob, s, LAST, 1);
    expect(result.position).toBe(1);
    expect(await entry(s, result.trainingWaitlistEntryId)).toMatchObject({
      classId: classOf(s, LAST, 1),
      participantKey: `class:${classOf(s, LAST, 1)}:self`,
      participant: SELF,
      status: 'waiting',
      userId: s.users['bob'],
    });
    expect(await registeredCounts(s, LAST)).toEqual([0, 1, 0]);
  });

  test('numbers the entries of a class in the order they joined, and leaves another class out', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await registerClass(s.alice, s, LAST, 1);
    expect((await joinClass(s.bob, s, LAST, 0)).position).toBe(1);
    later();
    expect((await joinClass(s.carol, s, LAST, 0)).position).toBe(2);
    later();
    expect((await joinClass(s.carol, s, LAST, 1)).position).toBe(1);
  });

  test('counts a series entry that joined earlier ahead of a class entry, and a later one behind it', async () => {
    const s = await setup();
    await fillSeries(s);
    await joinSeries(s.bob, s, LAST);
    later();
    expect((await joinClass(s.carol, s, LAST, 2)).position).toBe(2);
    later();
    const zed = await joinSeries(s.t.withIdentity(identity(s.zed.authUserId)), s, LAST);
    expect(zed.position).toBe(3);
  });

  test('puts a guardian’s child on the waitlist of a class under the guardian’s account', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 2);
    const result = await joinClass(s.bob, s, LAST, 2, MINOR('Sam R.'));
    expect(await entry(s, result.trainingWaitlistEntryId)).toMatchObject({
      userId: s.users['bob'],
      participant: MINOR('Sam R.'),
      participantKey: `class:${classOf(s, LAST, 2)}:minor:sam r.`,
    });
  });

  test('refuses a class with a place free and no waiting entry, and a drop-in registers for it', async () => {
    const s = await setup();
    const data = await refusal(joinClass(s.bob, s, LAST, 0));
    expect(data).toMatchObject({
      code: 'classHasPlace',
      message: TRAINING_WAITLIST_MESSAGES.classHasPlace,
    });
    expect(await entriesOf(s, LAST)).toHaveLength(0);
    await expect(registerClass(s.bob, s, LAST, 0)).resolves.toMatchObject({});
    expect(await registeredCounts(s, LAST)).toEqual([1, 0, 0]);
  });

  test('takes a join for a class with a place free that a waiting class entry holds, behind that entry', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await joinClass(s.bob, s, LAST, 0);
    await setPlaces(s, LAST, 0, 2);
    later();
    const result = await joinClass(s.carol, s, LAST, 0);
    expect(result.position).toBe(2);
  });

  test('takes a join for a class with a place free that a waiting series entry holds', async () => {
    const s = await setup();
    await seedEntry(s, LAST, s.users['alice'], undefined);
    later();
    const result = await joinClass(s.bob, s, LAST, 1);
    expect(result.position).toBe(2);
  });

  test('refuses the same child twice, however the name was typed, and accepts the child for another class', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await registerClass(s.alice, s, LAST, 1);
    await joinClass(s.bob, s, LAST, 0, MINOR('Sam R.'));
    const again = await refusal(joinClass(s.bob, s, LAST, 0, MINOR('  sam   R. ')));
    expect(again).toMatchObject({ code: 'alreadyWaitingForClass', field: 'minorName' });
    await expect(joinClass(s.bob, s, LAST, 1, MINOR('Sam R.'))).resolves.toMatchObject({});
    expect(await entriesOf(s, LAST)).toHaveLength(2);
  });

  test('refuses the same person twice for one class', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await joinClass(s.bob, s, LAST, 0);
    const data = await refusal(joinClass(s.bob, s, LAST, 0));
    expect(data).toMatchObject({
      code: 'alreadyWaitingForClass',
      message: TRAINING_WAITLIST_MESSAGES.alreadyWaitingForClass(SELF, '2027-02-02'),
    });
    expect(await entriesOf(s, LAST)).toHaveLength(1);
  });

  test('refuses a participant who holds a place in the class', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    expect((await refusal(joinClass(s.alice, s, LAST, 0))).code).toBe('alreadyRegistered');
    expect(await entriesOf(s, LAST)).toHaveLength(0);
  });

  test('refuses a series registrant, who holds a place in every class', async () => {
    const s = await setup();
    await fillSeries(s);
    expect((await refusal(joinClass(s.alice, s, LAST, 1))).code).toBe('alreadyRegistered');
  });

  test('refuses a participant who waits for the series, and takes the guardian’s other child', async () => {
    const s = await setup();
    await fillSeries(s);
    await joinSeries(s.bob, s, LAST, MINOR('Maya R.'));
    await joinSeries(s.bob, s, LAST);
    const refused = await refusal(joinClass(s.bob, s, LAST, 1));
    expect(refused.code).toBe('alreadyWaiting');
    const child = await refusal(joinClass(s.bob, s, LAST, 1, MINOR('Maya R.')));
    expect(child.code).toBe('alreadyWaiting');
    await expect(joinClass(s.bob, s, LAST, 1, MINOR('Sam R.'))).resolves.toMatchObject({});
  });

  test('refuses an unauthenticated caller and writes nothing', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await expect(joinClass(s.signedOut, s, LAST, 0)).rejects.toThrow(
      /Sign in required|Not authenticated/,
    );
    expect(await entriesOf(s, LAST)).toHaveLength(0);
  });

  test('refuses a program that takes no single class, a class of another program, a cancelled class, and a class that has passed', async () => {
    const s = await setup();
    await registerSeries(s.alice, s, 'lastPlace');
    const series = await refusal(
      s.bob.mutation(api.trainingWaitlist.join, {
        trainingId: trainingOf(s, 'lastPlace'),
        classId: classOf(s, 'lastPlace', 0),
        participant: SELF,
        ageConfirmed: true,
      }),
    );
    expect(series.code).toBe('singleClassNotAllowed');
    const other = await refusal(
      s.bob.mutation(api.trainingWaitlist.join, {
        trainingId: trainingOf(s, LAST),
        classId: classOf(s, OPEN, 0),
        participant: SELF,
        ageConfirmed: true,
      }),
    );
    expect(other.code).toBe('classNotFound');
    await s.admin.mutation(api.trainingClasses.cancel, { trainingClassId: classOf(s, LAST, 2) });
    expect((await refusal(joinClass(s.bob, s, LAST, 2))).code).toBe('classNotFound');
    vi.setSystemTime(Date.UTC(2027, 1, 3, 12, 0, 0));
    expect((await refusal(joinClass(s.bob, s, LAST, 0))).code).toBe('registrationClosed');
  });

  test('counts a guardian’s waiting class entries toward the limit of children in one program', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    for (let index = 1; index <= MAX_MINORS_PER_SESSION; index++) {
      await joinClass(s.bob, s, LAST, 0, MINOR(`Child ${String(index).padStart(2, '0')}`));
    }
    const data = await refusal(joinClass(s.bob, s, LAST, 0, MINOR('One too many')));
    expect(data).toMatchObject({ code: 'minorLimit', field: 'minorName' });
  });

  test('sends two joins of the same participant at once as one entry and one refusal', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    const results = await Promise.allSettled([
      joinClass(s.bob, s, LAST, 0),
      joinClass(s.bob, s, LAST, 0),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await entriesOf(s, LAST)).toHaveLength(1);
  });
});

describe('a waiting class entry counts as full', () => {
  test('refuses a single-class registration for that class though it has a place, and takes another class', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    const data = await refusal(registerClass(s.bob, s, OPEN, 1));
    expect(data.code).toBe('classFull');
    expect(await registeredCounts(s, OPEN)).toEqual([0, 0, 0]);
    await expect(registerClass(s.bob, s, OPEN, 0)).resolves.toMatchObject({});
  });

  test('refuses a series registration while a class entry waits, though every class has places', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 2);
    const data = await refusal(registerSeries(s.bob, s, OPEN));
    expect(data.code).toBe('classFull');
    expect(await registeredCounts(s, OPEN)).toEqual([0, 0, 0]);
  });

  test('lets a person join the series waitlist when only a class entry makes it full', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 2);
    later();
    const result = await joinSeries(s.bob, s, OPEN);
    expect(result.position).toBe(2);
  });

  test('takes registrations again once the class entry is promoted', async () => {
    const s = await setup();
    const id = await seedEntry(s, OPEN, s.users['alice'], 1);
    await promote(s.admin, id);
    await expect(registerClass(s.bob, s, OPEN, 1)).resolves.toMatchObject({});
    await expect(registerSeries(s.carol, s, OPEN)).resolves.toMatchObject({});
    expect(await registeredCounts(s, OPEN)).toEqual([1, 3, 1]);
  });

  test('does not hold another training program’s registrations', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    await expect(registerClass(s.bob, s, LAST, 1)).resolves.toMatchObject({});
  });

  test('refuses a participant who waits for the same class again, and accepts another class', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    const other = await refusal(registerClass(s.alice, s, OPEN, 1));
    expect(other.code).toBe('alreadyWaitingForClass');
    await expect(registerClass(s.alice, s, OPEN, 0)).resolves.toMatchObject({});
  });
});

describe('trainingWaitlist.promote with class entries', () => {
  test('gives a freed place in a class to its class entry before a later series entry', async () => {
    const s = await setup();
    await fillSeries(s);
    const classEntry = await joinClass(s.bob, s, LAST, 1);
    later();
    const seriesEntry = await joinSeries(s.carol, s, LAST);
    await raiseAll(s, LAST, 1);
    const behind = await refusal(promote(s.admin, seriesEntry.trainingWaitlistEntryId));
    expect(behind).toMatchObject({ code: 'notNext', message: TRAINING_WAITLIST_MESSAGES.notNext });
    const { registrationId } = await promote(s.admin, classEntry.trainingWaitlistEntryId);
    expect(await registeredCounts(s, LAST)).toEqual([1, 2, 1]);
    expect(
      await s.t.run((ctx) => ctx.db.get('trainingRegistrations', registrationId)),
    ).toMatchObject({
      classId: classOf(s, LAST, 1),
      userId: s.users['bob'],
      participant: SELF,
      participantKey: `class:${classOf(s, LAST, 1)}:self`,
    });
    expect(await entry(s, classEntry.trainingWaitlistEntryId)).toMatchObject({
      status: 'promoted',
      registrationId,
    });
  });

  test('keeps an earlier series entry first when the places it needs are free', async () => {
    const s = await setup();
    await fillSeries(s);
    const seriesEntry = await joinSeries(s.bob, s, LAST);
    later();
    const classEntry = await joinClass(s.carol, s, LAST, 1);
    await raiseAll(s, LAST, 1);
    const behind = await refusal(promote(s.admin, classEntry.trainingWaitlistEntryId));
    expect(behind.code).toBe('notNext');
    await promote(s.admin, seriesEntry.trainingWaitlistEntryId);
    expect(await registeredCounts(s, LAST)).toEqual([2, 2, 2]);
    const full = await refusal(promote(s.admin, classEntry.trainingWaitlistEntryId));
    expect(full.code).toBe('noFreePlace');
  });

  test('lets a later class entry take a free place when an earlier series entry still lacks a place elsewhere', async () => {
    const s = await setup();
    await fillSeries(s);
    const seriesEntry = await joinSeries(s.bob, s, LAST);
    later();
    const classEntry = await joinClass(s.carol, s, LAST, 0);
    await setPlaces(s, LAST, 0, 2);
    const rows = await listFor(s.admin, s, LAST);
    expect(rows.map((row) => [row.trainingWaitlistEntryId, row.canPromote])).toEqual([
      [seriesEntry.trainingWaitlistEntryId, false],
      [classEntry.trainingWaitlistEntryId, true],
    ]);
    const held = await refusal(promote(s.admin, seriesEntry.trainingWaitlistEntryId));
    expect(held.code).toBe('noFreePlace');
    await promote(s.admin, classEntry.trainingWaitlistEntryId);
    expect(await registeredCounts(s, LAST)).toEqual([2, 1, 1]);
  });

  test('registers a child under the guardian, with the age box the entry stored', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 1);
    const { trainingWaitlistEntryId } = await joinClass(s.bob, s, LAST, 1, MINOR('Sam R.'));
    await setPlaces(s, LAST, 1, 2);
    const { registrationId } = await promote(s.admin, trainingWaitlistEntryId);
    expect(
      await s.t.run((ctx) => ctx.db.get('trainingRegistrations', registrationId)),
    ).toMatchObject({
      userId: s.users['bob'],
      participant: MINOR('Sam R.'),
    });
  });

  test('refuses a class entry whose class has no place, and registers no one', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 1);
    const { trainingWaitlistEntryId } = await joinClass(s.bob, s, LAST, 1);
    const data = await refusal(promote(s.admin, trainingWaitlistEntryId));
    expect(data).toMatchObject({
      code: 'noFreePlace',
      message: TRAINING_WAITLIST_MESSAGES.noFreePlaceInClass,
    });
    expect(await registeredCounts(s, LAST)).toEqual([0, 1, 0]);
    expect((await entry(s, trainingWaitlistEntryId))?.status).toBe('waiting');
  });

  test('refuses a class entry whose class has passed, which is out of the queue', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    const { trainingWaitlistEntryId } = await joinClass(s.bob, s, LAST, 0);
    await setPlaces(s, LAST, 0, 2);
    vi.setSystemTime(Date.UTC(2027, 1, 3, 12, 0, 0));
    const data = await refusal(promote(s.admin, trainingWaitlistEntryId));
    expect(data).toMatchObject({
      code: 'classGone',
      message: TRAINING_WAITLIST_MESSAGES.classGone,
    });
    expect(await listFor(s.admin, s, LAST)).toEqual([]);
  });

  test('refuses an entry that was already promoted, and one whose account is gone', async () => {
    const s = await setup();
    const first = await seedEntry(s, OPEN, s.users['alice'], 0);
    await promote(s.admin, first);
    expect((await refusal(promote(s.admin, first))).code).toBe('notWaiting');
    const ghost = await seedEntry(s, OPEN, s.users['bob'], 1);
    await s.t.run((ctx) => ctx.db.delete('users', s.users['bob']));
    expect((await refusal(promote(s.admin, ghost))).code).toBe('accountGone');
  });

  test('skips an entry whose account is gone, so it does not hold up the entries behind it', async () => {
    const s = await setup();
    const ghost = await seedEntry(s, OPEN, s.users['alice'], 1);
    later();
    const next = await seedEntry(s, OPEN, s.users['bob'], 1);
    await s.t.run((ctx) => ctx.db.delete('users', s.users['alice']));
    const rows = await listFor(s.admin, s, OPEN);
    expect(rows.map((row) => [row.trainingWaitlistEntryId, row.canPromote])).toEqual([
      [ghost, false],
      [next, true],
    ]);
    await expect(promote(s.admin, next)).resolves.toMatchObject({});
  });

  describe('refuses', () => {
    test.each([
      ['an unauthenticated caller', (s: Setup) => s.signedOut],
      ['an org admin of another organization', (s: Setup) => s.asOtherAdmin],
      ['a league organizer assigned to another training program', (s: Setup) => s.asUnassigned],
      ['a league organizer assigned to no program', (s: Setup) => s.asLeagueOnly],
      ['a player', (s: Setup) => s.asPlayer],
      ['the waiting person', (s: Setup) => s.bob],
    ])('%s, and registers no one', async (_, caller) => {
      const s = await setup();
      await registerClass(s.alice, s, LAST, 1);
      const { trainingWaitlistEntryId } = await joinClass(s.bob, s, LAST, 1);
      await setPlaces(s, LAST, 1, 2);
      await expect(promote(caller(s), trainingWaitlistEntryId)).rejects.toThrow(
        /Sign in required|Not allowed|Not authenticated/,
      );
      expect(await registeredCounts(s, LAST)).toEqual([0, 1, 0]);
    });
  });

  test('lets an org admin and an organizer assigned to the program promote a class entry', async () => {
    const s = await setup();
    const first = await seedEntry(s, OPEN, s.users['alice'], 0);
    await expect(promote(s.admin, first)).resolves.toMatchObject({});
    const second = await seedEntry(s, OPEN, s.users['bob'], 1);
    await expect(promote(s.asAssigned, second)).resolves.toMatchObject({});
  });
});

describe('trainingWaitlist.listForTraining with class entries', () => {
  test('lists series and class entries in the order they joined, each with its class and whether a place is free', async () => {
    const s = await setup();
    await fillSeries(s);
    await joinSeries(s.bob, s, LAST);
    later();
    await joinClass(s.carol, s, LAST, 2);
    await setPlaces(s, LAST, 2, 2);
    const rows = await listFor(s.admin, s, LAST);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty('classId');
    expect(rows[0]).toMatchObject({ hasPlace: false, canPromote: false });
    expect(rows[1]).toMatchObject({
      classId: classOf(s, LAST, 2),
      classDate: '2027-02-16',
      hasPlace: true,
      canPromote: true,
    });
  });

  test('names a child with the guardian’s name and email, as for the series', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await joinClass(s.asPlayer, s, LAST, 0, MINOR('Sam R.'));
    const [row] = await listFor(s.admin, s, LAST);
    expect(row).toMatchObject({
      name: 'Sam R.',
      guardian: { name: 'Gail Guardian', email: 'guardian@example.test' },
    });
    expect(row).not.toHaveProperty('userId');
    expect(row).not.toHaveProperty('participantKey');
  });

  test('marks one entry promotable: the earliest that has a place', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 0);
    await registerClass(s.alice, s, LAST, 1);
    await joinClass(s.bob, s, LAST, 0);
    later();
    await joinClass(s.carol, s, LAST, 1);
    const canPromote = async () => (await listFor(s.admin, s, LAST)).map((row) => row.canPromote);
    expect(await canPromote()).toEqual([false, false]);
    await setPlaces(s, LAST, 0, 2);
    await setPlaces(s, LAST, 1, 2);
    expect(await canPromote()).toEqual([true, false]);
  });

  test('counts the class entries in the management page’s waitlist count', async () => {
    const s = await setup();
    await fillSeries(s);
    await joinSeries(s.bob, s, LAST);
    await joinClass(s.carol, s, LAST, 1);
    const page = await s.admin.query(api.trainings.getForManagement, {
      orgSlug: 'org-a',
      trainingSlug: SLUGS[LAST],
    });
    expect(page?.waitlistCount).toBe(2);
  });

  test('is refused for a player and for another organization’s admin', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    await expect(listFor(s.asPlayer, s, OPEN)).rejects.toThrow();
    await expect(listFor(s.asOtherAdmin, s, OPEN)).rejects.toThrow();
  });
});

describe('trainingWaitlist.listMineForClasses', () => {
  const mine = (caller: Caller, key: string) =>
    caller.query(api.trainingWaitlist.listMineForClasses, {
      orgSlug: 'org-a',
      trainingSlug: SLUGS[key],
    });

  test('gives the caller’s own class entries with the class and the position, and no one else’s', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 1);
    await registerClass(s.alice, s, LAST, 2);
    await joinClass(s.bob, s, LAST, 1);
    later();
    await joinClass(s.carol, s, LAST, 1);
    later();
    await joinClass(s.carol, s, LAST, 2, MINOR('Sam R.'));
    expect(await mine(s.carol, LAST)).toEqual([
      { classId: classOf(s, LAST, 1), participant: SELF, position: 2 },
      { classId: classOf(s, LAST, 2), participant: MINOR('Sam R.'), position: 1 },
    ]);
    expect(await mine(s.bob, LAST)).toEqual([
      { classId: classOf(s, LAST, 1), participant: SELF, position: 1 },
    ]);
  });

  test('is empty for a signed-out caller, a caller with no entry, a draft, and an unknown program', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 1);
    await joinClass(s.bob, s, LAST, 1);
    expect(await mine(s.signedOut, LAST)).toEqual([]);
    expect(await mine(s.carol, LAST)).toEqual([]);
    expect(
      await s.bob.query(api.trainingWaitlist.listMineForClasses, {
        orgSlug: 'org-a',
        trainingSlug: 'secret-draft-clinic',
      }),
    ).toEqual([]);
    expect(
      await s.bob.query(api.trainingWaitlist.listMineForClasses, {
        orgSlug: 'org-z',
        trainingSlug: SLUGS[LAST],
      }),
    ).toEqual([]);
  });

  test('drops an entry once it is promoted', async () => {
    const s = await setup();
    const id = await seedEntry(s, OPEN, s.users['bob'], 1);
    expect(await mine(s.bob, OPEN)).toHaveLength(1);
    await promote(s.admin, id);
    expect(await mine(s.bob, OPEN)).toEqual([]);
  });

  test('does not list a class entry among the series entries, which an earlier release reads', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['bob'], 1);
    expect(
      await s.bob.query(api.trainingWaitlist.listMineForTraining, {
        orgSlug: 'org-a',
        trainingSlug: SLUGS[OPEN],
      }),
    ).toEqual([]);
  });
});

describe('what the pages read while a class entry waits', () => {
  const answer = (caller: Caller, key: string, classId?: string) =>
    caller.query(api.trainingRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      trainingSlug: SLUGS[key],
      ...(classId !== undefined && { classId }),
    });
  const page = (s: Setup, key: string) =>
    s.t.query(api.trainings.getPublicPage, { orgSlug: 'org-a', trainingSlug: SLUGS[key] });

  test('gives the public page no place left in that class only, and no series waitlist flag', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    expect((await page(s, OPEN))?.classes.map((row) => row.placesLeft)).toEqual([12, 0, 12]);
    expect(await page(s, OPEN)).not.toHaveProperty('seriesWaitlist');
  });

  test('reads the class as full, and tells the waiting account, and not another, that it waits', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    const id = classOf(s, OPEN, 1);
    expect(await answer(s.alice, OPEN, id)).toMatchObject({
      singleClass: { classId: id, placesLeft: 0, waitlisted: true },
    });
    const other = await answer(s.bob, OPEN, id);
    expect(other).toMatchObject({ singleClass: { placesLeft: 0 } });
    expect(other?.singleClass).not.toHaveProperty('waitlisted');
    expect(await answer(s.signedOut, OPEN, id)).toMatchObject({ singleClass: { placesLeft: 0 } });
    const free = await answer(s.alice, OPEN, classOf(s, OPEN, 0));
    expect(free?.singleClass).toMatchObject({ placesLeft: 12 });
    expect(free?.singleClass).not.toHaveProperty('waitlisted');
  });

  test('reads the series as full at that class, with no series waitlist flag', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    const read = await answer(s.bob, OPEN);
    expect(read).toMatchObject({ placesLeft: 0, fullClassDate: '2027-02-09', waitlisted: false });
    expect(read).not.toHaveProperty('seriesWaitlist');
  });

  test('reads the series as open to the account holder whose own entry is the only one, and full to another', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    const own = await answer(s.alice, OPEN);
    expect(own).toMatchObject({ placesLeft: 12 });
    expect(own).not.toHaveProperty('fullClassDate');
    expect(await answer(s.bob, OPEN)).toMatchObject({ placesLeft: 0, fullClassDate: '2027-02-09' });
  });

  test('reads the places as before once the class entry is promoted', async () => {
    const s = await setup();
    const id = await seedEntry(s, OPEN, s.users['alice'], 1);
    await promote(s.admin, id);
    expect((await page(s, OPEN))?.classes.map((row) => row.placesLeft)).toEqual([12, 11, 12]);
  });
});

describe('cancelling a class with a waitlist', () => {
  test('is refused while a class entry waits, and the class row says so', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    const data = await refusal(
      s.admin.mutation(api.trainingClasses.cancel, { trainingClassId: classOf(s, OPEN, 1) }),
    );
    expect(data).toMatchObject({
      code: 'hasWaitlist',
      message: TRAINING_PATTERN_MESSAGES.hasWaitlist(1),
    });
    const rows = await s.admin.query(api.trainingClasses.listForTraining, {
      trainingId: trainingOf(s, OPEN),
    });
    expect(rows.map((row) => row.waitlistCount)).toEqual([undefined, 1, undefined]);
  });

  test('cancels a class that no class entry waits for, though other classes have one', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    await expect(
      s.admin.mutation(api.trainingClasses.cancel, { trainingClassId: classOf(s, OPEN, 0) }),
    ).resolves.toBeNull();
  });

  test('cancels the class once its entry is promoted, which then holds a registration', async () => {
    const s = await setup();
    const id = await seedEntry(s, OPEN, s.users['alice'], 1);
    await promote(s.admin, id);
    const data = await refusal(
      s.admin.mutation(api.trainingClasses.cancel, { trainingClassId: classOf(s, OPEN, 1) }),
    );
    expect(data.code).toBe('hasRegistrations');
  });
});

describe('deleting an account that waits for a class', () => {
  test('removes its class entries and keeps another account’s', async () => {
    const s = await setup();
    await registerClass(s.alice, s, LAST, 1);
    const bob = await joinClass(s.bob, s, LAST, 1);
    later();
    const carol = await joinClass(s.carol, s, LAST, 1);
    await s.t.run((ctx) => deleteUserRecord(ctx, 'bob'));
    expect(await entry(s, bob.trainingWaitlistEntryId)).toBeNull();
    expect(await entry(s, carol.trainingWaitlistEntryId)).not.toBeNull();
  });
});

describe('a series replaces the participant’s class waitlist entries', () => {
  const classEntriesOf = async (s: Setup, key: string, userId: Id<'users'>) =>
    (await entriesOf(s, key)).filter((row) => row.userId === userId && row.classId !== undefined);
  const mineClasses = (caller: Caller, key: string) =>
    caller.query(api.trainingWaitlist.listMineForClasses, {
      orgSlug: 'org-a',
      trainingSlug: SLUGS[key],
    });
  const mineSeries = (caller: Caller, key: string) =>
    caller.query(api.trainingWaitlist.listMineForTraining, {
      orgSlug: 'org-a',
      trainingSlug: SLUGS[key],
    });

  test('registering for the series removes the entries for classes, which their own wait does not hold up', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    later();
    await seedEntry(s, OPEN, s.users['alice'], 2);
    await expect(registerSeries(s.alice, s, OPEN)).resolves.toMatchObject({});
    expect(await registeredCounts(s, OPEN)).toEqual([1, 1, 1]);
    expect(await entriesOf(s, OPEN)).toEqual([]);
    expect(await mineClasses(s.alice, OPEN)).toEqual([]);
    expect(await mineSeries(s.alice, OPEN)).toEqual([]);
  });

  test('registering for the series leaves another participant’s entries, which still hold their class', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    later();
    await seedEntry(s, OPEN, s.users['alice'], 1, MINOR('Maya R.'));
    const held = await refusal(registerSeries(s.alice, s, OPEN));
    expect(held.code).toBe('classFull');
    expect(await registeredCounts(s, OPEN)).toEqual([0, 0, 0]);
    expect(await classEntriesOf(s, OPEN, s.users['alice'])).toHaveLength(2);
  });

  test('registering for the series refuses while another account’s entry holds a class, and keeps the entries', async () => {
    const s = await setup();
    await seedEntry(s, OPEN, s.users['bob'], 1);
    later();
    await seedEntry(s, OPEN, s.users['alice'], 1);
    const data = await refusal(registerSeries(s.alice, s, OPEN));
    expect(data.code).toBe('classFull');
    expect(await entriesOf(s, OPEN)).toHaveLength(2);
    expect(await registeredCounts(s, OPEN)).toEqual([0, 0, 0]);
  });

  test('joining the series waitlist removes the participant’s class entries, and numbers the new entry behind the others', async () => {
    const s = await setup();
    await fillSeries(s);
    const carol = await joinSeries(s.carol, s, LAST);
    later();
    const zed = s.t.withIdentity(identity(s.zed.authUserId));
    const zedEntry = await joinClass(zed, s, LAST, 2);
    later();
    await joinClass(s.bob, s, LAST, 1);
    later();
    const sam = await joinClass(s.bob, s, LAST, 1, MINOR('Sam R.'));
    later();
    const joined = await joinSeries(s.bob, s, LAST);
    expect(joined.position).toBe(4);
    const rows = await entriesOf(s, LAST);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row._id).sort()).toEqual(
      [
        carol.trainingWaitlistEntryId,
        zedEntry.trainingWaitlistEntryId,
        sam.trainingWaitlistEntryId,
        joined.trainingWaitlistEntryId,
      ].sort(),
    );
    expect(await classEntriesOf(s, LAST, s.users['bob'])).toMatchObject([
      { participant: MINOR('Sam R.') },
    ]);
    expect(await mineSeries(s.bob, LAST)).toEqual([{ participant: SELF, position: 4 }]);
    expect(await mineClasses(s.bob, LAST)).toEqual([
      { classId: classOf(s, LAST, 1), participant: MINOR('Sam R.'), position: 2 },
    ]);
    expect(await registeredCounts(s, LAST)).toEqual([1, 1, 1]);
  });

  test('joining the series waitlist with no class entry changes nothing else', async () => {
    const s = await setup();
    await fillSeries(s);
    await joinClass(s.carol, s, LAST, 1);
    later();
    expect((await joinSeries(s.bob, s, LAST)).position).toBe(2);
    expect(await entriesOf(s, LAST)).toHaveLength(2);
  });

  test('promoting a series entry removes the participant’s class entries too, so no second place is given', async () => {
    const s = await setup();
    await fillSeries(s);
    const series = await seedEntry(s, LAST, s.users['bob'], undefined);
    later();
    const classEntry = await seedEntry(s, LAST, s.users['bob'], 1);
    await raiseAll(s, LAST, 1);
    await expect(promote(s.admin, series)).resolves.toMatchObject({});
    expect(await registeredCounts(s, LAST)).toEqual([2, 2, 2]);
    expect(await entry(s, classEntry)).toBeNull();
    expect(await mineClasses(s.bob, LAST)).toEqual([]);
  });
});
