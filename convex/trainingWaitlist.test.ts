/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MAX_MINORS_PER_SESSION, type Participant } from './lib/individualRegistration';
import { insertTrainingClassRegistration } from './lib/trainingRegistrationWrites';
import { TRAINING_WAITLIST_MESSAGES } from './lib/trainingWaitlist';
import { insertTrainingWaitlistEntry } from './lib/trainingWaitlistWrites';
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

const as = (who: { authUserId: string }, s: Setup): Caller =>
  s.t.withIdentity(identity(who.authUserId));

const trainingOf = (s: Setup, key: string) => s.trainings[key].trainingId;

const register = (caller: Caller, s: Setup, key: string, participant: Participant = SELF) =>
  caller.mutation(api.trainingRegistrations.register, {
    trainingId: trainingOf(s, key),
    participant,
    ageConfirmed: true,
  });

const registerClass = (
  caller: Caller,
  s: Setup,
  key: string,
  index: number,
  participant: Participant = SELF,
) =>
  caller.mutation(api.trainingRegistrations.register, {
    trainingId: trainingOf(s, key),
    classId: s.trainings[key].classIds[index],
    participant,
    ageConfirmed: true,
  });

const join = (
  caller: Caller,
  s: Setup,
  key: string,
  participant: Participant = SELF,
  ageConfirmed = true,
) =>
  caller.mutation(api.trainingWaitlist.join, {
    trainingId: trainingOf(s, key),
    participant,
    ageConfirmed,
  });

const promote = (caller: Caller, id: Id<'trainingWaitlistEntries'>) =>
  caller.mutation(api.trainingWaitlist.promote, { trainingWaitlistEntryId: id });

const listFor = (caller: Caller, s: Setup, key: string) =>
  caller.query(api.trainingWaitlist.listForTraining, { trainingId: trainingOf(s, key) });

const mine = (caller: Caller, key: string) =>
  caller.query(api.trainingWaitlist.listMineForTraining, {
    orgSlug: 'org-a',
    trainingSlug: SLUGS[key],
  });

const SLUGS: Record<string, string> = {
  open: 'tuesday-serving-clinic',
  lastPlace: 'last-place-clinic',
  dropIn: 'drop-in-clinic',
  dropInLastPlace: 'drop-in-last-place-clinic',
  draft: 'secret-draft-clinic',
  adults: 'adult-clinic',
  youth: 'youth-clinic',
};

/** Skips the rules of joining, so a series with places left can wait. */
async function seedEntry(
  s: Setup,
  key: string,
  userId: Id<'users'>,
  participant: Participant = SELF,
  requestedAt = NOW,
): Promise<Id<'trainingWaitlistEntries'>> {
  return s.t.run(async (ctx) => {
    const training = (await ctx.db.get('trainings', trainingOf(s, key)))!;
    const id = await insertTrainingWaitlistEntry(ctx, training, { userId, participant });
    await ctx.db.patch('trainingWaitlistEntries', id, { requestedAt });
    return id;
  });
}

const entriesOf = (s: Setup, key: string) =>
  s.t.run((ctx) =>
    ctx.db
      .query('trainingWaitlistEntries')
      .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
        q.eq('trainingId', trainingOf(s, key)),
      )
      .collect(),
  );

/** Adds `by` places to every class of the training program, as an organizer would. */
async function raisePlaces(s: Setup, key: string, by: number, only?: number): Promise<void> {
  const classes = s.trainings[key].classIds;
  for (const [index, trainingClassId] of classes.entries()) {
    if (only !== undefined && index !== only) continue;
    const row = await s.t.run((ctx) => ctx.db.get('trainingClasses', trainingClassId));
    await s.admin.mutation(api.trainingClasses.updatePlaces, {
      trainingClassId,
      places: row!.places + by,
    });
  }
}

/** Sets every class of the training program to `places`, which no one has registered for yet. */
async function setPlaces(s: Setup, key: string, places: number): Promise<void> {
  for (const trainingClassId of s.trainings[key].classIds) {
    await s.admin.mutation(api.trainingClasses.updatePlaces, { trainingClassId, places });
  }
}

/** Fills a one-place series with `alice`, so every class is full. */
async function fillSeries(s: Setup, key = 'lastPlace') {
  await register(s.alice, s, key);
  expect(await registeredCounts(s, key)).toEqual([1, 1, 1]);
}

describe('trainingWaitlist.join', () => {
  test('puts a person on the waitlist of a full series without taking a place, at position 1', async () => {
    const s = await setup();
    await fillSeries(s);
    const result = await join(s.bob, s, 'lastPlace');
    expect(result.position).toBe(1);
    expect(await registeredCounts(s, 'lastPlace')).toEqual([1, 1, 1]);
    const [entry] = await entriesOf(s, 'lastPlace');
    expect(entry).toMatchObject({
      _id: result.trainingWaitlistEntryId,
      status: 'waiting',
      participant: SELF,
      participantKey: 'self',
      userId: s.users['bob'],
      organizationId: s.organization,
    });
    expect(entry?.requestedAt).toBeGreaterThanOrEqual(NOW);
    expect(entry).not.toHaveProperty('classId');
    expect(entry).not.toHaveProperty('registrationId');
  });

  test('numbers each entry in the order it joined', async () => {
    const s = await setup();
    await fillSeries(s);
    expect((await join(s.bob, s, 'lastPlace')).position).toBe(1);
    vi.setSystemTime(NOW + 1000);
    expect((await join(s.carol, s, 'lastPlace')).position).toBe(2);
    vi.setSystemTime(NOW + 2000);
    expect((await join(s.alice, s, 'lastPlace', MINOR('Maya R.'))).position).toBe(3);
  });

  test('puts a guardian’s child on the waitlist under the guardian’s account', async () => {
    const s = await setup();
    await fillSeries(s);
    const { position } = await join(s.asPlayer, s, 'lastPlace', MINOR('Maya R.'));
    expect(position).toBe(1);
    const [entry] = await entriesOf(s, 'lastPlace');
    expect(entry).toMatchObject({
      participant: MINOR('Maya R.'),
      participantKey: 'minor:maya r.',
      userId: s.guardian.userId,
    });
  });

  test('stores the age confirmation of a program with an age range', async () => {
    const s = await setup();
    await setPlaces(s, 'youth', 1);
    await register(s.asPlayer, s, 'youth', MINOR('Sam R.'));
    await join(s.asPlayer, s, 'youth', MINOR('Maya R.'));
    const entries = await entriesOf(s, 'youth');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ageConfirmedAt).toBeGreaterThanOrEqual(NOW);
  });

  test('refuses a series with a place free in every class, and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(join(s.bob, s, 'open'));
    expect(data).toMatchObject({
      code: 'seriesHasPlace',
      message: TRAINING_WAITLIST_MESSAGES.seriesHasPlace,
    });
    expect(await entriesOf(s, 'open')).toEqual([]);
  });

  test('refuses a series whose only full class holds the account holder’s own single-class place', async () => {
    const s = await setup();
    await registerClass(s.alice, s, 'dropInLastPlace', 0);
    const data = await refusal(join(s.alice, s, 'dropInLastPlace'));
    expect(data.code).toBe('seriesHasPlace');
  });

  test('accepts another person for a series that single-class place fills', async () => {
    const s = await setup();
    await registerClass(s.alice, s, 'dropInLastPlace', 0);
    const { position } = await join(s.bob, s, 'dropInLastPlace');
    expect(position).toBe(1);
  });

  test('refuses a duplicate entry for the same participant, however the child’s name was typed', async () => {
    const s = await setup();
    await fillSeries(s);
    await join(s.bob, s, 'lastPlace');
    const again = await refusal(join(s.bob, s, 'lastPlace'));
    expect(again).toMatchObject({
      code: 'alreadyWaiting',
      message: TRAINING_WAITLIST_MESSAGES.alreadyWaiting(SELF),
    });
    await join(s.bob, s, 'lastPlace', MINOR('Maya R.'));
    const child = await refusal(join(s.bob, s, 'lastPlace', MINOR('  maya   r. ')));
    expect(child).toMatchObject({ code: 'alreadyWaiting', field: 'minorName' });
    expect(child.message).toBe(TRAINING_WAITLIST_MESSAGES.alreadyWaiting(MINOR('Maya R.')));
    expect(await entriesOf(s, 'lastPlace')).toHaveLength(2);
  });

  test('refuses a participant already registered for the series', async () => {
    const s = await setup();
    await fillSeries(s);
    const data = await refusal(join(s.alice, s, 'lastPlace'));
    expect(data.code).toBe('alreadyRegistered');
    expect(await entriesOf(s, 'lastPlace')).toEqual([]);
  });

  test('refuses an unauthenticated caller', async () => {
    const s = await setup();
    await fillSeries(s);
    await expect(join(s.signedOut, s, 'lastPlace')).rejects.toThrow(
      /Sign in required|Not authenticated/,
    );
    expect(await entriesOf(s, 'lastPlace')).toEqual([]);
  });

  test('refuses a draft program as one that is not open, so nothing says it exists', async () => {
    const s = await setup();
    const data = await refusal(join(s.bob, s, 'draft'));
    expect(data.code).toBe('trainingNotFound');
  });

  test('refuses a program with no classes scheduled', async () => {
    const s = await setup();
    const data = await refusal(join(s.bob, s, 'unscheduled'));
    expect(data.code).toBe('trainingNotFound');
  });

  test('refuses after the series deadline', async () => {
    const s = await setup();
    await fillSeries(s, 'lastPlace');
    vi.setSystemTime(Date.UTC(2027, 1, 2, 13, 0, 0));
    const data = await refusal(join(s.bob, s, 'lastPlace'));
    expect(data.code).toBe('registrationClosed');
  });

  test('refuses a program’s age range and a missing age box as registering does', async () => {
    const s = await setup();
    const unconfirmed = await refusal(join(s.asPlayer, s, 'youth', MINOR('Maya R.'), false));
    expect(unconfirmed).toMatchObject({ code: 'ageNotConfirmed', field: 'ageConfirmed' });
    const adult = await refusal(join(s.bob, s, 'youth', SELF));
    expect(adult.code).toBe('adultNotAllowed');
    const child = await refusal(join(s.asPlayer, s, 'adults', MINOR('Maya R.')));
    expect(child.code).toBe('minorNotAllowed');
  });

  test('counts a guardian’s waiting children toward the limit of children in one program', async () => {
    const s = await setup();
    await fillSeries(s);
    for (let index = 1; index <= MAX_MINORS_PER_SESSION; index++) {
      await join(s.asPlayer, s, 'lastPlace', MINOR(`Child ${String(index).padStart(2, '0')}`));
    }
    const data = await refusal(join(s.asPlayer, s, 'lastPlace', MINOR('One too many')));
    expect(data).toMatchObject({ code: 'minorLimit', field: 'minorName' });
    const own = await join(s.asPlayer, s, 'lastPlace', SELF);
    expect(own.position).toBe(MAX_MINORS_PER_SESSION + 1);
  });

  test('counts a guardian’s registered and waiting children together toward the limit', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', trainingOf(s, 'dropIn')))!;
      for (let index = 1; index <= MAX_MINORS_PER_SESSION - 1; index++) {
        await ctx.db.insert('trainingRegistrations', {
          trainingId: training._id,
          organizationId: training.organizationId,
          userId: s.guardian.userId,
          participant: MINOR(`Child ${index}`),
          participantKey: `minor:child ${index}`,
          createdAt: NOW,
        });
      }
    });
    await seedEntry(s, 'dropIn', s.guardian.userId, MINOR('Waiting child'));
    const data = await refusal(join(s.asPlayer, s, 'dropIn', MINOR('One too many')));
    expect(data.code).toBe('minorLimit');
  });

  test('joins a series that is full only because someone waits, behind them', async () => {
    const s = await setup();
    await seedEntry(s, 'open', s.users['alice']);
    const { position } = await join(s.bob, s, 'open');
    expect(position).toBe(2);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
  });

  test('sends two joins of the same participant at once as one entry and one refusal', async () => {
    const s = await setup();
    await fillSeries(s);
    const results = await Promise.allSettled([
      join(s.bob, s, 'lastPlace'),
      join(s.bob, s, 'lastPlace'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await entriesOf(s, 'lastPlace')).toHaveLength(1);
  });
});

describe('a waiting series entry counts as full', () => {
  test('refuses a new series registration while an entry waits, though every class has places', async () => {
    const s = await setup();
    await seedEntry(s, 'open', s.users['alice']);
    const data = await refusal(register(s.bob, s, 'open'));
    expect(data.code).toBe('classFull');
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
  });

  test('refuses a new single-class registration while a series entry waits, though the class has places', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.users['alice']);
    const data = await refusal(registerClass(s.bob, s, 'dropIn', 1));
    expect(data.code).toBe('classFull');
    expect(await registeredCounts(s, 'dropIn')).toEqual([0, 0, 0]);
  });

  test('refuses a waiting participant who registers instead, and names the waitlist', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.users['alice']);
    const series = await refusal(register(s.alice, s, 'dropIn'));
    expect(series).toMatchObject({
      code: 'alreadyWaiting',
      message: TRAINING_WAITLIST_MESSAGES.alreadyWaiting(SELF),
    });
    const single = await refusal(registerClass(s.alice, s, 'dropIn', 0));
    expect(single.code).toBe('alreadyWaiting');
  });

  test('takes registrations again once no entry waits', async () => {
    const s = await setup();
    const id = await seedEntry(s, 'open', s.users['alice']);
    await promote(s.admin, id);
    await expect(register(s.bob, s, 'open')).resolves.toMatchObject({});
    expect(await registeredCounts(s, 'open')).toEqual([2, 2, 2]);
  });

  test('does not hold another training program’s registrations', async () => {
    const s = await setup();
    await seedEntry(s, 'open', s.users['alice']);
    await expect(register(s.bob, s, 'dropIn')).resolves.toMatchObject({});
  });
});

describe('trainingWaitlist.promote', () => {
  test('registers the first entry for the series once one place is added in every class', async () => {
    const s = await setup();
    await fillSeries(s);
    const first = await join(s.bob, s, 'lastPlace');
    vi.setSystemTime(NOW + 1000);
    await join(s.carol, s, 'lastPlace');
    await raisePlaces(s, 'lastPlace', 1);
    const { registrationId } = await promote(s.admin, first.trainingWaitlistEntryId);
    expect(await registeredCounts(s, 'lastPlace')).toEqual([2, 2, 2]);
    const registration = await s.t.run((ctx) =>
      ctx.db.get('trainingRegistrations', registrationId),
    );
    expect(registration).toMatchObject({
      userId: s.users['bob'],
      participant: SELF,
      participantKey: 'self',
      trainingId: trainingOf(s, 'lastPlace'),
    });
    expect(registration).not.toHaveProperty('classId');
    const entry = await s.t.run((ctx) =>
      ctx.db.get('trainingWaitlistEntries', first.trainingWaitlistEntryId),
    );
    expect(entry).toMatchObject({ status: 'promoted', registrationId });
    expect(entry?.promotedAt).toBeGreaterThanOrEqual(NOW + 1000);
  });

  test('refuses while one class is still full, and registers no one', async () => {
    const s = await setup();
    await fillSeries(s);
    const { trainingWaitlistEntryId } = await join(s.bob, s, 'lastPlace');
    await raisePlaces(s, 'lastPlace', 1, 0);
    await raisePlaces(s, 'lastPlace', 1, 2);
    const data = await refusal(promote(s.admin, trainingWaitlistEntryId));
    expect(data).toMatchObject({
      code: 'noFreePlace',
      message: TRAINING_WAITLIST_MESSAGES.noFreePlace,
    });
    expect(await registeredCounts(s, 'lastPlace')).toEqual([1, 1, 1]);
    const entry = await s.t.run((ctx) =>
      ctx.db.get('trainingWaitlistEntries', trainingWaitlistEntryId),
    );
    expect(entry?.status).toBe('waiting');
  });

  test('refuses when no place was added', async () => {
    const s = await setup();
    await fillSeries(s);
    const { trainingWaitlistEntryId } = await join(s.bob, s, 'lastPlace');
    const data = await refusal(promote(s.admin, trainingWaitlistEntryId));
    expect(data.code).toBe('noFreePlace');
  });

  test('refuses an entry that is not the first, and gives the places to the first', async () => {
    const s = await setup();
    await fillSeries(s);
    const first = await join(s.bob, s, 'lastPlace');
    vi.setSystemTime(NOW + 1000);
    const second = await join(s.carol, s, 'lastPlace');
    await raisePlaces(s, 'lastPlace', 1);
    const data = await refusal(promote(s.admin, second.trainingWaitlistEntryId));
    expect(data).toMatchObject({ code: 'notNext', message: TRAINING_WAITLIST_MESSAGES.notNext });
    await promote(s.admin, first.trainingWaitlistEntryId);
    await raisePlaces(s, 'lastPlace', 1);
    await expect(promote(s.admin, second.trainingWaitlistEntryId)).resolves.toMatchObject({});
    expect(await registeredCounts(s, 'lastPlace')).toEqual([3, 3, 3]);
  });

  test('refuses an entry that was already promoted', async () => {
    const s = await setup();
    await fillSeries(s);
    const { trainingWaitlistEntryId } = await join(s.bob, s, 'lastPlace');
    await raisePlaces(s, 'lastPlace', 2);
    await promote(s.admin, trainingWaitlistEntryId);
    const data = await refusal(promote(s.admin, trainingWaitlistEntryId));
    expect(data).toMatchObject({
      code: 'notWaiting',
      message: TRAINING_WAITLIST_MESSAGES.notWaiting,
    });
    expect(await registeredCounts(s, 'lastPlace')).toEqual([2, 2, 2]);
  });

  test('promotes an entry in a series with places left, as the series then has no queue', async () => {
    const s = await setup();
    const id = await seedEntry(s, 'open', s.users['bob']);
    await expect(promote(s.admin, id)).resolves.toMatchObject({});
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
  });

  test('registers a waiting child under the guardian, and lets the organizer assigned to the program do it', async () => {
    const s = await setup();
    const id = await seedEntry(s, 'dropIn', s.guardian.userId, MINOR('Maya R.'));
    const { registrationId } = await promote(s.asAssigned, id);
    const registration = await s.t.run((ctx) =>
      ctx.db.get('trainingRegistrations', registrationId),
    );
    expect(registration).toMatchObject({
      userId: s.guardian.userId,
      participant: MINOR('Maya R.'),
      participantKey: 'minor:maya r.',
    });
  });

  test('takes the place of the entry’s own single-class registration, which it frees', async () => {
    const s = await setup();
    const [first, second] = s.trainings['dropInLastPlace'].classIds;
    await registerClass(s.alice, s, 'dropInLastPlace', 0);
    await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', trainingOf(s, 'dropInLastPlace')))!;
      const trainingClass = (await ctx.db.get('trainingClasses', second))!;
      await insertTrainingClassRegistration(ctx, training, trainingClass, {
        userId: s.users['bob'],
        participant: SELF,
      });
    });
    const id = await seedEntry(s, 'dropInLastPlace', s.users['bob']);
    await expect(promote(s.admin, id)).rejects.toThrow();
    await s.admin.mutation(api.trainingClasses.updatePlaces, { trainingClassId: first, places: 2 });
    await promote(s.admin, id);
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([2, 1, 1]);
    const rows = await s.t.run((ctx) =>
      ctx.db
        .query('trainingRegistrations')
        .withIndex('by_userId', (q) => q.eq('userId', s.users['bob']))
        .collect(),
    );
    expect(rows.map((row) => row.classId)).toEqual([undefined]);
  });

  test('refuses when no class is left to attend', async () => {
    const s = await setup();
    const id = await seedEntry(s, 'open', s.users['alice']);
    vi.setSystemTime(Date.UTC(2027, 2, 1, 12, 0, 0));
    const data = await refusal(promote(s.admin, id));
    expect(data).toMatchObject({
      code: 'noUpcomingClass',
      message: TRAINING_WAITLIST_MESSAGES.noUpcomingClass,
    });
  });

  test('keeps the next entry waiting after it promotes the first, so registration stays closed', async () => {
    const s = await setup();
    await fillSeries(s);
    const first = await join(s.bob, s, 'lastPlace');
    vi.setSystemTime(NOW + 1000);
    await join(s.carol, s, 'lastPlace');
    await raisePlaces(s, 'lastPlace', 3);
    await promote(s.admin, first.trainingWaitlistEntryId);
    const data = await refusal(register(s.asPlayer, s, 'lastPlace'));
    expect(data.code).toBe('classFull');
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
      await fillSeries(s);
      const { trainingWaitlistEntryId } = await join(s.bob, s, 'lastPlace');
      await raisePlaces(s, 'lastPlace', 1);
      await expect(promote(caller(s), trainingWaitlistEntryId)).rejects.toThrow(
        /Sign in required|Not allowed|Not authenticated/,
      );
      expect(await registeredCounts(s, 'lastPlace')).toEqual([1, 1, 1]);
    });

    test('an entry that no longer exists, as it does another organization’s', async () => {
      const s = await setup();
      const id = await seedEntry(s, 'open', s.users['alice']);
      await s.t.run((ctx) => ctx.db.delete('trainingWaitlistEntries', id));
      await expect(promote(s.admin, id)).rejects.toThrow(/Not allowed/);
    });
  });
});

describe('trainingWaitlist.listForTraining', () => {
  test('lists the waiting entries in the order they joined, a child with the guardian’s name and email', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.adult.userId, SELF, NOW - 3000);
    await seedEntry(s, 'dropIn', s.guardian.userId, MINOR('Maya R.'), NOW - 2000);
    await seedEntry(s, 'dropIn', s.zed.userId, SELF, NOW - 1000);
    const rows = await listFor(s.admin, s, 'dropIn');
    expect(
      rows.map(({ name, guardian, requestedAt }) => ({ name, guardian, requestedAt })),
    ).toEqual([
      { name: 'Pat Player', guardian: undefined, requestedAt: NOW - 3000 },
      {
        name: 'Maya R.',
        guardian: { name: 'Gail Guardian', email: 'guardian@example.test' },
        requestedAt: NOW - 2000,
      },
      { name: 'Zed Zimmer', guardian: undefined, requestedAt: NOW - 1000 },
    ]);
  });

  test('marks only the first entry promotable, and only once every class has a place', async () => {
    const s = await setup();
    await fillSeries(s);
    await join(s.bob, s, 'lastPlace');
    vi.setSystemTime(NOW + 1000);
    await join(s.carol, s, 'lastPlace');
    const canPromote = async () =>
      (await listFor(s.admin, s, 'lastPlace')).map((row) => row.canPromote);
    expect(await canPromote()).toEqual([false, false]);
    await raisePlaces(s, 'lastPlace', 1, 0);
    await raisePlaces(s, 'lastPlace', 1, 1);
    expect(await canPromote()).toEqual([false, false]);
    await raisePlaces(s, 'lastPlace', 1, 2);
    expect(await canPromote()).toEqual([true, false]);
  });

  test('marks an entry promotable when its own single-class place is the only full class', async () => {
    const s = await setup();
    await registerClass(s.alice, s, 'dropInLastPlace', 0);
    await seedEntry(s, 'dropInLastPlace', s.users['alice']);
    const [row] = await listFor(s.admin, s, 'dropInLastPlace');
    expect(row?.canPromote).toBe(true);
  });

  test('marks no entry promotable when no class is left to attend', async () => {
    const s = await setup();
    await seedEntry(s, 'open', s.users['alice']);
    vi.setSystemTime(Date.UTC(2027, 2, 1, 12, 0, 0));
    const [row] = await listFor(s.admin, s, 'open');
    expect(row?.canPromote).toBe(false);
  });

  test('leaves out a promoted entry and another program’s entries', async () => {
    const s = await setup();
    const promoted = await seedEntry(s, 'dropIn', s.adult.userId);
    await seedEntry(s, 'dropIn', s.zed.userId);
    await seedEntry(s, 'open', s.guardian.userId, MINOR('Maya R.'));
    await promote(s.admin, promoted);
    const rows = await listFor(s.admin, s, 'dropIn');
    expect(rows.map((row) => row.name)).toEqual(['Zed Zimmer']);
  });

  test('is empty when no one waits', async () => {
    const s = await setup();
    await expect(listFor(s.admin, s, 'dropIn')).resolves.toEqual([]);
  });

  test('sends neither a user id nor the participant key', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.guardian.userId, MINOR('Maya R.'));
    const text = JSON.stringify(await listFor(s.admin, s, 'dropIn'));
    for (const secret of [s.guardian.userId, s.guardian.authUserId, 'minor:']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('participantKey');
  });

  test('lists for an organizer assigned to the training program, and an org admin', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.guardian.userId, MINOR('Maya R.'));
    for (const caller of [s.asAssigned, s.admin]) {
      expect(await listFor(caller, s, 'dropIn')).toHaveLength(1);
    }
  });

  test.each([
    ['an unauthenticated caller', (s: Setup) => s.signedOut],
    ['an org admin of another organization', (s: Setup) => s.asOtherAdmin],
    ['a league organizer assigned to another training program', (s: Setup) => s.asUnassigned],
    ['a league organizer assigned to no program', (s: Setup) => s.asLeagueOnly],
    ['a player', (s: Setup) => s.asPlayer],
  ])('refuses %s and returns no name', async (_, caller) => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.guardian.userId, MINOR('Maya R.'));
    await expect(listFor(caller(s), s, 'dropIn')).rejects.toThrow(/Sign in required|Not allowed/);
  });
});

describe('trainingWaitlist.listMineForTraining', () => {
  test('gives the caller’s own entries with their positions, and no one else’s', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.zed.userId, SELF, NOW - 3000);
    await seedEntry(s, 'dropIn', s.guardian.userId, MINOR('Maya R.'), NOW - 2000);
    await seedEntry(s, 'dropIn', s.guardian.userId, SELF, NOW - 1000);
    const rows = await mine(s.asPlayer, 'dropIn');
    expect(rows).toEqual([
      { participant: MINOR('Maya R.'), position: 2 },
      { participant: SELF, position: 3 },
    ]);
    expect(await mine(as(s.zed, s), 'dropIn')).toEqual([{ participant: SELF, position: 1 }]);
  });

  test('is empty for a signed-out caller, a program with no entry of theirs, and a draft', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.zed.userId);
    expect(await mine(s.signedOut, 'dropIn')).toEqual([]);
    expect(await mine(s.asPlayer, 'dropIn')).toEqual([]);
    await seedEntry(s, 'draft', s.guardian.userId);
    expect(await mine(s.asPlayer, 'draft')).toEqual([]);
  });

  test('drops an entry once it is promoted, and moves the ones behind it up', async () => {
    const s = await setup();
    const first = await seedEntry(s, 'dropIn', s.zed.userId, SELF, NOW - 2000);
    await seedEntry(s, 'dropIn', s.guardian.userId, SELF, NOW - 1000);
    expect(await mine(s.asPlayer, 'dropIn')).toEqual([{ participant: SELF, position: 2 }]);
    await promote(s.admin, first);
    expect(await mine(s.asPlayer, 'dropIn')).toEqual([{ participant: SELF, position: 1 }]);
    expect(await mine(as(s.zed, s), 'dropIn')).toEqual([]);
  });

  test('is empty for an unknown organization or program', async () => {
    const s = await setup();
    await expect(
      s.asPlayer.query(api.trainingWaitlist.listMineForTraining, {
        orgSlug: 'nobody',
        trainingSlug: 'drop-in-clinic',
      }),
    ).resolves.toEqual([]);
    await expect(
      s.asPlayer.query(api.trainingWaitlist.listMineForTraining, {
        orgSlug: 'org-a',
        trainingSlug: 'nothing',
      }),
    ).resolves.toEqual([]);
  });
});

describe('what the pages read while a series entry waits', () => {
  const answer = (caller: Caller, key: string, classId?: string) =>
    caller.query(api.trainingRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      trainingSlug: SLUGS[key],
      ...(classId !== undefined && { classId }),
    });

  test('reads no place left, and the first class as full, though every class has places', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.users['alice']);
    const read = await answer(s.bob, 'dropIn', s.trainings['dropIn'].classIds[1]);
    expect(read).toMatchObject({
      placesLeft: 0,
      fullClassDate: '2027-02-02',
      seriesWaitlist: true,
      waitlisted: false,
      singleClass: { placesLeft: 0, allowed: true },
    });
  });

  test('tells the waiting account, and not another, that it waits', async () => {
    const s = await setup();
    await seedEntry(s, 'dropIn', s.users['alice']);
    expect(await answer(s.alice, 'dropIn')).toMatchObject({ waitlisted: true, registered: false });
    expect(await answer(s.bob, 'dropIn')).toMatchObject({ waitlisted: false });
    expect(await answer(s.signedOut, 'dropIn')).toMatchObject({ waitlisted: false });
  });

  test('reads the places as before once no one waits', async () => {
    const s = await setup();
    expect(await answer(s.bob, 'dropIn')).toMatchObject({ placesLeft: 12, waitlisted: false });
    expect(await answer(s.bob, 'dropIn')).not.toHaveProperty('fullClassDate');
    expect(await answer(s.bob, 'dropIn')).not.toHaveProperty('seriesWaitlist');
  });

  test('gives the public page no place left in any class while an entry waits', async () => {
    const s = await setup();
    const page = () =>
      s.t.query(api.trainings.getPublicPage, { orgSlug: 'org-a', trainingSlug: 'drop-in-clinic' });
    expect((await page())?.classes.map((row) => row.placesLeft)).toEqual([12, 12, 12]);
    expect(await page()).not.toHaveProperty('seriesWaitlist');
    await seedEntry(s, 'dropIn', s.users['alice']);
    expect((await page())?.classes.map((row) => row.placesLeft)).toEqual([0, 0, 0]);
    expect(await page()).toMatchObject({ seriesWaitlist: true });
    expect((await page())?.classes.map((row) => row.classId)).toEqual(
      s.trainings['dropIn'].classIds,
    );
  });
});

describe('trainings.getForManagement', () => {
  const read = (caller: Caller, key: string) =>
    caller.query(api.trainings.getForManagement, { orgSlug: 'org-a', trainingSlug: SLUGS[key] });

  test('counts the series entries that wait, for the page to hold the room of the list', async () => {
    const s = await setup();
    expect(await read(s.admin, 'dropIn')).not.toHaveProperty('waitlistCount');
    const first = await seedEntry(s, 'dropIn', s.users['alice']);
    await seedEntry(s, 'dropIn', s.users['bob']);
    await seedEntry(s, 'open', s.users['carol']);
    expect(await read(s.admin, 'dropIn')).toMatchObject({ waitlistCount: 2 });
    await promote(s.admin, first);
    expect(await read(s.admin, 'dropIn')).toMatchObject({ waitlistCount: 1 });
  });
});
