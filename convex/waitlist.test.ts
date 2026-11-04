/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import {
  addRosterEntry,
  insertFreeAgent,
  insertTeamInvite,
  insertTeamWithCaptain,
} from './lib/rosterWrites';
import { insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const OPEN_NOW = Date.parse('2030-05-01T12:00:00Z');
const AFTER_DEADLINE = Date.parse('2030-05-21T12:00:00Z');

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
  maxTeams: 2,
};
const SLUGS = { orgSlug: 'org-a', leagueSlug: 'coed-4s', seasonSlug: 'summer-2030' };

const PEOPLE = [
  'captain-1',
  'captain-2',
  'player',
  'free-agent',
  'late',
  'later',
  'latest',
  'stranger',
  'admin-a',
  'organizer-coed',
  'organizer-mens',
  'admin-b',
] as const;
type Person = (typeof PEOPLE)[number];

beforeEach(() => {
  vi.useFakeTimers({ now: OPEN_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        { name: 'Coed 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
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
    const seasonId = await insertSeason(ctx, coed, SUMMER, 'published');
    await insertSeason(ctx, mens, { ...SUMMER, maxTeams: undefined }, 'published');
    const users = {} as Record<Person, { authUserId: string; userId: Id<'users'> }>;
    for (const name of PEOPLE) {
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
        name: `Name ${name}`,
        adultConfirmedAt: 1,
      });
      users[name] = { authUserId: account._id, userId };
    }
    const memberships: [
      Person,
      Id<'organizations'>,
      'orgAdmin' | 'leagueOrganizer',
      Id<'leagues'>[],
    ][] = [
      ['admin-a', a, 'orgAdmin', []],
      ['organizer-coed', a, 'leagueOrganizer', [coed._id]],
      ['organizer-mens', a, 'leagueOrganizer', [mens._id]],
      ['admin-b', b, 'orgAdmin', []],
    ];
    for (const [name, organizationId, role, leagueIds] of memberships) {
      await ctx.db.insert('memberships', {
        userId: users[name].userId,
        organizationId,
        role,
        leagueIds,
      });
    }
    const teamIds: Id<'teams'>[] = [];
    for (const [index, name] of (['captain-1', 'captain-2'] as const).entries()) {
      const season = (await ctx.db.get('seasons', seasonId))!;
      teamIds.push(
        await insertTeamWithCaptain(ctx, season, {
          name: `Team ${index + 1}`,
          captainUserId: users[name].userId,
        }),
      );
    }
    await addRosterEntry(ctx, (await ctx.db.get('teams', teamIds[0]))!, {
      userId: users.player.userId,
      source: 'invite',
      addedByUserId: users['captain-1'].userId,
    });
    await insertFreeAgent(
      ctx,
      (await ctx.db.get('seasons', seasonId))!,
      users['free-agent'].userId,
    );
    return { seasonId, users, teamOne: teamIds[0], coedId: coed._id };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const as = (s: Setup, who: Person) => s.t.withIdentity(identity(s.users[who].authUserId));

const refusalOf = (failure: unknown) =>
  failure instanceof ConvexError ? (failure.data as Record<string, unknown>) : failure;

const register = (s: Setup, who: Person, name: string) =>
  as(s, who).mutation(api.teams.register, { ...SLUGS, name });

const setMax = (s: Setup, maxTeams: number | null) =>
  as(s, 'organizer-coed').mutation(api.seasons.setMaxTeams, { seasonId: s.seasonId, maxTeams });

const promote = (
  s: Setup,
  waitlistEntryId: Id<'waitlistEntries'>,
  who: Person = 'organizer-coed',
) => as(s, who).mutation(api.waitlist.promote, { waitlistEntryId });

async function snapshot(s: Setup) {
  return s.t.run(async (ctx) => ({
    seasons: await ctx.db.query('seasons').collect(),
    teams: await ctx.db.query('teams').collect(),
    entries: await ctx.db.query('rosterEntries').collect(),
    waitlist: await ctx.db.query('waitlistEntries').collect(),
    freeAgents: await ctx.db.query('freeAgents').collect(),
    invites: await ctx.db.query('teamInvites').collect(),
  }));
}

const season = (s: Setup) => s.t.run(async (ctx) => (await ctx.db.get('seasons', s.seasonId))!);

async function waitingEntries(s: Setup) {
  return (await snapshot(s)).waitlist.filter((entry) => entry.status === 'waiting');
}

async function expectCountersMatchRecount(s: Setup): Promise<void> {
  const { seasons, teams, waitlist } = await snapshot(s);
  for (const row of seasons) {
    expect(row.teamCount).toBe(teams.filter((team) => team.seasonId === row._id).length);
    expect(row.waitlistCount).toBe(
      waitlist.filter((entry) => entry.seasonId === row._id && entry.status === 'waiting').length,
    );
  }
  for (const team of teams) {
    const { entries } = await snapshot(s);
    expect(team.rosterCount).toBe(
      entries.filter((entry) => entry.teamId === team._id && entry.status === 'rostered').length,
    );
  }
}

async function inviteTo(s: Setup, teamId: Id<'teams'>, who: Person): Promise<string> {
  const token = generateInviteToken();
  const tokenHash = await hashInviteToken(token);
  await s.t.run(async (ctx) => {
    await insertTeamInvite(ctx, (await ctx.db.get('teams', teamId))!, {
      email: `${who}@example.test`,
      tokenHash,
      expiresAt: Date.now() + INVITE_LIFETIME_MS,
      invitedByUserId: s.users['captain-1'].userId,
    });
  });
  return token;
}

describe('teams.register in a full season: the waitlist', () => {
  test('a full, open season writes a waiting entry and no team or roster entry, and the route reads position 1', async () => {
    const s = await setup();
    const before = await snapshot(s);
    expect(await register(s, 'late', ' Late   Lobsters ')).toEqual({
      status: 'waitlisted',
      position: 1,
    });
    const after = await snapshot(s);
    expect(after.teams).toEqual(before.teams);
    expect(after.entries).toEqual(before.entries);
    expect(after.waitlist).toEqual([
      expect.objectContaining({
        organizationId: before.seasons[0].organizationId,
        seasonId: s.seasonId,
        userId: s.users.late.userId,
        teamName: 'Late Lobsters',
        sortName: 'late lobsters',
        status: 'waiting',
        requestedAt: expect.any(Number) as number,
      }),
    ]);
    expect((await season(s)).waitlistCount).toBe(1);
    expect(await as(s, 'late').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      isFull: true,
      team: null,
      waitlist: { teamName: 'Late Lobsters', position: 1 },
    });
    expect(await as(s, 'later').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      waitlist: null,
    });
    expect(await s.t.query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      waitlist: null,
    });
    await expectCountersMatchRecount(s);
  });

  test('a second waiting entry is at position 2', async () => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    vi.setSystemTime(OPEN_NOW + 1000);
    expect(await register(s, 'later', 'Shore Thing')).toEqual({
      status: 'waitlisted',
      position: 2,
    });
    expect(await as(s, 'later').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      waitlist: { teamName: 'Shore Thing', position: 2 },
    });
    await expectCountersMatchRecount(s);
  });

  test.each([
    ['a team', 'TEAM 1', 'Team 1'],
    ['a waiting entry', 'late LOBSTERS', 'Late Lobsters'],
  ])('a name equal to %s, ignoring case, is refused and writes nothing', async (_, name, taken) => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    const before = await snapshot(s);
    expect(await register(s, 'later', name).catch(refusalOf)).toEqual({
      field: 'name',
      code: 'nameTaken',
      message: `${taken} is already registered in this season. Choose another name.`,
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test.each([
    [
      'a rostered player',
      'player' as const,
      'alreadyOnAnotherTeam',
      'Already on Team 1 in this season.',
    ],
    [
      'a waiting free agent',
      'free-agent' as const,
      'waitingFreeAgent',
      "You're registered as a free agent in this season. An organizer places free agents on teams.",
    ],
  ])(
    '%s of the season is refused with that message, and no waiting entry is written',
    async (_, who, code, message) => {
      const s = await setup();
      const before = await snapshot(s);
      expect(await register(s, who, 'Late Lobsters').catch(refusalOf)).toMatchObject({
        code,
        message,
      });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  test('a full season whose registration is closed refuses as closed and writes no entry', async () => {
    const s = await setup();
    vi.setSystemTime(AFTER_DEADLINE);
    const before = await snapshot(s);
    expect(await register(s, 'late', 'Late Lobsters').catch(refusalOf)).toMatchObject({
      code: 'registrationClosed',
    });
    expect(await snapshot(s)).toEqual(before);
  });
});

describe('one place per season with a waiting entry', () => {
  const ON_WAITLIST = {
    code: 'onWaitlist',
    teamName: 'Late Lobsters',
    position: 1,
    message: "You're on the waitlist with Late Lobsters in this season.",
  };

  test('another team, a free-agent registration, and an invite accept are each refused, writing nothing', async () => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    const token = await inviteTo(s, s.teamOne, 'late');
    const before = await snapshot(s);
    expect(await register(s, 'late', 'Second Try').catch(refusalOf)).toEqual(ON_WAITLIST);
    expect(await as(s, 'late').mutation(api.freeAgents.register, SLUGS).catch(refusalOf)).toEqual(
      ON_WAITLIST,
    );
    expect(
      await as(s, 'late').mutation(api.teamInvites.accept, { token }).catch(refusalOf),
    ).toEqual(ON_WAITLIST);
    expect(
      await as(s, 'late')
        .mutation(api.teamInvites.accept, { token, joinSelf: false, minorName: 'Ava Lane' })
        .catch(refusalOf),
    ).toEqual(ON_WAITLIST);
    const after = await snapshot(s);
    expect(after).toEqual(before);
    expect(after.invites.map((invite) => invite.status)).toEqual(['pending']);
  });

  test('the refusal carries the position of the waiting entry', async () => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    vi.setSystemTime(OPEN_NOW + 1000);
    await register(s, 'later', 'Shore Thing');
    expect(await register(s, 'later', 'Again').catch(refusalOf)).toMatchObject({
      code: 'onWaitlist',
      teamName: 'Shore Thing',
      position: 2,
    });
  });
});

describe('waiting teams keep their place', () => {
  test('with the maximum raised from 2 to 3, a new team is waitlisted at position 2, isFull stays true, and promoting the first succeeds', async () => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    await setMax(s, 3);
    vi.setSystemTime(OPEN_NOW + 1000);
    expect(await register(s, 'later', 'Shore Thing')).toEqual({
      status: 'waitlisted',
      position: 2,
    });
    expect(await s.t.query(api.seasons.getForRegistration, SLUGS)).toMatchObject({ isFull: true });
    expect(await s.t.query(api.seasons.getPublicPage, SLUGS)).toMatchObject({ isFull: true });
    const [first] = await waitingEntries(s);
    await expect(promote(s, first._id)).resolves.toMatchObject({ teamCount: 3, maxTeams: 3 });
    await expectCountersMatchRecount(s);
  });

  test('with the maximum removed and a waiting entry, a new team is waitlisted too', async () => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    await setMax(s, null);
    vi.setSystemTime(OPEN_NOW + 1000);
    expect(await register(s, 'later', 'Shore Thing')).toEqual({
      status: 'waitlisted',
      position: 2,
    });
    expect((await snapshot(s)).teams).toHaveLength(2);
  });
});

describe('waitlist.promote', () => {
  async function raisedWithEntry() {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    await setMax(s, 3);
    const [entry] = await waitingEntries(s);
    return { s, entryId: entry._id };
  }

  test('creates the team and the captain entry, counts it, and marks the entry promoted; its own name does not refuse it', async () => {
    const { s, entryId } = await raisedWithEntry();
    vi.setSystemTime(OPEN_NOW + 5000);
    const result = await promote(s, entryId);
    expect(result).toEqual({ teamId: expect.any(String) as string, teamCount: 3, maxTeams: 3 });
    const { teams, entries, waitlist } = await snapshot(s);
    const team = teams.find((row) => row._id === result.teamId)!;
    expect(team).toMatchObject({
      name: 'Late Lobsters',
      captainUserId: s.users.late.userId,
      rosterCount: 1,
    });
    expect(entries.filter((entry) => entry.teamId === team._id)).toEqual([
      expect.objectContaining({
        userId: s.users.late.userId,
        source: 'captain',
        status: 'rostered',
      }),
    ]);
    expect(waitlist).toEqual([
      expect.objectContaining({
        status: 'promoted',
        promotedTeamId: team._id,
        promotedAt: OPEN_NOW + 5000,
        promotedByUserId: s.users['organizer-coed'].userId,
      }),
    ]);
    expect(await season(s)).toMatchObject({ teamCount: 3, waitlistCount: 0 });
    expect(await as(s, 'late').query(api.teams.listMine, {})).toEqual([
      expect.objectContaining({ teamId: team._id, teamName: 'Late Lobsters', role: 'captain' }),
    ]);
    expect(await as(s, 'late').query(api.seasons.getForRegistration, SLUGS)).toMatchObject({
      waitlist: null,
      team: { name: 'Late Lobsters', isCaptain: true },
    });
    await expectCountersMatchRecount(s);
  });

  test('ignores the registration deadline', async () => {
    const { s, entryId } = await raisedWithEntry();
    vi.setSystemTime(AFTER_DEADLINE);
    await expect(promote(s, entryId)).resolves.toMatchObject({ teamCount: 3 });
  });

  test('with no room, it is refused and writes nothing', async () => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    const [entry] = await waitingEntries(s);
    const before = await snapshot(s);
    expect(await promote(s, entry._id).catch(refusalOf)).toEqual({
      code: 'noRoom',
      message: 'The season is full. Raise the maximum teams first.',
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test('an entry already promoted is refused and writes nothing', async () => {
    const { s, entryId } = await raisedWithEntry();
    await promote(s, entryId);
    await setMax(s, 4);
    const before = await snapshot(s);
    expect(await promote(s, entryId).catch(refusalOf)).toEqual({
      code: 'alreadyPromoted',
      message: 'It has already been promoted.',
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test('a captain who holds a rostered entry in the season (test seed) is refused and nothing is written', async () => {
    const { s, entryId } = await raisedWithEntry();
    await s.t.run(async (ctx) => {
      await ctx.db.insert('rosterEntries', {
        organizationId: (await ctx.db.get('seasons', s.seasonId))!.organizationId,
        seasonId: s.seasonId,
        teamId: s.teamOne,
        userId: s.users.late.userId,
        status: 'rostered',
        source: 'invite',
        addedAt: Date.now(),
        addedByUserId: s.users['captain-1'].userId,
      });
    });
    const before = await snapshot(s);
    expect(await promote(s, entryId).catch(refusalOf)).toEqual({
      code: 'alreadyOnAnotherTeam',
      teamName: 'Team 1',
      message: 'Already on Team 1 in this season.',
    });
    expect(await snapshot(s)).toEqual(before);
  });

  test('an org admin of the organization may promote', async () => {
    const { s, entryId } = await raisedWithEntry();
    await expect(promote(s, entryId, 'admin-a')).resolves.toMatchObject({ teamCount: 3 });
  });

  test.each(['organizer-mens', 'admin-b', 'captain-1', 'stranger'] as const)(
    '%s is refused and nothing is written',
    async (who) => {
      const { s, entryId } = await raisedWithEntry();
      const before = await snapshot(s);
      await expect(promote(s, entryId, who)).rejects.toThrow();
      expect(await snapshot(s)).toEqual(before);
    },
  );

  test('an unauthenticated caller is refused', async () => {
    const { s, entryId } = await raisedWithEntry();
    await expect(
      s.t.mutation(api.waitlist.promote, { waitlistEntryId: entryId }),
    ).rejects.toThrow();
    expect(await waitingEntries(s)).toHaveLength(1);
  });
});

describe('waitlist.listForOrganizer', () => {
  async function twoWaiting() {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    vi.setSystemTime(OPEN_NOW + 1000);
    await register(s, 'later', 'Shore Thing');
    return s;
  }

  test('lists the waiting entries oldest first with captain and email, and the total', async () => {
    const s = await twoWaiting();
    const list = await as(s, 'organizer-coed').query(api.waitlist.listForOrganizer, SLUGS);
    expect(list).toEqual({
      rows: [
        {
          waitlistEntryId: expect.any(String) as string,
          teamName: 'Late Lobsters',
          captainName: 'Name late',
          captainEmail: 'late@example.test',
          requestedAt: OPEN_NOW,
        },
        {
          waitlistEntryId: expect.any(String) as string,
          teamName: 'Shore Thing',
          captainName: 'Name later',
          captainEmail: 'later@example.test',
          requestedAt: OPEN_NOW + 1000,
        },
      ],
      waitlistCount: 2,
    });
    expect(await as(s, 'admin-a').query(api.waitlist.listForOrganizer, SLUGS)).toMatchObject({
      waitlistCount: 2,
    });
  });

  test.each(['organizer-mens', 'admin-b', 'captain-1', 'late', 'stranger'] as const)(
    '%s is refused',
    async (who) => {
      const s = await twoWaiting();
      const answer = await as(s, who)
        .query(api.waitlist.listForOrganizer, SLUGS)
        .catch((failure: unknown) => failure);
      expect(answer).not.toMatchObject({ waitlistCount: expect.any(Number) as number });
    },
  );

  test('an unauthenticated caller is refused', async () => {
    const s = await twoWaiting();
    const answer = await s.t
      .query(api.waitlist.listForOrganizer, SLUGS)
      .catch((failure: unknown) => failure);
    expect(answer).not.toMatchObject({ waitlistCount: expect.any(Number) as number });
  });

  test('an unknown slug and a season slug of another league give null', async () => {
    const s = await twoWaiting();
    const organizer = as(s, 'organizer-coed');
    expect(
      await organizer.query(api.waitlist.listForOrganizer, { ...SLUGS, seasonSlug: 'nope' }),
    ).toBeNull();
    expect(
      await as(s, 'admin-a').query(api.waitlist.listForOrganizer, { ...SLUGS, leagueSlug: 'nope' }),
    ).toBeNull();
    expect(
      await organizer
        .query(api.waitlist.listForOrganizer, { ...SLUGS, leagueSlug: 'mens-2s' })
        .catch((failure: unknown) => failure),
    ).not.toMatchObject({ rows: expect.anything() as unknown });
  });
});

describe('waiting entries are not teams', () => {
  test('no teams query lists them and no roster entry exists for them', async () => {
    const s = await setup();
    await register(s, 'late', 'Late Lobsters');
    const organizerView = await as(s, 'organizer-coed').query(api.seasons.getOrganizerView, SLUGS);
    expect(organizerView?.teams.map((team) => team.name)).toEqual(['Team 1', 'Team 2']);
    expect(organizerView?.teamCount).toBe(2);
    const publicTeams = await s.t.query(api.teams.listPublic, { ...SLUGS, page: 1 });
    expect(publicTeams.rows.map((row) => row.name)).toEqual(['Team 1', 'Team 2']);
    expect(
      (await as(s, 'player').query(api.teams.listForSeasonMember, { teamId: s.teamOne }))?.rows.map(
        (row) => row.name,
      ),
    ).toEqual(['Team 1', 'Team 2']);
    expect((await snapshot(s)).entries.some((entry) => entry.userId === s.users.late.userId)).toBe(
      false,
    );
    expect(await as(s, 'late').query(api.teams.listMine, {})).toEqual([]);
  });
});
