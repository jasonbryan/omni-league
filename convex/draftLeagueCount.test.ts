/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { ADMIN_LEAGUES_LIMIT } from './leagues';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { insertLeague, insertTenant, defaultDivision } from './lib/tenantWrites';
import schema from './schema';
import { modules, leagueRequiredFields } from './test.setup';

beforeEach(() => {
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const FIELD = 'Alpha Field';

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenant = (name: string, slug: string) =>
      insertTenant(ctx, {
        organization: { name, slug },
        locations: [{ name: FIELD, address: '1 Alpha St' }],
        leagues: [
          {
            name: 'Published One',
            sport: 'soccer',
            locations: [FIELD],
            division: defaultDivision('soccer'),
          },
          {
            name: 'Draft One',
            sport: 'soccer',
            locations: [FIELD],
            status: 'draft',
            division: defaultDivision('soccer'),
          },
        ],
      });
    const organizationA = await tenant('Org A', 'org-a');
    const organizationB = await tenant('Org B', 'org-b');
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds: [] });
      }
    };
    await member('admin-a', organizationA);
    await member('organizer-a', organizationA, 'leagueOrganizer');
    await member('admin-b', organizationB);
    await member('stranger', null);
    const locationA = (await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationA))
      .first())!._id;
    return { organizationA, organizationB, locationA };
  });
  return {
    t,
    ...ids,
    asAdminA: t.withIdentity(identity('admin-a')),
    asOrganizerA: t.withIdentity(identity('organizer-a')),
    asAdminB: t.withIdentity(identity('admin-b')),
    asStranger: t.withIdentity(identity('stranger')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function storedAndRecount(s: Setup, organizationId: Id<'organizations'>) {
  return s.t.run(async (ctx) => {
    const organization = await ctx.db.get('organizations', organizationId);
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
      .collect();
    return {
      stored: organization?.draftLeagueCount,
      recount: leagues.filter((league) => league.status === 'draft').length,
    };
  });
}

async function expectCountersMatch(s: Setup): Promise<void> {
  for (const organizationId of [s.organizationA, s.organizationB]) {
    const { stored, recount } = await storedAndRecount(s, organizationId);
    expect(stored).toBe(recount);
  }
}

const unsetCounter = (s: Setup, organizationId: Id<'organizations'>) =>
  s.t.run((ctx) => ctx.db.patch('organizations', organizationId, { draftLeagueCount: undefined }));

const newLeague = (s: Setup, slug: string) => ({
  organizationId: s.organizationA,
  name: `League ${slug}`,
  slug,
  sport: 'beachVolleyball' as const,
  locationIds: [s.locationA],
  gender: 'coed' as const,
  playersPerSide: 4,
  level: 'bb' as const,
  ageGroup: 'adult',
});

const draftIdOf = (s: Setup, organizationId: Id<'organizations'>) =>
  s.t.run(async (ctx) => {
    const draft = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_status_and_sortName', (q) =>
        q.eq('organizationId', organizationId).eq('status', 'draft'),
      )
      .first();
    return draft!._id;
  });

describe('leagues.draftCount', () => {
  test('returns the organization’s draft count to its org admin', async () => {
    const s = await setup();
    expect(
      await s.asAdminA.query(api.leagues.draftCount, { organizationId: s.organizationA }),
    ).toBe(1);
  });

  test('refuses the unauthenticated, a league organizer, a non-member, and another organization’s admin', async () => {
    const s = await setup();
    const args = { organizationId: s.organizationA };
    await expect(s.t.query(api.leagues.draftCount, args)).rejects.toThrow(/Sign in required/);
    await expect(s.asOrganizerA.query(api.leagues.draftCount, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asStranger.query(api.leagues.draftCount, args)).rejects.toThrow(/Not allowed/);
    await expect(s.asAdminB.query(api.leagues.draftCount, args)).rejects.toThrow(/Not allowed/);
  });

  test('counts past the 200 rows the league list stops at', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let n = 0; n < ADMIN_LEAGUES_LIMIT; n++) {
        await insertLeague(ctx, s.organizationA, {
          name: `Extra ${n}`,
          sport: 'soccer',
          locations: [FIELD],
          status: 'draft',
          division: defaultDivision('soccer'),
        });
      }
    });
    const args = { organizationId: s.organizationA };
    expect(await s.asAdminA.query(api.leagues.draftCount, args)).toBe(ADMIN_LEAGUES_LIMIT + 1);
    expect(await s.asAdminA.query(api.leagues.listForAdmin, args)).toHaveLength(
      ADMIN_LEAGUES_LIMIT,
    );
  });

  test('reads a counter that is not set yet from the rows', async () => {
    const s = await setup();
    await unsetCounter(s, s.organizationA);
    expect(
      await s.asAdminA.query(api.leagues.draftCount, { organizationId: s.organizationA }),
    ).toBe(1);
  });
});

describe('the draft league counter', () => {
  test('equals a recount of the rows after every writer', async () => {
    const s = await setup();
    await expectCountersMatch(s);
    await s.asAdminA.mutation(api.leagues.create, newLeague(s, 'one'));
    await expectCountersMatch(s);
    await s.asAdminA.mutation(api.leagues.create, newLeague(s, 'two'));
    await expectCountersMatch(s);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(3);
    await s.asAdminA.mutation(api.leagues.publish, {
      leagueId: await draftIdOf(s, s.organizationA),
    });
    await expectCountersMatch(s);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(2);
    await s.t.run((ctx) =>
      insertLeague(ctx, s.organizationA, {
        name: 'Seeded draft',
        sport: 'soccer',
        locations: [FIELD],
        status: 'draft',
        division: defaultDivision('soccer'),
      }),
    );
    await s.t.run((ctx) =>
      insertLeague(ctx, s.organizationA, {
        name: 'Seeded published',
        sport: 'soccer',
        locations: [FIELD],
        division: defaultDivision('soccer'),
      }),
    );
    await expectCountersMatch(s);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(3);
    expect((await storedAndRecount(s, s.organizationB)).stored).toBe(1);
  });

  test('publishing a published league changes nothing', async () => {
    const s = await setup();
    const leagueId = await draftIdOf(s, s.organizationA);
    await s.asAdminA.mutation(api.leagues.publish, { leagueId });
    await s.asAdminA.mutation(api.leagues.publish, { leagueId });
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 0, recount: 0 });
  });

  test('starts at 0 for a new organization', async () => {
    const s = await setup();
    const organizationId = await s.t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Org C', slug: 'org-c' },
        locations: [],
        leagues: [],
      }),
    );
    expect((await storedAndRecount(s, organizationId)).stored).toBe(0);
  });

  test('a counter that is not set yet is recounted by the next create, which includes it', async () => {
    const s = await setup();
    await unsetCounter(s, s.organizationA);
    await s.asAdminA.mutation(api.leagues.create, newLeague(s, 'one'));
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 2, recount: 2 });
  });

  test('a counter that is not set yet is recounted by the next publish, which excludes it', async () => {
    const s = await setup();
    await unsetCounter(s, s.organizationA);
    await s.asAdminA.mutation(api.leagues.publish, {
      leagueId: await draftIdOf(s, s.organizationA),
    });
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 0, recount: 0 });
  });

  test('a league published before the status field existed is not a draft', async () => {
    const s = await setup();
    const legacy = await s.t.run(async (ctx) => {
      const { leagueId } = await insertLeague(ctx, s.organizationA, {
        name: 'Legacy',
        sport: 'soccer',
        locations: [FIELD],
        division: defaultDivision('soccer'),
      });
      const league = (await ctx.db.get('leagues', leagueId))!;
      await ctx.db.replace('leagues', leagueId, {
        ...leagueRequiredFields(league.sport, league.name),
        organizationId: league.organizationId,
        name: league.name,
        slug: league.slug,
        sport: league.sport,
        locationIds: league.locationIds,
        sortName: league.sortName,
      });
      return leagueId;
    });
    await s.asAdminA.mutation(api.leagues.publish, { leagueId: legacy });
    expect(await storedAndRecount(s, s.organizationA)).toEqual({ stored: 1, recount: 1 });
  });
});

describe('seed:demo backfill of the draft league counter', () => {
  test('sets a counter that is not set from a recount, counts the organization, and leaves a set one', async () => {
    const s = await setup();
    await unsetCounter(s, s.organizationA);
    await s.t.run((ctx) =>
      ctx.db.patch('organizations', s.organizationB, { draftLeagueCount: 40 }),
    );
    const first = await s.t.mutation(internal.seed.insertDemoData, {});
    expect(first.backfilled.draftLeagueCounts).toBe(1);
    expect((await storedAndRecount(s, s.organizationA)).stored).toBe(1);
    expect((await storedAndRecount(s, s.organizationB)).stored).toBe(40);
    const second = await s.t.mutation(internal.seed.insertDemoData, {});
    expect(second.backfilled.draftLeagueCounts).toBe(0);
  });
});
