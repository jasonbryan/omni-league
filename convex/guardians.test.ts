/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MAX_MINORS_PER_GUARDIAN_IN_SEASON } from './lib/minorName';
import { addMinorEntry, addRosterEntry, insertTeamWithCaptain } from './lib/rosterWrites';
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

const SLUGS = { orgSlug: 'gulf-coast', leagueSlug: 'coed-4s', seasonSlug: 'summer-2030' };

const PEOPLE = {
  captain: 'Tasha Greene',
  player: 'Elena Ruiz',
  guardian: 'Ana Rivera',
  otherGuardian: 'Marcus Bell',
  rivalCaptain: 'Jalen Brooks',
  rivalPlayer: 'Devon Park',
  fallCaptain: 'Kai Nakamura',
  organizer: 'Olivia Organizer',
  otherOrganizer: 'Oscar Organizer',
  outsider: 'Sam Okoye',
} as const;

type Who = keyof typeof PEOPLE;

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const organizationId = await insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        { name: 'Coed 4s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
        { name: 'Mens 2s', sport: 'beachVolleyball', locations: ['Alpha Beach'] },
      ],
    });
    const league = async (slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!;
    const coed = await league('coed-4s');
    const mens = await league('mens-2s');
    const summerId = await insertSeason(ctx, coed, SUMMER, 'published');
    const fallId = await insertSeason(
      ctx,
      coed,
      { ...SUMMER, name: 'Fall 2030', slug: 'fall-2030', startDate: '2030-09-01' },
      'published',
    );
    const people = {} as Record<Who, { authUserId: string; userId: Id<'users'> }>;
    for (const [key, name] of Object.entries(PEOPLE) as [Who, string][]) {
      const now = Date.now();
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name,
            email: `${key}@example.test`,
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
      people[key] = { authUserId: account._id, userId };
    }
    await ctx.db.insert('memberships', {
      userId: people.organizer.userId,
      organizationId,
      role: 'leagueOrganizer',
      leagueIds: [coed._id],
    });
    await ctx.db.insert('memberships', {
      userId: people.otherOrganizer.userId,
      organizationId,
      role: 'leagueOrganizer',
      leagueIds: [mens._id],
    });
    const season = async (id: Id<'seasons'>) => (await ctx.db.get('seasons', id))!;
    const sharks = await insertTeamWithCaptain(ctx, await season(summerId), {
      name: 'Sand Sharks',
      captainUserId: people.captain.userId,
    });
    await addRosterEntry(ctx, (await ctx.db.get('teams', sharks))!, {
      userId: people.player.userId,
      source: 'invite',
      addedByUserId: people.captain.userId,
    });
    const party = await insertTeamWithCaptain(ctx, await season(summerId), {
      name: 'Block Party',
      captainUserId: people.rivalCaptain.userId,
    });
    await addRosterEntry(ctx, (await ctx.db.get('teams', party))!, {
      userId: people.rivalPlayer.userId,
      source: 'invite',
      addedByUserId: people.rivalCaptain.userId,
    });
    const fallCrew = await insertTeamWithCaptain(ctx, await season(fallId), {
      name: 'Fall Crew',
      captainUserId: people.fallCaptain.userId,
    });
    return { people, summerId, sharks, party, fallCrew };
  });
  const as = (who: Who) => t.withIdentity(identity(ids.people[who].authUserId));
  return { t, ...ids, as };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function inviteToken(s: Setup, email: string, teamId: Id<'teams'>, from: Who) {
  return (await s.as(from).action(api.teamInvites.create, { teamId, email })).token;
}

const CAPTAIN_OF = (s: Setup, teamId: Id<'teams'>): Who =>
  teamId === s.sharks ? 'captain' : teamId === s.party ? 'rivalCaptain' : 'fallCaptain';

async function acceptAs(
  s: Setup,
  who: Who,
  teamId: Id<'teams'>,
  choices: { joinSelf?: boolean; minorName?: string },
) {
  const token = await inviteToken(s, `${who}@example.test`, teamId, CAPTAIN_OF(s, teamId));
  const result = await s.as(who).mutation(api.teamInvites.accept, { token, ...choices });
  return { token, result };
}

/** A minor entry written straight through the roster writer, as an accepted invite would. */
async function seedMinor(s: Setup, guardian: Who, teamId: Id<'teams'>, minorName: string) {
  return s.t.run(async (ctx) =>
    addMinorEntry(ctx, (await ctx.db.get('teams', teamId))!, {
      guardianUserId: s.people[guardian].userId,
      minorName,
      source: 'invite',
      addedByUserId: s.people.captain.userId,
    }),
  );
}

async function seedPlayer(s: Setup, who: Who, teamId: Id<'teams'>) {
  await s.t.run(async (ctx) =>
    addRosterEntry(ctx, (await ctx.db.get('teams', teamId))!, {
      userId: s.people[who].userId,
      source: 'invite',
      addedByUserId: s.people.captain.userId,
    }),
  );
}

const snapshot = (s: Setup) =>
  s.t.run(async (ctx) => ({
    entries: await ctx.db.query('rosterEntries').collect(),
    teams: await ctx.db.query('teams').collect(),
    invites: await ctx.db.query('teamInvites').collect(),
  }));

const rosterCount = async (s: Setup, teamId: Id<'teams'>) =>
  (await snapshot(s)).teams.find((team) => team._id === teamId)!.rosterCount;

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (failure) {
    return failure instanceof ConvexError ? failure.data : String(failure);
  }
  throw new Error('Expected a refusal');
}

describe('teamInvites.accept with choices', () => {
  test('"Add a minor" alone writes one minor entry under the guardian, no entry of their own, and accepts the invite', async () => {
    const s = await setup();
    const before = await rosterCount(s, s.sharks);
    const { result } = await acceptAs(s, 'guardian', s.sharks, {
      joinSelf: false,
      minorName: '  Maya   Rivera ',
    });
    expect(result).toMatchObject({ teamId: s.sharks, joinedSelf: false, minorName: 'Maya Rivera' });
    const { entries, invites } = await snapshot(s);
    const mine = entries.filter((entry) => entry.userId === s.people.guardian.userId);
    expect(mine).toMatchObject([
      { teamId: s.sharks, minorName: 'Maya Rivera', status: 'rostered', source: 'invite' },
    ]);
    expect(await rosterCount(s, s.sharks)).toBe(before + 1);
    expect(invites.map((invite) => invite.status)).toEqual(['accepted']);
  });

  test('both choices write an adult entry and a minor entry and raise the count by 2', async () => {
    const s = await setup();
    const before = await rosterCount(s, s.sharks);
    await acceptAs(s, 'guardian', s.sharks, { joinSelf: true, minorName: 'Maya Rivera' });
    const mine = (await snapshot(s)).entries.filter(
      (entry) => entry.userId === s.people.guardian.userId,
    );
    expect(mine.map((entry) => entry.minorName ?? null)).toEqual([null, 'Maya Rivera']);
    expect(await rosterCount(s, s.sharks)).toBe(before + 2);
  });

  test.each([
    ['neither choice', { joinSelf: false }, 'nothingChosen'],
    ['an empty minor name', { joinSelf: false, minorName: '   ' }, 'minorNameEmpty'],
    [
      'a 61-character minor name',
      { joinSelf: true, minorName: 'M'.repeat(61) },
      'minorNameTooLong',
    ],
  ])('%s is refused, writes nothing, and leaves the invite pending', async (_, choices, code) => {
    const s = await setup();
    const token = await inviteToken(s, 'guardian@example.test', s.sharks, 'captain');
    const before = await snapshot(s);
    expect(
      await refusalOf(s.as('guardian').mutation(api.teamInvites.accept, { token, ...choices })),
    ).toMatchObject({ code });
    const after = await snapshot(s);
    expect(after.entries).toEqual(before.entries);
    expect(after.invites.map((invite) => invite.status)).toEqual(['pending']);
  });

  test('a guardian on another team of the season may add a minor alone, but not join themself', async () => {
    const s = await setup();
    await seedPlayer(s, 'guardian', s.party);
    const token = await inviteToken(s, 'guardian@example.test', s.sharks, 'captain');
    expect(
      await refusalOf(s.as('guardian').mutation(api.teamInvites.accept, { token })),
    ).toMatchObject({ code: 'alreadyOnAnotherTeam', teamName: 'Block Party' });
    await s.as('guardian').mutation(api.teamInvites.accept, {
      token,
      joinSelf: false,
      minorName: 'Maya Rivera',
    });
    const mine = (await snapshot(s)).entries.filter(
      (entry) => entry.userId === s.people.guardian.userId,
    );
    expect(mine.map((entry) => [entry.teamId, entry.minorName ?? null])).toEqual([
      [s.party, null],
      [s.sharks, 'Maya Rivera'],
    ]);
  });

  test('with only a token, accept joins the caller as before', async () => {
    const s = await setup();
    const token = await inviteToken(s, 'guardian@example.test', s.sharks, 'captain');
    const result = await s.as('guardian').mutation(api.teamInvites.accept, { token });
    expect(result).toMatchObject({ teamName: 'Sand Sharks', joinedSelf: true, minorName: null });
    const mine = (await snapshot(s)).entries.filter(
      (entry) => entry.userId === s.people.guardian.userId,
    );
    expect(mine).toMatchObject([{ teamId: s.sharks, status: 'rostered' }]);
    expect(mine[0].minorName).toBeUndefined();
  });
});

describe('rosterEntries.addMinor', () => {
  test('a guardian with their own entry and a minor adds a second minor from the team page', async () => {
    const s = await setup();
    await seedPlayer(s, 'guardian', s.sharks);
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    const before = await rosterCount(s, s.sharks);
    const added = await s
      .as('guardian')
      .mutation(api.rosterEntries.addMinor, { teamId: s.sharks, minorName: 'Leo Rivera' });
    expect(added.minorName).toBe('Leo Rivera');
    const entry = (await snapshot(s)).entries.find((row) => row._id === added.rosterEntryId);
    expect(entry).toMatchObject({
      minorName: 'Leo Rivera',
      userId: s.people.guardian.userId,
      source: 'guardian',
      addedByUserId: s.people.guardian.userId,
    });
    expect(await rosterCount(s, s.sharks)).toBe(before + 1);
  });

  test('a guardian whose only entry on the team is a minor’s adds a second minor', async () => {
    const s = await setup();
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    await s
      .as('guardian')
      .mutation(api.rosterEntries.addMinor, { teamId: s.sharks, minorName: 'Leo Rivera' });
    const minors = (await snapshot(s)).entries.filter(
      (entry) => entry.userId === s.people.guardian.userId,
    );
    expect(minors.map((entry) => entry.minorName)).toEqual(['Maya Rivera', 'Leo Rivera']);
  });

  test('a member of another team, a removed member, and an unauthenticated caller are refused', async () => {
    const s = await setup();
    const add = { teamId: s.sharks, minorName: 'Leo Rivera' };
    expect(
      await refusalOf(s.as('rivalPlayer').mutation(api.rosterEntries.addMinor, add)),
    ).toContain('Not allowed');
    const playerEntry = (await snapshot(s)).entries.find(
      (entry) => entry.userId === s.people.player.userId,
    )!;
    await s.as('captain').mutation(api.rosterEntries.remove, { rosterEntryId: playerEntry._id });
    expect(await refusalOf(s.as('player').mutation(api.rosterEntries.addMinor, add))).toContain(
      'Not allowed',
    );
    expect(await refusalOf(s.t.mutation(api.rosterEntries.addMinor, add))).toContain(
      'Sign in required',
    );
    expect(
      (await snapshot(s)).entries.filter((entry) => entry.minorName !== undefined),
    ).toHaveLength(0);
  });
});

describe('the same minor in a season', () => {
  test('the guardian’s minor is refused a second place in the season, by addMinor or accept; another minor and another season are not', async () => {
    const s = await setup();
    await seedPlayer(s, 'guardian', s.sharks);
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    const before = await snapshot(s);
    expect(
      await refusalOf(
        s
          .as('guardian')
          .mutation(api.rosterEntries.addMinor, { teamId: s.sharks, minorName: 'maya  rivera' }),
      ),
    ).toEqual({
      field: 'minorName',
      code: 'minorInSeason',
      minorName: 'Maya Rivera',
      teamName: 'Sand Sharks',
      message: 'Maya Rivera is already on Sand Sharks in this season.',
    });

    const token = await inviteToken(s, 'guardian@example.test', s.party, 'rivalCaptain');
    expect(
      await refusalOf(
        s.as('guardian').mutation(api.teamInvites.accept, {
          token,
          joinSelf: false,
          minorName: 'MAYA RIVERA',
        }),
      ),
    ).toMatchObject({ code: 'minorInSeason', teamName: 'Sand Sharks' });
    const refused = await snapshot(s);
    expect(refused.entries).toEqual(before.entries);
    expect(refused.invites.map((invite) => invite.status)).toEqual(['pending']);

    await s.as('guardian').mutation(api.teamInvites.accept, {
      token,
      joinSelf: false,
      minorName: 'Leo Rivera',
    });
    await acceptAs(s, 'guardian', s.fallCrew, { joinSelf: false, minorName: 'Maya Rivera' });
    const minors = (await snapshot(s)).entries.filter((entry) => entry.minorName !== undefined);
    expect(minors.map((entry) => [entry.teamId, entry.minorName])).toEqual([
      [s.sharks, 'Maya Rivera'],
      [s.party, 'Leo Rivera'],
      [s.fallCrew, 'Maya Rivera'],
    ]);
  });

  test('renaming a minor to the name of the guardian’s other minor in the season is refused; a change of case is not', async () => {
    const s = await setup();
    const maya = await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    const leo = await seedMinor(s, 'guardian', s.party, 'Leo Rivera');
    expect(
      await refusalOf(
        s.as('guardian').mutation(api.rosterEntries.renameMinor, {
          rosterEntryId: leo,
          minorName: 'Maya Rivera',
        }),
      ),
    ).toMatchObject({ code: 'minorInSeason', teamName: 'Sand Sharks' });
    await s
      .as('guardian')
      .mutation(api.rosterEntries.renameMinor, { rosterEntryId: maya, minorName: 'maya rivera' });
    const { entries } = await snapshot(s);
    expect(entries.find((entry) => entry._id === maya)?.minorName).toBe('maya rivera');
    expect(entries.find((entry) => entry._id === leo)?.minorName).toBe('Leo Rivera');
  });
});

async function addAndRemoveMinors(s: Setup, guardian: Who, teamId: Id<'teams'>, count: number) {
  for (let i = 0; i < count; i++) {
    const { rosterEntryId } = await s
      .as(guardian)
      .mutation(api.rosterEntries.addMinor, { teamId, minorName: `Cycle ${i}` });
    await s.as(guardian).mutation(api.rosterEntries.remove, { rosterEntryId });
  }
}

describe('a guardian’s minors in a season', () => {
  test(`are limited to ${MAX_MINORS_PER_GUARDIAN_IN_SEASON}, removed ones included, by addMinor and accept`, async () => {
    const s = await setup();
    await seedPlayer(s, 'guardian', s.sharks);
    await addAndRemoveMinors(s, 'guardian', s.sharks, MAX_MINORS_PER_GUARDIAN_IN_SEASON);
    const before = await snapshot(s);
    expect(
      await refusalOf(
        s
          .as('guardian')
          .mutation(api.rosterEntries.addMinor, { teamId: s.sharks, minorName: 'Maya Rivera' }),
      ),
    ).toEqual({
      field: 'minorName',
      code: 'minorLimit',
      message: `You’ve added ${MAX_MINORS_PER_GUARDIAN_IN_SEASON} minors in this season, removed ones included, which is the most one guardian can add.`,
    });
    const token = await inviteToken(s, 'guardian@example.test', s.party, 'rivalCaptain');
    expect(
      await refusalOf(
        s.as('guardian').mutation(api.teamInvites.accept, {
          token,
          joinSelf: false,
          minorName: 'Maya Rivera',
        }),
      ),
    ).toMatchObject({ code: 'minorLimit' });
    const refused = await snapshot(s);
    expect(refused.entries).toEqual(before.entries);
    expect(refused.invites.map((invite) => invite.status)).toEqual(['pending']);
    await acceptAs(s, 'guardian', s.fallCrew, { joinSelf: false, minorName: 'Maya Rivera' });
  });

  test('a guardian at the limit who captains a team cannot register or captain a second one', async () => {
    const s = await setup();
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    await addAndRemoveMinors(s, 'guardian', s.sharks, MAX_MINORS_PER_GUARDIAN_IN_SEASON - 1);
    await s.as('guardian').mutation(api.teams.register, { ...SLUGS, name: 'Rivera Rockets' });
    expect(
      await refusalOf(
        s.as('guardian').mutation(api.teams.register, { ...SLUGS, name: 'Rivera Rollers' }),
      ),
    ).toMatchObject({ code: 'alreadyOnAnotherTeam', teamName: 'Rivera Rockets' });
    expect(
      (await snapshot(s)).teams.filter((team) => team.captainUserId === s.people.guardian.userId),
    ).toHaveLength(1);
  });

  test('do not hide the guardian’s own entry, however many there are', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const team = (await ctx.db.get('teams', s.sharks))!;
      for (let i = 0; i < 150; i++) {
        await ctx.db.insert('rosterEntries', {
          organizationId: team.organizationId,
          seasonId: team.seasonId,
          teamId: team._id,
          userId: s.people.guardian.userId,
          minorName: `Old ${i}`,
          status: 'removed',
          source: 'guardian',
          addedAt: 1,
          addedByUserId: s.people.guardian.userId,
        });
      }
    });
    await s.as('guardian').mutation(api.teams.register, { ...SLUGS, name: 'Rivera Rockets' });
    expect(
      await refusalOf(
        s.as('guardian').mutation(api.teams.register, { ...SLUGS, name: 'Rivera Rollers' }),
      ),
    ).toMatchObject({ code: 'alreadyOnAnotherTeam' });
    expect(
      await refusalOf(s.as('guardian').mutation(api.freeAgents.register, SLUGS)),
    ).toMatchObject({ code: 'alreadyOnAnotherTeam' });
    const registration = await s.as('guardian').query(api.seasons.getForRegistration, SLUGS);
    expect(registration?.team).toMatchObject({ name: 'Rivera Rockets' });
  });

  test('the same minor cannot go on a second team after many minors were added and removed', async () => {
    const s = await setup();
    await seedPlayer(s, 'guardian', s.sharks);
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    await addAndRemoveMinors(s, 'guardian', s.sharks, MAX_MINORS_PER_GUARDIAN_IN_SEASON - 2);
    const token = await inviteToken(s, 'guardian@example.test', s.party, 'rivalCaptain');
    expect(
      await refusalOf(
        s.as('guardian').mutation(api.teamInvites.accept, {
          token,
          joinSelf: false,
          minorName: 'maya rivera',
        }),
      ),
    ).toMatchObject({ code: 'minorInSeason', teamName: 'Sand Sharks' });
    const { rosterEntryId } = await s
      .as('guardian')
      .mutation(api.rosterEntries.addMinor, { teamId: s.sharks, minorName: 'Leo Rivera' });
    expect(
      await refusalOf(
        s
          .as('guardian')
          .mutation(api.rosterEntries.renameMinor, { rosterEntryId, minorName: 'Maya Rivera' }),
      ),
    ).toMatchObject({ code: 'minorInSeason', teamName: 'Sand Sharks' });
    const rostered = (await snapshot(s)).entries.filter(
      (entry) => entry.minorName !== undefined && entry.status === 'rostered',
    );
    expect(rostered.map((entry) => [entry.teamId, entry.minorName])).toEqual([
      [s.sharks, 'Maya Rivera'],
      [s.sharks, 'Leo Rivera'],
    ]);
  });
});

describe('a guardian whose only entry in the season is a minor’s', () => {
  test('has no team on the register route, registers a team, and can be invited to join the minor’s team', async () => {
    const s = await setup();
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    const registration = await s.as('guardian').query(api.seasons.getForRegistration, SLUGS);
    expect(registration?.team).toBeNull();
    const invited = await s.as('captain').action(api.teamInvites.create, {
      teamId: s.sharks,
      email: 'guardian@example.test',
    });
    expect(invited.token).not.toBe('');
    const { teamId } = await s
      .as('guardian')
      .mutation(api.teams.register, { ...SLUGS, name: 'Rivera Rockets' });
    expect((await snapshot(s)).teams.find((team) => team._id === teamId)?.rosterCount).toBe(1);
  });

  test('registers as a free agent', async () => {
    const s = await setup();
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    await expect(s.as('guardian').mutation(api.freeAgents.register, SLUGS)).resolves.toMatchObject({
      status: 'waiting',
    });
  });
});

describe('teams.listMine for a guardian', () => {
  test('lists each team once: the role of their own entry, else guardian', async () => {
    const s = await setup();
    await seedPlayer(s, 'guardian', s.sharks);
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    await seedMinor(s, 'guardian', s.fallCrew, 'Leo Rivera');
    const rows = await s.as('guardian').query(api.teams.listMine, {});
    expect(rows.map((row) => [row.teamName, row.role])).toEqual([
      ['Fall Crew', 'guardian'],
      ['Sand Sharks', 'player'],
    ]);
  });

  test('a captain with a minor on their own team stays captain', async () => {
    const s = await setup();
    await seedMinor(s, 'captain', s.sharks, 'Theo Greene');
    const rows = await s.as('captain').query(api.teams.listMine, {});
    expect(rows.map((row) => [row.teamName, row.role])).toEqual([['Sand Sharks', 'captain']]);
  });
});

describe('renaming and removing a minor', () => {
  test.each<[string, Who]>([
    ['its guardian', 'guardian'],
    ['an organizer of the league', 'organizer'],
  ])('%s may rename it and remove it', async (_, who) => {
    const s = await setup();
    const maya = await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    await expect(
      s.as(who).mutation(api.rosterEntries.renameMinor, {
        rosterEntryId: maya,
        minorName: ' Maya  Rivera-Lopez ',
      }),
    ).resolves.toEqual({ minorName: 'Maya Rivera-Lopez' });
    const before = await rosterCount(s, s.sharks);
    await s.as(who).mutation(api.rosterEntries.remove, { rosterEntryId: maya });
    const entry = (await snapshot(s)).entries.find((row) => row._id === maya);
    expect(entry).toMatchObject({ status: 'removed', minorName: 'Maya Rivera-Lopez' });
    expect(entry?.removedByUserId).toBe(s.people[who].userId);
    expect(await rosterCount(s, s.sharks)).toBe(before - 1);
  });

  test('the captain may remove it but not rename it', async () => {
    const s = await setup();
    const maya = await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    expect(
      await refusalOf(
        s
          .as('captain')
          .mutation(api.rosterEntries.renameMinor, { rosterEntryId: maya, minorName: 'Maya R' }),
      ),
    ).toContain('Not allowed');
    await s.as('captain').mutation(api.rosterEntries.remove, { rosterEntryId: maya });
    expect((await snapshot(s)).entries.find((row) => row._id === maya)?.status).toBe('removed');
  });

  test('a captain removes their own minor, which is not the captain’s place', async () => {
    const s = await setup();
    const theo = await seedMinor(s, 'captain', s.sharks, 'Theo Greene');
    await s.as('captain').mutation(api.rosterEntries.remove, { rosterEntryId: theo });
    const { entries } = await snapshot(s);
    expect(entries.find((row) => row._id === theo)?.status).toBe('removed');
    expect(
      entries.find((row) => row.userId === s.people.captain.userId && !row.minorName)?.status,
    ).toBe('rostered');
  });

  test.each<[string, Who | null]>([
    ['another member of the team', 'player'],
    ['a guardian of another minor', 'otherGuardian'],
    ['an organizer of another league', 'otherOrganizer'],
    ['an unauthenticated caller', null],
  ])('%s may neither rename nor remove it', async (_, who) => {
    const s = await setup();
    const maya = await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    await seedMinor(s, 'otherGuardian', s.sharks, 'Theo Bell');
    const caller = who ? s.as(who) : s.t;
    expect(
      String(
        await refusalOf(
          caller.mutation(api.rosterEntries.renameMinor, { rosterEntryId: maya, minorName: 'X' }),
        ),
      ),
    ).toMatch(/Not allowed|Sign in required/);
    expect(
      String(await refusalOf(caller.mutation(api.rosterEntries.remove, { rosterEntryId: maya }))),
    ).toMatch(/Not allowed|Sign in required/);
    expect((await snapshot(s)).entries.find((row) => row._id === maya)).toMatchObject({
      status: 'rostered',
      minorName: 'Maya Rivera',
    });
  });
});

describe('who sees a minor’s name', () => {
  async function privacySetup() {
    const s = await setup();
    await seedMinor(s, 'guardian', s.sharks, 'Maya Rivera');
    const userIds = Object.values(s.people).map((person) => person.userId as string);
    return { s, userIds };
  }

  test('a player of another team gets "Maya R.", with no mark, no guardian, no "Rivera", and no user id', async () => {
    const { s, userIds } = await privacySetup();
    const team = await s.as('rivalPlayer').query(api.teams.getForMember, { teamId: s.sharks });
    const row = team?.roster.find((player) => player.name.startsWith('Maya'));
    expect(row).toMatchObject({
      name: 'Maya R.',
      isCaptain: false,
      isViewer: false,
      minor: null,
      viewerCanRename: false,
      viewerCanRemove: false,
    });
    const json = JSON.stringify(team);
    expect(json).not.toContain('Rivera');
    for (const userId of userIds) expect(json).not.toContain(userId);
  });

  test.each<[string, Who]>([
    ['a teammate', 'player'],
    ['an organizer of the league', 'organizer'],
    ['the guardian', 'guardian'],
  ])('%s sees "Maya Rivera" and the guardian "Ana Rivera"', async (_, who) => {
    const { s } = await privacySetup();
    const team = await s.as(who).query(api.teams.getForMember, { teamId: s.sharks });
    expect(team?.roster.find((player) => player.name.startsWith('Maya'))).toMatchObject({
      name: 'Maya Rivera',
      minor: { guardianName: 'Ana Rivera' },
      isViewer: false,
    });
  });

  test('the guardian opens the minor’s team, may add a minor there, and sees it marked as their team in the season', async () => {
    const { s } = await privacySetup();
    const team = await s.as('guardian').query(api.teams.getForMember, { teamId: s.sharks });
    expect(team).toMatchObject({
      viewerOnTeam: true,
      viewerTeamName: null,
      viewerCanManage: false,
    });
    expect(team?.roster.find((player) => player.name === 'Maya Rivera')).toMatchObject({
      viewerCanRename: true,
      viewerCanRemove: true,
    });
    const season = await s.as('guardian').query(api.teams.listForSeasonMember, { teamId: s.party });
    expect(season?.rows.map((row) => [row.name, row.isViewerTeam])).toEqual([
      ['Block Party', false],
      ['Sand Sharks', true],
    ]);
    const opponent = await s.as('guardian').query(api.teams.getForMember, { teamId: s.party });
    expect(opponent?.viewerOnTeam).toBe(false);
  });
});
