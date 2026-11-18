/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Participant } from './lib/individualRegistration';
import { insertMembership } from './lib/memberships';
import { setTrainingClassStatus } from './lib/tenantWrites';
import {
  insertTrainingClassRegistration,
  insertTrainingSeriesRegistration,
} from './lib/trainingRegistrationWrites';
import {
  NOW,
  identity,
  setup as baseSetup,
  type Setup as BaseSetup,
} from './trainingRegistrations.setup';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const SELF: Participant = { kind: 'self' };
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

type Role = 'orgAdmin' | 'leagueOrganizer';

async function setup() {
  const s = await baseSetup();
  betterAuthTest.register(s.t, 'betterAuth');
  const people = await s.t.run(async (ctx) => {
    const programOf = async (key: string) =>
      (await ctx.db.get('trainings', s.trainings[key].trainingId))!.programId;
    const dropIn = await programOf('dropIn');
    const open = await programOf('open');
    const person = async (
      authUserId: string,
      name: string,
      membership: {
        organizationId: Id<'organizations'>;
        role: Role;
        programIds?: Id<'programs'>[];
      } | null,
    ) => {
      const now = Date.now();
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name,
            email: `${authUserId}@example.test`,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      } as never)) as { _id: string };
      const userId = await ctx.db.insert('users', {
        authUserId: account._id,
        name,
        adultConfirmedAt: 1,
      });
      if (membership) {
        await insertMembership(
          ctx,
          userId,
          membership.organizationId,
          membership.role,
          [],
          membership.programIds,
        );
      }
      return { authUserId: account._id, userId };
    };
    return {
      otherAdmin: await person('admin-b', 'Bo Admin', {
        organizationId: s.otherOrganization,
        role: 'orgAdmin',
      }),
      assigned: await person('assigned', 'Olive Organizer', {
        organizationId: s.organization,
        role: 'leagueOrganizer',
        programIds: [dropIn],
      }),
      unassigned: await person('unassigned', 'Uma Organizer', {
        organizationId: s.organization,
        role: 'leagueOrganizer',
        programIds: [open],
      }),
      leagueOnly: await person('league-only', 'Lee Organizer', {
        organizationId: s.organization,
        role: 'leagueOrganizer',
      }),
      guardian: await person('guardian', 'Gail Guardian', null),
      adult: await person('player', 'Pat Player', null),
      zed: await person('zed', 'Zed Zimmer', null),
    };
  });
  const as = (who: { authUserId: string }) => s.t.withIdentity(identity(who.authUserId));
  return {
    ...s,
    ...people,
    asOtherAdmin: as(people.otherAdmin),
    asAssigned: as(people.assigned),
    asUnassigned: as(people.unassigned),
    asLeagueOnly: as(people.leagueOnly),
    asPlayer: as(people.guardian),
    signedOut: s.t,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const classOf = (s: BaseSetup, key: string, index: number) => s.trainings[key].classIds[index];

const listFor = (caller: Setup['admin'], trainingClassId: Id<'trainingClasses'>) =>
  caller.query(api.trainingRegistrations.listForClass, { trainingClassId });

async function registerSeries(
  s: Setup,
  key: string,
  userId: Id<'users'>,
  participant: Participant,
  at = NOW,
) {
  await s.t.run(async (ctx) => {
    const training = (await ctx.db.get('trainings', s.trainings[key].trainingId))!;
    const classes = await Promise.all(
      s.trainings[key].classIds.map((id) => ctx.db.get('trainingClasses', id)),
    );
    const id = await insertTrainingSeriesRegistration(
      ctx,
      training,
      classes.map((row) => row!),
      { userId, participant },
    );
    await ctx.db.patch('trainingRegistrations', id, { createdAt: at });
  });
}

async function registerClass(
  s: Setup,
  key: string,
  index: number,
  userId: Id<'users'>,
  participant: Participant,
  at = NOW,
) {
  await s.t.run(async (ctx) => {
    const training = (await ctx.db.get('trainings', s.trainings[key].trainingId))!;
    const trainingClass = (await ctx.db.get('trainingClasses', classOf(s, key, index)))!;
    const id = await insertTrainingClassRegistration(ctx, training, trainingClass, {
      userId,
      participant,
    });
    await ctx.db.patch('trainingRegistrations', id, { createdAt: at });
  });
}

describe('trainingRegistrations.listForClass', () => {
  test('lists series and single-class registrants of the class, each marked, a minor with the guardian’s name and email', async () => {
    const s = await setup();
    await registerSeries(s, 'dropIn', s.adult.userId, SELF);
    await registerClass(s, 'dropIn', 0, s.guardian.userId, MINOR('Maya R.'));
    const rows = await listFor(s.admin, classOf(s, 'dropIn', 0));
    expect(rows.map(({ name, kind, guardian }) => ({ name, kind, guardian }))).toEqual([
      {
        name: 'Maya R.',
        kind: 'class',
        guardian: { name: 'Gail Guardian', email: 'guardian@example.test' },
      },
      { name: 'Pat Player', kind: 'series', guardian: undefined },
    ]);
    expect(Object.keys(rows[1]).sort()).toEqual(['kind', 'name', 'registeredAt', 'registrationId']);
  });

  test('lists a series registrant in every class, and a single-class registrant in its own class only', async () => {
    const s = await setup();
    await registerSeries(s, 'dropIn', s.adult.userId, SELF);
    await registerClass(s, 'dropIn', 1, s.zed.userId, SELF);
    const names = async (index: number) =>
      (await listFor(s.admin, classOf(s, 'dropIn', index))).map((row) => row.name);
    expect(await names(0)).toEqual(['Pat Player']);
    expect(await names(1)).toEqual(['Pat Player', 'Zed Zimmer']);
    expect(await names(2)).toEqual(['Pat Player']);
  });

  test('leaves out the registrants of another training program', async () => {
    const s = await setup();
    await registerSeries(s, 'dropIn', s.adult.userId, SELF);
    await registerSeries(s, 'open', s.zed.userId, SELF);
    const rows = await listFor(s.admin, classOf(s, 'dropIn', 0));
    expect(rows.map((row) => row.name)).toEqual(['Pat Player']);
  });

  test('sorts by name regardless of case, kind, and of when each registered', async () => {
    const s = await setup();
    await registerSeries(s, 'dropIn', s.zed.userId, SELF, NOW - 3000);
    await registerClass(s, 'dropIn', 0, s.guardian.userId, MINOR('maya R.'), NOW - 2000);
    await registerSeries(s, 'dropIn', s.adult.userId, SELF, NOW - 1000);
    await registerClass(s, 'dropIn', 0, s.guardian.userId, MINOR('Leo R.'), NOW - 500);
    const rows = await listFor(s.admin, classOf(s, 'dropIn', 0));
    expect(rows.map((row) => row.name)).toEqual(['Leo R.', 'maya R.', 'Pat Player', 'Zed Zimmer']);
  });

  test('gives the time each registration was made', async () => {
    const s = await setup();
    await registerSeries(s, 'dropIn', s.adult.userId, SELF, NOW - 86_400_000);
    const [row] = await listFor(s.admin, classOf(s, 'dropIn', 0));
    expect(row?.registeredAt).toBe(NOW - 86_400_000);
  });

  test('is empty for a class no one registered for', async () => {
    const s = await setup();
    await expect(listFor(s.admin, classOf(s, 'dropIn', 0))).resolves.toEqual([]);
  });

  test('is empty for a cancelled class, whose registrants hold no place in it', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const row = (await ctx.db.get('trainingClasses', classOf(s, 'dropIn', 0)))!;
      await setTrainingClassStatus(ctx, row, 'cancelled');
    });
    await registerSeries(s, 'dropIn', s.adult.userId, SELF);
    await expect(listFor(s.admin, classOf(s, 'dropIn', 0))).resolves.toEqual([]);
    expect(await listFor(s.admin, classOf(s, 'dropIn', 1))).toHaveLength(1);
  });

  test('lists an organizer assigned to the training program, and an org admin', async () => {
    const s = await setup();
    await registerClass(s, 'dropIn', 0, s.guardian.userId, MINOR('Maya R.'));
    for (const caller of [s.asAssigned, s.admin]) {
      const rows = await listFor(caller, classOf(s, 'dropIn', 0));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Maya R.', guardian: { name: 'Gail Guardian' } });
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
    await registerClass(s, 'dropIn', 0, s.guardian.userId, MINOR('Maya R.'));
    await expect(listFor(caller(s), classOf(s, 'dropIn', 0))).rejects.toThrow(
      /Sign in required|Not allowed/,
    );
  });

  test('refuses a class that was deleted, as it does another organization’s', async () => {
    const s = await setup();
    const gone = classOf(s, 'dropIn', 0);
    await s.t.run((ctx) => ctx.db.delete('trainingClasses', gone));
    await expect(listFor(s.admin, gone)).rejects.toThrow(/Not allowed/);
  });

  test('sends neither a user id nor the participant key', async () => {
    const s = await setup();
    await registerClass(s, 'dropIn', 0, s.guardian.userId, MINOR('Maya R.'));
    await registerSeries(s, 'dropIn', s.adult.userId, SELF);
    const text = JSON.stringify(await listFor(s.admin, classOf(s, 'dropIn', 0)));
    for (const secret of [s.guardian.userId, s.guardian.authUserId, s.adult.userId, 'class:']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('participantKey');
  });

  test('reads no more rows than the class has places, series first', async () => {
    const s = await setup();
    const trainingClass = classOf(s, 'dropIn', 0);
    await s.t.run((ctx) => ctx.db.patch('trainingClasses', trainingClass, { places: 3 }));
    await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', s.trainings['dropIn'].trainingId))!;
      const key = (kind: string, name: string) =>
        kind === 'series' ? `minor:${name}` : `class:${trainingClass}:minor:${name}`;
      for (const [kind, name] of [
        ['series', 'a'],
        ['series', 'b'],
        ['series', 'c'],
        ['class', 'd'],
        ['class', 'e'],
      ] as const) {
        await ctx.db.insert('trainingRegistrations', {
          trainingId: training._id,
          ...(kind === 'class' && { classId: trainingClass }),
          organizationId: training.organizationId,
          userId: s.guardian.userId,
          participant: MINOR(name.toUpperCase()),
          participantKey: key(kind, name),
          createdAt: NOW,
        });
      }
    });
    const rows = await listFor(s.admin, trainingClass);
    expect(rows.map((row) => row.name)).toEqual(['A', 'B', 'C']);
  });

  test('shows the guardian’s name alone when the sign-in account holding the email is gone', async () => {
    const s = await setup();
    await registerClass(s, 'dropIn', 0, s.guardian.userId, MINOR('Maya R.'));
    await s.t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: 'user', where: [{ field: '_id', value: s.guardian.authUserId }] },
      } as never);
    });
    const rows = await listFor(s.admin, classOf(s, 'dropIn', 0));
    expect(rows.map(({ name, guardian }) => ({ name, guardian }))).toEqual([
      { name: 'Maya R.', guardian: { name: 'Gail Guardian', email: '' } },
    ]);
  });

  test('names a registrant whose account is gone, with no guardian line', async () => {
    const s = await setup();
    await registerSeries(s, 'dropIn', s.adult.userId, SELF);
    await s.t.run((ctx) => ctx.db.delete('users', s.adult.userId));
    const rows = await listFor(s.admin, classOf(s, 'dropIn', 0));
    expect(rows.map(({ name, guardian }) => ({ name, guardian }))).toEqual([
      { name: 'Removed account', guardian: undefined },
    ]);
  });
});
