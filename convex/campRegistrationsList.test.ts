/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertCampRegistration } from './lib/campRegistrationWrites';
import type { Participant } from './lib/individualRegistration';
import { insertCampSession, insertDraftCamp, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.UTC(2027, 5, 1, 12, 0, 0);

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
      sessions: { name: string; places?: number }[],
    ) => {
      const campId = await insertDraftCamp(ctx, organizationA, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [alpha],
        minimumAge: 9,
        maximumAge: 99,
      });
      const row = (await ctx.db.get('camps', campId))!;
      const sessionIds: Record<string, Id<'campSessions'>> = {};
      for (const session of sessions) {
        sessionIds[session.name] = await insertCampSession(ctx, row, { ...WEEK, ...session });
      }
      return { programId: row.programId, sessions: sessionIds };
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
    const junior = await camp('Junior Beach Volleyball Camp', 'junior-beach-volleyball-camp', [
      { name: 'Week 1' },
      { name: 'Week 2' },
      { name: 'Tiny', places: 2 },
    ]);
    const fall = await camp('Fall Break Camp', 'fall-break-camp', [{ name: 'Week 1' }]);
    return {
      junior,
      fall,
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
      leagueOnly: await person('league-only', 'Lee Organizer', {
        organizationId: organizationA,
        role: 'leagueOrganizer',
      }),
      guardian: await person('guardian', 'Gail Guardian', null),
      adult: await person('player', 'Pat Player', null),
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
    asLeagueOnly: as(ids.leagueOnly),
    asGuardian: as(ids.guardian),
    signedOut: t,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const week1 = (s: Setup) => s.junior.sessions['Week 1'];

async function register(
  s: Setup,
  sessionId: Id<'campSessions'>,
  userId: Id<'users'>,
  participant: Participant,
  at = NOW,
) {
  await s.t.run(async (ctx) => {
    const session = (await ctx.db.get('campSessions', sessionId))!;
    const id = await insertCampRegistration(ctx, session, { userId, participant });
    await ctx.db.patch('campRegistrations', id, { createdAt: at });
  });
}

const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });
const SELF: Participant = { kind: 'self' };

describe('campRegistrations.listForSession', () => {
  test('lists a minor with the guardian’s name and email, and an adult with no guardian', async () => {
    const s = await setup();
    await register(s, week1(s), s.guardian.userId, MINOR('Maya R.'));
    await register(s, week1(s), s.adult.userId, SELF);
    const rows = await s.asAdmin.query(api.campRegistrations.listForSession, {
      sessionId: week1(s),
    });
    expect(rows.map(({ name, guardian }) => ({ name, guardian }))).toEqual([
      { name: 'Maya R.', guardian: { name: 'Gail Guardian', email: 'guardian@example.test' } },
      { name: 'Pat Player', guardian: undefined },
    ]);
    expect(Object.keys(rows[1]).sort()).toEqual(['name', 'registeredAt', 'registrationId']);
  });

  test('gives the time each registration was made', async () => {
    const s = await setup();
    await register(s, week1(s), s.adult.userId, SELF, NOW - 86_400_000);
    const [row] = await s.asAdmin.query(api.campRegistrations.listForSession, {
      sessionId: week1(s),
    });
    const stored = await s.t.run((ctx) => ctx.db.query('campRegistrations').first());
    expect(row?.registeredAt).toBe(stored?.createdAt);
    expect(row?.registeredAt).toBeLessThan(NOW);
  });

  test('sorts by name regardless of case and of when each registered', async () => {
    const s = await setup();
    await register(s, week1(s), s.zed.userId, SELF, NOW - 3000);
    await register(s, week1(s), s.guardian.userId, MINOR('maya R.'), NOW - 2000);
    await register(s, week1(s), s.adult.userId, SELF, NOW - 1000);
    await register(s, week1(s), s.guardian.userId, MINOR('Leo R.'), NOW - 500);
    const rows = await s.asAdmin.query(api.campRegistrations.listForSession, {
      sessionId: week1(s),
    });
    expect(rows.map((row) => row.name)).toEqual(['Leo R.', 'maya R.', 'Pat Player', 'Zed Zimmer']);
  });

  test('lists only the asked session’s registrations', async () => {
    const s = await setup();
    await register(s, week1(s), s.adult.userId, SELF);
    await register(s, s.junior.sessions['Week 2'], s.zed.userId, SELF);
    const rows = await s.asAdmin.query(api.campRegistrations.listForSession, {
      sessionId: week1(s),
    });
    expect(rows.map((row) => row.name)).toEqual(['Pat Player']);
  });

  test('is empty for a session no one registered for', async () => {
    const s = await setup();
    await expect(
      s.asAdmin.query(api.campRegistrations.listForSession, { sessionId: week1(s) }),
    ).resolves.toEqual([]);
  });

  test('lists an organizer assigned to the camp, and an org admin', async () => {
    const s = await setup();
    await register(s, week1(s), s.guardian.userId, MINOR('Maya R.'));
    for (const caller of [s.asAssigned, s.asAdmin]) {
      const rows = await caller.query(api.campRegistrations.listForSession, {
        sessionId: week1(s),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Maya R.', guardian: { name: 'Gail Guardian' } });
    }
  });

  test.each([
    ['an unauthenticated caller', (s: Setup) => s.signedOut],
    ['an org admin of another organization', (s: Setup) => s.asOtherAdmin],
    ['a league organizer assigned to another camp', (s: Setup) => s.asUnassigned],
    ['a league organizer assigned to no camp', (s: Setup) => s.asLeagueOnly],
    ['a player', (s: Setup) => s.asGuardian],
  ])('refuses %s and returns no name', async (_, caller) => {
    const s = await setup();
    await register(s, week1(s), s.guardian.userId, MINOR('Maya R.'));
    await expect(
      caller(s).query(api.campRegistrations.listForSession, { sessionId: week1(s) }),
    ).rejects.toThrow(/Sign in required|Not allowed/);
  });

  test('refuses a session that was deleted, as it does another organization’s', async () => {
    const s = await setup();
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete('campSessions', week1(s));
      return week1(s);
    });
    await expect(
      s.asAdmin.query(api.campRegistrations.listForSession, { sessionId: gone }),
    ).rejects.toThrow(/Not allowed/);
  });

  test('sends neither a user id nor the participant key', async () => {
    const s = await setup();
    await register(s, week1(s), s.guardian.userId, MINOR('Maya R.'));
    const rows = await s.asAdmin.query(api.campRegistrations.listForSession, {
      sessionId: week1(s),
    });
    const text = JSON.stringify(rows);
    expect(text).not.toContain(s.guardian.userId);
    expect(text).not.toContain(s.guardian.authUserId);
    expect(text).not.toContain('participantKey');
  });

  test('reads no more rows than the session has places', async () => {
    const s = await setup();
    const tiny = s.junior.sessions['Tiny'];
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', tiny))!;
      for (const name of ['A', 'B', 'C', 'D']) {
        await ctx.db.insert('campRegistrations', {
          sessionId: tiny,
          campId: session.campId,
          organizationId: session.organizationId,
          userId: s.guardian.userId,
          participant: MINOR(name),
          participantKey: `minor:${name.toLowerCase()}`,
          createdAt: NOW,
        });
      }
    });
    const rows = await s.asAdmin.query(api.campRegistrations.listForSession, { sessionId: tiny });
    expect(rows).toHaveLength(2);
  });

  test('names a registrant whose account is gone, with no guardian line', async () => {
    const s = await setup();
    await register(s, week1(s), s.adult.userId, SELF);
    await register(s, week1(s), s.guardian.userId, MINOR('Maya R.'));
    await s.t.run(async (ctx) => {
      await ctx.db.delete('users', s.adult.userId);
      await ctx.db.delete('users', s.guardian.userId);
    });
    const rows = await s.asAdmin.query(api.campRegistrations.listForSession, {
      sessionId: week1(s),
    });
    expect(rows.map(({ name, guardian }) => ({ name, guardian }))).toEqual([
      { name: 'Maya R.', guardian: undefined },
      { name: 'Removed account', guardian: undefined },
    ]);
  });
});
