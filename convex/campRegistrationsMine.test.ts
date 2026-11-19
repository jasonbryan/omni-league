/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertCampRegistration } from './lib/campRegistrationWrites';
import { insertCampWaitlistEntry, promoteCampWaitlistEntry } from './lib/campWaitlistWrites';
import type { Participant } from './lib/individualRegistration';
import { MINE_ROWS_LIMIT } from './lib/myRegistrations';
import { insertCampSession, insertDraftCamp, insertTenant, publishCamp } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// Noon UTC on 2027-06-01, so the day in every time zone is 2027-06-01.
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

const SELF: Participant = { kind: 'self' };
const MINOR = (minorName: string): Participant => ({ kind: 'minor', minorName });

const SESSION = {
  places: 12,
  registrationDeadline: '2027-06-20',
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organization = await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
      locations: [
        { name: 'Alpha Beach', address: '1 Alpha St' },
        { name: 'Bravo Field', address: '2 Bravo St' },
      ],
      leagues: [],
    });
    const location = async (name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organization).eq('name', name),
        )
        .unique())!._id;
    const camp = async (
      name: string,
      slug: string,
      sessions: Record<string, Omit<Parameters<typeof insertCampSession>[2], 'name'>>,
      published = true,
    ) => {
      const campId = await insertDraftCamp(ctx, organization, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [await location('Alpha Beach'), await location('Bravo Field')],
        minimumAge: 9,
        maximumAge: 99,
      });
      const row = (await ctx.db.get('camps', campId))!;
      const sessionIds: Record<string, Id<'campSessions'>> = {};
      for (const [sessionName, session] of Object.entries(sessions)) {
        sessionIds[sessionName] = await insertCampSession(ctx, row, {
          ...session,
          name: sessionName,
        });
      }
      if (published) await publishCamp(ctx, row);
      return sessionIds;
    };
    const junior = await camp('Junior Beach Volleyball Camp', 'junior-beach-volleyball-camp', {
      'Week 1': {
        ...SESSION,
        startDate: '2027-07-05',
        endDate: '2027-07-09',
        dailyStartTime: '09:00',
        dailyEndTime: '12:30',
      },
      'Week 2': { ...SESSION, startDate: '2027-07-12', endDate: '2027-07-16' },
      'Last week': { ...SESSION, startDate: '2027-05-24', endDate: '2027-05-28' },
      'In progress': { ...SESSION, startDate: '2027-05-31', endDate: '2027-06-04' },
      'Ends today': { ...SESSION, startDate: '2027-05-28', endDate: '2027-06-01' },
    });
    const fall = await camp('Fall Break Camp', 'fall-break-camp', {
      'Week 1': { ...SESSION, startDate: '2027-06-14', endDate: '2027-06-14' },
    });
    const draft = await camp(
      'Secret Draft Camp',
      'secret-draft-camp',
      { 'Week 1': { ...SESSION, startDate: '2027-08-02', endDate: '2027-08-06' } },
      false,
    );
    const users: Record<string, Id<'users'>> = {};
    for (const name of ['guardian', 'player', 'other']) {
      users[name] = await ctx.db.insert('users', { authUserId: name, name, adultConfirmedAt: 1 });
    }
    return { junior, fall, draft, users };
  });
  return {
    t,
    ...ids,
    guardian: t.withIdentity(identity('guardian')),
    player: t.withIdentity(identity('player')),
    other: t.withIdentity(identity('other')),
    signedOut: t,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function register(
  s: Setup,
  sessionId: Id<'campSessions'>,
  who: keyof Setup['users'],
  participant: Participant,
) {
  await s.t.run(async (ctx) => {
    const session = (await ctx.db.get('campSessions', sessionId))!;
    await insertCampRegistration(ctx, session, { userId: s.users[who], participant });
  });
}

async function wait(
  s: Setup,
  sessionId: Id<'campSessions'>,
  who: keyof Setup['users'],
  participant: Participant,
): Promise<Id<'campWaitlistEntries'>> {
  return s.t.run((ctx) =>
    insertCampWaitlistEntry(ctx, sessionId, { userId: s.users[who], participant }),
  );
}

const mine = (caller: Pick<Setup['t'], 'query'>) =>
  caller.query(api.campRegistrations.listMine, {});

describe('campRegistrations.listMine', () => {
  test('gives a registration its camp, session, dates, times, locations, and who attends', async () => {
    const s = await setup();
    await register(s, s.junior['Week 1'], 'guardian', MINOR('Maya R.'));
    const [row, ...rest] = await mine(s.guardian);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      status: 'registered',
      participant: { kind: 'minor', minorName: 'Maya R.' },
      organizationName: 'Gulf Coast Sport & Social',
      organizationSlug: 'gulf-coast',
      campName: 'Junior Beach Volleyball Camp',
      campSlug: 'junior-beach-volleyball-camp',
      sessionName: 'Week 1',
      startDate: '2027-07-05',
      endDate: '2027-07-09',
      dailyStartTime: '09:00',
      dailyEndTime: '12:30',
      locations: ['Alpha Beach', 'Bravo Field'],
    });
    expect(row?.position).toBeUndefined();
  });

  test('omits the times a session has none of', async () => {
    const s = await setup();
    await register(s, s.junior['Week 2'], 'player', SELF);
    const [row] = await mine(s.player);
    expect(row).not.toHaveProperty('dailyStartTime');
    expect(row).not.toHaveProperty('dailyEndTime');
  });

  test('lists the account holder and each child in a session as separate rows', async () => {
    const s = await setup();
    await register(s, s.junior['Week 1'], 'guardian', SELF);
    await register(s, s.junior['Week 1'], 'guardian', MINOR('Maya R.'));
    await register(s, s.junior['Week 1'], 'guardian', MINOR('Sam R.'));
    const rows = await mine(s.guardian);
    expect(rows.map((row) => row.participant)).toEqual([SELF, MINOR('Maya R.'), MINOR('Sam R.')]);
    expect(new Set(rows.map((row) => row.rowId)).size).toBe(3);
  });

  test('gives a waiting entry its position in the session’s queue', async () => {
    const s = await setup();
    await wait(s, s.junior['Week 2'], 'player', SELF);
    await wait(s, s.junior['Week 2'], 'guardian', MINOR('Maya R.'));
    await wait(s, s.junior['Week 2'], 'other', SELF);
    expect(await mine(s.guardian)).toMatchObject([
      { status: 'waiting', position: 2, participant: MINOR('Maya R.'), sessionName: 'Week 2' },
    ]);
    expect(await mine(s.other)).toMatchObject([{ status: 'waiting', position: 3 }]);
  });

  test('shows a promoted entry once, as a registration', async () => {
    const s = await setup();
    const entryId = await wait(s, s.junior['Week 2'], 'guardian', MINOR('Maya R.'));
    await s.t.run(async (ctx) => {
      const entry = (await ctx.db.get('campWaitlistEntries', entryId))!;
      await promoteCampWaitlistEntry(ctx, entry);
    });
    expect(await mine(s.guardian)).toMatchObject([{ status: 'registered', sessionName: 'Week 2' }]);
  });

  test('lists the soonest first, with a session in progress ahead of one to come, and hides the past', async () => {
    const s = await setup();
    await register(s, s.junior['Week 2'], 'guardian', SELF);
    await register(s, s.junior['Last week'], 'guardian', SELF);
    await register(s, s.fall['Week 1'], 'guardian', SELF);
    await register(s, s.junior['Ends today'], 'guardian', MINOR('Maya R.'));
    await register(s, s.junior['In progress'], 'guardian', MINOR('Sam R.'));
    await register(s, s.junior['Week 1'], 'guardian', SELF);
    const rows = await mine(s.guardian);
    expect(rows.map((row) => [row.campName, row.sessionName])).toEqual([
      ['Junior Beach Volleyball Camp', 'Ends today'],
      ['Junior Beach Volleyball Camp', 'In progress'],
      ['Fall Break Camp', 'Week 1'],
      ['Junior Beach Volleyball Camp', 'Week 1'],
      ['Junior Beach Volleyball Camp', 'Week 2'],
    ]);
  });

  test('never lists another account’s registrations or waiting entries', async () => {
    const s = await setup();
    await register(s, s.junior['Week 1'], 'player', SELF);
    await wait(s, s.junior['Week 2'], 'other', SELF);
    expect(await mine(s.guardian)).toEqual([]);
    expect(await mine(s.player)).toHaveLength(1);
    expect(await mine(s.other)).toMatchObject([{ status: 'waiting', participant: SELF }]);
  });

  test('leaves out a camp that is still a draft', async () => {
    const s = await setup();
    await register(s, s.draft['Week 1'], 'guardian', SELF);
    await wait(s, s.draft['Week 1'], 'guardian', MINOR('Maya R.'));
    expect(await mine(s.guardian)).toEqual([]);
  });

  test('gives an unauthenticated caller no rows', async () => {
    const s = await setup();
    await register(s, s.junior['Week 1'], 'guardian', SELF);
    await expect(mine(s.signedOut)).resolves.toEqual([]);
  });

  test('gives a caller with no account row no rows', async () => {
    const s = await setup();
    await expect(mine(s.t.withIdentity(identity('ghost')))).resolves.toEqual([]);
  });

  test('stops at the limit, keeping the soonest, and past rows do not use it up', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.get('campSessions', s.junior['Week 2']))!;
      const past = (await ctx.db.get('campSessions', s.junior['Last week']))!;
      for (let index = 0; index < MINE_ROWS_LIMIT + 5; index++) {
        await insertCampRegistration(ctx, session, {
          userId: s.users['guardian'],
          participant: MINOR(`Child ${String(index).padStart(2, '0')}`),
        });
      }
      await insertCampRegistration(ctx, past, { userId: s.users['guardian'], participant: SELF });
    });
    await register(s, s.junior['Week 1'], 'guardian', SELF);
    const rows = await mine(s.guardian);
    expect(rows).toHaveLength(MINE_ROWS_LIMIT);
    expect(rows[0]?.sessionName).toBe('Week 1');
  });
});
