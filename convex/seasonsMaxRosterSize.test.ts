/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { hashInviteToken } from './lib/inviteToken';
import {
  addMinorEntry,
  addRosterEntry,
  insertFreeAgent,
  insertTeamInvite,
  insertTeamWithCaptain,
} from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.UTC(2030, 4, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
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

const SUMMER: NewSeason = {
  name: 'Summer 2030',
  slug: 'summer-2030',
  startDate: '2030-06-01',
  endDate: '2030-08-30',
  registrationDeadline: '2030-05-20',
  playersPerSide: 4,
  minimumRosterSize: 4,
};
const SLUGS = { orgSlug: 'org-a', leagueSlug: 'coed-4s', seasonSlug: 'summer-2030' };
const FULL = { code: 'teamFull', message: 'The team is full.' };
const GUARDIAN_TOKEN = 'guardian-token';
const NEWCOMER_TOKEN = 'newcomer-token';

async function setup({
  maxRosterSize = 4,
  full = false,
}: { maxRosterSize?: number | null; full?: boolean } = {}) {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Coed 4s',
          sport: 'beachVolleyball',
          locations: ['Alpha Beach'],
          division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
        },
        { name: 'Mens 2s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [{ name: 'Coed 4s', sport: 'beachVolleyball', locations: ['B Beach'] }],
    });
    const league = async (slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) => q.eq('organizationId', a).eq('slug', slug))
        .unique())!;
    const coed = await league('coed-4s');
    const mens = await league('mens-2s');
    const seasonId = await insertSeason(
      ctx,
      coed,
      maxRosterSize === null ? SUMMER : { ...SUMMER, maxRosterSize },
      'published',
    );
    const person = async (
      name: string,
      membership?: {
        organizationId: Id<'organizations'>;
        role: 'orgAdmin' | 'leagueOrganizer';
        leagueIds?: Id<'leagues'>[];
      },
    ) => {
      const now = Date.now();
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name,
            email: `${name}@example.test`,
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
          leagueIds: membership.leagueIds ?? [],
        });
      }
      return { authUserId: account._id, userId };
    };
    const people = {
      captain: await person('captain'),
      second: await person('second'),
      third: await person('third'),
      fourth: await person('fourth'),
      guardian: await person('guardian'),
      newcomer: await person('newcomer'),
      freeAgent: await person('free-agent'),
      rival: await person('rival'),
      adminA: await person('admin-a', { organizationId: a, role: 'orgAdmin' }),
      organizerCoed: await person('organizer-coed', {
        organizationId: a,
        role: 'leagueOrganizer',
        leagueIds: [coed._id],
      }),
      organizerMens: await person('organizer-mens', {
        organizationId: a,
        role: 'leagueOrganizer',
        leagueIds: [mens._id],
      }),
      adminB: await person('admin-b', { organizationId: b, role: 'orgAdmin' }),
      stranger: await person('stranger'),
    };
    const season = (await ctx.db.get('seasons', seasonId))!;
    const sharks = await insertTeamWithCaptain(ctx, season, {
      name: 'Sand Sharks',
      captainUserId: people.captain.userId,
    });
    const team = async () => (await ctx.db.get('teams', sharks))!;
    for (const who of [people.second, people.third]) {
      await addRosterEntry(ctx, await team(), {
        userId: who.userId,
        source: 'invite',
        addedByUserId: people.captain.userId,
      });
    }
    for (const [who, token] of [
      ['guardian', GUARDIAN_TOKEN],
      ['newcomer', NEWCOMER_TOKEN],
    ] as const) {
      await insertTeamInvite(ctx, await team(), {
        email: `${who}@example.test`,
        tokenHash: await hashInviteToken(token),
        expiresAt: Date.now() + INVITE_LIFETIME_MS,
        invitedByUserId: people.captain.userId,
      });
    }
    if (full) {
      await addRosterEntry(ctx, await team(), {
        userId: people.fourth.userId,
        source: 'invite',
        addedByUserId: people.captain.userId,
      });
    }
    await insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', seasonId))!, {
      name: 'Rivals',
      captainUserId: people.rival.userId,
    });
    const freeAgent = await insertFreeAgent(
      ctx,
      (await ctx.db.get('seasons', seasonId))!,
      people.freeAgent.userId,
    );
    return { ...people, seasonId, sharks, coedId: coed._id, freeAgentId: freeAgent._id };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return { t, ...ids, as };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function refusalOf(failure: unknown): unknown {
  return failure instanceof ConvexError ? failure.data : failure;
}

async function snapshot(s: Setup) {
  return s.t.run(async (ctx) => ({
    seasons: await ctx.db.query('seasons').collect(),
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
    invites: await ctx.db.query('teamInvites').collect(),
    freeAgents: await ctx.db.query('freeAgents').collect(),
  }));
}

const sharks = (s: Setup) => s.t.run((ctx) => ctx.db.get('teams', s.sharks));

const accept = (
  s: Setup,
  who: { authUserId: string },
  token: string,
  choices: { joinSelf?: boolean; minorName?: string } = {},
) => s.as(who).mutation(api.teamInvites.accept, { token, ...choices });

async function inviteStatus(s: Setup, email: string) {
  return s.t.run(async (ctx) => {
    const invites = await ctx.db.query('teamInvites').collect();
    return invites.find((invite) => invite.email === email)?.status;
  });
}

describe('seasons.create: maximum roster size', () => {
  const create = (s: Setup, maxRosterSize?: number) =>
    s.as(s.adminA).mutation(api.seasons.create, {
      leagueId: s.coedId,
      name: 'Fall 2030',
      slug: 'fall-2030',
      startDate: '2030-09-01',
      endDate: '2030-11-15',
      registrationDeadline: '2030-08-25',
      ...(maxRosterSize !== undefined && { maxRosterSize }),
    });

  test.each([3, 100, 7.5])(
    'with a minimum of 4, a maximum of %s is refused and nothing is created',
    async (maxRosterSize) => {
      const s = await setup();
      const before = await snapshot(s);
      expect(refusalOf(await create(s, maxRosterSize).catch((e: unknown) => e))).toEqual({
        field: 'maxRosterSize',
        code: 'maxRosterSizeInvalid',
        message: 'Enter a whole number from 4 to 99, or leave it blank.',
      });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  test('a maximum of 4 is stored, and a blank one leaves the season without a limit', async () => {
    const s = await setup();
    const { seasonId } = await create(s, 4);
    const at = await s.t.run((ctx) => ctx.db.get('seasons', seasonId));
    expect(at?.maxRosterSize).toBe(4);
    await s.t.run((ctx) => ctx.db.delete('seasons', seasonId));
    const blank = await create(s);
    const none = await s.t.run((ctx) => ctx.db.get('seasons', blank.seasonId));
    expect(none).not.toHaveProperty('maxRosterSize');
  });
});

describe('the roster writer at the maximum', () => {
  test('a full team refuses an entry by the writer, as a minor, and as an invite, and writes nothing', async () => {
    const s = await setup({ full: true });
    const before = await snapshot(s);
    const writes = [
      (team: NonNullable<Awaited<ReturnType<typeof sharks>>>) =>
        s.t.run((ctx) =>
          addRosterEntry(ctx, team, {
            userId: s.newcomer.userId,
            source: 'invite',
            addedByUserId: s.captain.userId,
          }),
        ),
      (team: NonNullable<Awaited<ReturnType<typeof sharks>>>) =>
        s.t.run((ctx) =>
          addMinorEntry(ctx, team, {
            guardianUserId: s.guardian.userId,
            minorName: 'Lily Park',
            source: 'guardian',
            addedByUserId: s.guardian.userId,
          }),
        ),
      (team: NonNullable<Awaited<ReturnType<typeof sharks>>>) =>
        s.t.run((ctx) =>
          insertTeamInvite(ctx, team, {
            email: 'late@example.test',
            tokenHash: 'late',
            expiresAt: NOW + INVITE_LIFETIME_MS,
            invitedByUserId: s.captain.userId,
          }),
        ),
    ];
    for (const write of writes) {
      const team = (await sharks(s))!;
      expect(refusalOf(await write(team).catch((e: unknown) => e))).toEqual(FULL);
    }
    expect(await snapshot(s)).toEqual(before);
  });

  test('accepting an invite, placing a free agent, and adding a minor from the team page are each refused', async () => {
    const s = await setup({ full: true });
    const before = await snapshot(s);
    const attempts = [
      () => accept(s, s.newcomer, NEWCOMER_TOKEN),
      () => accept(s, s.guardian, GUARDIAN_TOKEN, { joinSelf: false, minorName: 'Lily Park' }),
      () =>
        s.as(s.organizerCoed).mutation(api.freeAgents.place, {
          freeAgentId: s.freeAgentId,
          teamId: s.sharks,
        }),
      () =>
        s.as(s.second).mutation(api.rosterEntries.addMinor, {
          teamId: s.sharks,
          minorName: 'Theo Bell',
        }),
    ];
    for (const attempt of attempts) {
      expect(refusalOf(await attempt().catch((e: unknown) => e))).toEqual(FULL);
    }
    expect(await snapshot(s)).toEqual(before);
    expect((await sharks(s))?.rosterCount).toBe(4);
  });

  test('a guardian accepting for themself and a minor with one place left is refused as a whole; one choice then succeeds', async () => {
    const s = await setup();
    const before = await snapshot(s);
    const both = await accept(s, s.guardian, GUARDIAN_TOKEN, {
      joinSelf: true,
      minorName: 'Lily Park',
    }).catch((e: unknown) => e);
    expect(refusalOf(both)).toEqual(FULL);
    expect(await snapshot(s)).toEqual(before);
    expect((await sharks(s))?.rosterCount).toBe(3);
    expect(await inviteStatus(s, 'guardian@example.test')).toBe('pending');

    await accept(s, s.guardian, GUARDIAN_TOKEN, { joinSelf: false, minorName: 'Lily Park' });
    expect((await sharks(s))?.rosterCount).toBe(4);
    expect(await inviteStatus(s, 'guardian@example.test')).toBe('accepted');
  });

  test('a guardian joining themself alone takes the last place', async () => {
    const s = await setup();
    await accept(s, s.guardian, GUARDIAN_TOKEN, { joinSelf: true });
    expect((await sharks(s))?.rosterCount).toBe(4);
  });

  test('without a maximum a team takes entries past any size', async () => {
    const s = await setup({ maxRosterSize: null, full: true });
    await accept(s, s.newcomer, NEWCOMER_TOKEN);
    expect((await sharks(s))?.rosterCount).toBe(5);
  });
});

describe('teamInvites.create on a full team', () => {
  test('is refused, and an invite pending from before it filled cannot be accepted and stays pending', async () => {
    const s = await setup({ full: true });
    const created = await s
      .as(s.captain)
      .action(api.teamInvites.create, { teamId: s.sharks, email: 'late@example.test' })
      .catch((e: unknown) => e);
    expect(refusalOf(created)).toEqual(FULL);
    expect(refusalOf(await accept(s, s.newcomer, NEWCOMER_TOKEN).catch((e: unknown) => e))).toEqual(
      FULL,
    );
    expect(await inviteStatus(s, 'newcomer@example.test')).toBe('pending');
    expect((await sharks(s))?.pendingInviteCount).toBe(2);
  });
});

describe('seasons.setMaxRosterSize', () => {
  const set = (s: Setup, maxRosterSize: number | null, who: { authUserId: string } = s.adminA) =>
    s.as(who).mutation(api.seasons.setMaxRosterSize, { seasonId: s.seasonId, maxRosterSize });

  test('below the largest roster it is refused naming the team; 5 lets the pending invite be accepted; null removes the limit', async () => {
    const s = await setup({ full: true });
    const before = await snapshot(s);
    expect(refusalOf(await set(s, 3).catch((e: unknown) => e))).toEqual({
      field: 'maxRosterSize',
      code: 'maxRosterSizeBelowRoster',
      message: 'Sand Sharks already has 4 players. Enter 4 or more, or leave it blank.',
    });
    expect(await snapshot(s)).toEqual(before);

    await set(s, 5, s.organizerCoed);
    await accept(s, s.newcomer, NEWCOMER_TOKEN);
    expect((await sharks(s))?.rosterCount).toBe(5);

    await set(s, null);
    const season = await s.t.run((ctx) => ctx.db.get('seasons', s.seasonId));
    expect(season).not.toHaveProperty('maxRosterSize');
  });

  test.each([100, 4.5, 1])('a maximum of %s is refused with the range', async (maxRosterSize) => {
    const s = await setup({ maxRosterSize: null });
    expect(refusalOf(await set(s, maxRosterSize).catch((e: unknown) => e))).toEqual({
      field: 'maxRosterSize',
      code: 'maxRosterSizeInvalid',
      message: 'Enter a whole number from 4 to 99, or leave it blank.',
    });
  });

  test('every caller who does not organize the league, and an unknown season, are refused and nothing changes', async () => {
    const s = await setup();
    const before = await snapshot(s);
    for (const who of [s.organizerMens, s.adminB, s.captain, s.stranger]) {
      await expect(set(s, 6, who)).rejects.toThrow();
    }
    await expect(
      s.t.mutation(api.seasons.setMaxRosterSize, { seasonId: s.seasonId, maxRosterSize: 6 }),
    ).rejects.toThrow();
    const gone = await s.t.run(async (ctx) => {
      const league = (await ctx.db.get('leagues', s.coedId))!;
      const id = await insertSeason(ctx, league, { ...SUMMER, slug: 'gone' });
      await ctx.db.delete('seasons', id);
      return id;
    });
    await expect(
      s.as(s.adminA).mutation(api.seasons.setMaxRosterSize, { seasonId: gone, maxRosterSize: 6 }),
    ).rejects.toThrow('Not allowed');
    expect(await snapshot(s)).toEqual(before);
  });
});

describe('the maximum in the views', () => {
  test('the organizer view has the maximum and the largest roster; the team page and the register query have the maximum', async () => {
    const s = await setup({ full: true });
    const view = await s.as(s.adminA).query(api.seasons.getOrganizerView, SLUGS);
    expect(view?.maxRosterSize).toBe(4);
    expect(view?.largestRoster).toEqual({ name: 'Sand Sharks', rosterCount: 4 });
    const team = await s.as(s.captain).query(api.teams.getForMember, { teamId: s.sharks });
    expect(team?.maxRosterSize).toBe(4);
    expect(team?.rosterCount).toBe(4);
    const registration = await s.t.query(api.seasons.getForRegistration, SLUGS);
    expect(registration).toMatchObject({ minimumRosterSize: 4, maxRosterSize: 4 });
  });

  test('without a limit no view has a maximum', async () => {
    const s = await setup({ maxRosterSize: null });
    const view = await s.as(s.adminA).query(api.seasons.getOrganizerView, SLUGS);
    expect(view).not.toHaveProperty('maxRosterSize');
    const team = await s.as(s.captain).query(api.teams.getForMember, { teamId: s.sharks });
    expect(team).not.toHaveProperty('maxRosterSize');
    const registration = await s.t.query(api.seasons.getForRegistration, SLUGS);
    expect(registration).not.toBeNull();
    expect(registration).not.toHaveProperty('maxRosterSize');
  });
});
