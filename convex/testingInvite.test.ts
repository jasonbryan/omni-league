/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { recountPendingInvites } from './lib/inviteWrites';
import { hashInviteToken } from './lib/inviteToken';
import { insertTeamWithCaptain } from './lib/rosterWrites';
import { insertSeason, insertTenant, defaultDivision } from './lib/tenantWrites';
import schema from './schema';
import { insertCampProgram, insertTournamentProgram, modules } from './test.setup';

afterEach(() => {
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Field', address: '1 Test Road' }],
      leagues: [
        {
          name: 'Coed 7v7',
          sport: 'soccer',
          locations: ['Field'],
          division: defaultDivision('soccer'),
        },
      ],
    });
  });
  return t;
}

const INVITE = {
  organizationSlug: 'org-a',
  email: 'Late@Example.com',
  role: 'leagueOrganizer' as const,
  leagueNames: ['Coed 7v7'],
  expiresAt: 1_000,
};

describe('testing:addInvite', () => {
  test.each([undefined, 'false', 'TRUE', ''])(
    'throws with IS_TEST %j and writes nothing',
    async (value) => {
      vi.stubEnv('IS_TEST', value);
      const t = await setup();
      await expect(t.mutation(internal.testing.addInvite, INVITE)).rejects.toThrow(/IS_TEST/);
      expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
    },
  );

  test('adds a pending invite with the given expiry and a hash that matches no token', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await t.mutation(internal.testing.addInvite, INVITE);
    const rows = await t.run((ctx) => ctx.db.query('invites').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'late@example.com',
      role: 'leagueOrganizer',
      status: 'pending',
      expiresAt: 1_000,
    });
    expect(rows[0].leagueIds).toHaveLength(1);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('with a token, its hash is stored, so the token opens the invite', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    const token = 'e2e-token_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    await t.mutation(internal.testing.addInvite, {
      ...INVITE,
      expiresAt: Date.now() + 60_000,
      token,
    });
    const rows = await t.run((ctx) => ctx.db.query('invites').collect());
    expect(rows[0]?.tokenHash).toBe(await hashInviteToken(token));
    expect(await t.query(api.invites.getByToken, { token })).toMatchObject({
      status: 'valid',
      organizationName: 'Org A',
      leagueNames: ['Coed 7v7'],
    });
  });

  test('names tournaments, which the invite then lists by name', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    const programId = await t.run(async (ctx) => {
      const organization = (await ctx.db.query('organizations').first())!;
      return insertTournamentProgram(ctx, organization._id, 'Gulf Coast Beach Open', 'gulf-open');
    });
    const token = 'e2e-token_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    await t.mutation(internal.testing.addInvite, {
      ...INVITE,
      leagueNames: [],
      tournamentNames: ['Gulf Coast Beach Open'],
      expiresAt: Date.now() + 60_000,
      token,
    });
    const [row] = await t.run((ctx) => ctx.db.query('invites').collect());
    expect(row).toMatchObject({ leagueIds: [], programIds: [programId] });
    expect(await t.query(api.invites.getByToken, { token })).toMatchObject({
      status: 'valid',
      leagueNames: [],
      tournamentNames: ['Gulf Coast Beach Open'],
    });
  });

  test('refuses a tournament that does not exist', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await expect(
      t.mutation(internal.testing.addInvite, { ...INVITE, tournamentNames: ['Missing'] }),
    ).rejects.toThrow(/No tournament/);
    expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
  });

  test('names camps, which the invite then lists apart from tournaments', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    const programId = await t.run(async (ctx) => {
      const organization = (await ctx.db.query('organizations').first())!;
      return insertCampProgram(ctx, organization._id, 'Junior Beach Camp', 'junior-beach-camp');
    });
    const token = 'e2e-token_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    await t.mutation(internal.testing.addInvite, {
      ...INVITE,
      leagueNames: [],
      campNames: ['Junior Beach Camp'],
      expiresAt: Date.now() + 60_000,
      token,
    });
    const [row] = await t.run((ctx) => ctx.db.query('invites').collect());
    expect(row).toMatchObject({ leagueIds: [], programIds: [programId] });
    const answer = await t.query(api.invites.getByToken, { token });
    expect(answer).toMatchObject({ status: 'valid', campNames: ['Junior Beach Camp'] });
    expect('tournamentNames' in answer).toBe(false);
  });

  test('refuses a camp that does not exist', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await expect(
      t.mutation(internal.testing.addInvite, { ...INVITE, campNames: ['Missing'] }),
    ).rejects.toThrow(/No camp/);
    expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
  });

  test('refuses an unknown organization or league', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await expect(
      t.mutation(internal.testing.addInvite, { ...INVITE, organizationSlug: 'nope' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.addInvite, { ...INVITE, leagueNames: ['Missing'] }),
    ).rejects.toThrow(/No league/);
    expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
  });
});

describe('testing:seedPendingInvites', () => {
  const SEED = { organizationSlug: 'org-a', count: 3, emailPrefix: 'many' };
  const organization = (t: Awaited<ReturnType<typeof setup>>) =>
    t.run(async (ctx) => (await ctx.db.query('organizations').first())!);

  test.each([undefined, 'false', 'TRUE', ''])(
    'throws with IS_TEST %j and writes nothing',
    async (value) => {
      vi.stubEnv('IS_TEST', value);
      const t = await setup();
      const before = (await organization(t)).pendingInviteCount;
      await expect(t.mutation(internal.testing.seedPendingInvites, SEED)).rejects.toThrow(
        /IS_TEST/,
      );
      expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
      expect((await organization(t)).pendingInviteCount).toBe(before);
    },
  );

  test('writes the given number of pending invites with distinct emails, and the counter equals a recount', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await t.mutation(internal.testing.seedPendingInvites, SEED);
    const rows = await t.run((ctx) => ctx.db.query('invites').collect());
    expect(rows.map((row) => row.email)).toEqual([
      'many-001@example.test',
      'many-002@example.test',
      'many-003@example.test',
    ]);
    expect(rows.map((row) => row.status)).toEqual(['pending', 'pending', 'pending']);
    expect(rows.every((row) => row.role === 'orgAdmin' && row.leagueIds.length === 0)).toBe(true);
    expect(new Set(rows.map((row) => row.tokenHash)).size).toBe(3);
    expect(rows.every((row) => row.expiresAt > Date.now())).toBe(true);
    const row = await organization(t);
    expect(row.pendingInviteCount).toBe(3);
    expect(await t.run((ctx) => recountPendingInvites(ctx, row._id))).toBe(3);
  });

  test('refuses an unknown organization slug and writes nothing', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await expect(
      t.mutation(internal.testing.seedPendingInvites, { ...SEED, organizationSlug: 'nope' }),
    ).rejects.toThrow(/No organization/);
    expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
  });
});

describe('testing:addTeamInvite', () => {
  async function team(t: Awaited<ReturnType<typeof setup>>) {
    return t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').first())!;
      const seasonId = await insertSeason(
        ctx,
        league,
        {
          name: 'Summer',
          slug: 'summer',
          startDate: '2030-06-01',
          endDate: '2030-08-30',
          registrationDeadline: '2030-05-20',
          playersPerSide: 7,
          minimumRosterSize: 7,
        },
        'published',
      );
      const captainUserId = await ctx.db.insert('users', {
        authUserId: 'captain',
        name: 'Captain',
        adultConfirmedAt: 1,
      });
      return insertTeamWithCaptain(ctx, (await ctx.db.get('seasons', seasonId))!, {
        name: 'Sand Sharks',
        captainUserId,
      });
    });
  }

  test('with a token, its hash is stored, so the token opens the invite', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    const teamId = await team(t);
    const token = 'e2e-token_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    await t.mutation(internal.testing.addTeamInvite, {
      teamId,
      email: 'Late@Example.com',
      expiresAt: Date.now() + 60_000,
      token,
    });
    const rows = await t.run((ctx) => ctx.db.query('teamInvites').collect());
    expect(rows[0]).toMatchObject({
      email: 'late@example.com',
      tokenHash: await hashInviteToken(token),
    });
    expect(await t.query(api.teamInvites.getByToken, { token })).toMatchObject({
      status: 'valid',
      teamName: 'Sand Sharks',
    });
  });

  test('without a token, the hash matches no token anyone holds', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    const teamId = await team(t);
    await t.mutation(internal.testing.addTeamInvite, {
      teamId,
      email: 'x@example.com',
      expiresAt: Date.now() + 60_000,
    });
    const rows = await t.run((ctx) => ctx.db.query('teamInvites').collect());
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
