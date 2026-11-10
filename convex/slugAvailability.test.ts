/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { DEMO_ORGANIZATION_SLUGS } from './lib/slugs';
import { insertSeason, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const SOCCER_7V7 = {
  gender: 'coed',
  playersPerSide: 7,
  level: 'rec',
  ageGroup: 'adult',
} as const;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'], division: SOCCER_7V7 },
        { name: 'Other 7v7', sport: 'soccer', locations: ['Alpha Field'], division: SOCCER_7V7 },
      ],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [
        { name: 'B League', sport: 'soccer', locations: ['B Field'], division: SOCCER_7V7 },
      ],
    });
    const league = async (organizationId: Id<'organizations'>, slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!._id;
    const leagueA = await league(organizationA, 'coed-7v7');
    const leagueOther = await league(organizationA, 'other-7v7');
    const leagueB = await league(organizationB, 'b-league');
    const leagueDoc = (await ctx.db.get('leagues', leagueA))!;
    await insertSeason(ctx, leagueDoc, {
      name: 'Fall 2026',
      slug: 'fall-2026',
      startDate: '2026-09-01',
      endDate: '2026-11-15',
      registrationDeadline: '2026-08-25',
      playersPerSide: 7,
      minimumRosterSize: 7,
    });
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
      leagueIds: Id<'leagues'>[] = [],
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
      }
    };
    await member('admin-a', organizationA);
    await member('organizer-a', organizationA, 'leagueOrganizer', [leagueA]);
    await member('admin-b', organizationB);
    await member('stranger', null);
    return { organizationA, organizationB, leagueA, leagueOther, leagueB };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    organizerA: t.withIdentity(identity('organizer-a')),
    adminB: t.withIdentity(identity('admin-b')),
    stranger: t.withIdentity(identity('stranger')),
    ghost: t.withIdentity(identity('ghost')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

describe('organizations.isSlugAvailable', () => {
  test('answers true for a free slug and false for a taken one', async () => {
    const s = await setup();
    expect(await s.stranger.query(api.organizations.isSlugAvailable, { slug: 'free-org' })).toBe(
      true,
    );
    expect(await s.stranger.query(api.organizations.isSlugAvailable, { slug: 'org-a' })).toBe(
      false,
    );
  });

  test('answers false for a reserved slug and for one that is not well-formed', async () => {
    const s = await setup();
    for (const slug of ['new', ...DEMO_ORGANIZATION_SLUGS, 'Bad-Slug', 'ab', 'a--b']) {
      expect(await s.stranger.query(api.organizations.isSlugAvailable, { slug }), slug).toBe(false);
    }
  });

  test('refuses a caller who is not signed in, or has no users row', async () => {
    const s = await setup();
    await expect(
      s.t.query(api.organizations.isSlugAvailable, { slug: 'free-org' }),
    ).rejects.toThrow('Sign in required');
    await expect(
      s.ghost.query(api.organizations.isSlugAvailable, { slug: 'free-org' }),
    ).rejects.toThrow('Sign in required');
  });
});

describe('leagues.isSlugAvailable', () => {
  test('answers true for a free slug and false for one the organization uses', async () => {
    const s = await setup();
    const organizationId = s.organizationA;
    expect(
      await s.adminA.query(api.leagues.isSlugAvailable, { organizationId, slug: 'free-league' }),
    ).toBe(true);
    expect(
      await s.adminA.query(api.leagues.isSlugAvailable, { organizationId, slug: 'coed-7v7' }),
    ).toBe(false);
  });

  test('allows a slug that another organization uses', async () => {
    const s = await setup();
    expect(
      await s.adminA.query(api.leagues.isSlugAvailable, {
        organizationId: s.organizationA,
        slug: 'b-league',
      }),
    ).toBe(true);
  });

  test('answers false for a reserved slug', async () => {
    const s = await setup();
    expect(
      await s.adminA.query(api.leagues.isSlugAvailable, {
        organizationId: s.organizationA,
        slug: 'new',
      }),
    ).toBe(false);
  });

  test.each([
    ['unauthenticated', 'Sign in required', (s: Setup) => s.t, 'leagueA'],
    ['an organizer of another league', 'Not allowed', (s: Setup) => s.organizerA, 'leagueOther'],
    ['an org admin of another organization', 'Not allowed', (s: Setup) => s.adminB, 'leagueA'],
    ['a non-member', 'Not allowed', (s: Setup) => s.stranger, 'leagueA'],
  ] as const)('refuses %s', async (_name, message, caller, league) => {
    const s = await setup();
    await expect(
      caller(s).query(api.seasons.isSlugAvailable, { leagueId: s[league], slug: 'spring-2027' }),
    ).rejects.toThrow(message);
  });
});
