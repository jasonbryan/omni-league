/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOrgAdmin, requireProgramOrganizer } from './lib/access';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { defaultDivision, insertDraftCamp, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { insertTournamentProgram, modules } from './test.setup';

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

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

type Role = 'orgAdmin' | 'leagueOrganizer';

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Coed 7v7',
          sport: 'soccer',
          locations: ['Alpha Field'],
          division: defaultDivision('soccer'),
        },
      ],
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
    const bField = await locationIn(organizationB, 'B Field');
    const campProgram = async (
      organizationId: Id<'organizations'>,
      locationId: Id<'locations'>,
      name: string,
      slug: string,
    ) => {
      const campId = await insertDraftCamp(ctx, organizationId, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [locationId],
        minimumAge: 9,
        maximumAge: 14,
      });
      return (await ctx.db.get('camps', campId))!.programId;
    };
    const person = async (
      authUserId: string,
      membership: { organizationId: Id<'organizations'>; role: Role } | null,
    ) => {
      const now = Date.now();
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name: authUserId,
            email: `${authUserId}@example.test`,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      } as never)) as { _id: string };
      const userId = await ctx.db.insert('users', {
        authUserId: account._id,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (membership) {
        await ctx.db.insert('memberships', {
          userId,
          organizationId: membership.organizationId,
          role: membership.role,
          leagueIds: [],
        });
      }
      return { authUserId: account._id, userId };
    };
    return {
      organizationA,
      organizationB,
      junior: await campProgram(
        organizationA,
        alpha,
        'Junior Beach Volleyball Camp',
        'junior-beach-volleyball-camp',
      ),
      fall: await campProgram(organizationA, alpha, 'Fall Break Camp', 'fall-break-camp'),
      campB: await campProgram(organizationB, bField, 'B Camp', 'b-camp'),
      gulf: await insertTournamentProgram(
        ctx,
        organizationA,
        'Gulf Coast Beach Open',
        'gulf-coast-beach-open',
      ),
      coedProgram: (await ctx.db.query('leagues').first())!.programId,
      adminA: await person('admin-a', { organizationId: organizationA, role: 'orgAdmin' }),
      organizerA: await person('organizer-a', {
        organizationId: organizationA,
        role: 'leagueOrganizer',
      }),
      adminB: await person('admin-b', { organizationId: organizationB, role: 'orgAdmin' }),
      dana: await person('dana', null),
    };
  });
  const as = (who: { authUserId: string }) => t.withIdentity(identity(who.authUserId));
  return {
    t,
    ...ids,
    asAdminA: as(ids.adminA),
    asOrganizerA: as(ids.organizerA),
    asAdminB: as(ids.adminB),
    asDana: as(ids.dana),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const invite = (s: Setup, email: string, programIds: Id<'programs'>[]) =>
  s.asAdminA.action(api.invites.create, {
    organizationId: s.organizationA,
    email,
    role: 'leagueOrganizer',
    leagueIds: [],
    programIds,
  });

const allInvites = (s: Setup) => s.t.run((ctx) => ctx.db.query('invites').collect());

const membershipsOf = (s: Setup, userId: Id<'users'>) =>
  s.t.run((ctx) =>
    ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', userId))
      .collect(),
  );

describe('invites.create with camps', () => {
  test('stores a camp-only league organizer invite, and a camp with a tournament together', async () => {
    const s = await setup();
    await invite(s, 'dana@example.com', [s.junior]);
    await invite(s, 'eli@example.com', [s.junior, s.gulf, s.junior]);
    const [campOnly, mixed] = await allInvites(s);
    expect(campOnly).toMatchObject({ leagueIds: [], programIds: [s.junior] });
    expect(mixed).toMatchObject({ programIds: [s.junior, s.gulf] });
  });

  test('refuses a camp of another organization, alone or among its own, and stores nothing', async () => {
    const s = await setup();
    for (const programIds of [[s.campB], [s.junior, s.campB]]) {
      await expect(invite(s, 'dana@example.com', programIds)).rejects.toThrow(/Not allowed/);
    }
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses a camp that does not exist, and a league’s program', async () => {
    const s = await setup();
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete('programs', s.fall);
      return s.fall;
    });
    for (const programIds of [[gone], [s.coedProgram, s.junior]]) {
      await expect(invite(s, 'dana@example.com', programIds)).rejects.toThrow(/Not allowed/);
    }
  });

  test('refuses an org admin invite that carries a camp', async () => {
    const s = await setup();
    await expect(
      s.asAdminA.action(api.invites.create, {
        organizationId: s.organizationA,
        email: 'dana@example.com',
        role: 'orgAdmin',
        leagueIds: [],
        programIds: [s.junior],
      }),
    ).rejects.toThrow();
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses an invite with nothing chosen, naming the camps and tournaments the organization has', async () => {
    const s = await setup();
    await expect(invite(s, 'dana@example.com', [])).rejects.toMatchObject({
      data: {
        field: 'leagues',
        code: 'leaguesEmpty',
        message: 'Choose at least one league, tournament, or camp.',
      },
    });
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    const args = {
      organizationId: s.organizationA,
      email: 'dana@example.com',
      role: 'leagueOrganizer' as const,
      leagueIds: [],
      programIds: [s.junior],
    };
    await expect(s.t.action(api.invites.create, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asAdminB.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asDana.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    expect(await allInvites(s)).toEqual([]);
  });
});

describe('the invite and the staff lists with camps', () => {
  test('getByToken names the camps apart from the tournaments, and an invite with none has no field for them', async () => {
    const s = await setup();
    const both = await invite(s, 'dana@example.test', [s.fall, s.gulf, s.junior]);
    expect(await s.t.query(api.invites.getByToken, { token: both.token })).toEqual({
      status: 'valid',
      organizationName: 'Org A',
      role: 'leagueOrganizer',
      leagueNames: [],
      tournamentNames: ['Gulf Coast Beach Open'],
      campNames: ['Fall Break Camp', 'Junior Beach Volleyball Camp'],
      expiresAt: NOW + INVITE_LIFETIME_MS,
    });
    const tournamentOnly = await invite(s, 'eli@example.test', [s.gulf]);
    const answer = await s.t.query(api.invites.getByToken, { token: tournamentOnly.token });
    expect('campNames' in answer).toBe(false);
  });

  test('listPending names the camps of an invite, only for an invite that has some', async () => {
    const s = await setup();
    const camp = await invite(s, 'dana@example.com', [s.junior]);
    const tournament = await invite(s, 'eli@example.com', [s.gulf]);
    const rows = await s.asAdminA.query(api.invites.listPending, {
      organizationId: s.organizationA,
    });
    const row = (inviteId: Id<'invites'>) => rows.find((r) => r.inviteId === inviteId)!;
    expect(row(camp.inviteId)).toMatchObject({ campNames: ['Junior Beach Volleyball Camp'] });
    expect('tournamentNames' in row(camp.inviteId)).toBe(false);
    expect(row(tournament.inviteId).tournamentNames).toEqual(['Gulf Coast Beach Open']);
    expect('campNames' in row(tournament.inviteId)).toBe(false);
  });

  test('listPending leaves out a camp that is gone or of another organization', async () => {
    const s = await setup();
    const created = await invite(s, 'dana@example.com', [s.junior, s.fall]);
    await s.t.run(async (ctx) => {
      await ctx.db.delete('programs', s.fall);
      await ctx.db.patch('invites', created.inviteId, { programIds: [s.junior, s.fall, s.campB] });
    });
    const [row] = await s.asAdminA.query(api.invites.listPending, {
      organizationId: s.organizationA,
    });
    expect(row?.campNames).toEqual(['Junior Beach Volleyball Camp']);
  });

  test('memberships.listForOrganization lists the camps a member runs by name', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const membership = (await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', s.organizerA.userId))
        .unique())!;
      await ctx.db.patch('memberships', membership._id, {
        programIds: [s.junior, s.gulf, s.campB],
      });
    });
    const rows = await s.asAdminA.query(api.memberships.listForOrganization, {
      organizationId: s.organizationA,
    });
    const organizer = rows.find((row) => row.name === 'organizer-a')!;
    expect(organizer.campNames).toEqual(['Junior Beach Volleyball Camp']);
    expect(organizer.tournamentNames).toEqual(['Gulf Coast Beach Open']);
    expect('campNames' in rows.find((row) => row.name === 'admin-a')!).toBe(false);
  });
});

describe('invites.accept with camps', () => {
  test('a camp-only invite makes a league organizer who runs that camp only', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', [s.junior]);
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect(result).toEqual({
      organizationName: 'Org A',
      organizationSlug: 'org-a',
      role: 'leagueOrganizer',
      leagueNames: [],
      leagues: [],
      campNames: ['Junior Beach Volleyball Camp'],
      camps: [{ name: 'Junior Beach Volleyball Camp', slug: 'junior-beach-volleyball-camp' }],
    });
    expect((await membershipsOf(s, s.dana.userId))[0]).toMatchObject({
      role: 'leagueOrganizer',
      leagueIds: [],
      programIds: [s.junior],
    });
    await s.asDana.run(async (ctx) => {
      await expect(requireProgramOrganizer(ctx, s.junior)).resolves.toBeDefined();
      await expect(requireProgramOrganizer(ctx, s.fall)).rejects.toThrow('Not allowed');
      await expect(requireProgramOrganizer(ctx, s.campB)).rejects.toThrow('Not allowed');
      await expect(requireOrgAdmin(ctx, s.organizationA)).rejects.toThrow('Not allowed');
    });
  });

  test('a camp and a tournament are granted together and reported apart', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', [s.junior, s.gulf]);
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect(result.camps).toEqual([
      { name: 'Junior Beach Volleyball Camp', slug: 'junior-beach-volleyball-camp' },
    ]);
    expect(result.tournaments).toEqual([
      { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
    ]);
    expect((await membershipsOf(s, s.dana.userId))[0]?.programIds).toEqual([s.junior, s.gulf]);
  });

  test('a tournament-only invite leaves the answer without camp fields', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', [s.gulf]);
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect('camps' in result).toBe(false);
    expect('campNames' in result).toBe(false);
  });

  test('a camp of another organization named in the stored invite is left out of the grant', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'dana@example.test', [s.junior]);
    await s.t.run((ctx) => ctx.db.patch('invites', inviteId, { programIds: [s.junior, s.campB] }));
    await s.asDana.mutation(api.invites.accept, { token });
    expect((await membershipsOf(s, s.dana.userId))[0]?.programIds).toEqual([s.junior]);
  });
});

describe('organizations.listMine with camps', () => {
  async function assign(s: Setup, programIds: Id<'programs'>[]) {
    await s.t.run(async (ctx) => {
      const membership = (await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', s.organizerA.userId))
        .unique())!;
      await ctx.db.patch('memberships', membership._id, { programIds });
    });
  }

  test('an organizer’s row lists the assigned camps in sort-name order, apart from the tournaments', async () => {
    const s = await setup();
    await assign(s, [s.junior, s.gulf, s.fall]);
    const [row] = await s.asOrganizerA.query(api.organizations.listMine, {});
    expect(row?.camps).toEqual([
      { name: 'Fall Break Camp', slug: 'fall-break-camp' },
      { name: 'Junior Beach Volleyball Camp', slug: 'junior-beach-volleyball-camp' },
    ]);
    expect(row?.tournaments).toEqual([
      { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
    ]);
  });

  test('a row with no assigned camp has no camps field, and an org admin’s never has one', async () => {
    const s = await setup();
    await assign(s, [s.gulf]);
    const [organizer] = await s.asOrganizerA.query(api.organizations.listMine, {});
    expect('camps' in organizer).toBe(false);
    await s.t.run(async (ctx) => {
      const membership = (await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', s.adminA.userId))
        .unique())!;
      await ctx.db.patch('memberships', membership._id, { programIds: [s.junior] });
    });
    const [admin] = await s.asAdminA.query(api.organizations.listMine, {});
    expect('camps' in admin).toBe(false);
  });

  test('drops an assigned camp that is another organization’s or gone', async () => {
    const s = await setup();
    await assign(s, [s.junior, s.campB, s.fall]);
    await s.t.run((ctx) => ctx.db.delete('programs', s.fall));
    const [row] = await s.asOrganizerA.query(api.organizations.listMine, {});
    expect(row?.camps).toEqual([
      { name: 'Junior Beach Volleyball Camp', slug: 'junior-beach-volleyball-camp' },
    ]);
  });
});
