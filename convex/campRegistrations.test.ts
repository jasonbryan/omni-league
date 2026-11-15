/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CAMP_REGISTRATION_MESSAGES } from './lib/campRegistration';
import { MAX_MINORS_PER_SESSION } from './lib/individualRegistration';
import { insertCampSession, insertDraftCamp, insertTenant, publishCamp } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.parse('2027-06-01T12:00:00Z');

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
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  places: 12,
  registrationDeadline: '2027-06-28',
};

const SELF = { kind: 'self' } as const;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organization = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [],
    });
    const otherOrganization = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const location = (await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', organization).eq('name', 'Alpha Field'),
      )
      .unique())!._id;
    const camp = async (
      name: string,
      slug: string,
      ages: { minimumAge: number; maximumAge: number },
      status: 'published' | 'draft',
      sessions: { name: string; values: Partial<typeof WEEK> }[],
    ) => {
      const campId = await insertDraftCamp(ctx, organization, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [location],
        ...ages,
      });
      const camp = (await ctx.db.get('camps', campId))!;
      const sessionIds: Record<string, Id<'campSessions'>> = {};
      for (const { name: sessionName, values } of sessions) {
        sessionIds[sessionName] = await insertCampSession(ctx, camp, {
          name: sessionName,
          ...WEEK,
          ...values,
        });
      }
      if (status === 'published') await publishCamp(ctx, (await ctx.db.get('camps', campId))!);
      return { campId, sessions: sessionIds };
    };
    const adult = await camp(
      'Adult Beach Skills Camp',
      'adult-beach-skills-camp',
      { minimumAge: 18, maximumAge: 99 },
      'published',
      [
        { name: 'Week 1', values: {} },
        { name: 'Last place', values: { places: 1 } },
        { name: 'Past deadline', values: { registrationDeadline: '2027-05-30' } },
        {
          name: 'Started',
          values: { startDate: '2027-06-01', registrationDeadline: '2027-06-10' },
        },
      ],
    );
    const youth = await camp(
      'Youth Camp',
      'youth-camp',
      { minimumAge: 9, maximumAge: 17 },
      'published',
      [{ name: 'Week 1', values: {} }],
    );
    const mixed = await camp(
      'Open Ages Camp',
      'open-ages-camp',
      { minimumAge: 14, maximumAge: 30 },
      'published',
      [{ name: 'Week 1', values: {} }],
    );
    const draft = await camp(
      'Secret Draft Camp',
      'secret-draft-camp',
      { minimumAge: 18, maximumAge: 99 },
      'draft',
      [{ name: 'Week 1', values: {} }],
    );
    const users: Record<string, Id<'users'>> = {};
    for (const name of ['alice', 'bob', 'carol']) {
      users[name] = await ctx.db.insert('users', {
        authUserId: name,
        name,
        adultConfirmedAt: 1,
      });
    }
    return { organization, otherOrganization, adult, youth, mixed, draft, users };
  });
  return {
    t,
    ...ids,
    alice: t.withIdentity(identity('alice')),
    bob: t.withIdentity(identity('bob')),
    carol: t.withIdentity(identity('carol')),
    ghost: t.withIdentity(identity('ghost')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Caller = Setup['alice'];

const args = (sessionId: Id<'campSessions'>, over: { ageConfirmed?: boolean } = {}) => ({
  sessionId,
  participant: SELF,
  ageConfirmed: true,
  ...over,
});

const week1 = (s: Setup) => s.adult.sessions['Week 1'];

const MAYA = { kind: 'minor', minorName: 'Maya R.' } as const;

const childArgs = (
  sessionId: Id<'campSessions'>,
  minorName = 'Maya R.',
  over: { ageConfirmed?: boolean } = {},
) => ({
  sessionId,
  participant: { kind: 'minor', minorName } as const,
  ageConfirmed: true,
  ...over,
});

const youthWeek1 = (s: Setup) => s.youth.sessions['Week 1'];

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string; message: string; field?: string }>).data;
}

const rows = (s: Setup) =>
  s.t.run(async (ctx) => ({
    registrations: await ctx.db.query('campRegistrations').collect(),
    sessions: await ctx.db.query('campSessions').collect(),
  }));

async function registeredCount(s: Setup, sessionId: Id<'campSessions'>): Promise<number> {
  return s.t.run(async (ctx) => (await ctx.db.get('campSessions', sessionId))!.registeredCount);
}

async function expectNothingWritten(s: Setup, call: () => Promise<unknown>) {
  const before = await rows(s);
  await call().catch(() => undefined);
  expect(await rows(s)).toEqual(before);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('campRegistrations.register', () => {
  test('takes one place and writes the registration for the caller', async () => {
    const s = await setup();
    const { registrationId } = await s.alice.mutation(
      api.campRegistrations.register,
      args(week1(s)),
    );
    const { registrations } = await rows(s);
    expect(registrations).toEqual([
      {
        _id: registrationId,
        _creationTime: registrations[0]._creationTime,
        sessionId: week1(s),
        campId: s.adult.campId,
        organizationId: s.organization,
        userId: s.users['alice'],
        participant: { kind: 'self' },
        participantKey: 'self',
        ageConfirmedAt: NOW,
        createdAt: NOW,
      },
    ]);
    expect(await registeredCount(s, week1(s))).toBe(1);
  });

  test('keeps the places of other sessions', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    expect(await registeredCount(s, s.adult.sessions['Last place'])).toBe(0);
    expect(await registeredCount(s, s.youth.sessions['Week 1'])).toBe(0);
  });

  test('lets two people register for the same session', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    await s.bob.mutation(api.campRegistrations.register, args(week1(s)));
    expect(await registeredCount(s, week1(s))).toBe(2);
  });

  test('lets one person register for two sessions', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    await s.alice.mutation(api.campRegistrations.register, args(s.adult.sessions['Last place']));
    expect((await rows(s)).registrations).toHaveLength(2);
  });

  test('refuses an unauthenticated caller and writes nothing', async () => {
    const s = await setup();
    await expectNothingWritten(s, async () => {
      await expect(s.t.mutation(api.campRegistrations.register, args(week1(s)))).rejects.toThrow(
        'Sign in required',
      );
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, week1(s))).toBe(0);
  });

  test('refuses an identity with no users row and writes nothing', async () => {
    const s = await setup();
    await expect(s.ghost.mutation(api.campRegistrations.register, args(week1(s)))).rejects.toThrow(
      'Sign in required',
    );
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('refuses a session of a draft camp as not found and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.campRegistrations.register, args(s.draft.sessions['Week 1'])),
    );
    expect(data).toMatchObject({ code: 'campNotFound' });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, s.draft.sessions['Week 1'])).toBe(0);
  });

  test('refuses a session whose deadline has passed and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.campRegistrations.register, args(s.adult.sessions['Past deadline'])),
    );
    expect(data).toEqual({
      code: 'registrationClosed',
      message: CAMP_REGISTRATION_MESSAGES.registrationClosed,
    });
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('refuses a session that has started even before its deadline', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.campRegistrations.register, args(s.adult.sessions['Started'])),
    );
    expect(data).toMatchObject({ code: 'registrationClosed' });
  });

  test('is open on the deadline day itself', async () => {
    vi.setSystemTime(Date.parse('2027-06-28T12:00:00Z'));
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    expect(await registeredCount(s, week1(s))).toBe(1);
  });

  test('refuses a second registration of the same person and keeps the count', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    const data = await refusal(s.alice.mutation(api.campRegistrations.register, args(week1(s))));
    expect(data).toEqual({
      code: 'alreadyRegistered',
      message: CAMP_REGISTRATION_MESSAGES.alreadyRegistered(SELF),
    });
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCount(s, week1(s))).toBe(1);
  });

  test('refuses a full session and writes nothing', async () => {
    const s = await setup();
    const last = s.adult.sessions['Last place'];
    await s.alice.mutation(api.campRegistrations.register, args(last));
    const data = await refusal(s.bob.mutation(api.campRegistrations.register, args(last)));
    expect(data).toEqual({
      code: 'sessionFull',
      message: CAMP_REGISTRATION_MESSAGES.sessionFull,
    });
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCount(s, last)).toBe(1);
  });

  test('refuses an adult for a camp whose maximum age is 17 and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.campRegistrations.register, args(s.youth.sessions['Week 1'])),
    );
    expect(data).toEqual({
      code: 'adultNotAllowed',
      message: CAMP_REGISTRATION_MESSAGES.adultNotAllowed(17),
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, s.youth.sessions['Week 1'])).toBe(0);
  });

  test('refuses an unticked age box under the box and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.campRegistrations.register, args(week1(s), { ageConfirmed: false })),
    );
    expect(data).toEqual({
      code: 'ageNotConfirmed',
      field: 'ageConfirmed',
      message: 'Confirm your age to continue.',
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, week1(s))).toBe(0);
  });
});

describe('campRegistrations.register for a child', () => {
  test('takes one place and writes the child under the guardian with nothing else about the child', async () => {
    const s = await setup();
    const { registrationId } = await s.alice.mutation(
      api.campRegistrations.register,
      childArgs(youthWeek1(s)),
    );
    const { registrations } = await rows(s);
    expect(registrations).toEqual([
      {
        _id: registrationId,
        _creationTime: registrations[0]._creationTime,
        sessionId: youthWeek1(s),
        campId: s.youth.campId,
        organizationId: s.organization,
        userId: s.users['alice'],
        participant: MAYA,
        participantKey: 'minor:maya r.',
        ageConfirmedAt: NOW,
        createdAt: NOW,
      },
    ]);
    expect(Object.keys(registrations[0]).sort()).toEqual([
      '_creationTime',
      '_id',
      'ageConfirmedAt',
      'campId',
      'createdAt',
      'organizationId',
      'participant',
      'participantKey',
      'sessionId',
      'userId',
    ]);
    expect(Object.keys(registrations[0].participant).sort()).toEqual(['kind', 'minorName']);
    expect(await registeredCount(s, youthWeek1(s))).toBe(1);
  });

  test('stores the name trimmed and with inner spaces collapsed, keeping its case', async () => {
    const s = await setup();
    await s.alice.mutation(
      api.campRegistrations.register,
      childArgs(youthWeek1(s), '  Maya    Rivera '),
    );
    const { registrations } = await rows(s);
    expect(registrations[0].participant).toEqual({ kind: 'minor', minorName: 'Maya Rivera' });
    expect(registrations[0].participantKey).toBe('minor:maya rivera');
  });

  test('lets one guardian register several children, each taking a place', async () => {
    const s = await setup();
    for (const name of ['Maya R.', 'Leo R.', 'Zoe R.']) {
      await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), name));
    }
    expect((await rows(s)).registrations).toHaveLength(3);
    expect(await registeredCount(s, youthWeek1(s))).toBe(3);
  });

  test('lets the same name register for another session and under another guardian', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s)));
    await s.alice.mutation(api.campRegistrations.register, childArgs(s.mixed.sessions['Week 1']));
    await s.bob.mutation(api.campRegistrations.register, childArgs(youthWeek1(s)));
    expect(await registeredCount(s, youthWeek1(s))).toBe(2);
    expect(await registeredCount(s, s.mixed.sessions['Week 1'])).toBe(1);
  });

  test('lets a guardian register themself and a child for a camp that admits both', async () => {
    const s = await setup();
    const session = s.mixed.sessions['Week 1'];
    await s.alice.mutation(api.campRegistrations.register, args(session));
    await s.alice.mutation(api.campRegistrations.register, childArgs(session));
    expect(await registeredCount(s, session)).toBe(2);
  });

  test('refuses the same name again, also with another case or spacing, and writes nothing', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s)));
    for (const again of ['Maya R.', 'MAYA R.', 'maya r.', ' Maya   R. ']) {
      const data = await refusal(
        s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), again)),
      );
      expect(data).toEqual({
        code: 'alreadyRegistered',
        field: 'minorName',
        message: 'Maya R. is already registered for this session.',
      });
    }
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCount(s, youthWeek1(s))).toBe(1);
  });

  test('refuses an unticked age box under the box, naming the child, and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(
        api.campRegistrations.register,
        childArgs(youthWeek1(s), 'Maya R.', { ageConfirmed: false }),
      ),
    );
    expect(data).toEqual({
      code: 'ageNotConfirmed',
      field: 'ageConfirmed',
      message: "Confirm Maya R.'s age to continue.",
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, youthWeek1(s))).toBe(0);
  });

  test('refuses a child for a camp whose minimum age is 18 or more and writes nothing', async () => {
    const s = await setup();
    const data = await refusal(
      s.alice.mutation(api.campRegistrations.register, childArgs(week1(s))),
    );
    expect(data).toEqual({
      code: 'minorNotAllowed',
      message: CAMP_REGISTRATION_MESSAGES.minorNotAllowed(18),
    });
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, week1(s))).toBe(0);
  });

  test('refuses an unauthenticated caller and an identity with no users row, writing nothing', async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.campRegistrations.register, childArgs(youthWeek1(s))),
    ).rejects.toThrow('Sign in required');
    await expect(
      s.ghost.mutation(api.campRegistrations.register, childArgs(youthWeek1(s))),
    ).rejects.toThrow('Sign in required');
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, youthWeek1(s))).toBe(0);
  });

  test('refuses an empty, an over-long, and a hidden-character name under the name and writes nothing', async () => {
    const s = await setup();
    const cases = [
      ['   ', 'minorNameEmpty'],
      ['x'.repeat(61), 'minorNameTooLong'],
      ['Maya​R.', 'minorNameInvisible'],
    ] as const;
    for (const [name, code] of cases) {
      const data = await refusal(
        s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), name)),
      );
      expect(data).toMatchObject({ field: 'minorName', code });
    }
    expect((await rows(s)).registrations).toEqual([]);
  });

  test('accepts a name of 60 characters', async () => {
    const s = await setup();
    await s.alice.mutation(
      api.campRegistrations.register,
      childArgs(youthWeek1(s), 'x'.repeat(60)),
    );
    expect(await registeredCount(s, youthWeek1(s))).toBe(1);
  });

  test('refuses a closed, a full, and a draft session for a child and writes nothing', async () => {
    const s = await setup();
    const closed = s.mixed.sessions['Week 1'];
    await s.t.run(async (ctx) => {
      await ctx.db.patch('campSessions', closed, { registrationDeadline: '2027-05-30' });
      await ctx.db.patch('campSessions', youthWeek1(s), { places: 1, registeredCount: 1 });
    });
    const cases = [
      [closed, 'registrationClosed'],
      [youthWeek1(s), 'sessionFull'],
      [s.draft.sessions['Week 1'], 'campNotFound'],
    ] as const;
    for (const [sessionId, code] of cases) {
      expect(
        await refusal(s.alice.mutation(api.campRegistrations.register, childArgs(sessionId))),
      ).toMatchObject({ code });
    }
    expect((await rows(s)).registrations).toEqual([]);
    expect(await registeredCount(s, youthWeek1(s))).toBe(1);
  });

  test('refuses the 21st child of one guardian in a session', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('campSessions', youthWeek1(s), { places: 50 });
    });
    for (let i = 1; i <= MAX_MINORS_PER_SESSION; i++) {
      await s.alice.mutation(
        api.campRegistrations.register,
        childArgs(youthWeek1(s), `Child ${i}`),
      );
    }
    const data = await refusal(
      s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), 'One more')),
    );
    expect(data).toEqual({
      code: 'minorLimit',
      field: 'minorName',
      message: CAMP_REGISTRATION_MESSAGES.minorLimit,
    });
    expect(await registeredCount(s, youthWeek1(s))).toBe(MAX_MINORS_PER_SESSION);
    await s.bob.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), 'Bob child'));
    expect(await registeredCount(s, youthWeek1(s))).toBe(MAX_MINORS_PER_SESSION + 1);
  });

  test('does not overbook when one guardian registers several children at once for the last places', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('campSessions', youthWeek1(s), { places: 2 });
    });
    const results = await Promise.allSettled(
      ['Maya R.', 'Leo R.', 'Zoe R.', 'Ian R.'].map((name) =>
        s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), name)),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect((await rows(s)).registrations).toHaveLength(2);
    expect(await registeredCount(s, youthWeek1(s))).toBe(2);
  });

  test('registers the same child once when the form is pressed twice at once', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s))),
      s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), 'maya  r.')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCount(s, youthWeek1(s))).toBe(1);
  });

  test('a child and a stranger racing for the last place leave one registration', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('campSessions', youthWeek1(s), { places: 1 });
    });
    const results = await Promise.allSettled([
      s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s))),
      s.bob.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), 'Sam T.')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await registeredCount(s, youthWeek1(s))).toBe(1);
  });
});

describe('campRegistrations.listMyMinorsForCamp', () => {
  const list = (caller: Caller | Setup['t'], campSlug = 'youth-camp') =>
    caller.query(api.campRegistrations.listMyMinorsForCamp, { orgSlug: 'org-a', campSlug });

  test('lists the caller own children by session and no one else', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s)));
    await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), 'Leo R.'));
    await s.bob.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), 'Sam T.'));
    const mine = await list(s.alice);
    expect(mine).toHaveLength(2);
    expect(mine).toEqual(
      expect.arrayContaining([
        { sessionId: youthWeek1(s), minorName: 'Maya R.' },
        { sessionId: youthWeek1(s), minorName: 'Leo R.' },
      ]),
    );
    expect(await list(s.bob)).toEqual([{ sessionId: youthWeek1(s), minorName: 'Sam T.' }]);
    expect(await list(s.carol)).toEqual([]);
  });

  test('lists a session’s children in the order they were registered, not by name', async () => {
    const s = await setup();
    for (const name of ['Maya R.', 'Leo R.', 'Ana R.']) {
      await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s), name));
    }
    const names = (await list(s.alice)).map((row) => row.minorName);
    expect(names).toEqual(['Maya R.', 'Leo R.', 'Ana R.']);
  });

  test('leaves out the guardian own registration', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(s.mixed.sessions['Week 1']));
    expect(await list(s.alice, 'open-ages-camp')).toEqual([]);
  });

  test('is empty for a signed-out caller, an unknown camp, and a draft camp', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s)));
    expect(await list(s.t)).toEqual([]);
    expect(await list(s.alice, 'no-such-camp')).toEqual([]);
    expect(await list(s.alice, 'secret-draft-camp')).toEqual([]);
  });
});

describe('a registered child on the public reads', () => {
  test('the public camp page and the register query carry no child name or guardian', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, childArgs(youthWeek1(s)));
    const page = await s.t.query(api.camps.getPublicPage, {
      orgSlug: 'org-a',
      campSlug: 'youth-camp',
    });
    const asked = await s.bob.query(api.campRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      campSlug: 'youth-camp',
      sessionId: youthWeek1(s),
    });
    for (const body of [JSON.stringify(page), JSON.stringify(asked)]) {
      for (const secret of ['Maya', s.users['alice'], 'minor', 'participant']) {
        expect(body).not.toContain(secret);
      }
    }
    expect(page?.sessions[0].placesLeft).toBe(11);
  });

  test('the register query does not say a guardian who registered only a child is registered', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, childArgs(s.mixed.sessions['Week 1']));
    const asked = await s.alice.query(api.campRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      campSlug: 'open-ages-camp',
      sessionId: s.mixed.sessions['Week 1'],
    });
    expect(asked?.registered).toBe(false);
  });
});

describe('two registrations at once', () => {
  test('for the last place, exactly one succeeds and the other is refused as full', async () => {
    const s = await setup();
    const last = s.adult.sessions['Last place'];
    const results = await Promise.allSettled([
      s.alice.mutation(api.campRegistrations.register, args(last)),
      s.bob.mutation(api.campRegistrations.register, args(last)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refused!.reason).toBeInstanceOf(ConvexError);
    expect((refused!.reason as ConvexError<{ code: string }>).data).toMatchObject({
      code: 'sessionFull',
    });
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCount(s, last)).toBe(1);
  });

  test('three for two places leave exactly two registrations', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch('campSessions', week1(s), { places: 2 });
    });
    const results = await Promise.allSettled([
      s.alice.mutation(api.campRegistrations.register, args(week1(s))),
      s.bob.mutation(api.campRegistrations.register, args(week1(s))),
      s.carol.mutation(api.campRegistrations.register, args(week1(s))),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect((await rows(s)).registrations).toHaveLength(2);
    expect(await registeredCount(s, week1(s))).toBe(2);
  });

  test('one person pressing twice gets one registration', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.alice.mutation(api.campRegistrations.register, args(week1(s))),
      s.alice.mutation(api.campRegistrations.register, args(week1(s))),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await rows(s)).registrations).toHaveLength(1);
    expect(await registeredCount(s, week1(s))).toBe(1);
  });
});

describe('campRegistrations.getForRegistration', () => {
  const ask = (caller: Caller | Setup['t'], s: Setup, session: string | null = week1(s)) =>
    caller.query(api.campRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      campSlug: 'adult-beach-skills-camp',
      ...(session !== null && { sessionId: session }),
    });

  test('answers a signed-out caller with the camp and the session, not registered', async () => {
    const s = await setup();
    expect(await ask(s.t, s)).toEqual({
      organizationName: 'Org A',
      name: 'Adult Beach Skills Camp',
      minimumAge: 18,
      maximumAge: 99,
      session: {
        sessionId: week1(s),
        name: 'Week 1',
        startDate: '2027-07-05',
        endDate: '2027-07-09',
        dailyStartTime: '09:00',
        dailyEndTime: '12:00',
        registrationDeadline: '2027-06-28',
        placesLeft: 12,
      },
      registered: false,
    });
  });

  test('says registered to the person who holds a place and not to others', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    expect((await ask(s.alice, s))?.registered).toBe(true);
    expect((await ask(s.bob, s))?.registered).toBe(false);
    expect((await ask(s.t, s))?.registered).toBe(false);
    expect((await ask(s.bob, s))?.session?.placesLeft).toBe(11);
  });

  test('has a null session for a missing, malformed, or foreign session id', async () => {
    const s = await setup();
    expect((await ask(s.alice, s, null))?.session).toBeNull();
    expect((await ask(s.alice, s, 'not-an-id'))?.session).toBeNull();
    expect((await ask(s.alice, s, s.youth.sessions['Week 1']))?.session).toBeNull();
    expect((await ask(s.alice, s, s.users['alice']))?.session).toBeNull();
  });

  test('is null for a draft camp, an unknown camp, and an unknown organization', async () => {
    const s = await setup();
    expect(
      await s.alice.query(api.campRegistrations.getForRegistration, {
        orgSlug: 'org-a',
        campSlug: 'secret-draft-camp',
        sessionId: s.draft.sessions['Week 1'],
      }),
    ).toBeNull();
    expect(
      await s.alice.query(api.campRegistrations.getForRegistration, {
        orgSlug: 'org-a',
        campSlug: 'no-such-camp',
      }),
    ).toBeNull();
    expect(
      await s.alice.query(api.campRegistrations.getForRegistration, {
        orgSlug: 'org-b',
        campSlug: 'adult-beach-skills-camp',
      }),
    ).toBeNull();
  });
});

describe('a guardian who registered only a minor', () => {
  async function registerMinorOnly(s: Setup) {
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', week1(s)))!;
      await ctx.db.insert('campRegistrations', {
        sessionId: session._id,
        campId: session.campId,
        organizationId: session.organizationId,
        userId: s.users['alice'],
        participant: { kind: 'minor', minorName: 'Ava Lane' },
        participantKey: 'minor:ava lane',
        createdAt: NOW,
      });
      await ctx.db.patch('campSessions', session._id, { registeredCount: 1 });
    });
  }

  test('is not registered themself, on the register page or the camp page', async () => {
    const s = await setup();
    await registerMinorOnly(s);
    const answer = await s.alice.query(api.campRegistrations.getForRegistration, {
      orgSlug: 'org-a',
      campSlug: 'adult-beach-skills-camp',
      sessionId: week1(s),
    });
    expect(answer?.registered).toBe(false);
    expect(
      await s.alice.query(api.campRegistrations.listMineForCamp, {
        orgSlug: 'org-a',
        campSlug: 'adult-beach-skills-camp',
      }),
    ).toEqual([]);
  });

  test('can still register themself', async () => {
    const s = await setup();
    await registerMinorOnly(s);
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    expect(await registeredCount(s, week1(s))).toBe(2);
  });
});

describe('campRegistrations.listMineForCamp', () => {
  const list = (caller: Caller | Setup['t'], campSlug = 'adult-beach-skills-camp') =>
    caller.query(api.campRegistrations.listMineForCamp, { orgSlug: 'org-a', campSlug });

  test('lists the sessions the caller holds a place in', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    await s.alice.mutation(api.campRegistrations.register, args(s.adult.sessions['Last place']));
    await s.bob.mutation(api.campRegistrations.register, args(week1(s)));
    expect(new Set(await list(s.alice))).toEqual(
      new Set([week1(s), s.adult.sessions['Last place']]),
    );
    expect(await list(s.bob)).toEqual([week1(s)]);
    expect(await list(s.carol)).toEqual([]);
  });

  test('is empty for a signed-out caller, an unknown camp, and a draft camp', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    expect(await list(s.t)).toEqual([]);
    expect(await list(s.alice, 'no-such-camp')).toEqual([]);
    expect(await list(s.alice, 'secret-draft-camp')).toEqual([]);
  });
});

describe('camps.getPublicPage with registrations', () => {
  test('gives each session its id and its places left and no registrant field', async () => {
    const s = await setup();
    await s.alice.mutation(api.campRegistrations.register, args(week1(s)));
    const page = await s.t.query(api.camps.getPublicPage, {
      orgSlug: 'org-a',
      campSlug: 'adult-beach-skills-camp',
    });
    const first = page?.sessions.find((session) => session.name === 'Week 1');
    expect(first).toMatchObject({ sessionId: week1(s), placesLeft: 11 });
    const text = JSON.stringify(page);
    for (const secret of [s.users['alice'], 'alice', 'participant', 'userId', 'registrations']) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(first!).sort()).toEqual([
      'dailyEndTime',
      'dailyStartTime',
      'endDate',
      'name',
      'placesLeft',
      'registrationDeadline',
      'sessionId',
      'startDate',
    ]);
  });
});
