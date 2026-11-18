/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { MAX_MINORS_PER_SESSION } from './lib/individualRegistration';
import { TRAINING_REGISTRATION_MESSAGES } from './lib/trainingRegistration';
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

const SELF = { kind: 'self' } as const;

const args = (s: Setup, key: string, over: { ageConfirmed?: boolean } = {}) => ({
  trainingId: s.trainings[key].trainingId,
  participant: SELF,
  ageConfirmed: true,
  ...over,
});

const childArgs = (
  s: Setup,
  key: string,
  minorName = 'Maya R.',
  over: { ageConfirmed?: boolean } = {},
) => ({
  trainingId: s.trainings[key].trainingId,
  participant: { kind: 'minor', minorName } as const,
  ageConfirmed: true,
  ...over,
});

const rows = (s: Setup) =>
  s.t.run(async (ctx) => ({
    registrations: await ctx.db.query('trainingRegistrations').collect(),
    classes: await ctx.db.query('trainingClasses').collect(),
  }));

async function expectNothingWritten(s: Setup, call: () => Promise<unknown>) {
  const before = await rows(s);
  await call().catch(() => undefined);
  expect(await rows(s)).toEqual(before);
}

describe('trainingRegistrations.register', () => {
  test('takes one place in every class and writes one series registration for the caller', async () => {
    const s = await setup();
    const { registrationId } = await s.alice.mutation(
      api.trainingRegistrations.register,
      args(s, 'adults'),
    );
    const { registrations } = await rows(s);
    expect(registrations).toEqual([
      {
        _id: registrationId,
        _creationTime: registrations[0]._creationTime,
        trainingId: s.trainings['adults'].trainingId,
        organizationId: s.organization,
        userId: s.users['alice'],
        participant: { kind: 'self' },
        participantKey: 'self',
        ageConfirmedAt: NOW,
        createdAt: NOW,
      },
    ]);
    expect(await registeredCounts(s, 'adults')).toEqual([1, 1, 1]);
  });

  test('leaves the classes of other training programs alone', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'open'));
    expect(await registeredCounts(s, 'adults')).toEqual([0, 0, 0]);
    expect(await registeredCounts(s, 'youth')).toEqual([0, 0, 0]);
  });

  test('lets two people register and one person register for two training programs', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'open'));
    await s.bob.mutation(api.trainingRegistrations.register, args(s, 'open'));
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'lastPlace'));
    expect(await registeredCounts(s, 'open')).toEqual([2, 2, 2]);
    expect((await rows(s)).registrations).toHaveLength(3);
  });

  test('takes no place in a cancelled class', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', s.trainings['open'].classIds[1], { status: 'cancelled' }),
    );
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'open'));
    expect(await registeredCounts(s, 'open')).toEqual([1, 0, 1]);
  });

  test('is open on the deadline day itself', async () => {
    const s = await setup();
    vi.setSystemTime(Date.parse('2027-02-01T23:59:00Z'));
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'open'));
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
  });

  test('refuses an unauthenticated caller and an identity with no users row, writing nothing', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      await expect(
        s.t.mutation(api.trainingRegistrations.register, args(s, 'open')),
      ).rejects.toThrow('Sign in required');
      await expect(
        s.ghost.mutation(api.trainingRegistrations.register, args(s, 'open')),
      ).rejects.toThrow('Sign in required');
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 0]);
  });

  test('refuses a draft training program and one with no classes as not found, writing nothing', async () => {
    const s = await setup();
    for (const key of ['draft', 'unscheduled']) {
      const data = await refusal(
        s.alice.mutation(api.trainingRegistrations.register, args(s, key)),
      );
      expect(data).toEqual({
        code: 'trainingNotFound',
        message: TRAINING_REGISTRATION_MESSAGES.trainingNotFound,
      });
    }
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCounts(s, 'draft')).toEqual([0, 0, 0]);
  });

  test('refuses a series whose deadline has passed, writing nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'pastDeadline')),
    );
    expect(data).toEqual({
      code: 'registrationClosed',
      message: TRAINING_REGISTRATION_MESSAGES.registrationClosed,
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCounts(s, 'pastDeadline')).toEqual([0, 0, 0]);
  });

  test('refuses a series with no class left to attend', async () => {
    const s = await setup();
    const passed = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'passed')),
    );
    expect(passed).toMatchObject({ code: 'registrationClosed' });
    await s.t.run(async (ctx) => {
      for (const id of s.trainings['open'].classIds) {
        await ctx.db.patch('trainingClasses', id, { status: 'cancelled' });
      }
    });
    const cancelled = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'open')),
    );
    expect(cancelled).toMatchObject({ code: 'registrationClosed' });
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('refuses a second registration of the same person and keeps the counts', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'open'));
    const data = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'open')),
    );
    expect(data).toEqual({
      code: 'alreadyRegistered',
      message: TRAINING_REGISTRATION_MESSAGES.alreadyRegistered(SELF),
    });
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
  });

  test('refuses a series with any class full, naming the class, and writes nothing', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', s.trainings['open'].classIds[2], {
        places: 1,
        registeredCount: 1,
      }),
    );
    const data = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'open')),
    );
    expect(data).toEqual({
      code: 'classFull',
      message: TRAINING_REGISTRATION_MESSAGES.classFull(CLASS_DATES[2]),
    });
    expect(data.message).toBe('Tue, Feb 16, 2027 is full.');
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCounts(s, 'open')).toEqual([0, 0, 1]);
  });

  test('refuses once the last place of every class is taken', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'lastPlace'));
    const data = await refusal(
      s.bob.mutation(api.trainingRegistrations.register, args(s, 'lastPlace')),
    );
    expect(data).toMatchObject({ code: 'classFull' });
    expect(await registeredCounts(s, 'lastPlace')).toEqual([1, 1, 1]);
  });

  test('ignores a full class that is cancelled', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', s.trainings['open'].classIds[0], {
        places: 1,
        registeredCount: 1,
        status: 'cancelled',
      }),
    );
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'open'));
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
  });

  test('refuses an adult when the maximum age is under 18, writing nothing', async () => {
    const s = await setup();
    for (const key of ['youth', 'teens']) {
      const data = await refusal(
        s.alice.mutation(api.trainingRegistrations.register, args(s, key)),
      );
      expect(data).toMatchObject({ code: 'adultNotAllowed' });
    }
    const youth = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'youth')),
    );
    expect(youth.message).toBe(TRAINING_REGISTRATION_MESSAGES.adultNotAllowed(17));
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCounts(s, 'youth')).toEqual([0, 0, 0]);
  });

  test('lets an adult register where the maximum age is 18 or more, or there is none', async () => {
    const s = await setup();
    for (const key of ['adults', 'mixed', 'seniors', 'open']) {
      await s.alice.mutation(api.trainingRegistrations.register, args(s, key));
    }
    expect((await rows(s)).registrations).toHaveLength(4);
  });

  test('refuses an unticked age box under the box when the program has ages, writing nothing', async () => {
    const s = await setup();
    for (const key of ['adults', 'seniors']) {
      const data = await refusal(
        s.alice.mutation(api.trainingRegistrations.register, args(s, key, { ageConfirmed: false })),
      );
      expect(data).toEqual({
        code: 'ageNotConfirmed',
        field: 'ageConfirmed',
        message: 'Confirm your age to continue.',
      });
    }
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('needs no age box and stores no confirmation when the program has no ages', async () => {
    const s = await setup();
    await s.alice.mutation(
      api.trainingRegistrations.register,
      args(s, 'open', { ageConfirmed: false }),
    );
    const { registrations } = await rows(s);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).not.toHaveProperty('ageConfirmedAt');
  });

  test('gives exactly one of two registrations racing for the last places', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'lastPlace')),
      s.bob.mutation(api.trainingRegistrations.register, args(s, 'lastPlace')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCounts(s, 'lastPlace')).toEqual([1, 1, 1]);
  });

  test('gives exactly one of two registrations of the same person racing', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'open')),
      s.alice.mutation(api.trainingRegistrations.register, args(s, 'open')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await registeredCounts(s, 'open')).toEqual([1, 1, 1]);
  });
});

describe('trainingRegistrations.register for a child', () => {
  test('takes one place in every class and writes the child under the guardian with nothing else about the child', async () => {
    const s = await setup();
    const { registrationId } = await s.alice.mutation(
      api.trainingRegistrations.register,
      childArgs(s, 'youth'),
    );
    const { registrations } = await rows(s);
    expect(registrations).toEqual([
      {
        _id: registrationId,
        _creationTime: registrations[0]._creationTime,
        trainingId: s.trainings['youth'].trainingId,
        organizationId: s.organization,
        userId: s.users['alice'],
        participant: { kind: 'minor', minorName: 'Maya R.' },
        participantKey: 'minor:maya r.',
        ageConfirmedAt: NOW,
        createdAt: NOW,
      },
    ]);
    expect(Object.keys(registrations[0].participant).sort()).toEqual(['kind', 'minorName']);
    expect(await registeredCounts(s, 'youth')).toEqual([1, 1, 1]);
  });

  test('stores the name trimmed and with inner spaces collapsed, keeping its case', async () => {
    const s = await setup();
    await s.alice.mutation(
      api.trainingRegistrations.register,
      childArgs(s, 'youth', '  Maya    Rivera '),
    );
    const { registrations } = await rows(s);
    expect(registrations[0].participant).toEqual({ kind: 'minor', minorName: 'Maya Rivera' });
    expect(registrations[0].participantKey).toBe('minor:maya rivera');
  });

  test('refuses the same name again, also with another case or spacing, and writes nothing more', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'youth'));
    for (const again of ['Maya R.', 'MAYA R.', 'maya r.', ' Maya   R. ']) {
      const data = await refusal(
        s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'youth', again)),
      );
      expect(data).toEqual({
        code: 'alreadyRegistered',
        field: 'minorName',
        message: 'Maya R. is already registered for this training program.',
      });
    }
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCounts(s, 'youth')).toEqual([1, 1, 1]);
  });

  test('lets one guardian register several children and themself where the ages admit both', async () => {
    const s = await setup();
    for (const name of ['Maya R.', 'Leo R.']) {
      await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed', name));
    }
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'mixed'));
    expect(await registeredCounts(s, 'mixed')).toEqual([3, 3, 3]);
  });

  test('lets the same name register under another guardian and for another program', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'youth'));
    await s.bob.mutation(api.trainingRegistrations.register, childArgs(s, 'youth'));
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed'));
    expect(await registeredCounts(s, 'youth')).toEqual([2, 2, 2]);
    expect(await registeredCounts(s, 'mixed')).toEqual([1, 1, 1]);
  });

  test('refuses an unticked age box under the box, naming the child, and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(
        api.trainingRegistrations.register,
        childArgs(s, 'youth', 'Maya R.', { ageConfirmed: false }),
      ),
    );
    expect(data).toEqual({
      code: 'ageNotConfirmed',
      field: 'ageConfirmed',
      message: "Confirm Maya R.'s age to continue.",
    });
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('needs no age box for a child when the program has no ages', async () => {
    const s = await setup();
    await s.alice.mutation(
      api.trainingRegistrations.register,
      childArgs(s, 'open', 'Maya R.', { ageConfirmed: false }),
    );
    expect((await rows(s)).registrations).toHaveLength(1);
  });

  test('refuses a child when the minimum age is 18 or more, writing nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'adults')),
    );
    expect(data).toEqual({
      code: 'minorNotAllowed',
      message: TRAINING_REGISTRATION_MESSAGES.minorNotAllowed(18),
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCounts(s, 'adults')).toEqual([0, 0, 0]);
  });

  test('refuses an unauthenticated caller, writing nothing', async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.trainingRegistrations.register, childArgs(s, 'youth')),
    ).rejects.toThrow('Sign in required');
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('refuses an empty, an over-long, and a hidden-character name under the name', async () => {
    const s = await setup();
    const cases = [
      ['   ', 'minorNameEmpty'],
      ['x'.repeat(61), 'minorNameTooLong'],
      ['Maya\u200bR.', 'minorNameInvisible'],
    ] as const;
    for (const [name, code] of cases) {
      const data = await refusal(
        s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'youth', name)),
      );
      expect(data).toMatchObject({ field: 'minorName', code });
      if (code === 'minorNameEmpty') expect(data.message).toBe("Enter your child's name.");
    }
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('refuses a closed, a full, and a draft series for a child, writing nothing', async () => {
    const s = await setup();
    const closed = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'pastDeadline')),
    );
    expect(closed).toMatchObject({ code: 'registrationClosed' });
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', s.trainings['youth'].classIds[0], {
        places: 1,
        registeredCount: 1,
      }),
    );
    const full = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'youth')),
    );
    expect(full).toMatchObject({ code: 'classFull' });
    const draft = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'draft')),
    );
    expect(draft).toMatchObject({ code: 'trainingNotFound' });
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('refuses a child past the most one guardian can register, under the name', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < MAX_MINORS_PER_SESSION; index++) {
        await ctx.db.insert('trainingRegistrations', {
          trainingId: s.trainings['youth'].trainingId,
          organizationId: s.organization,
          userId: s.users['alice'],
          participant: { kind: 'minor', minorName: `Child ${index}` },
          participantKey: `minor:child ${index}`,
          createdAt: NOW,
        });
      }
    });
    const data = await refusal(
      s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'youth', 'One More')),
    );
    expect(data).toMatchObject({ code: 'minorLimit', field: 'minorName' });
    await s.bob.mutation(api.trainingRegistrations.register, childArgs(s, 'youth', 'One More'));
  });

  test('gives exactly one of a child and a stranger racing for the last places', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'lastPlace')),
      s.bob.mutation(api.trainingRegistrations.register, childArgs(s, 'lastPlace', 'Sam T.')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await registeredCounts(s, 'lastPlace')).toEqual([1, 1, 1]);
  });
});

describe('trainingRegistrations.getForRegistration', () => {
  const ask = (caller: Setup['alice'] | Setup['t'], trainingSlug = 'adult-clinic') =>
    caller.query(api.trainingRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      trainingSlug,
    });

  test('answers a signed-out caller with the series, not registered', async () => {
    const s = await setup();
    expect(await ask(s.t)).toEqual({
      trainingId: s.trainings['adults'].trainingId,
      organizationName: 'Org A',
      name: 'Adult Clinic',
      minimumAge: 18,
      maximumAge: 99,
      pattern: {
        weekday: 2,
        startTime: '18:00',
        endTime: '19:00',
        firstDate: '2027-02-02',
        weeks: 3,
        registrationDeadline: '2027-02-01',
      },
      classCount: 3,
      placesLeft: 12,
      registered: false,
    });
  });

  test('leaves out an age the program has no bound for', async () => {
    const s = await setup();
    const answer = await ask(s.t, 'senior-clinic');
    expect(answer).toMatchObject({ minimumAge: 16 });
    expect(answer).not.toHaveProperty('maximumAge');
    expect(await ask(s.t, 'tuesday-serving-clinic')).not.toHaveProperty('minimumAge');
  });

  test('reports the fewest places left and the first full class', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('trainingClasses', s.trainings['adults'].classIds[1], {
        registeredCount: 9,
      });
      await ctx.db.patch('trainingClasses', s.trainings['adults'].classIds[2], {
        registeredCount: 12,
      });
    });
    const answer = await ask(s.t);
    expect(answer).toMatchObject({ placesLeft: 0, fullClassDate: '2027-02-16' });
  });

  test('counts only the classes still to attend', async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch('trainingClasses', s.trainings['adults'].classIds[0], { status: 'cancelled' }),
    );
    expect((await ask(s.t))?.classCount).toBe(2);
  });

  test('says registered to the person who holds a place and not to others', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'adults'));
    expect((await ask(s.alice))?.registered).toBe(true);
    expect((await ask(s.bob))?.registered).toBe(false);
    expect((await ask(s.t))?.registered).toBe(false);
    expect((await ask(s.bob))?.placesLeft).toBe(11);
  });

  test('does not say a guardian who registered only a child is registered themself', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed'));
    expect((await ask(s.alice, 'mixed-clinic'))?.registered).toBe(false);
  });

  test('is null for a draft, an unscheduled, an unknown, and a foreign training program', async () => {
    const s = await setup();
    expect(await ask(s.alice, 'secret-draft-clinic')).toBeNull();
    expect(await ask(s.alice, 'unscheduled-clinic')).toBeNull();
    expect(await ask(s.alice, 'no-such-clinic')).toBeNull();
    expect(
      await s.alice.query(api.trainingRegistrations.getForRegistration, {
        orgSlug: 'org-b',
        trainingSlug: 'adult-clinic',
      }),
    ).toBeNull();
    expect(
      await s.alice.query(api.trainingRegistrations.getForRegistration, {
        orgSlug: 'no-such-org',
        trainingSlug: 'adult-clinic',
      }),
    ).toBeNull();
  });

  test('returns no registrant field', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed'));
    await s.bob.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed', 'Sam T.'));
    const serialised = JSON.stringify(await ask(s.t, 'mixed-clinic'));
    expect(serialised).not.toContain('Maya');
    expect(serialised).not.toContain('Sam');
    expect(serialised).not.toContain('alice');
  });
});

describe('trainingRegistrations.listMineForTraining', () => {
  const list = (caller: Setup['alice'] | Setup['t'], trainingSlug = 'mixed-clinic') =>
    caller.query(api.trainingRegistrations.listMineForTraining, {
      orgSlug: 'org-a',
      trainingSlug,
    });

  test('lists the caller’s own registration and children, in the order registered, and no one else’s', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'mixed'));
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed', 'Zoe R.'));
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed', 'Amy R.'));
    await s.bob.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed', 'Sam T.'));
    expect(await list(s.alice)).toEqual({
      self: true,
      minorNames: ['Zoe R.', 'Amy R.'],
      classes: [],
    });
    expect(await list(s.bob)).toEqual({ self: false, minorNames: ['Sam T.'], classes: [] });
    expect(await list(s.carol)).toEqual({ self: false, minorNames: [], classes: [] });
  });

  test('is empty for a signed-out caller, an unknown program, and a draft program', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, args(s, 'mixed'));
    const none = { self: false, minorNames: [], classes: [] };
    expect(await list(s.t)).toEqual(none);
    expect(await list(s.alice, 'no-such-clinic')).toEqual(none);
    expect(await list(s.alice, 'secret-draft-clinic')).toEqual(none);
  });
});

describe('trainings.getPublicPage with registrations', () => {
  test('shows places left for each class and no registrant field', async () => {
    const s = await setup();
    await s.alice.mutation(api.trainingRegistrations.register, childArgs(s, 'mixed'));
    const page = await s.t.query(api.trainings.getPublicPage, {
      orgSlug: 'org-a',
      trainingSlug: 'mixed-clinic',
    });
    expect(page?.classes.map((row) => row.placesLeft)).toEqual([11, 11, 11]);
    const serialised = JSON.stringify(page);
    expect(serialised).not.toContain('Maya');
    expect(serialised).not.toContain('alice');
  });
});
