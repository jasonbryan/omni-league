/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertCampRegistration } from './lib/campRegistrationWrites';
import { insertCampWaitlistEntry } from './lib/campWaitlistWrites';
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
  places: 1,
  registrationDeadline: '2027-06-28',
};

const SELF: Participant = { kind: 'self' };
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

async function setup() {
  const t = convexTest(schema, modules);
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
    const sessions = {
      a: await insertCampSession(ctx, camp, { name: 'A', ...WEEK }),
      b: await insertCampSession(ctx, camp, { name: 'B', ...WEEK }),
    };
    await publishCamp(ctx, (await ctx.db.get('camps', campId))!);
    const person = (authUserId: string) =>
      ctx.db.insert('users', { authUserId, name: authUserId, adultConfirmedAt: 1 });
    const users = {
      admin: await person('admin'),
      holder: await person('holder'),
      guardian: await person('guardian'),
      other: await person('other'),
    };
    await insertMembership(ctx, users.admin, organization, 'orgAdmin');
    return { campId, sessions, users };
  });
  return { t, ...ids, asAdmin: t.withIdentity(identity('admin')) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function fill(s: Setup, sessionId: Id<'campSessions'>, userId: Id<'users'>) {
  return s.t.run(async (ctx) => {
    const session = (await ctx.db.get('campSessions', sessionId))!;
    await insertCampRegistration(ctx, session, { userId, participant: SELF });
  });
}

function wait(
  s: Setup,
  sessionId: Id<'campSessions'>,
  userId: Id<'users'>,
  participant: Participant,
) {
  return s.t.run((ctx) => insertCampWaitlistEntry(ctx, sessionId, { userId, participant }));
}

const deleteAccount = (s: Setup, authUserId: string) =>
  s.t.run((ctx) => deleteUserRecord(ctx, authUserId));

const entriesOf = (s: Setup, userId: Id<'users'>) =>
  s.t.run((ctx) =>
    ctx.db
      .query('campWaitlistEntries')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect(),
  );

const waitlistCountOf = (s: Setup, sessionId: Id<'campSessions'>) =>
  s.t.run(async (ctx) => (await ctx.db.get('campSessions', sessionId))?.waitlistCount);

describe('deleting an account removes its camp waitlist entries', () => {
  test('deletes waiting and promoted entries, keeps another account’s entry in the same session, and lowers the count by the waiting ones', async () => {
    const s = await setup();
    await fill(s, s.sessions.a, s.users.holder);
    await wait(s, s.sessions.a, s.users.guardian, MINOR('Maya R.'));
    await wait(s, s.sessions.a, s.users.guardian, MINOR('Leo R.'));
    await wait(s, s.sessions.a, s.users.other, SELF);
    await wait(s, s.sessions.b, s.users.guardian, SELF);
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: s.sessions.a,
      places: 2,
    });
    const [first] = await s.t.run((ctx) =>
      ctx.db
        .query('campWaitlistEntries')
        .withIndex('by_sessionId_and_status_and_requestedAt', (q) =>
          q.eq('sessionId', s.sessions.a).eq('status', 'waiting'),
        )
        .collect(),
    );
    expect(first?.userId).toBe(s.users.guardian);
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: first._id });
    expect((await entriesOf(s, s.users.guardian)).map((entry) => entry.status).sort()).toEqual([
      'promoted',
      'waiting',
      'waiting',
    ]);
    expect(await waitlistCountOf(s, s.sessions.a)).toBe(2);

    await deleteAccount(s, 'guardian');

    expect(await entriesOf(s, s.users.guardian)).toEqual([]);
    expect(await entriesOf(s, s.users.other)).toHaveLength(1);
    expect(await waitlistCountOf(s, s.sessions.a)).toBe(1);
    expect(await waitlistCountOf(s, s.sessions.b)).toBe(0);
    const left = await s.t.run((ctx) => ctx.db.query('campWaitlistEntries').collect());
    expect(left.map((entry) => entry.userId)).toEqual([s.users.other]);
  });

  test('leaves no entry holding the id of a deleted registration', async () => {
    const s = await setup();
    await fill(s, s.sessions.a, s.users.holder);
    await wait(s, s.sessions.a, s.users.guardian, MINOR('Maya R.'));
    await s.asAdmin.mutation(api.campSessions.updatePlaces, {
      campSessionId: s.sessions.a,
      places: 2,
    });
    const [entry] = await entriesOf(s, s.users.guardian);
    await s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: entry._id });
    await deleteAccount(s, 'guardian');
    const rows = await s.t.run(async (ctx) => ({
      entries: await ctx.db.query('campWaitlistEntries').collect(),
      registrations: await ctx.db.query('campRegistrations').collect(),
    }));
    expect(rows.entries).toEqual([]);
    expect(rows.registrations.map((row) => row.userId)).toEqual([s.users.holder]);
  });

  test('lets the next entry be promoted once an earlier account is gone', async () => {
    const s = await setup();
    await fill(s, s.sessions.a, s.users.holder);
    await wait(s, s.sessions.a, s.users.guardian, SELF);
    vi.setSystemTime(NOW + 1000);
    await wait(s, s.sessions.a, s.users.other, SELF);
    await deleteAccount(s, 'guardian');
    await deleteAccount(s, 'holder');
    const [entry] = await entriesOf(s, s.users.other);
    await expect(
      s.asAdmin.mutation(api.campWaitlist.promote, { campWaitlistEntryId: entry._id }),
    ).resolves.toHaveProperty('registrationId');
  });

  test('completes when the session row is gone, and the users row is deleted', async () => {
    const s = await setup();
    await fill(s, s.sessions.a, s.users.holder);
    await wait(s, s.sessions.a, s.users.guardian, SELF);
    await wait(s, s.sessions.b, s.users.guardian, SELF);
    await s.t.run((ctx) => ctx.db.delete('campSessions', s.sessions.a));
    await deleteAccount(s, 'guardian');
    expect(await entriesOf(s, s.users.guardian)).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.get('users', s.users.guardian))).toBeNull();
    expect(await waitlistCountOf(s, s.sessions.b)).toBe(0);
  });

  test('keeps a count that is already 0 at 0', async () => {
    const s = await setup();
    await wait(s, s.sessions.a, s.users.guardian, SELF);
    await s.t.run((ctx) => ctx.db.patch('campSessions', s.sessions.a, { waitlistCount: 0 }));
    await deleteAccount(s, 'guardian');
    expect(await waitlistCountOf(s, s.sessions.a)).toBe(0);
  });

  test.each([99, 100, 101, 201])(
    'deletes all %i entries of one account in one session and leaves the other account’s entry',
    async (rows) => {
      const s = await setup();
      for (let i = 0; i < rows; i++) await wait(s, s.sessions.a, s.users.guardian, MINOR(`M ${i}`));
      await wait(s, s.sessions.a, s.users.other, SELF);
      expect(await waitlistCountOf(s, s.sessions.a)).toBe(rows + 1);
      await deleteAccount(s, 'guardian');
      expect(await entriesOf(s, s.users.guardian)).toEqual([]);
      expect(await entriesOf(s, s.users.other)).toHaveLength(1);
      expect(await waitlistCountOf(s, s.sessions.a)).toBe(1);
    },
  );

  test('leaves entries alone when no users row matches', async () => {
    const s = await setup();
    await wait(s, s.sessions.a, s.users.guardian, SELF);
    await deleteAccount(s, 'nobody');
    expect(await entriesOf(s, s.users.guardian)).toHaveLength(1);
  });
});
