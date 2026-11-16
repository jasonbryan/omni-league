/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertCampRegistration } from './lib/campRegistrationWrites';
import { CAMP_WAITLIST_MESSAGES } from './lib/campWaitlist';
import { MAX_MINORS_PER_SESSION, type Participant } from './lib/individualRegistration';
import { insertCampSession, insertDraftCamp, insertTenant, publishCamp } from './lib/tenantWrites';
import { deleteUserRecord } from './lib/users';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.parse('2027-06-01T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const WEEK = {
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  places: 12,
  registrationDeadline: '2027-06-28',
};

const SELF: Participant = { kind: 'self' };
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

type Role = 'orgAdmin' | 'leagueOrganizer';

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const alpha = (await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', organizationA).eq('name', 'Alpha Field'),
      )
      .unique())!._id;
    const camp = async (
      name: string,
      slug: string,
      ages: { minimumAge: number; maximumAge: number },
      sessions: { name: string; values?: Partial<typeof WEEK> }[],
      publish = true,
    ) => {
      const campId = await insertDraftCamp(ctx, organizationA, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [alpha],
        ...ages,
      });
      const row = (await ctx.db.get('camps', campId))!;
      const sessionIds: Record<string, Id<'campSessions'>> = {};
      for (const session of sessions) {
        sessionIds[session.name] = await insertCampSession(ctx, row, {
          name: session.name,
          ...WEEK,
          ...session.values,
        });
      }
      if (publish) await publishCamp(ctx, (await ctx.db.get('camps', campId))!);
      return { campId, programId: row.programId, sessions: sessionIds };
    };
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
        await ctx.db.insert('memberships', {
          userId,
          organizationId: membership.organizationId,
          role: membership.role,
          leagueIds: [],
          ...(membership.programIds && { programIds: membership.programIds }),
        });
      }
      return { authUserId: account._id, userId };
    };
    const junior = await camp(
      'Junior Beach Volleyball Camp',
      'junior-beach-volleyball-camp',
      { minimumAge: 9, maximumAge: 99 },
      [
        { name: 'Week 1' },
        { name: 'Full', values: { places: 1 } },
        { name: 'Closed', values: { places: 1, registrationDeadline: '2027-05-30' } },
      ],
    );
    const fall = await camp(
      'Fall Break Camp',
      'fall-break-camp',
      { minimumAge: 9, maximumAge: 14 },
      [{ name: 'Week 1' }],
    );
    const adult = await camp(
      'Adult Beach Skills Camp',
      'adult-beach-skills-camp',
      { minimumAge: 18, maximumAge: 99 },
      [{ name: 'Full', values: { places: 1 } }],
    );
    const youth = await camp('Youth Camp', 'youth-camp', { minimumAge: 9, maximumAge: 14 }, [
      { name: 'Full', values: { places: 1 } },
    ]);
    const draft = await camp(
      'Secret Camp',
      'secret-camp',
      { minimumAge: 9, maximumAge: 14 },
      [{ name: 'Full', values: { places: 1 } }],
      false,
    );
    return {
      junior,
      fall,
      adult,
      youth,
      draft,
      organizationA,
      adminA: await person('admin-a', 'Ada Admin', {
        organizationId: organizationA,
        role: 'orgAdmin',
      }),
      adminB: await person('admin-b', 'Bo Admin', {
        organizationId: organizationB,
        role: 'orgAdmin',
      }),
      assigned: await person('assigned', 'Olive Organizer', {
        organizationId: organizationA,
        role: 'leagueOrganizer',
        programIds: [junior.programId],
      }),
      unassigned: await person('unassigned', 'Uma Organizer', {
        organizationId: organizationA,
        role: 'leagueOrganizer',
        programIds: [fall.programId],
      }),
      guardian: await person('guardian', 'Gail Guardian', null),
      holder: await person('holder', 'Hal Holder', null),
      pat: await person('pat', 'Pat Player', null),
      zed: await person('zed', 'Zed Zimmer', null),
    };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return {
    t,
    ...ids,
    asAdmin: as(ids.adminA),
    asOtherAdmin: as(ids.adminB),
    asAssigned: as(ids.assigned),
    asUnassigned: as(ids.unassigned),
    asGuardian: as(ids.guardian),
    asPat: as(ids.pat),
    asZed: as(ids.zed),
    signedOut: t,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function withFullSession(s: Setup) {
  await s.t.run(async (ctx) => {
    const session = (await ctx.db.get('campSessions', s.junior.sessions['Full']))!;
    await insertCampRegistration(ctx, session, { userId: s.holder.userId, participant: SELF });
  });
  return s.junior.sessions['Full'];
}

const join = (
  caller: Setup['asGuardian'],
  sessionId: Id<'campSessions'>,
  participant: Participant,
  ageConfirmed = true,
) => caller.mutation(api.campWaitlist.join, { sessionId, participant, ageConfirmed });

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toHaveProperty('data');
  return (error as { data: { code: string; message: string; field?: string } }).data;
}

const rowsOf = (s: Setup) =>
  s.t.run(async (ctx) => ({
    entries: await ctx.db.query('campWaitlistEntries').collect(),
    registrations: await ctx.db.query('campRegistrations').collect(),
    sessions: await ctx.db.query('campSessions').collect(),
  }));

const sessionOf = (s: Setup, id: Id<'campSessions'>) =>
  s.t.run(async (ctx) => (await ctx.db.get('campSessions', id))!);

async function expectNothingWritten(s: Setup, call: () => Promise<unknown>) {
  const before = await rowsOf(s);
  await call().catch(() => undefined);
  expect(await rowsOf(s)).toEqual(before);
}

const tick = (ms = 1000) => vi.setSystemTime(Date.now() + ms);

describe('campWaitlist.join', () => {
  test('joins a full session without taking a place, at position 1', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    const { position } = await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    expect(position).toBe(1);
    const { entries, sessions } = await rowsOf(s);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionId,
      campId: s.junior.campId,
      organizationId: s.organizationA,
      userId: s.guardian.userId,
      participant: MINOR('Maya R.'),
      participantKey: 'minor:maya r.',
      status: 'waiting',
    });
    expect(entries[0]?.requestedAt).toBeGreaterThanOrEqual(NOW);
    expect(entries[0]?.ageConfirmedAt).toBe(entries[0]?.requestedAt);
    expect(entries[0]?.registrationId).toBeUndefined();
    expect(sessions.find((row) => row._id === sessionId)).toMatchObject({
      registeredCount: 1,
      waitlistCount: 1,
    });
    expect(await rowsOf(s).then((rows) => rows.registrations)).toHaveLength(1);
  });

  test('numbers the entries in the order they joined, across guardians', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    expect((await join(s.asGuardian, sessionId, MINOR('Maya R.'))).position).toBe(1);
    tick();
    expect((await join(s.asPat, sessionId, SELF)).position).toBe(1 + 1);
    tick();
    expect((await join(s.asGuardian, sessionId, MINOR('Leo R.'))).position).toBe(3);
  });

  test('two guardians may wait with the same child name', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await expect(join(s.asZed, sessionId, MINOR('Maya R.'))).resolves.toMatchObject({
      position: 2,
    });
  });

  test('joins when waiting entries make a session with a free place count as full', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 2,
    });
    await expect(join(s.asPat, sessionId, SELF)).resolves.toMatchObject({ position: 2 });
  });

  test('refuses the same participant twice, under the child’s name, and writes nothing', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await expectNothingWritten(s, async () => {
      const data = await refusal(join(s.asGuardian, sessionId, MINOR('  maya   r. ')));
      expect(data).toMatchObject({
        code: 'alreadyWaiting',
        field: 'minorName',
        message: CAMP_WAITLIST_MESSAGES.alreadyWaiting(MINOR('Maya R.')),
      });
    });
    await join(s.asPat, sessionId, SELF);
    const data = await refusal(join(s.asPat, sessionId, SELF));
    expect(data).toMatchObject({ code: 'alreadyWaiting' });
    expect(data.field).toBeUndefined();
    expect((await rowsOf(s)).entries).toHaveLength(2);
    expect((await sessionOf(s, sessionId)).waitlistCount).toBe(2);
  });

  test('refuses a participant who already holds a place in the session', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await expectNothingWritten(s, async () => {
      const data = await refusal(
        join(s.t.withIdentity(identity(s.holder.authUserId)), sessionId, SELF),
      );
      expect(data.code).toBe('alreadyRegistered');
    });
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', sessionId))!;
      await insertCampRegistration(ctx, session, {
        userId: s.guardian.userId,
        participant: MINOR('Maya R.'),
      });
    });
    await expect(refusal(join(s.asGuardian, sessionId, MINOR('Maya R.')))).resolves.toMatchObject({
      code: 'alreadyRegistered',
      field: 'minorName',
    });
  });

  test('refuses a participant without the age box, and names the child', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await expectNothingWritten(s, async () => {
      const data = await refusal(join(s.asGuardian, sessionId, MINOR('Maya R.'), false));
      expect(data).toMatchObject({ code: 'ageNotConfirmed', field: 'ageConfirmed' });
      expect(data.message).toContain('Maya R.');
    });
    await expect(refusal(join(s.asPat, sessionId, SELF, false))).resolves.toMatchObject({
      code: 'ageNotConfirmed',
    });
  });

  test('refuses once the registration deadline has passed', async () => {
    const s = await setup();
    const sessionId = s.junior.sessions['Closed'];
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', sessionId))!;
      await insertCampRegistration(ctx, session, { userId: s.holder.userId, participant: SELF });
    });
    await expectNothingWritten(s, async () => {
      expect((await refusal(join(s.asGuardian, sessionId, MINOR('Maya R.')))).code).toBe(
        'registrationClosed',
      );
    });
  });

  test('refuses an unauthenticated caller', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await expectNothingWritten(s, async () => {
      await expect(
        s.signedOut.mutation(api.campWaitlist.join, {
          sessionId,
          participant: SELF,
          ageConfirmed: true,
        }),
      ).rejects.toThrow(/Sign in required/);
    });
  });

  test('refuses a session that still has a free place and no one waiting', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      const data = await refusal(join(s.asGuardian, s.junior.sessions['Week 1'], SELF));
      expect(data).toMatchObject({
        code: 'sessionHasPlace',
        message: CAMP_WAITLIST_MESSAGES.sessionHasPlace,
      });
    });
  });

  test('refuses a draft camp’s session like an unknown one', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', s.draft.sessions['Full']))!;
      await insertCampRegistration(ctx, session, { userId: s.holder.userId, participant: SELF });
    });
    await expectNothingWritten(s, async () => {
      expect((await refusal(join(s.asGuardian, s.draft.sessions['Full'], SELF))).code).toBe(
        'campNotFound',
      );
    });
  });

  test('applies the camp’s age rules to who may wait', async () => {
    const s = await setup();
    for (const sessionId of [s.adult.sessions['Full'], s.youth.sessions['Full']]) {
      await s.t.run(async (ctx) => {
        const session = (await ctx.db.get('campSessions', sessionId))!;
        await insertCampRegistration(ctx, session, { userId: s.holder.userId, participant: SELF });
      });
    }
    expect(
      (await refusal(join(s.asGuardian, s.adult.sessions['Full'], MINOR('Maya R.')))).code,
    ).toBe('minorNotAllowed');
    expect((await refusal(join(s.asPat, s.youth.sessions['Full'], SELF))).code).toBe(
      'adultNotAllowed',
    );
  });

  test('counts a guardian’s waiting children toward the most one guardian may bring', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', sessionId))!;
      for (let i = 0; i < MAX_MINORS_PER_SESSION; i++) {
        await ctx.db.insert('campWaitlistEntries', {
          sessionId,
          campId: session.campId,
          organizationId: session.organizationId,
          userId: s.guardian.userId,
          participant: MINOR(`Child ${i}`),
          participantKey: `minor:child ${i}`,
          status: 'waiting',
          requestedAt: NOW + i,
        });
      }
      await ctx.db.patch('campSessions', sessionId, { waitlistCount: MAX_MINORS_PER_SESSION });
    });
    await expect(refusal(join(s.asGuardian, sessionId, MINOR('One more')))).resolves.toMatchObject({
      code: 'minorLimit',
      field: 'minorName',
    });
  });
});

describe('a session with a waiting entry counts as full', () => {
  test('refuses a new registration after the places are raised, and promotes the first entry', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    tick();
    await join(s.asZed, sessionId, SELF);
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 2,
    });

    await expectNothingWritten(s, async () => {
      const data = await refusal(
        s.asPat.mutation(api.campRegistrations.register, {
          sessionId,
          participant: SELF,
          ageConfirmed: true,
        }),
      );
      expect(data.code).toBe('sessionFull');
    });

    const [first, second] = (await rowsOf(s)).entries;
    expect(first?.participant).toEqual(MINOR('Maya R.'));
    const { registrationId } = await s.asAdmin.mutation(api.campWaitlist.promote, {
      campWaitlistEntryId: first._id,
    });

    const after = await rowsOf(s);
    const registration = after.registrations.find((row) => row._id === registrationId);
    expect(registration).toMatchObject({
      sessionId,
      campId: s.junior.campId,
      organizationId: s.organizationA,
      userId: s.guardian.userId,
      participant: MINOR('Maya R.'),
      participantKey: 'minor:maya r.',
      ageConfirmedAt: first.ageConfirmedAt,
    });
    expect(after.entries.find((row) => row._id === first._id)).toMatchObject({
      status: 'promoted',
      registrationId,
    });
    expect(after.entries.find((row) => row._id === first._id)?.promotedAt).toBeGreaterThanOrEqual(
      NOW,
    );
    expect(after.entries.find((row) => row._id === second._id)?.status).toBe('waiting');
    expect(after.sessions.find((row) => row._id === sessionId)).toMatchObject({
      registeredCount: 2,
      waitlistCount: 1,
    });
  });

  test('takes registrations again once no one waits and a place is free', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 3,
    });
    const [entry] = (await rowsOf(s)).entries;
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: entry._id });
    await expect(
      s.asPat.mutation(api.campRegistrations.register, {
        sessionId,
        participant: SELF,
        ageConfirmed: true,
      }),
    ).resolves.toHaveProperty('registrationId');
  });

  test('reads 0 places left on every public read while someone waits', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 5,
    });
    const slugs = { orgSlug: 'org-a', campSlug: 'junior-beach-volleyball-camp' };
    const page = await s.signedOut.query(api.camps.getPublicPage, slugs);
    expect(page?.sessions.find((row) => row.sessionId === sessionId)?.placesLeft).toBe(0);
    const registration = await s.asPat.query(api.campRegistrations.getForRegistration, {
      ...slugs,
      sessionId,
    });
    expect(registration?.session?.placesLeft).toBe(0);
    const list = await s.signedOut.query(api.camps.listPublic, {
      organizationSlug: 'org-a',
      page: 1,
    });
    const junior = list.rows.find((row) => row.slug === 'junior-beach-volleyball-camp');
    expect(junior?.sessions.find((row) => row.name === 'Full')?.placesLeft).toBe(0);
    const open = await s.signedOut.query(api.camps.listOpenForOrganization, {
      organizationSlug: 'org-a',
    });
    expect(
      open.some(
        (card) => card.slug === 'junior-beach-volleyball-camp' && card.sessionName === 'Full',
      ),
    ).toBe(false);
  });
});

describe('campWaitlist.promote', () => {
  async function waiting(s: Setup) {
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    tick();
    await join(s.asZed, sessionId, SELF);
    const entries = (await rowsOf(s)).entries;
    return { sessionId, first: entries[0]._id, second: entries[1]._id };
  }

  async function raise(s: Setup, sessionId: Id<'campSessions'>, places = 2) {
    await s.asAdmin.mutation(api.campSessions.updatePlaces, { campSessionId: sessionId, places });
  }

  test.each([
    ['an org admin', (s: Setup) => s.asAdmin],
    ['an organizer assigned to the camp', (s: Setup) => s.asAssigned],
  ])('lets %s promote the first entry', async (_, caller) => {
    const s = await setup();
    const { sessionId, first } = await waiting(s);
    await raise(s, sessionId);
    await expect(
      caller(s).mutation(api.campWaitlist.promote, { campWaitlistEntryId: first }),
    ).resolves.toHaveProperty('registrationId');
  });

  test.each([
    ['an unauthenticated caller', (s: Setup) => s.signedOut],
    ['an org admin of another organization', (s: Setup) => s.asOtherAdmin],
    ['a player', (s: Setup) => s.asPat],
    ['the person waiting', (s: Setup) => s.asGuardian],
    ['a league organizer not assigned to the camp', (s: Setup) => s.asUnassigned],
  ])('refuses %s and writes nothing', async (_, caller) => {
    const s = await setup();
    const { sessionId, first } = await waiting(s);
    await raise(s, sessionId);
    await expectNothingWritten(s, async () => {
      await expect(
        caller(s).mutation(api.campWaitlist.promote, { campWaitlistEntryId: first }),
      ).rejects.toThrow(/Sign in required|Not allowed/);
    });
    expect((await rowsOf(s)).entries[0]?.status).toBe('waiting');
  });

  test('refuses an entry that was deleted, as it does another organization’s', async () => {
    const s = await setup();
    const { sessionId, first } = await waiting(s);
    await raise(s, sessionId);
    await s.t.run((ctx) => ctx.db.delete('campWaitlistEntries', first));
    await expect(
      s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first }),
    ).rejects.toThrow(/Not allowed/);
  });

  test('refuses when no place is free, and writes nothing', async () => {
    const s = await setup();
    const { first } = await waiting(s);
    await expectNothingWritten(s, async () => {
      const data = await refusal(
        s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first }),
      );
      expect(data).toMatchObject({
        code: 'noFreePlace',
        message: CAMP_WAITLIST_MESSAGES.noFreePlace,
      });
    });
  });

  test('refuses an entry that is not the first waiting one', async () => {
    const s = await setup();
    const { sessionId, second } = await waiting(s);
    await raise(s, sessionId, 3);
    await expectNothingWritten(s, async () => {
      expect(
        (
          await refusal(
            s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: second }),
          )
        ).code,
      ).toBe('notNext');
    });
  });

  test('refuses an entry that was already promoted, and takes no second place', async () => {
    const s = await setup();
    const { sessionId, first } = await waiting(s);
    await raise(s, sessionId, 3);
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first });
    await expectNothingWritten(s, async () => {
      expect(
        (
          await refusal(
            s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first }),
          )
        ).code,
      ).toBe('notWaiting');
    });
    expect((await sessionOf(s, sessionId)).registeredCount).toBe(2);
  });

  test('promotes the next entry once the first has its place', async () => {
    const s = await setup();
    const { sessionId, first, second } = await waiting(s);
    await raise(s, sessionId, 3);
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first });
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: second });
    const after = await rowsOf(s);
    expect(after.entries.map((row) => row.status)).toEqual(['promoted', 'promoted']);
    expect(after.registrations.filter((row) => row.sessionId === sessionId)).toHaveLength(3);
    expect(await sessionOf(s, sessionId)).toMatchObject({ registeredCount: 3, waitlistCount: 0 });
  });

  test('ignores the registration deadline, as an organizer’s action', async () => {
    const s = await setup();
    const { sessionId, first } = await waiting(s);
    await raise(s, sessionId);
    await s.t.run((ctx) =>
      ctx.db.patch('campSessions', sessionId, { registrationDeadline: '2027-05-01' }),
    );
    await expect(
      s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first }),
    ).resolves.toHaveProperty('registrationId');
  });
});

describe('campWaitlist.listForSession', () => {
  test('lists the waiting entries oldest first, a child with the guardian’s name and email', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    tick();
    await join(s.asZed, sessionId, SELF);
    const rows = await s.asAdmin.query(api.campWaitlist.listForSession, { sessionId });
    expect(rows.map(({ name, guardian }) => ({ name, guardian }))).toEqual([
      { name: 'Maya R.', guardian: { name: 'Gail Guardian', email: 'guardian@example.test' } },
      { name: 'Zed Zimmer', guardian: undefined },
    ]);
    expect(rows[0]?.requestedAt).toBeGreaterThanOrEqual(NOW);
    expect(Object.keys(rows[1]).sort()).toEqual(['campWaitlistEntryId', 'name', 'requestedAt']);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(s.guardian.userId);
    expect(text).not.toContain('participantKey');
  });

  test('is empty when no one waits, and leaves out promoted entries', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await expect(s.asAdmin.query(api.campWaitlist.listForSession, { sessionId })).resolves.toEqual(
      [],
    );
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 2,
    });
    const [entry] = (await rowsOf(s)).entries;
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: entry._id });
    await expect(s.asAdmin.query(api.campWaitlist.listForSession, { sessionId })).resolves.toEqual(
      [],
    );
  });

  test('lists for an organizer assigned to the camp', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await expect(
      s.asAssigned.query(api.campWaitlist.listForSession, { sessionId }),
    ).resolves.toHaveLength(1);
  });

  test.each([
    ['an unauthenticated caller', (s: Setup) => s.signedOut],
    ['an org admin of another organization', (s: Setup) => s.asOtherAdmin],
    ['a league organizer assigned to another camp', (s: Setup) => s.asUnassigned],
    ['a player', (s: Setup) => s.asPat],
    ['the guardian of a waiting child', (s: Setup) => s.asGuardian],
  ])('refuses %s and returns no name', async (_, caller) => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await expect(caller(s).query(api.campWaitlist.listForSession, { sessionId })).rejects.toThrow(
      /Sign in required|Not allowed/,
    );
  });
});

describe('campWaitlist.listMineForCamp', () => {
  const slugs = { orgSlug: 'org-a', campSlug: 'junior-beach-volleyball-camp' };

  test('gives the caller’s own waiting entries with their positions', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asZed, sessionId, SELF);
    tick();
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    tick();
    await join(s.asGuardian, sessionId, MINOR('Leo R.'));
    await expect(s.asGuardian.query(api.campWaitlist.listMineForCamp, slugs)).resolves.toEqual([
      { sessionId, participant: MINOR('Maya R.'), position: 2 },
      { sessionId, participant: MINOR('Leo R.'), position: 3 },
    ]);
    await expect(s.asZed.query(api.campWaitlist.listMineForCamp, slugs)).resolves.toEqual([
      { sessionId, participant: SELF, position: 1 },
    ]);
  });

  test('gives nothing to another account, a signed-out caller, or for a draft camp', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await expect(s.asPat.query(api.campWaitlist.listMineForCamp, slugs)).resolves.toEqual([]);
    await expect(s.signedOut.query(api.campWaitlist.listMineForCamp, slugs)).resolves.toEqual([]);
    await expect(
      s.asGuardian.query(api.campWaitlist.listMineForCamp, {
        orgSlug: 'org-a',
        campSlug: 'secret-camp',
      }),
    ).resolves.toEqual([]);
  });

  test('moves a position up when an earlier entry is promoted, and drops a promoted entry', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asZed, sessionId, SELF);
    tick();
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 2,
    });
    const [zed] = (await rowsOf(s)).entries;
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: zed._id });
    await expect(s.asZed.query(api.campWaitlist.listMineForCamp, slugs)).resolves.toEqual([]);
    await expect(s.asGuardian.query(api.campWaitlist.listMineForCamp, slugs)).resolves.toEqual([
      { sessionId, participant: MINOR('Maya R.'), position: 1 },
    ]);
  });
});

describe('campRegistrations.getForRegistration', () => {
  test('says whether the caller themself is waiting, and keeps the fields it had', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    const ask = (caller: Setup['asPat']) =>
      caller.query(api.campRegistrations.getForRegistration, {
        orgSlug: 'org-a',
        campSlug: 'adult-beach-skills-camp',
        sessionId: s.adult.sessions['Full'],
      });
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', s.adult.sessions['Full']))!;
      await insertCampRegistration(ctx, session, { userId: s.holder.userId, participant: SELF });
    });
    expect((await ask(s.asPat))?.waitlisted).toBe(false);
    await s.asPat.mutation(api.campWaitlist.join, {
      sessionId: s.adult.sessions['Full'],
      participant: SELF,
      ageConfirmed: true,
    });
    const answer = await ask(s.asPat);
    expect(answer).toMatchObject({ waitlisted: true, registered: false });
    expect(answer?.session).toMatchObject({ placesLeft: 0 });
    expect((await ask(s.asZed))?.waitlisted).toBe(false);
    expect(sessionId).toBeDefined();
  });
});

describe('campSessions', () => {
  test('lists the number of people waiting beside the registered count', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    const rows = await s.asAdmin.query(api.campSessions.listForCamp, { campId: s.junior.campId });
    expect(rows.find((row) => row.campSessionId === sessionId)).toMatchObject({
      registeredCount: 1,
      waitlistCount: 1,
    });
    expect(rows.find((row) => row.name === 'Week 1')?.waitlistCount).toBe(0);
  });

  test('refuses to delete a session while someone waits', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.t.run((ctx) => ctx.db.patch('campSessions', sessionId, { registeredCount: 0 }));
    await expect(
      s.asAdmin.mutation(api.campSessions.remove, { campSessionId: sessionId }),
    ).rejects.toMatchObject({ data: { code: 'hasWaitlist' } });
  });
});

describe('writes that arrive together', () => {
  async function consistent(s: Setup, sessionId: Id<'campSessions'>) {
    const { entries, registrations, sessions } = await rowsOf(s);
    const session = sessions.find((row) => row._id === sessionId)!;
    expect(session.waitlistCount ?? 0).toBe(
      entries.filter((row) => row.sessionId === sessionId && row.status === 'waiting').length,
    );
    expect(session.registeredCount).toBe(
      registrations.filter((row) => row.sessionId === sessionId).length,
    );
    expect(session.registeredCount).toBeLessThanOrEqual(session.places);
  }

  test('two joins at once take positions 1 and 2', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    const answers = await Promise.all([
      join(s.asGuardian, sessionId, MINOR('Maya R.')),
      join(s.asZed, sessionId, SELF),
    ]);
    expect(answers.map(({ position }) => position).sort()).toEqual([1, 2]);
    await consistent(s, sessionId);
  });

  test('a join and a promotion at once leave every count equal to its rows', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 2,
    });
    const [first] = (await rowsOf(s)).entries;
    await Promise.all([
      s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first._id }),
      join(s.asPat, sessionId, SELF),
    ]);
    await consistent(s, sessionId);
    const { entries } = await rowsOf(s);
    expect(entries.map((row) => row.status).sort()).toEqual(['promoted', 'waiting']);
  });

  test('a registration and a promotion at once never take more places than the session has', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 2,
    });
    const [first] = (await rowsOf(s)).entries;
    await Promise.allSettled([
      s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first._id }),
      s.asPat.mutation(api.campRegistrations.register, {
        sessionId,
        participant: SELF,
        ageConfirmed: true,
      }),
    ]);
    await consistent(s, sessionId);
    const { registrations } = await rowsOf(s);
    expect(
      registrations.some((row) => row.userId === s.guardian.userId) ||
        registrations.some((row) => row.userId === s.pat.userId),
    ).toBe(true);
  });
});

describe('a place freed by a removed registration', () => {
  test('goes to the waitlist, not to a new registration, until promoted', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    await join(s.asGuardian, sessionId, MINOR('Maya R.'));
    await s.t.run((ctx) => deleteUserRecord(ctx, s.holder.authUserId));
    expect((await sessionOf(s, sessionId)).registeredCount).toBe(0);
    const slugs = { orgSlug: 'org-a', campSlug: 'junior-beach-volleyball-camp' };
    const page = await s.signedOut.query(api.camps.getPublicPage, slugs);
    expect(page?.sessions.find((row) => row.sessionId === sessionId)?.placesLeft).toBe(0);
    await expect(
      refusal(
        s.asPat.mutation(api.campRegistrations.register, {
          sessionId,
          participant: SELF,
          ageConfirmed: true,
        }),
      ),
    ).resolves.toMatchObject({ code: 'sessionFull' });
    const [first] = (await rowsOf(s)).entries;
    await expect(
      s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first._id }),
    ).resolves.toHaveProperty('registrationId');
    expect(await sessionOf(s, sessionId)).toMatchObject({ registeredCount: 1, waitlistCount: 0 });
  });
});

describe('the most one guardian may bring', () => {
  test('counts registered, waiting, and promoted children together, for that guardian only', async () => {
    const s = await setup();
    const sessionId = await withFullSession(s);
    const half = MAX_MINORS_PER_SESSION / 2;
    await s.t.run(async (ctx) => {
      await ctx.db.patch('campSessions', sessionId, { places: 1 + half });
      for (let i = 0; i < half; i++) {
        const session = (await ctx.db.get('campSessions', sessionId))!;
        await insertCampRegistration(ctx, session, {
          userId: s.guardian.userId,
          participant: MINOR(`Held ${i}`),
        });
      }
    });
    for (let i = 0; i < half; i++) await join(s.asGuardian, sessionId, MINOR(`Waiting ${i}`));
    await expect(refusal(join(s.asGuardian, sessionId, MINOR('One more')))).resolves.toMatchObject({
      code: 'minorLimit',
      field: 'minorName',
    });
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: sessionId,
      places: 1 + half + 1,
    });
    const [first] = (await rowsOf(s)).entries;
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first._id });
    await expect(refusal(join(s.asGuardian, sessionId, MINOR('One more')))).resolves.toMatchObject({
      code: 'minorLimit',
    });
    await expect(join(s.asZed, sessionId, MINOR('One more'))).resolves.toMatchObject({
      position: half,
    });
  });
});
