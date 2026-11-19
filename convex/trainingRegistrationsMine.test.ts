/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { UPCOMING_ROWS_LIMIT } from './lib/myRegistrations';
import {
  insertTrainingClassRegistration,
  insertTrainingSeriesRegistration,
} from './lib/trainingRegistrationWrites';
import {
  insertTrainingWaitlistEntry,
  promoteTrainingWaitlistEntry,
} from './lib/trainingWaitlistWrites';
import { CLASS_DATES, NOW, identity, setup, type Setup } from './trainingRegistrations.setup';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const SELF: Participant = { kind: 'self' };
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

type Who = 'alice' | 'bob' | 'carol';

async function registerSeries(s: Setup, key: string, who: Who, participant: Participant) {
  await s.t.run(async (ctx) => {
    const training = (await ctx.db.get('trainings', s.trainings[key].trainingId))!;
    const classes = await Promise.all(
      s.trainings[key].classIds.map((id) => ctx.db.get('trainingClasses', id)),
    );
    await insertTrainingSeriesRegistration(
      ctx,
      training,
      classes.map((row) => row!),
      { userId: s.users[who], participant },
    );
  });
}

async function registerClass(
  s: Setup,
  key: string,
  index: number,
  who: Who,
  participant: Participant,
) {
  await s.t.run(async (ctx) => {
    const training = (await ctx.db.get('trainings', s.trainings[key].trainingId))!;
    const row = (await ctx.db.get('trainingClasses', s.trainings[key].classIds[index]))!;
    await insertTrainingClassRegistration(ctx, training, row, {
      userId: s.users[who],
      participant,
    });
  });
}

async function wait(
  s: Setup,
  key: string,
  who: Who,
  participant: Participant,
  classIndex?: number,
): Promise<Id<'trainingWaitlistEntries'>> {
  return s.t.run(async (ctx) => {
    const training = (await ctx.db.get('trainings', s.trainings[key].trainingId))!;
    return insertTrainingWaitlistEntry(ctx, training, {
      userId: s.users[who],
      participant,
      ...(classIndex !== undefined && { classId: s.trainings[key].classIds[classIndex] }),
    });
  });
}

const mine = (caller: Pick<Setup['t'], 'query'>) =>
  caller.query(api.trainingRegistrations.listMine, {});

describe('trainingRegistrations.listMine', () => {
  test('gives a series registration its next class, hours, locations, and who attends', async () => {
    const s = await setup();
    await registerSeries(s, 'open', 'alice', MINOR('Maya R.'));
    const [row, ...rest] = await mine(s.alice);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      kind: 'series',
      status: 'registered',
      participant: { kind: 'minor', minorName: 'Maya R.' },
      organizationName: 'Org A',
      organizationSlug: 'org-a',
      trainingName: 'Tuesday Serving Clinic',
      trainingSlug: 'tuesday-serving-clinic',
      classDate: CLASS_DATES[0],
      startTime: '18:00',
      endTime: '19:00',
      locations: ['Alpha Field'],
    });
    expect(row?.position).toBeUndefined();
  });

  test('moves a series to its next class as the classes pass, and drops it after the last', async () => {
    const s = await setup();
    await registerSeries(s, 'open', 'alice', SELF);
    vi.setSystemTime(Date.UTC(2027, 1, 10, 12));
    expect(await mine(s.alice)).toMatchObject([{ classDate: CLASS_DATES[2] }]);
    vi.setSystemTime(Date.UTC(2027, 1, 16, 12));
    expect(await mine(s.alice)).toMatchObject([{ classDate: CLASS_DATES[2] }]);
    vi.setSystemTime(Date.UTC(2027, 1, 18, 12));
    expect(await mine(s.alice)).toEqual([]);
  });

  test('gives a single-class registration its class, and hides it once the class has passed', async () => {
    const s = await setup();
    await registerClass(s, 'dropIn', 1, 'alice', SELF);
    await registerClass(s, 'dropIn', 0, 'alice', MINOR('Sam R.'));
    expect(await mine(s.alice)).toMatchObject([
      { kind: 'class', classDate: CLASS_DATES[0], participant: MINOR('Sam R.') },
      { kind: 'class', classDate: CLASS_DATES[1], participant: SELF },
    ]);
    vi.setSystemTime(Date.UTC(2027, 1, 5, 12));
    expect(await mine(s.alice)).toMatchObject([{ classDate: CLASS_DATES[1] }]);
  });

  test('hides a series whose classes have all passed', async () => {
    const s = await setup();
    await registerSeries(s, 'passed', 'alice', SELF);
    expect(await mine(s.alice)).toEqual([]);
  });

  test('gives a waiting entry its position in the queue, a series entry behind every earlier one', async () => {
    const s = await setup();
    await wait(s, 'dropIn', 'bob', SELF, 2);
    await wait(s, 'dropIn', 'carol', SELF);
    await wait(s, 'dropIn', 'alice', MINOR('Maya R.'));
    await wait(s, 'dropIn', 'alice', MINOR('Sam R.'), 1);
    expect(await mine(s.alice)).toMatchObject([
      { kind: 'series', status: 'waiting', position: 3, participant: MINOR('Maya R.') },
      { kind: 'class', status: 'waiting', position: 3, classDate: CLASS_DATES[1] },
    ]);
    expect(await mine(s.carol)).toMatchObject([{ status: 'waiting', position: 2 }]);
    expect(await mine(s.bob)).toMatchObject([{ status: 'waiting', position: 1 }]);
  });

  test('shows a promoted entry once, as a registration', async () => {
    const s = await setup();
    const entryId = await wait(s, 'open', 'alice', MINOR('Maya R.'));
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.get('trainingWaitlistEntries', entryId))!;
      const training = (await ctx.db.get('trainings', entry.trainingId))!;
      const classes = await Promise.all(
        s.trainings['open'].classIds.map((id) => ctx.db.get('trainingClasses', id)),
      );
      await promoteTrainingWaitlistEntry(
        ctx,
        entry,
        training,
        classes.map((row) => row!),
        [],
      );
    });
    expect(await mine(s.alice)).toMatchObject([{ kind: 'series', status: 'registered' }]);
  });

  test('never lists another account’s registrations or waiting entries', async () => {
    const s = await setup();
    await registerSeries(s, 'open', 'bob', SELF);
    await wait(s, 'dropIn', 'carol', SELF);
    expect(await mine(s.alice)).toEqual([]);
    expect(await mine(s.bob)).toHaveLength(1);
    expect(await mine(s.carol)).toHaveLength(1);
  });

  test('leaves out a program that is still a draft, and one with no classes scheduled', async () => {
    const s = await setup();
    await registerSeries(s, 'draft', 'alice', SELF);
    await wait(s, 'draft', 'alice', MINOR('Maya R.'));
    await registerSeries(s, 'unscheduled', 'alice', SELF);
    expect(await mine(s.alice)).toEqual([]);
  });

  test('lists the soonest first across programs', async () => {
    const s = await setup();
    await registerSeries(s, 'open', 'alice', SELF);
    await registerClass(s, 'dropIn', 1, 'alice', SELF);
    await registerSeries(s, 'youth', 'alice', MINOR('Maya R.'));
    expect((await mine(s.alice)).map((row) => [row.trainingName, row.classDate])).toEqual([
      ['Tuesday Serving Clinic', CLASS_DATES[0]],
      ['Youth Clinic', CLASS_DATES[0]],
      ['Drop-in Clinic', CLASS_DATES[1]],
    ]);
  });

  test('gives an unauthenticated caller no rows', async () => {
    const s = await setup();
    await registerSeries(s, 'open', 'alice', SELF);
    await expect(mine(s.t)).resolves.toEqual([]);
  });

  test('gives a caller with no account row no rows', async () => {
    const s = await setup();
    await expect(mine(s.t.withIdentity(identity('nobody')))).resolves.toEqual([]);
  });

  test('stops at the limit, and rows of programs that are over do not use it up', async () => {
    const s = await setup();
    await registerSeries(s, 'passed', 'alice', SELF);
    for (let index = 0; index < UPCOMING_ROWS_LIMIT + 5; index++) {
      await registerSeries(s, 'open', 'alice', MINOR(`Child ${String(index).padStart(2, '0')}`));
    }
    await registerSeries(s, 'passed', 'alice', MINOR('Late R.'));
    expect(await mine(s.alice)).toHaveLength(UPCOMING_ROWS_LIMIT);
  });
});
