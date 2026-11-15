/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOrgAdmin, requireProgramOrganizer } from './lib/access';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { defaultDivision, insertDraftTraining, insertTenant } from './lib/tenantWrites';
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
    const trainingProgram = async (
      organizationId: Id<'organizations'>,
      locationId: Id<'locations'>,
      name: string,
      slug: string,
    ) => {
      const trainingId = await insertDraftTraining(ctx, organizationId, {
        name,
        slug,
        sport: 'beachVolleyball',
        locationIds: [locationId],
        coachName: 'Dana Ruiz',
      });
      return (await ctx.db.get('trainings', trainingId))!.programId;
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
      tuesday: await trainingProgram(
        organizationA,
        alpha,
        'Tuesday Serving Clinic',
        'tuesday-serving-clinic',
      ),
      thursday: await trainingProgram(
        organizationA,
        alpha,
        'Thursday Passing Clinic',
        'thursday-passing-clinic',
      ),
      trainingB: await trainingProgram(organizationB, bField, 'B Clinic', 'b-clinic'),
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

describe('invites.create with trainings', () => {
  test('stores a training-only league organizer invite, and a training with a tournament together', async () => {
    const s = await setup();
    await invite(s, 'dana@example.com', [s.tuesday]);
    await invite(s, 'eli@example.com', [s.tuesday, s.gulf, s.tuesday]);
    const [trainingOnly, mixed] = await allInvites(s);
    expect(trainingOnly).toMatchObject({ leagueIds: [], programIds: [s.tuesday] });
    expect(mixed).toMatchObject({ programIds: [s.tuesday, s.gulf] });
  });

  test('refuses a training of another organization, alone or among its own, and stores nothing', async () => {
    const s = await setup();
    for (const programIds of [[s.trainingB], [s.tuesday, s.trainingB]]) {
      await expect(invite(s, 'dana@example.com', programIds)).rejects.toThrow(/Not allowed/);
    }
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses a training that does not exist, and a league’s program', async () => {
    const s = await setup();
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete('programs', s.thursday);
      return s.thursday;
    });
    for (const programIds of [[gone], [s.coedProgram, s.tuesday]]) {
      await expect(invite(s, 'dana@example.com', programIds)).rejects.toThrow(/Not allowed/);
    }
  });

  test('refuses an org admin invite that carries a training', async () => {
    const s = await setup();
    await expect(
      s.asAdminA.action(api.invites.create, {
        organizationId: s.organizationA,
        email: 'dana@example.com',
        role: 'orgAdmin',
        leagueIds: [],
        programIds: [s.tuesday],
      }),
    ).rejects.toThrow();
    expect(await allInvites(s)).toEqual([]);
  });

  test('refuses an invite with nothing chosen, naming the trainings and tournaments the organization has', async () => {
    const s = await setup();
    await expect(invite(s, 'dana@example.com', [])).rejects.toMatchObject({
      data: {
        field: 'leagues',
        code: 'leaguesEmpty',
        message: 'Choose at least one league, tournament, or training program.',
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
      programIds: [s.tuesday],
    };
    await expect(s.t.action(api.invites.create, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asAdminB.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asDana.action(api.invites.create, args)).rejects.toThrow(/Not allowed/);
    expect(await allInvites(s)).toEqual([]);
  });
});

describe('the invite and the staff lists with trainings', () => {
  test('getByToken names the trainings apart from the tournaments, and an invite with none has no field for them', async () => {
    const s = await setup();
    const both = await invite(s, 'dana@example.test', [s.thursday, s.gulf, s.tuesday]);
    expect(await s.t.query(api.invites.getByToken, { token: both.token })).toEqual({
      status: 'valid',
      organizationName: 'Org A',
      role: 'leagueOrganizer',
      leagueNames: [],
      tournamentNames: ['Gulf Coast Beach Open'],
      trainingNames: ['Thursday Passing Clinic', 'Tuesday Serving Clinic'],
      expiresAt: NOW + INVITE_LIFETIME_MS,
    });
    const tournamentOnly = await invite(s, 'eli@example.test', [s.gulf]);
    const answer = await s.t.query(api.invites.getByToken, { token: tournamentOnly.token });
    expect('trainingNames' in answer).toBe(false);
  });

  test('listPending names the trainings of an invite, only for an invite that has some', async () => {
    const s = await setup();
    const training = await invite(s, 'dana@example.com', [s.tuesday]);
    const tournament = await invite(s, 'eli@example.com', [s.gulf]);
    const rows = await s.asAdminA.query(api.invites.listPending, {
      organizationId: s.organizationA,
    });
    const row = (inviteId: Id<'invites'>) => rows.find((r) => r.inviteId === inviteId)!;
    expect(row(training.inviteId)).toMatchObject({ trainingNames: ['Tuesday Serving Clinic'] });
    expect('tournamentNames' in row(training.inviteId)).toBe(false);
    expect(row(tournament.inviteId).tournamentNames).toEqual(['Gulf Coast Beach Open']);
    expect('trainingNames' in row(tournament.inviteId)).toBe(false);
  });

  test('listPending leaves out a training that is gone or of another organization', async () => {
    const s = await setup();
    const created = await invite(s, 'dana@example.com', [s.tuesday, s.thursday]);
    await s.t.run(async (ctx) => {
      await ctx.db.delete('programs', s.thursday);
      await ctx.db.patch('invites', created.inviteId, {
        programIds: [s.tuesday, s.thursday, s.trainingB],
      });
    });
    const [row] = await s.asAdminA.query(api.invites.listPending, {
      organizationId: s.organizationA,
    });
    expect(row?.trainingNames).toEqual(['Tuesday Serving Clinic']);
  });

  test('memberships.listForOrganization lists the trainings a member runs by name', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const membership = (await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', s.organizerA.userId))
        .unique())!;
      await ctx.db.patch('memberships', membership._id, {
        programIds: [s.tuesday, s.gulf, s.trainingB],
      });
    });
    const rows = await s.asAdminA.query(api.memberships.listForOrganization, {
      organizationId: s.organizationA,
    });
    const organizer = rows.find((row) => row.name === 'organizer-a')!;
    expect(organizer.trainingNames).toEqual(['Tuesday Serving Clinic']);
    expect(organizer.tournamentNames).toEqual(['Gulf Coast Beach Open']);
    expect('trainingNames' in rows.find((row) => row.name === 'admin-a')!).toBe(false);
  });
});

describe('invites.accept with trainings', () => {
  test('a training-only invite makes a league organizer who runs that training only', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', [s.tuesday]);
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect(result).toEqual({
      organizationName: 'Org A',
      organizationSlug: 'org-a',
      role: 'leagueOrganizer',
      leagueNames: [],
      leagues: [],
      trainingNames: ['Tuesday Serving Clinic'],
      trainings: [{ name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' }],
    });
    expect((await membershipsOf(s, s.dana.userId))[0]).toMatchObject({
      role: 'leagueOrganizer',
      leagueIds: [],
      programIds: [s.tuesday],
    });
    await s.asDana.run(async (ctx) => {
      await expect(requireProgramOrganizer(ctx, s.tuesday)).resolves.toBeDefined();
      await expect(requireProgramOrganizer(ctx, s.thursday)).rejects.toThrow('Not allowed');
      await expect(requireProgramOrganizer(ctx, s.trainingB)).rejects.toThrow('Not allowed');
      await expect(requireOrgAdmin(ctx, s.organizationA)).rejects.toThrow('Not allowed');
    });
  });

  test('a training and a tournament are granted together and reported apart', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', [s.tuesday, s.gulf]);
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect(result.trainings).toEqual([
      { name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' },
    ]);
    expect(result.tournaments).toEqual([
      { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
    ]);
    expect((await membershipsOf(s, s.dana.userId))[0]?.programIds).toEqual([s.tuesday, s.gulf]);
  });

  test('a tournament-only invite leaves the answer without training fields', async () => {
    const s = await setup();
    const { token } = await invite(s, 'dana@example.test', [s.gulf]);
    const result = await s.asDana.mutation(api.invites.accept, { token });
    expect('trainings' in result).toBe(false);
    expect('trainingNames' in result).toBe(false);
  });

  test('a training of another organization named in the stored invite is left out of the grant', async () => {
    const s = await setup();
    const { token, inviteId } = await invite(s, 'dana@example.test', [s.tuesday]);
    await s.t.run((ctx) =>
      ctx.db.patch('invites', inviteId, { programIds: [s.tuesday, s.trainingB] }),
    );
    await s.asDana.mutation(api.invites.accept, { token });
    expect((await membershipsOf(s, s.dana.userId))[0]?.programIds).toEqual([s.tuesday]);
  });
});

describe('organizations.listMine with trainings', () => {
  async function assign(s: Setup, programIds: Id<'programs'>[]) {
    await s.t.run(async (ctx) => {
      const membership = (await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', s.organizerA.userId))
        .unique())!;
      await ctx.db.patch('memberships', membership._id, { programIds });
    });
  }

  test('an organizer’s row lists the assigned trainings in sort-name order, apart from the tournaments', async () => {
    const s = await setup();
    await assign(s, [s.tuesday, s.gulf, s.thursday]);
    const [row] = await s.asOrganizerA.query(api.organizations.listMine, {});
    expect(row?.trainings).toEqual([
      { name: 'Thursday Passing Clinic', slug: 'thursday-passing-clinic' },
      { name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' },
    ]);
    expect(row?.tournaments).toEqual([
      { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
    ]);
  });

  test('a row with no assigned training has no trainings field, and an org admin’s never has one', async () => {
    const s = await setup();
    await assign(s, [s.gulf]);
    const [organizer] = await s.asOrganizerA.query(api.organizations.listMine, {});
    expect('trainings' in organizer).toBe(false);
    await s.t.run(async (ctx) => {
      const membership = (await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', s.adminA.userId))
        .unique())!;
      await ctx.db.patch('memberships', membership._id, { programIds: [s.tuesday] });
    });
    const [admin] = await s.asAdminA.query(api.organizations.listMine, {});
    expect('trainings' in admin).toBe(false);
  });

  test('drops an assigned training that is another organization’s or gone', async () => {
    const s = await setup();
    await assign(s, [s.tuesday, s.trainingB, s.thursday]);
    await s.t.run((ctx) => ctx.db.delete('programs', s.thursday));
    const [row] = await s.asOrganizerA.query(api.organizations.listMine, {});
    expect(row?.trainings).toEqual([
      { name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' },
    ]);
  });
});
