/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertSeason, insertTenant, publishSeason } from './lib/tenantWrites';
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

const fall = {
  name: 'Fall 2027',
  slug: 'fall-2027',
  startDate: '2027-09-08',
  endDate: '2027-11-10',
  registrationDeadline: '2027-08-25',
  format: '7v7' as const,
  minimumRosterSize: 7,
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field'] },
        { name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Alpha Field'] },
        { name: 'Draft Softball', sport: 'softball', locations: ['Alpha Field'], status: 'draft' },
      ],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['B Field'] }],
    });
    const league = async (organizationId: Id<'organizations'>, slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', organizationId).eq('slug', slug),
        )
        .unique())!;
    const leagueL = await league(organizationA, 'coed-7v7');
    const leagueM = await league(organizationA, 'sand-2s');
    const leagueD = await league(organizationA, 'draft-softball');
    const leagueB = await league(organizationB, 'coed-7v7');
    const seasonL = await insertSeason(ctx, leagueL, fall);
    const publishedL = await insertSeason(
      ctx,
      leagueL,
      { ...fall, name: 'Summer 2027', slug: 'summer-2027' },
      'published',
    );
    const seasonM = await insertSeason(ctx, leagueM, { ...fall, format: '4v4' });
    const seasonD = await insertSeason(ctx, leagueD, { ...fall, format: '10v10' });
    const seasonB = await insertSeason(ctx, leagueB, fall);
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
    await member('organizer-l', organizationA, 'leagueOrganizer', [leagueL._id]);
    await member('organizer-m', organizationA, 'leagueOrganizer', [leagueM._id]);
    await member('organizer-d', organizationA, 'leagueOrganizer', [leagueD._id]);
    await member('admin-b', organizationB);
    await member('stranger', null);
    return { seasonL, publishedL, seasonM, seasonD, seasonB };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    organizerL: t.withIdentity(identity('organizer-l')),
    organizerM: t.withIdentity(identity('organizer-m')),
    organizerD: t.withIdentity(identity('organizer-d')),
    adminB: t.withIdentity(identity('admin-b')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const seasons = (t: Setup['t']) => t.run((ctx) => ctx.db.query('seasons').collect());
const organizations = (t: Setup['t']) => t.run((ctx) => ctx.db.query('organizations').collect());
const leagues = (t: Setup['t']) => t.run((ctx) => ctx.db.query('leagues').collect());
const statusOf = (t: Setup['t'], id: Id<'seasons'>) =>
  t.run(async (ctx) => (await ctx.db.get('seasons', id))?.status);

describe('seasons.publish', () => {
  test('an org admin publishes a draft season of a published league: only its status changes', async () => {
    const s = await setup();
    const before = await seasons(s.t);
    await expect(s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL })).resolves.toBe(
      null,
    );
    const after = await seasons(s.t);
    expect(after.find((season) => season._id === s.seasonL)).toEqual({
      ...before.find((season) => season._id === s.seasonL)!,
      status: 'published',
    });
    expect(after.filter((season) => season._id !== s.seasonL)).toEqual(
      before.filter((season) => season._id !== s.seasonL),
    );
  });

  test('writes no organization row, and the only league row it changes is the league’s publishedSeasonCount', async () => {
    const s = await setup();
    const leagueL = await s.t.run(
      async (ctx) => (await ctx.db.get('seasons', s.seasonL))!.leagueId,
    );
    const before = { organizations: await organizations(s.t), leagues: await leagues(s.t) };
    await s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL });
    const after = { organizations: await organizations(s.t), leagues: await leagues(s.t) };
    expect(after.organizations).toEqual(before.organizations);
    expect(after.leagues).toHaveLength(before.leagues.length);
    for (const league of before.leagues) {
      const changed = after.leagues.find((candidate) => candidate._id === league._id);
      expect(changed).toEqual(
        league._id === leagueL
          ? { ...league, publishedSeasonCount: (league.publishedSeasonCount ?? 0) + 1 }
          : league,
      );
      if (league._id === leagueL) expect(changed?.publishedSeasonCount).toBe(2);
    }
  });

  test('the league organizer assigned to the league publishes its season; the season of a league they are not assigned is refused', async () => {
    const s = await setup();
    await expect(s.organizerL.mutation(api.seasons.publish, { seasonId: s.seasonL })).resolves.toBe(
      null,
    );
    expect(await statusOf(s.t, s.seasonL)).toBe('published');

    const before = await seasons(s.t);
    await expect(
      s.organizerL.mutation(api.seasons.publish, { seasonId: s.seasonM }),
    ).rejects.toThrow('Not allowed');
    expect(await seasons(s.t)).toEqual(before);
    expect(await statusOf(s.t, s.seasonM)).toBe('draft');
  });

  test('publishing a season of a draft league is refused and the season stays a draft, for an org admin and for its league organizer', async () => {
    const s = await setup();
    const before = await seasons(s.t);
    for (const caller of [s.adminA, s.organizerD]) {
      await expect(caller.mutation(api.seasons.publish, { seasonId: s.seasonD })).rejects.toThrow(
        'Publish the league first',
      );
    }
    expect(await seasons(s.t)).toEqual(before);
    expect(await statusOf(s.t, s.seasonD)).toBe('draft');
  });

  test('a season of a draft league becomes publishable once the league is published', async () => {
    const s = await setup();
    await s.adminA.mutation(api.leagues.publish, {
      leagueId: (await seasons(s.t)).find((season) => season._id === s.seasonD)!.leagueId,
    });
    await expect(s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonD })).resolves.toBe(
      null,
    );
    expect(await statusOf(s.t, s.seasonD)).toBe('published');
  });

  test('refuses every caller who may not organize the season’s league, and changes nothing', async () => {
    const s = await setup();
    const before = { seasons: await seasons(s.t), leagues: await leagues(s.t) };
    const callers = [
      ['unauthenticated', s.t, 'Sign in required'],
      ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
      ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
      ['org admin of another organization', s.adminB, 'Not allowed'],
      ['league organizer of another league', s.organizerM, 'Not allowed'],
    ] as const;
    for (const [label, caller, message] of callers) {
      await expect(
        caller.mutation(api.seasons.publish, { seasonId: s.seasonL }),
        label,
      ).rejects.toThrow(message);
    }
    expect({ seasons: await seasons(s.t), leagues: await leagues(s.t) }).toEqual(before);
  });

  test('takes the organization from the stored season: the admin of B cannot publish A’s season, and A’s admin cannot publish B’s', async () => {
    const s = await setup();
    await expect(s.adminB.mutation(api.seasons.publish, { seasonId: s.seasonL })).rejects.toThrow(
      'Not allowed',
    );
    await expect(s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonB })).rejects.toThrow(
      'Not allowed',
    );
    expect(await statusOf(s.t, s.seasonB)).toBe('draft');
    await expect(s.adminB.mutation(api.seasons.publish, { seasonId: s.seasonB })).resolves.toBe(
      null,
    );
  });

  test('an unknown season id is refused with the same message as a season of another organization', async () => {
    const s = await setup();
    const gone = await s.t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').first())!;
      const id = await insertSeason(ctx, league, { ...fall, slug: 'gone' });
      await ctx.db.delete('seasons', id);
      return id;
    });
    const before = await seasons(s.t);
    await expect(s.adminA.mutation(api.seasons.publish, { seasonId: gone })).rejects.toThrow(
      'Not allowed',
    );
    await expect(s.t.mutation(api.seasons.publish, { seasonId: gone })).rejects.toThrow(
      'Sign in required',
    );
    expect(await seasons(s.t)).toEqual(before);
  });

  test('a repeat publish succeeds and changes nothing', async () => {
    const s = await setup();
    await s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL });
    const before = { seasons: await seasons(s.t), organizations: await organizations(s.t) };
    await expect(s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL })).resolves.toBe(
      null,
    );
    await expect(s.organizerL.mutation(api.seasons.publish, { seasonId: s.seasonL })).resolves.toBe(
      null,
    );
    expect({ seasons: await seasons(s.t), organizations: await organizations(s.t) }).toEqual(
      before,
    );
  });

  test('a season that was already published is a no-op for its organizers', async () => {
    const s = await setup();
    const before = await seasons(s.t);
    await expect(s.adminA.mutation(api.seasons.publish, { seasonId: s.publishedL })).resolves.toBe(
      null,
    );
    expect(await seasons(s.t)).toEqual(before);
  });

  test('a repeat publish is still refused for a caller who may not organize the league', async () => {
    const s = await setup();
    await expect(
      s.adminB.mutation(api.seasons.publish, { seasonId: s.publishedL }),
    ).rejects.toThrow('Not allowed');
  });

  test('publishSeason publishes a draft and leaves a published season alone', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const published = (await ctx.db.get('seasons', s.publishedL))!;
      await publishSeason(ctx, published);
      expect(await ctx.db.get('seasons', s.publishedL)).toEqual(published);
      const draft = (await ctx.db.get('seasons', s.seasonL))!;
      await publishSeason(ctx, draft);
      expect(await ctx.db.get('seasons', s.seasonL)).toEqual({ ...draft, status: 'published' });
    });
  });
});

describe('seasons.publish edge cases', () => {
  test('concurrent publishes of one season, by an org admin and by its league organizer, all succeed and leave one published row', async () => {
    const s = await setup();
    const before = await seasons(s.t);
    const results = await Promise.all([
      s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.organizerL.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.organizerL.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL }),
    ]);
    expect(results).toEqual([null, null, null, null, null]);
    const after = await seasons(s.t);
    expect(after).toHaveLength(before.length);
    expect(after.find((season) => season._id === s.seasonL)).toEqual({
      ...before.find((season) => season._id === s.seasonL)!,
      status: 'published',
    });
    expect(after.filter((season) => season._id !== s.seasonL)).toEqual(
      before.filter((season) => season._id !== s.seasonL),
    );
  });

  test('concurrent publishes mixed with refused callers: only the permitted ones write', async () => {
    const s = await setup();
    const settled = await Promise.allSettled([
      s.adminB.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.organizerM.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.t.mutation(api.seasons.publish, { seasonId: s.seasonL }),
      s.organizerL.mutation(api.seasons.publish, { seasonId: s.seasonL }),
    ]);
    expect(settled.map((r) => r.status)).toEqual([
      'rejected',
      'fulfilled',
      'rejected',
      'rejected',
      'fulfilled',
    ]);
    expect(await statusOf(s.t, s.seasonL)).toBe('published');
    expect(await statusOf(s.t, s.seasonM)).toBe('draft');
    expect(await statusOf(s.t, s.seasonB)).toBe('draft');
  });

  test('a concurrent publish while the league is a draft refuses every caller and writes nothing', async () => {
    const s = await setup();
    const before = await seasons(s.t);
    const settled = await Promise.allSettled([
      s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonD }),
      s.organizerD.mutation(api.seasons.publish, { seasonId: s.seasonD }),
    ]);
    expect(settled.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(await seasons(s.t)).toEqual(before);
  });

  test('publishing a season changes no result of the public queries, and an anonymous caller cannot list the season', async () => {
    const s = await setup();
    const publicResults = () =>
      Promise.all([
        s.t.query(api.organizations.getPublicPage, { slug: 'org-a' }),
        s.t.query(api.organizations.listPublicLeagues, { slug: 'org-a', page: 1 }),
        s.t.query(api.organizations.listPublicLocations, { slug: 'org-a', page: 1 }),
        s.t.query(api.organizations.listPublicLeagues, { slug: 'org-a', page: 1, sport: 'soccer' }),
      ]);
    const before = await publicResults();
    await s.adminA.mutation(api.seasons.publish, { seasonId: s.seasonL });
    expect(await publicResults()).toEqual(before);
    expect(JSON.stringify(await publicResults())).not.toMatch(/season|fall-2027|Fall 2027/i);
    const leagueId = (await seasons(s.t)).find((season) => season._id === s.seasonL)!.leagueId;
    await expect(s.t.query(api.seasons.listForOrganizer, { leagueId })).rejects.toThrow(
      'Sign in required',
    );
    await expect(s.adminB.query(api.seasons.listForOrganizer, { leagueId })).rejects.toThrow(
      'Not allowed',
    );
  });
});
