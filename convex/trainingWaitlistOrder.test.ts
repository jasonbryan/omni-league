/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { deleteUserRecord } from './lib/users';
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
const KEY = 'lastPlace';
const SLUG = 'last-place-clinic';

type Caller = Pick<Setup['t'], 'mutation' | 'query'>;

const trainingId = (s: Setup) => s.trainings[KEY].trainingId;

const join = (caller: Caller, s: Setup) =>
  caller.mutation(api.trainingWaitlist.join, {
    trainingId: trainingId(s),
    participant: SELF,
    ageConfirmed: true,
  });

const register = (caller: Caller, s: Setup) =>
  caller.mutation(api.trainingRegistrations.register, {
    trainingId: trainingId(s),
    participant: SELF,
    ageConfirmed: true,
  });

const promote = (caller: Caller, id: Id<'trainingWaitlistEntries'>) =>
  caller.mutation(api.trainingWaitlist.promote, { trainingWaitlistEntryId: id });

const setAllPlaces = (s: Setup, places: number) =>
  s.admin.mutation(api.trainingClasses.updateAllPlaces, { trainingId: trainingId(s), places });

const waiting = (s: Setup) =>
  s.admin.query(api.trainingWaitlist.listForTraining, { trainingId: trainingId(s) });

const management = (s: Setup) =>
  s.admin.query(api.trainings.getForManagement, { orgSlug: 'org-a', trainingSlug: SLUG });

const publicPlaces = async (s: Setup) =>
  (
    await s.t.query(api.trainings.getPublicPage, { orgSlug: 'org-a', trainingSlug: SLUG })
  )?.classes.map((row) => row.placesLeft);

/** Alice holds the one place in every class, then each of `names` joins in turn. */
async function queue(s: Setup, ...names: ('bob' | 'carol')[]) {
  await register(s.alice, s);
  const ids: Id<'trainingWaitlistEntries'>[] = [];
  for (const name of names) {
    vi.setSystemTime(Date.now() + 1000);
    ids.push((await join(s[name], s)).trainingWaitlistEntryId);
  }
  return ids;
}

describe('places raised for the whole series', () => {
  test('promote takes the waiting people in the order they joined, one place per press', async () => {
    const s = await setup();
    const [bob, carol] = await queue(s, 'bob', 'carol');
    await setAllPlaces(s, 2);
    expect((await refusal(promote(s.admin, carol))).code).toBe('notNext');
    await promote(s.admin, bob);
    expect(await registeredCounts(s, KEY)).toEqual([2, 2, 2]);
    expect((await refusal(promote(s.admin, carol))).code).toBe('noFreePlace');
    expect((await waiting(s)).map((row) => row.canPromote)).toEqual([false]);
    await setAllPlaces(s, 3);
    expect((await waiting(s)).map((row) => row.canPromote)).toEqual([true]);
    await promote(s.admin, carol);
    expect(await registeredCounts(s, KEY)).toEqual([3, 3, 3]);
    expect(await waiting(s)).toEqual([]);
  });

  test('every class reads no place left while someone waits, though the places were raised', async () => {
    const s = await setup();
    await queue(s, 'bob');
    await setAllPlaces(s, 5);
    expect(await publicPlaces(s)).toEqual([0, 0, 0]);
    await expect(register(s.carol, s)).rejects.toBeDefined();
  });
});

describe('a join, a registration and a promotion at once', () => {
  test('a join beside a promotion ends with one registration more and the joiner first in line', async () => {
    const s = await setup();
    const [bob] = await queue(s, 'bob');
    await setAllPlaces(s, 2);
    const results = await Promise.allSettled([promote(s.admin, bob), join(s.carol, s)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await registeredCounts(s, KEY)).toEqual([2, 2, 2]);
    expect((await waiting(s)).map((row) => row.name)).toEqual(['carol']);
    expect(
      await s.carol.query(api.trainingWaitlist.listMineForTraining, {
        orgSlug: 'org-a',
        trainingSlug: SLUG,
      }),
    ).toEqual([{ participant: SELF, position: 1 }]);
  });

  test('a registration beside a promotion is refused and never passes the places', async () => {
    const s = await setup();
    const [bob] = await queue(s, 'bob');
    await setAllPlaces(s, 2);
    const results = await Promise.allSettled([promote(s.admin, bob), register(s.carol, s)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await registeredCounts(s, KEY)).toEqual([2, 2, 2]);
  });

  test('two promotions of the same entry at once register it once', async () => {
    const s = await setup();
    const [bob] = await queue(s, 'bob');
    await setAllPlaces(s, 3);
    const results = await Promise.allSettled([promote(s.admin, bob), promote(s.admin, bob)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await registeredCounts(s, KEY)).toEqual([2, 2, 2]);
  });
});

describe('a restored class', () => {
  test('counts the series registrations, and keeps Promote refused until the places cover them', async () => {
    const s = await setup();
    const [first] = s.trainings[KEY].classIds;
    await setAllPlaces(s, 2);
    await s.admin.mutation(api.trainingClasses.cancel, { trainingClassId: first });
    await register(s.alice, s);
    await register(s.bob, s);
    expect(await registeredCounts(s, KEY)).toEqual([0, 2, 2]);
    await s.admin.mutation(api.trainingClasses.updatePlaces, {
      trainingClassId: first,
      places: 1,
    });
    await s.admin.mutation(api.trainingClasses.restore, { trainingClassId: first });
    expect(await registeredCounts(s, KEY)).toEqual([2, 2, 2]);
    const carol = (await join(s.carol, s)).trainingWaitlistEntryId;
    expect((await refusal(promote(s.admin, carol))).code).toBe('noFreePlace');
    expect((await waiting(s)).map((row) => row.canPromote)).toEqual([false]);
    await setAllPlaces(s, 3);
    await promote(s.admin, carol);
    expect(await registeredCounts(s, KEY)).toEqual([3, 3, 3]);
  });
});

describe('deleting an account that waits', () => {
  test('keeps the count on the management page and the places on the public page right', async () => {
    const s = await setup();
    await queue(s, 'bob', 'carol');
    expect(await management(s)).toMatchObject({ waitlistCount: 2 });
    await s.t.run((ctx) => deleteUserRecord(ctx, 'bob'));
    expect(await management(s)).toMatchObject({ waitlistCount: 1 });
    expect(await publicPlaces(s)).toEqual([0, 0, 0]);
    await s.t.run((ctx) => deleteUserRecord(ctx, 'carol'));
    expect(await management(s)).not.toHaveProperty('waitlistCount');
    expect(await publicPlaces(s)).toEqual([0, 0, 0]);
    await setAllPlaces(s, 2);
    expect(await publicPlaces(s)).toEqual([1, 1, 1]);
  });
});

describe('a guardian whose child holds a single-class place', () => {
  const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });
  const DROP_IN = 'dropInLastPlace';

  test('reads open for the account, refuses the sibling’s series registration, and lets the sibling join the waitlist', async () => {
    const s = await setup();
    const { trainingId: dropInId, classIds } = s.trainings[DROP_IN];
    await s.asPlayer.mutation(api.trainingRegistrations.register, {
      trainingId: dropInId,
      classId: classIds[0],
      participant: MINOR('Child A'),
      ageConfirmed: true,
    });
    const read = await s.asPlayer.query(api.trainingRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      trainingSlug: 'drop-in-last-place-clinic',
    });
    expect(read).toMatchObject({ placesLeft: 1 });
    expect(read).not.toHaveProperty('fullClassDate');
    const refused = await refusal(
      s.asPlayer.mutation(api.trainingRegistrations.register, {
        trainingId: dropInId,
        participant: MINOR('Child B'),
        ageConfirmed: true,
      }),
    );
    expect(refused.code).toBe('classFull');
    const joined = await s.asPlayer.mutation(api.trainingWaitlist.join, {
      trainingId: dropInId,
      participant: MINOR('Child B'),
      ageConfirmed: true,
    });
    expect(joined.position).toBe(1);
    expect(
      await s.asPlayer.query(api.trainingWaitlist.listMineForTraining, {
        orgSlug: 'org-a',
        trainingSlug: 'drop-in-last-place-clinic',
      }),
    ).toEqual([{ participant: MINOR('Child B'), position: 1 }]);
  });
});
