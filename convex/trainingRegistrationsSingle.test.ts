/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MAX_MINORS_PER_SESSION, type Participant } from './lib/individualRegistration';
import { classParticipantKey } from './lib/trainingRegistration';
import {
  CLASS_DATES,
  NOW,
  refusal,
  registeredCounts,
  setup,
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

type Caller = 'alice' | 'bob' | 'carol';

const classOf = (s: Setup, key: string, index: number) => s.trainings[key].classIds[index];

const registerClass = (
  s: Setup,
  caller: Caller | 't' | 'ghost',
  key: string,
  index: number,
  over: { participant?: Participant; ageConfirmed?: boolean } = {},
) =>
  s[caller].mutation(api.trainingRegistrations.register, {
    trainingId: s.trainings[key].trainingId,
    classId: classOf(s, key, index),
    participant: SELF,
    ageConfirmed: true,
    ...over,
  });

const registerSeries = (s: Setup, caller: Caller, key: string, participant: Participant = SELF) =>
  s[caller].mutation(api.trainingRegistrations.register, {
    trainingId: s.trainings[key].trainingId,
    participant,
    ageConfirmed: true,
  });

const registrations = (s: Setup) =>
  s.t.run((ctx) => ctx.db.query('trainingRegistrations').collect());

async function expectNothingWritten(s: Setup, call: () => Promise<unknown>) {
  const before = await s.t.run(async (ctx) => ({
    registrations: await ctx.db.query('trainingRegistrations').collect(),
    classes: await ctx.db.query('trainingClasses').collect(),
  }));
  await call().catch(() => undefined);
  const after = await s.t.run(async (ctx) => ({
    registrations: await ctx.db.query('trainingRegistrations').collect(),
    classes: await ctx.db.query('trainingClasses').collect(),
  }));
  expect(after).toEqual(before);
}

describe('trainingRegistrations.register for one class', () => {
  test('takes one place in that class only and writes a registration of that class', async () => {
    const s = await setup();
    const { registrationId } = await registerClass(s, 'alice', 'dropIn', 1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([0, 1, 0]);
    expect(await registrations(s)).toEqual([
      {
        _id: registrationId,
        _creationTime: expect.any(Number) as number,
        trainingId: s.trainings['dropIn'].trainingId,
        classId: classOf(s, 'dropIn', 1),
        organizationId: s.organization,
        userId: s.users['alice'],
        participant: { kind: 'self' },
        participantKey: `class:${classOf(s, 'dropIn', 1)}:self`,
        createdAt: NOW,
      },
    ]);
  });

  test('lets one person take several classes, each counting once, and leaves other programs alone', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 0);
    await registerClass(s, 'alice', 'dropIn', 2);
    await registerClass(s, 'bob', 'dropIn', 2);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 0, 2]);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
    expect(await registrations(s)).toHaveLength(3);
  });

  test('registers a child for one class and stores the age confirmation of a program with ages', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropInYouth', 0, { participant: MINOR('Maya R.') });
    const [row] = await registrations(s);
    expect(row).toMatchObject({
      classId: classOf(s, 'dropInYouth', 0),
      participant: { kind: 'minor', minorName: 'Maya R.' },
      participantKey: `class:${classOf(s, 'dropInYouth', 0)}:minor:maya r.`,
      ageConfirmedAt: NOW,
    });
    expect(await registeredCounts(s, 'dropInYouth')).toEqual([1, 0, 0]);
  });

  test('lets the same child take another class but not the same class twice', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropInYouth', 0, { participant: MINOR('Maya R.') });
    await registerClass(s, 'alice', 'dropInYouth', 1, { participant: MINOR('maya  r.') });
    const data = await refusal(
      registerClass(s, 'alice', 'dropInYouth', 1, { participant: MINOR('Maya R.') }),
    );
    expect(data).toMatchObject({ code: 'alreadyRegistered', field: 'minorName' });
    expect(await registeredCounts(s, 'dropInYouth')).toEqual([1, 1, 0]);
  });

  test('takes a place in the class when a guardian and the child both register', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 0);
    await registerClass(s, 'alice', 'dropIn', 0, { participant: MINOR('Maya R.') });
    expect(await registeredCounts(s, 'dropIn')).toEqual([2, 0, 0]);
  });
});

describe('trainingRegistrations.register for one class: when it is refused', () => {
  test('refuses a program that does not allow single-class registration, writing nothing', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      const data = await refusal(registerClass(s, 'alice', 'open', 0));
      expect(data).toMatchObject({ code: 'singleClassNotAllowed' });
    });
    expect(await registrations(s)).toEqual([]);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
  });

  test('is open through the class date and refused the day after', async () => {
    const s = await setup();
    vi.setSystemTime(Date.parse('2027-02-03T11:59:59Z'));
    await registerClass(s, 'alice', 'dropIn', 0);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 0, 0]);

    vi.setSystemTime(Date.parse('2027-02-03T12:00:00Z'));
    await expectNothingWritten(s, async () => {
      const data = await refusal(registerClass(s, 'bob', 'dropIn', 0));
      expect(data).toMatchObject({ code: 'registrationClosed' });
    });
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 0, 0]);
  });

  test('ignores the series deadline, which has passed for a class still to come', async () => {
    const s = await setup();
    vi.setSystemTime(Date.parse('2027-02-02T12:00:00Z'));
    const series = await refusal(registerSeries(s, 'alice', 'dropIn'));
    expect(series).toMatchObject({ code: 'registrationClosed' });
    await registerClass(s, 'alice', 'dropIn', 2);
    expect(await registeredCounts(s, 'dropIn')).toEqual([0, 0, 1]);
  });

  test('refuses a class that has passed, writing nothing', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      const data = await refusal(registerClass(s, 'alice', 'dropInMidRun', 0));
      expect(data).toMatchObject({ code: 'registrationClosed' });
    });
    expect(await registeredCounts(s, 'dropInMidRun')).toEqual([0, 0, 0]);
    await registerClass(s, 'alice', 'dropInMidRun', 1);
    expect(await registeredCounts(s, 'dropInMidRun')).toEqual([0, 1, 0]);
  });

  test('refuses an unauthenticated caller and an identity with no users row, writing nothing', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      await expect(registerClass(s, 't', 'dropIn', 0)).rejects.toThrow('Sign in required');
      await expect(registerClass(s, 'ghost', 'dropIn', 0)).rejects.toThrow('Sign in required');
    });
    expect(await registrations(s)).toEqual([]);
  });

  test('refuses the same class twice, keeping the count', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 1);
    const data = await refusal(registerClass(s, 'alice', 'dropIn', 1));
    expect(data).toMatchObject({ code: 'alreadyRegistered' });
    expect(await registeredCounts(s, 'dropIn')).toEqual([0, 1, 0]);
    expect(await registrations(s)).toHaveLength(1);
  });

  test('refuses a series registrant, who already holds a place in every class', async () => {
    const s = await setup();
    await registerSeries(s, 'alice', 'dropIn');
    const data = await refusal(registerClass(s, 'alice', 'dropIn', 1));
    expect(data).toMatchObject({ code: 'alreadyRegistered' });
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 1, 1]);
    await registerClass(s, 'alice', 'dropIn', 1, { participant: MINOR('Maya R.') });
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 2, 1]);
  });

  test('refuses a full class, naming its date, and a class with a place left is still open', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropInLastPlace', 1);
    const data = await refusal(registerClass(s, 'bob', 'dropInLastPlace', 1));
    expect(data).toMatchObject({ code: 'classFull' });
    expect(data.message).toContain('Feb 9, 2027');
    await registerClass(s, 'bob', 'dropInLastPlace', 0);
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([1, 1, 0]);
  });

  test('refuses a class of another program, a cancelled class, and one that does not exist as not open, writing nothing', async () => {
    const s = await setup();
    const gone = classOf(s, 'dropIn', 2);
    await s.t.run(async (ctx) => {
      await ctx.db.patch('trainingClasses', classOf(s, 'dropIn', 1), { status: 'cancelled' });
      await ctx.db.delete('trainingClasses', gone);
    });
    await expectNothingWritten(s, async () => {
      const foreign = await refusal(
        s.alice.mutation(api.trainingRegistrations.register, {
          trainingId: s.trainings['dropIn'].trainingId,
          classId: classOf(s, 'dropInYouth', 0),
          participant: SELF,
          ageConfirmed: true,
        }),
      );
      expect(foreign).toMatchObject({ code: 'classNotFound' });
      expect(await refusal(registerClass(s, 'alice', 'dropIn', 1))).toMatchObject({
        code: 'classNotFound',
      });
      expect(await refusal(registerClass(s, 'alice', 'dropIn', 2))).toMatchObject({
        code: 'classNotFound',
      });
    });
  });

  test('refuses a class of a draft program as not found', async () => {
    const s = await setup();
    const draft = s.trainings['draft'];
    const data = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, {
        trainingId: draft.trainingId,
        classId: draft.classIds[0],
        participant: SELF,
        ageConfirmed: true,
      }),
    );
    expect(data).toMatchObject({ code: 'trainingNotFound' });
  });
});

describe('trainingRegistrations.register for one class: the age rules of the program', () => {
  test('refuses an adult where the maximum age is under 18, and a child where the minimum is 18 or more', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      const adult = await refusal(registerClass(s, 'alice', 'dropInYouth', 0));
      expect(adult).toMatchObject({ code: 'adultNotAllowed' });
    });
    await s.t.run((ctx) =>
      ctx.db.patch('trainings', s.trainings['dropIn'].trainingId, { minimumAge: 18 }),
    );
    await expectNothingWritten(s, async () => {
      const child = await refusal(
        registerClass(s, 'alice', 'dropIn', 0, { participant: MINOR('Maya R.') }),
      );
      expect(child).toMatchObject({ code: 'minorNotAllowed' });
    });
  });

  test('refuses an unticked age box under the box, and needs none where the program has no ages', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      const data = await refusal(
        registerClass(s, 'alice', 'dropInYouth', 0, {
          participant: MINOR('Maya R.'),
          ageConfirmed: false,
        }),
      );
      expect(data).toMatchObject({ code: 'ageNotConfirmed', field: 'ageConfirmed' });
    });
    await registerClass(s, 'alice', 'dropIn', 0, { ageConfirmed: false });
    const row = (await registrations(s))[0];
    expect(row).not.toHaveProperty('ageConfirmedAt');
  });

  test('refuses an empty name for a child under the name', async () => {
    const s = await setup();
    const data = await refusal(
      registerClass(s, 'alice', 'dropInYouth', 0, { participant: MINOR('  ') }),
    );
    expect(data).toMatchObject({ field: 'minorName' });
    expect(await registrations(s)).toEqual([]);
  });

  test('counts a child once however many classes, and refuses a new child past the most one guardian can register', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < MAX_MINORS_PER_SESSION; index++) {
        const classId = classOf(s, 'dropInYouth', index % 3);
        const participant = MINOR(`Child ${index}`);
        await ctx.db.insert('trainingRegistrations', {
          trainingId: s.trainings['dropInYouth'].trainingId,
          classId,
          organizationId: s.organization,
          userId: s.users['alice'],
          participant,
          participantKey: classParticipantKey(classId, participant),
          createdAt: NOW,
        });
      }
    });
    const data = await refusal(
      registerClass(s, 'alice', 'dropInYouth', 0, { participant: MINOR('One More') }),
    );
    expect(data).toMatchObject({ code: 'minorLimit', field: 'minorName' });
    await registerClass(s, 'alice', 'dropInYouth', 2, { participant: MINOR('Child 0') });
    await registerClass(s, 'bob', 'dropInYouth', 0, { participant: MINOR('One More') });
  });

  test('gives exactly one of two registrations racing for the last place of a class', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      registerClass(s, 'alice', 'dropInLastPlace', 0),
      registerClass(s, 'bob', 'dropInLastPlace', 0),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([1, 0, 0]);
  });

  test('gives exactly one of two registrations of the same person for the same class racing', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      registerClass(s, 'alice', 'dropIn', 0),
      registerClass(s, 'alice', 'dropIn', 0),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 0, 0]);
  });
});

describe('trainingRegistrations.register for the series after single-class registrations', () => {
  const rowsOf = async (s: Setup, userId: Id<'users'>) =>
    (await registrations(s)).filter((row) => row.userId === userId);

  test('replaces the single-class rows of the participant, so each class counts them once', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 0);
    await registerClass(s, 'alice', 'dropIn', 2);
    await registerClass(s, 'bob', 'dropIn', 2);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 0, 2]);

    await registerSeries(s, 'alice', 'dropIn');
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 1, 2]);
    const mine = await rowsOf(s, s.users['alice']);
    expect(mine).toHaveLength(1);
    expect(mine[0]).not.toHaveProperty('classId');
    expect(await rowsOf(s, s.users['bob'])).toHaveLength(1);
  });

  test('replaces only the rows of the participant: a child’s single-class rows stay', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 0);
    await registerClass(s, 'alice', 'dropIn', 1, { participant: MINOR('Maya R.') });
    await registerSeries(s, 'alice', 'dropIn');
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 2, 1]);
    const mine = await rowsOf(s, s.users['alice']);
    expect(mine.map((row) => [row.participantKey, row.classId ?? null])).toEqual(
      expect.arrayContaining([
        ['self', null],
        [`class:${classOf(s, 'dropIn', 1)}:minor:maya r.`, classOf(s, 'dropIn', 1)],
      ]),
    );
    expect(mine).toHaveLength(2);
  });

  test('is not blocked by a class that is full only because of the participant’s own place in it', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropInLastPlace', 1);
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([0, 1, 0]);
    await registerSeries(s, 'alice', 'dropInLastPlace');
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([1, 1, 1]);
    const bob = await refusal(registerSeries(s, 'bob', 'dropInLastPlace'));
    expect(bob).toMatchObject({ code: 'classFull' });
  });

  test('still refuses a series when another account’s place fills a class', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropInLastPlace', 1);
    const data = await refusal(registerSeries(s, 'bob', 'dropInLastPlace'));
    expect(data).toMatchObject({ code: 'classFull' });
    expect(await registeredCounts(s, 'dropInLastPlace')).toEqual([0, 1, 0]);
  });

  test('refuses a second series registration of the same person', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 0);
    await registerSeries(s, 'alice', 'dropIn');
    const data = await refusal(registerSeries(s, 'alice', 'dropIn'));
    expect(data).toMatchObject({ code: 'alreadyRegistered' });
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 1, 1]);
  });

  test('leaves the single-class rows when the series is refused', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 0);
    vi.setSystemTime(Date.parse('2027-02-02T12:00:00Z'));
    await expectNothingWritten(s, async () => {
      await refusal(registerSeries(s, 'alice', 'dropIn'));
    });
    expect(await rowsOf(s, s.users['alice'])).toHaveLength(1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 0, 0]);
  });
});

describe('trainingRegistrations.getForRegistration and listMineForTraining with single-class registrations', () => {
  const ask = (caller: Setup['alice'] | Setup['t'], classId?: string) =>
    caller.query(api.trainingRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      trainingSlug: 'drop-in-clinic',
      ...(classId !== undefined && { classId }),
    });

  const mine = (caller: Setup['alice'] | Setup['t']) =>
    caller.query(api.trainingRegistrations.listMineForTraining, {
      orgSlug: 'org-a',
      trainingSlug: 'drop-in-clinic',
    });

  test('does not read a single-class row as a series registration', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 1);
    expect((await ask(s.alice))?.registered).toBe(false);
    expect(await mine(s.alice)).toMatchObject({ self: false, minorNames: [] });
  });

  test('does not count the caller’s own place in a class against the series they would replace it with', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', classOf(s, 'dropIn', 1), { registeredCount: 11 }),
    );
    await registerClass(s, 'alice', 'dropIn', 1);
    expect(await ask(s.bob)).toMatchObject({ placesLeft: 0, fullClassDate: CLASS_DATES[1] });
    const own = await ask(s.alice);
    expect(own).toMatchObject({ placesLeft: 1 });
    expect(own).not.toHaveProperty('fullClassDate');
  });

  test('answers with the class asked for: its date, places left, whether single-class is allowed, and who holds a place', async () => {
    const s = await setup();
    await registerClass(s, 'bob', 'dropIn', 1);
    await registerClass(s, 'alice', 'dropIn', 1);
    const answer = await ask(s.alice, classOf(s, 'dropIn', 1));
    expect(answer?.singleClass).toEqual({
      classId: classOf(s, 'dropIn', 1),
      date: CLASS_DATES[1],
      startTime: '18:00',
      endTime: '19:00',
      placesLeft: 10,
      allowed: true,
      held: 'class',
    });
    const other = await ask(s.alice, classOf(s, 'dropIn', 2));
    expect(other?.singleClass).toMatchObject({ placesLeft: 12 });
    expect(other?.singleClass).not.toHaveProperty('held');
    expect((await ask(s.t, classOf(s, 'dropIn', 2)))?.singleClass).toMatchObject({ allowed: true });
  });

  test('says a series registrant holds a place in the class through the series', async () => {
    const s = await setup();
    await registerSeries(s, 'alice', 'dropIn');
    const answer = await ask(s.alice, classOf(s, 'dropIn', 0));
    expect(answer?.registered).toBe(true);
    expect(answer?.singleClass).toMatchObject({ held: 'series', placesLeft: 11 });
  });

  test('says single-class registration is not allowed for a program that does not take it', async () => {
    const s = await setup();
    const answer = await s.alice.query(api.trainingRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      trainingSlug: 'tuesday-serving-clinic',
      classId: classOf(s, 'open', 0),
    });
    expect(answer?.singleClass).toMatchObject({ allowed: false });
  });

  test('leaves the class out for an id that is no class of this program, a cancelled class, and text that is no id', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', classOf(s, 'dropIn', 2), { status: 'cancelled' }),
    );
    for (const classId of [
      classOf(s, 'dropInYouth', 0),
      classOf(s, 'dropIn', 2),
      'not-an-id',
      s.users['alice'],
    ]) {
      const answer = await ask(s.alice, classId);
      expect(answer).not.toBeNull();
      expect(answer).not.toHaveProperty('singleClass');
    }
  });

  test('lists the classes the caller registered for one by one, with a child’s name only to the guardian', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 0);
    await registerClass(s, 'alice', 'dropIn', 2, { participant: MINOR('Maya R.') });
    await registerClass(s, 'alice', 'dropIn', 2);
    await registerClass(s, 'bob', 'dropIn', 1, { participant: MINOR('Sam T.') });
    expect(await mine(s.alice)).toEqual({
      self: false,
      minorNames: [],
      classes: [
        { classId: classOf(s, 'dropIn', 0), self: true, minorNames: [] },
        { classId: classOf(s, 'dropIn', 2), self: true, minorNames: ['Maya R.'] },
      ],
    });
    expect((await mine(s.carol)).classes).toEqual([]);
    expect(JSON.stringify(await mine(s.alice))).not.toContain('Sam');
    expect(JSON.stringify(await mine(s.t))).not.toContain('Maya');
  });

  test('keeps the series and the single-class registrations apart in the list', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 1, { participant: MINOR('Maya R.') });
    await registerSeries(s, 'alice', 'dropIn', MINOR('Zoe R.'));
    expect(await mine(s.alice)).toEqual({
      self: false,
      minorNames: ['Zoe R.'],
      classes: [{ classId: classOf(s, 'dropIn', 1), self: false, minorNames: ['Maya R.'] }],
    });
  });
});

describe('trainings.getPublicPage with single-class registration', () => {
  const page = (s: Setup, trainingSlug: string) =>
    s.t.query(api.trainings.getPublicPage, { orgSlug: 'org-a', trainingSlug });

  test('says a program allows single-class registration and names each class, and says nothing otherwise', async () => {
    const s = await setup();
    const allowed = await page(s, 'drop-in-clinic');
    expect(allowed?.allowSingleRegistration).toBe(true);
    expect(allowed?.classes.map((row) => row.classId)).toEqual(s.trainings['dropIn'].classIds);
    const not = await page(s, 'tuesday-serving-clinic');
    expect(not).not.toHaveProperty('allowSingleRegistration');
  });

  test('shows no registrant field', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropInYouth', 0, { participant: MINOR('Maya R.') });
    const serialised = JSON.stringify(await page(s, 'drop-in-youth-clinic'));
    expect(serialised).not.toContain('Maya');
    expect(serialised).not.toContain('alice');
  });
});

describe('trainingClasses.restore with single-class registrations', () => {
  const restore = (s: Setup, key: string, index: number) =>
    s.admin.mutation(api.trainingClasses.restore, { trainingClassId: classOf(s, key, index) });

  test('counts the series registrations of a restored class and not those of another class', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', classOf(s, 'dropIn', 1), { status: 'cancelled' }),
    );
    await registerSeries(s, 'alice', 'dropIn');
    await registerClass(s, 'bob', 'dropIn', 0);
    await registerClass(s, 'bob', 'dropIn', 2);
    expect(await registeredCounts(s, 'dropIn')).toEqual([2, 0, 2]);
    await restore(s, 'dropIn', 1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([2, 1, 2]);
  });

  test('counts more than 400 registrations of a program in all, the series ones among them', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', classOf(s, 'dropIn', 1), { status: 'cancelled' }),
    );
    const SINGLE_ROWS = 450;
    await s.t.run(async (ctx) => {
      const base = {
        trainingId: s.trainings['dropIn'].trainingId,
        organizationId: s.organization,
        createdAt: NOW,
      };
      for (let index = 0; index < SINGLE_ROWS; index++) {
        const name = `Child ${String(index).padStart(3, '0')}`;
        const classId = classOf(s, 'dropIn', 0);
        await ctx.db.insert('trainingRegistrations', {
          ...base,
          classId,
          userId: s.users['alice'],
          participant: MINOR(name),
          participantKey: classParticipantKey(classId, MINOR(name)),
        });
      }
      for (const user of ['alice', 'bob', 'carol']) {
        await ctx.db.insert('trainingRegistrations', {
          ...base,
          userId: s.users[user],
          participant: SELF,
          participantKey: 'self',
        });
      }
    });
    await restore(s, 'dropIn', 1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([0, 3, 0]);
  });

  test('counts the single-class rows that hold the restored class itself', async () => {
    const s = await setup();
    await registerSeries(s, 'alice', 'dropIn');
    await s.t.run(async (ctx) => {
      await ctx.db.patch('trainingClasses', classOf(s, 'dropIn', 1), { status: 'cancelled' });
      await ctx.db.insert('trainingRegistrations', {
        trainingId: s.trainings['dropIn'].trainingId,
        classId: classOf(s, 'dropIn', 1),
        organizationId: s.organization,
        userId: s.users['bob'],
        participant: SELF,
        participantKey: classParticipantKey(classOf(s, 'dropIn', 1), SELF),
        createdAt: NOW,
      });
    });
    await restore(s, 'dropIn', 1);
    expect(await registeredCounts(s, 'dropIn')).toEqual([1, 2, 1]);
  });

  test('cannot cancel a class that single-class registrations hold', async () => {
    const s = await setup();
    await registerClass(s, 'alice', 'dropIn', 1);
    const data = await refusal(
      s.admin.mutation(api.trainingClasses.cancel, { trainingClassId: classOf(s, 'dropIn', 1) }),
    );
    expect(data).toMatchObject({ code: 'hasRegistrations' });
  });
});
