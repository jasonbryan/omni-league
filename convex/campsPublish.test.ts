/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CAMP_PUBLISH_MESSAGES } from './lib/campInput';
import { CAMP_SESSION_MESSAGES } from './lib/campSessionInput';
import { insertCampSession, insertDraftCamp, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { insertTournamentProgram, modules } from './test.setup';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const SESSION = {
  name: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  places: 20,
  registrationDeadline: '2027-07-01',
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [
        { name: 'Alpha Field', address: '1 Alpha St' },
        { name: 'bravo Beach', address: '2 Bravo St' },
      ],
      leagues: [],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const locationIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const alpha = await locationIn(organizationA, 'Alpha Field');
    const bravo = await locationIn(organizationA, 'bravo Beach');
    const bField = await locationIn(organizationB, 'B Field');
    const camp = async (
      organizationId: Id<'organizations'>,
      locationIds: Id<'locations'>[],
      name: string,
      slug: string,
    ) => {
      const campId = await insertDraftCamp(ctx, organizationId, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds,
        minimumAge: 9,
        maximumAge: 14,
      });
      return { campId, programId: (await ctx.db.get('camps', campId))!.programId };
    };
    const junior = await camp(
      organizationA,
      [bravo, alpha],
      'Junior Beach Volleyball Camp',
      'junior-beach-volleyball-camp',
    );
    const fall = await camp(organizationA, [alpha], 'Fall Break Camp', 'fall-break-camp');
    const campB = await camp(organizationB, [bField], 'B Camp', 'b-camp');
    const member = async (
      authUserId: string,
      membership: {
        organizationId: Id<'organizations'>;
        role: 'orgAdmin' | 'leagueOrganizer';
        programIds?: Id<'programs'>[];
      } | null,
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
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
    };
    await member('admin-a', { organizationId: organizationA, role: 'orgAdmin' });
    await member('assigned-a', {
      organizationId: organizationA,
      role: 'leagueOrganizer',
      programIds: [junior.programId],
    });
    await member('unassigned-a', {
      organizationId: organizationA,
      role: 'leagueOrganizer',
      programIds: [fall.programId],
    });
    await member('admin-b', { organizationId: organizationB, role: 'orgAdmin' });
    await member('stranger', null);
    await insertTournamentProgram(ctx, organizationA, 'Gulf Coast Beach Open', 'gulf-coast-open');
    return { organizationA, organizationB, bField, junior, fall, campB };
  });
  const as = (authUserId: string) => t.withIdentity(identity(authUserId));
  return {
    t,
    ...ids,
    adminA: as('admin-a'),
    assignedA: as('assigned-a'),
    unassignedA: as('unassigned-a'),
    adminB: as('admin-b'),
    stranger: as('stranger'),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['org admin of another organization', s.adminB, 'Not allowed'],
    ['league organizer not assigned to the camp', s.unassignedA, 'Not allowed'],
    ['non-member', s.stranger, 'Not allowed'],
  ] as const;
}

async function addSession(
  s: Setup,
  camp: { campId: Id<'camps'> },
  change: Partial<typeof SESSION> & { registeredCount?: number } = {},
) {
  const { registeredCount, ...session } = { ...SESSION, ...change };
  return s.t.run(async (ctx) => {
    const id = await insertCampSession(ctx, (await ctx.db.get('camps', camp.campId))!, session);
    if (registeredCount !== undefined) await ctx.db.patch('campSessions', id, { registeredCount });
    return id;
  });
}

const statusOf = (s: Setup, camp: { programId: Id<'programs'> }) =>
  s.t.run(async (ctx) => (await ctx.db.get('programs', camp.programId))!.status);

const snapshot = (t: Setup['t']) =>
  t.run(async (ctx) => ({
    camps: await ctx.db.query('camps').collect(),
    programs: await ctx.db.query('programs').collect(),
    campSessions: await ctx.db.query('campSessions').collect(),
    organizations: await ctx.db.query('organizations').collect(),
    memberships: await ctx.db.query('memberships').collect(),
  }));

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string; message: string }>).data;
}

describe('camps.publish', () => {
  test('an org admin publishes a camp with a session: its program and its camp row read published and nothing else changes', async () => {
    const s = await setup();
    await addSession(s, s.junior);
    const before = await snapshot(s.t);
    expect(await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId })).toBeNull();
    const after = await snapshot(s.t);
    expect(
      after.programs.filter((program) => program.type === 'camp' && program.status === 'published'),
    ).toMatchObject([{ _id: s.junior.programId, type: 'camp' }]);
    expect({
      ...after,
      camps: after.camps.map((camp) =>
        camp._id === s.junior.campId ? { ...camp, status: 'draft' as const } : camp,
      ),
      programs: after.programs.map((program) =>
        program._id === s.junior.programId ? { ...program, status: 'draft' as const } : program,
      ),
    }).toEqual(before);
    expect(after.camps.find((camp) => camp._id === s.junior.campId)?.status).toBe('published');
  });

  test('refuses a camp with no session as "Add a session first." and keeps the draft', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.camps.publish, { campId: s.junior.campId })),
    ).toEqual({ code: 'noSessions', message: 'Add a session first.' });
    expect(CAMP_PUBLISH_MESSAGES.noSessions).toBe('Add a session first.');
    expect(await statusOf(s, s.junior)).toBe('draft');
  });

  test('counts the sessions of a camp whose counter was never written', async () => {
    const s = await setup();
    await addSession(s, s.junior);
    await s.t.run((ctx) => ctx.db.patch('camps', s.junior.campId, { sessionCount: undefined }));
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    expect(await statusOf(s, s.junior)).toBe('published');
  });

  test('publishing a published camp changes nothing', async () => {
    const s = await setup();
    await addSession(s, s.junior);
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses an unauthenticated caller, an org admin of another organization, and a league organizer not assigned to the camp, and keeps the draft', async () => {
    const s = await setup();
    await addSession(s, s.junior);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.camps.publish, { campId: s.junior.campId }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await statusOf(s, s.junior)).toBe('draft');
  });

  test('refuses a caller who may not organize the camp before it says the camp has no session', async () => {
    const s = await setup();
    await expect(
      s.unassignedA.mutation(api.camps.publish, { campId: s.junior.campId }),
    ).rejects.toThrow('Not allowed');
  });

  test('a league organizer assigned to the camp publishes it', async () => {
    const s = await setup();
    await addSession(s, s.junior);
    await s.assignedA.mutation(api.camps.publish, { campId: s.junior.campId });
    expect(await statusOf(s, s.junior)).toBe('published');
  });

  test('refuses another organization’s camp to an org admin, and a camp that does not exist', async () => {
    const s = await setup();
    await addSession(s, s.campB);
    await expect(s.adminA.mutation(api.camps.publish, { campId: s.campB.campId })).rejects.toThrow(
      'Not allowed',
    );
    await s.t.run((ctx) => ctx.db.delete('camps', s.fall.campId));
    await expect(s.adminA.mutation(api.camps.publish, { campId: s.fall.campId })).rejects.toThrow(
      'Not allowed',
    );
    expect(await statusOf(s, s.campB)).toBe('draft');
  });
});

describe('campSessions.remove on a published camp', () => {
  test('refuses to delete the last session and keeps it', async () => {
    const s = await setup();
    const campSessionId = await addSession(s, s.junior);
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    expect(await refusal(s.adminA.mutation(api.campSessions.remove, { campSessionId }))).toEqual({
      code: 'lastSession',
      message: CAMP_SESSION_MESSAGES.lastSession,
    });
    expect(await s.t.run((ctx) => ctx.db.get('campSessions', campSessionId))).not.toBeNull();
  });

  test('refuses the last session of a camp whose counter was never written', async () => {
    const s = await setup();
    const campSessionId = await addSession(s, s.junior);
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    await s.t.run((ctx) => ctx.db.patch('camps', s.junior.campId, { sessionCount: undefined }));
    expect(
      (await refusal(s.assignedA.mutation(api.campSessions.remove, { campSessionId }))).code,
    ).toBe('lastSession');
  });

  test('deletes one of two sessions, and then refuses the one that is left', async () => {
    const s = await setup();
    const first = await addSession(s, s.junior);
    const second = await addSession(s, s.junior, { name: 'Week 2', startDate: '2027-07-12' });
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    await s.adminA.mutation(api.campSessions.remove, { campSessionId: first });
    expect(
      (await refusal(s.adminA.mutation(api.campSessions.remove, { campSessionId: second }))).code,
    ).toBe('lastSession');
  });

  test('deletes the last session of a draft camp', async () => {
    const s = await setup();
    const campSessionId = await addSession(s, s.junior);
    await s.adminA.mutation(api.campSessions.remove, { campSessionId });
    expect(await s.t.run((ctx) => ctx.db.get('campSessions', campSessionId))).toBeNull();
  });
});

describe('camps.getPublicPage', () => {
  const slugs = { orgSlug: 'org-a', campSlug: 'junior-beach-volleyball-camp' };

  async function published(s: Setup) {
    const first = await addSession(s, s.junior, { registeredCount: 5 });
    await addSession(s, s.junior, {
      name: 'Week 3',
      startDate: '2027-07-19',
      endDate: '2027-07-23',
      registrationDeadline: '2027-07-15',
      registeredCount: 20,
      dailyStartTime: undefined,
      dailyEndTime: undefined,
    });
    await addSession(s, s.junior, {
      name: 'Week 2',
      startDate: '2027-07-12',
      endDate: '2027-07-16',
      registrationDeadline: '2027-07-08',
    });
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    return first;
  }

  test('gives a signed-out caller the published camp with its sessions in date order, the places left, and an id for each session', async () => {
    const s = await setup();
    await published(s);
    expect(await s.t.query(api.camps.getPublicPage, slugs)).toEqual({
      organization: { name: 'Org A', slug: 'org-a' },
      name: 'Junior Beach Volleyball Camp',
      slug: 'junior-beach-volleyball-camp',
      sportName: 'Beach volleyball',
      minimumAge: 9,
      maximumAge: 14,
      locations: [
        { name: 'bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      sessions: [
        {
          sessionId: expect.any(String) as string,
          name: 'Week 1',
          startDate: '2027-07-05',
          endDate: '2027-07-09',
          dailyStartTime: '09:00',
          dailyEndTime: '12:00',
          placesLeft: 15,
          registrationDeadline: '2027-07-01',
        },
        {
          sessionId: expect.any(String) as string,
          name: 'Week 2',
          startDate: '2027-07-12',
          endDate: '2027-07-16',
          dailyStartTime: '09:00',
          dailyEndTime: '12:00',
          placesLeft: 20,
          registrationDeadline: '2027-07-08',
        },
        {
          sessionId: expect.any(String) as string,
          name: 'Week 3',
          startDate: '2027-07-19',
          endDate: '2027-07-23',
          placesLeft: 0,
          registrationDeadline: '2027-07-15',
        },
      ],
    });
  });

  test('never reports fewer than no places left', async () => {
    const s = await setup();
    await published(s);
    await s.t.run(async (ctx) => {
      const [session] = await ctx.db.query('campSessions').collect();
      await ctx.db.patch('campSessions', session._id, { registeredCount: 25 });
    });
    const page = await s.t.query(api.camps.getPublicPage, slugs);
    expect(page?.sessions[0]?.placesLeft).toBe(0);
  });

  test('gives every caller the same answer', async () => {
    const s = await setup();
    await published(s);
    const anonymous = await s.t.query(api.camps.getPublicPage, slugs);
    for (const caller of [s.adminA, s.adminB, s.stranger]) {
      expect(await caller.query(api.camps.getPublicPage, slugs)).toEqual(anonymous);
    }
  });

  test('is null for a draft, even for its org admin, and answers once it is published', async () => {
    const s = await setup();
    await addSession(s, s.junior);
    expect(await s.t.query(api.camps.getPublicPage, slugs)).toBeNull();
    expect(await s.adminA.query(api.camps.getPublicPage, slugs)).toBeNull();
    await s.adminA.mutation(api.camps.publish, { campId: s.junior.campId });
    expect(await s.t.query(api.camps.getPublicPage, slugs)).not.toBeNull();
  });

  test('is null for an unknown organization, an unknown web address, a tournament’s, and another organization’s', async () => {
    const s = await setup();
    await published(s);
    await addSession(s, s.campB);
    await s.adminB.mutation(api.camps.publish, { campId: s.campB.campId });
    for (const args of [
      { orgSlug: 'nowhere', campSlug: slugs.campSlug },
      { orgSlug: 'org-a', campSlug: 'no-such-camp' },
      { orgSlug: 'org-a', campSlug: 'gulf-coast-open' },
      { orgSlug: 'org-b', campSlug: slugs.campSlug },
      { orgSlug: 'org-a', campSlug: 'b-camp' },
    ]) {
      expect(await s.t.query(api.camps.getPublicPage, args), JSON.stringify(args)).toBeNull();
    }
  });

  test('leaves out a location of another organization', async () => {
    const s = await setup();
    await published(s);
    await s.t.run((ctx) =>
      ctx.db.patch('programs', s.junior.programId, { locationIds: [s.bField] }),
    );
    const page = await s.t.query(api.camps.getPublicPage, slugs);
    expect(page?.locations).toEqual([]);
  });
});
