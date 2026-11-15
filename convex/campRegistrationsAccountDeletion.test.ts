/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertCampRegistration } from './lib/campRegistrationWrites';
import type { Participant } from './lib/individualRegistration';
import { insertMembership } from './lib/memberships';
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

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const organization = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [],
    });
    const location = (await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', organization).eq('name', 'Alpha Field'),
      )
      .unique())!._id;
    const campId = await insertDraftCamp(ctx, organization, {
      name: 'Beach Skills Camp',
      slug: 'beach-skills-camp',
      sport: 'beachVolleyball',
      locationIds: [location],
      minimumAge: 9,
      maximumAge: 99,
    });
    const camp = (await ctx.db.get('camps', campId))!;
    const session = (name: string, places = 12) =>
      insertCampSession(ctx, camp, { name, ...WEEK, places });
    const sessions = {
      s: await session('S', 3),
      s2: await session('S2'),
      s3: await session('S3'),
    };
    await publishCamp(ctx, (await ctx.db.get('camps', campId))!);
    const person = (authUserId: string) =>
      ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    const users = {
      admin: await person('admin'),
      guardian: await person('guardian'),
      adult: await person('adult'),
      other: await person('other'),
      newcomer: await person('newcomer'),
    };
    await insertMembership(ctx, users.admin, organization, 'orgAdmin');
    return { organization, campId, sessions, users };
  });
  return {
    t,
    ...ids,
    asAdmin: t.withIdentity(identity('admin')),
    asNewcomer: t.withIdentity(identity('newcomer')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function register(
  s: Setup,
  sessionId: Id<'campSessions'>,
  userId: Id<'users'>,
  participant: Participant = SELF,
) {
  return s.t.run(async (ctx) => {
    const session = (await ctx.db.get('campSessions', sessionId))!;
    await insertCampRegistration(ctx, session, { userId, participant });
  });
}

const deleteAccount = (s: Setup, authUserId: string) =>
  s.t.run((ctx) => deleteUserRecord(ctx, authUserId));

function countOf(s: Setup, sessionId: Id<'campSessions'>): Promise<number | undefined> {
  return s.t.run(async (ctx) => (await ctx.db.get('campSessions', sessionId))?.registeredCount);
}

function registrationsOf(s: Setup, userId: Id<'users'>) {
  return s.t.run((ctx) =>
    ctx.db
      .query('campRegistrations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect(),
  );
}

describe('deleting an account removes its camp registrations', () => {
  test('deletes the row of an adult and lowers the session count by 1', async () => {
    const s = await setup();
    await register(s, s.sessions.s, s.users.adult);
    expect(await countOf(s, s.sessions.s)).toBe(1);
    await deleteAccount(s, 'adult');
    expect(await registrationsOf(s, s.users.adult)).toEqual([]);
    expect(await countOf(s, s.sessions.s)).toBe(0);
  });

  test('lowers each session by the guardian’s minors in it and keeps another user’s place', async () => {
    const s = await setup();
    for (const name of ['Maya R.', 'Noa R.', 'Ola R.']) {
      await register(s, s.sessions.s, s.users.guardian, MINOR(name));
    }
    await register(s, s.sessions.s2, s.users.guardian, MINOR('Maya R.'));
    await register(s, s.sessions.s, s.users.other);
    await deleteAccount(s, 'guardian');
    expect(await registrationsOf(s, s.users.guardian)).toEqual([]);
    expect(await countOf(s, s.sessions.s)).toBe(1);
    expect(await countOf(s, s.sessions.s2)).toBe(0);
    expect(await registrationsOf(s, s.users.other)).toHaveLength(1);
  });

  test('frees a place in a full session for another user to take', async () => {
    const s = await setup();
    await register(s, s.sessions.s, s.users.adult);
    await register(s, s.sessions.s, s.users.guardian, MINOR('Maya R.'));
    await register(s, s.sessions.s, s.users.other);
    const ask = () =>
      s.asNewcomer.query(api.campRegistrations.getForRegistration, {
        orgSlug: 'org-a',
        campSlug: 'beach-skills-camp',
        sessionId: s.sessions.s,
      });
    expect((await ask())?.session?.placesLeft).toBe(0);
    await expect(
      s.asNewcomer.mutation(api.campRegistrations.register, {
        sessionId: s.sessions.s,
        participant: SELF,
        ageConfirmed: true,
      }),
    ).rejects.toThrow();
    await deleteAccount(s, 'adult');
    expect((await ask())?.session?.placesLeft).toBe(1);
    await s.asNewcomer.mutation(api.campRegistrations.register, {
      sessionId: s.sessions.s,
      participant: SELF,
      ageConfirmed: true,
    });
    expect(await countOf(s, s.sessions.s)).toBe(3);
  });

  test('lets the organizer delete a session whose only registrant’s account is deleted', async () => {
    const s = await setup();
    await register(s, s.sessions.s, s.users.adult);
    await expect(
      s.asAdmin.mutation(api.campSessions.remove, { campSessionId: s.sessions.s }),
    ).rejects.toThrow();
    await deleteAccount(s, 'adult');
    await s.asAdmin.mutation(api.campSessions.remove, { campSessionId: s.sessions.s });
    expect(await s.t.run((ctx) => ctx.db.get('campSessions', s.sessions.s))).toBeNull();
  });

  test('deletes more than one batch of registrations across sessions and keeps every count right', async () => {
    const s = await setup();
    const PER_SESSION = 40;
    const sessionIds = await s.t.run(async (ctx) => {
      const camp = (await ctx.db.get('camps', s.campId))!;
      const ids: Id<'campSessions'>[] = [];
      for (const name of ['Big 1', 'Big 2', 'Big 3']) {
        ids.push(await insertCampSession(ctx, camp, { name, ...WEEK, places: 100 }));
      }
      return ids;
    });
    for (const sessionId of sessionIds) {
      for (let i = 0; i < PER_SESSION; i++) {
        await register(s, sessionId, s.users.guardian, MINOR(`Minor ${i}`));
      }
      await register(s, sessionId, s.users.other);
    }
    expect(await registrationsOf(s, s.users.guardian)).toHaveLength(PER_SESSION * 3);
    await deleteAccount(s, 'guardian');
    expect(await registrationsOf(s, s.users.guardian)).toEqual([]);
    for (const sessionId of sessionIds) expect(await countOf(s, sessionId)).toBe(1);
    expect(await registrationsOf(s, s.users.other)).toHaveLength(3);
  });

  test('completes when the session row is gone, and the registration and users rows are deleted', async () => {
    const s = await setup();
    await register(s, s.sessions.s, s.users.adult);
    await register(s, s.sessions.s2, s.users.adult);
    await s.t.run((ctx) => ctx.db.delete('campSessions', s.sessions.s));
    await deleteAccount(s, 'adult');
    expect(await registrationsOf(s, s.users.adult)).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.get('users', s.users.adult))).toBeNull();
    expect(await countOf(s, s.sessions.s2)).toBe(0);
  });

  test('keeps a session count that is already 0 at 0', async () => {
    const s = await setup();
    await register(s, s.sessions.s, s.users.adult);
    await s.t.run((ctx) => ctx.db.patch('campSessions', s.sessions.s, { registeredCount: 0 }));
    await deleteAccount(s, 'adult');
    expect(await registrationsOf(s, s.users.adult)).toEqual([]);
    expect(await countOf(s, s.sessions.s)).toBe(0);
  });

  test('stops listing the registrations of the deleted account for the session', async () => {
    const s = await setup();
    await register(s, s.sessions.s, s.users.adult);
    await register(s, s.sessions.s, s.users.other);
    const list = () =>
      s.asAdmin.query(api.campRegistrations.listForSession, { sessionId: s.sessions.s });
    expect((await list()).map(({ name }) => name)).toEqual(['adult', 'other']);
    await deleteAccount(s, 'adult');
    expect((await list()).map(({ name }) => name)).toEqual(['other']);
  });

  test('leaves registrations alone when no users row matches', async () => {
    const s = await setup();
    await register(s, s.sessions.s, s.users.adult);
    await deleteAccount(s, 'nobody');
    expect(await registrationsOf(s, s.users.adult)).toHaveLength(1);
    expect(await countOf(s, s.sessions.s)).toBe(1);
  });
});
