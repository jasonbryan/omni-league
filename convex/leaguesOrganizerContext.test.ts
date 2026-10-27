/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { FORBIDDEN_CODE } from './lib/forbidden';
import { insertCustomLevel, insertTenant } from './lib/tenantWrites';
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

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [
        { name: 'Bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      leagues: [
        { name: 'Coed 7v7', sport: 'soccer', locations: ['Alpha Field', 'Bravo Beach'] },
        { name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Bravo Beach'] },
        { name: 'Draft Softball', sport: 'softball', locations: ['Alpha Field'], status: 'draft' },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const league = async (slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) => q.eq('organizationId', a).eq('slug', slug))
        .unique())!._id;
    const [l, m, d] = [
      await league('coed-7v7'),
      await league('sand-2s'),
      await league('draft-softball'),
    ];
    const bField = (await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', b).eq('name', 'B Field'),
      )
      .unique())!._id;
    const leagueL = (await ctx.db.get('leagues', l))!;
    await ctx.db.patch('leagues', l, { locationIds: [...leagueL.locationIds, bField] });
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
    await member('admin-a', a);
    await member('organizer-l', a, 'leagueOrganizer', [l]);
    await member('organizer-d', a, 'leagueOrganizer', [d]);
    await member('organizer-m', a, 'leagueOrganizer', [m]);
    await member('admin-b', b);
    await member('stranger', null);
    return { l, m, d };
  });
  const as = (name: string) => t.withIdentity(identity(name));
  return { t, as, ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const L = { orgSlug: 'org-a', leagueSlug: 'coed-7v7' };
const M = { orgSlug: 'org-a', leagueSlug: 'sand-2s' };
const D = { orgSlug: 'org-a', leagueSlug: 'draft-softball' };

async function forbidden(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data).toEqual({ code: FORBIDDEN_CODE });
}

function outsiders(s: Setup) {
  return [
    ['unauthenticated', s.t],
    ['identity with no users row', s.as('ghost')],
    ['org admin of another organization', s.as('admin-b')],
    ['non-member', s.as('stranger')],
  ] as const;
}

describe('leagues.getOrganizerContext', () => {
  test('gives an org admin the league, its locations, and its organization', async () => {
    const s = await setup();
    const context = await s.as('admin-a').query(api.leagues.getOrganizerContext, L);
    expect(context).toEqual({
      leagueId: expect.any(String) as string,
      name: 'Coed 7v7',
      slug: 'coed-7v7',
      sport: 'soccer',
      status: 'published',
      locationNames: ['Alpha Field', 'Bravo Beach'],
      role: 'orgAdmin',
      organization: { name: 'Org A', slug: 'org-a' },
      organizationId: expect.any(String) as string,
    });
  });

  test('gives the league organizer assigned to the league the same, with their role', async () => {
    const s = await setup();
    const context = await s.as('organizer-l').query(api.leagues.getOrganizerContext, L);
    expect(context).toMatchObject({ slug: 'coed-7v7', role: 'leagueOrganizer' });
  });

  test('gives the division with its label, and the league’s own custom level', async () => {
    const s = await setup();
    const customLevelId = await s.t.run(async (ctx) => {
      const organizationId = (await ctx.db.get('leagues', s.ids.l))!.organizationId;
      const id = await insertCustomLevel(ctx, organizationId, {
        sport: 'soccer',
        name: 'D',
        standardLevel: 'rec',
      });
      await ctx.db.patch('leagues', s.ids.l, {
        gender: 'coed',
        playersPerSide: 7,
        level: 'rec',
        customLevelId: id,
        ageGroup: 'adult',
        minimumRosterSize: 9,
      });
      return id;
    });
    const context = await s.as('organizer-l').query(api.leagues.getOrganizerContext, L);
    expect(context?.division).toEqual({
      gender: 'coed',
      playersPerSide: 7,
      level: 'rec',
      customLevel: { customLevelId, name: 'D' },
      ageGroup: 'adult',
      minimumRosterSize: 9,
      label: 'Coed · 7v7 · D (Rec)',
    });
  });

  test('gives no division for a league that has none', async () => {
    const s = await setup();
    const context = await s.as('admin-a').query(api.leagues.getOrganizerContext, L);
    expect(context).not.toHaveProperty('division');
  });

  test('gives staff of a draft league the league with status draft', async () => {
    const s = await setup();
    for (const name of ['admin-a', 'organizer-d']) {
      expect(await s.as(name).query(api.leagues.getOrganizerContext, D)).toMatchObject({
        slug: 'draft-softball',
        status: 'draft',
      });
    }
  });

  test('reports a league stored without a status as a draft, and hides it from outsiders', async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch('leagues', s.ids.l, { status: undefined }));
    expect(await s.as('admin-a').query(api.leagues.getOrganizerContext, L)).toMatchObject({
      status: 'draft',
    });
    expect(await s.as('stranger').query(api.leagues.getOrganizerContext, L)).toBeNull();
  });

  test.each([0, 1, 2, 3])(
    'throws FORBIDDEN for outsider %# on a published league',
    async (index) => {
      const s = await setup();
      const [, caller] = outsiders(s)[index];
      await forbidden(caller.query(api.leagues.getOrganizerContext, L));
    },
  );

  test.each([0, 1, 2, 3])('returns null for outsider %# on a draft league', async (index) => {
    const s = await setup();
    const [, caller] = outsiders(s)[index];
    expect(await caller.query(api.leagues.getOrganizerContext, D)).toBeNull();
  });

  test('throws FORBIDDEN for a league organizer of another league of the same organization', async () => {
    const s = await setup();
    await forbidden(s.as('organizer-m').query(api.leagues.getOrganizerContext, L));
    await forbidden(s.as('organizer-m').query(api.leagues.getOrganizerContext, D));
    await forbidden(s.as('organizer-l').query(api.leagues.getOrganizerContext, M));
  });

  test('returns null for an unknown organization, an unknown league, and a league of another organization', async () => {
    const s = await setup();
    for (const caller of [s.t, s.as('admin-a'), s.as('admin-b'), s.as('stranger')]) {
      expect(
        await caller.query(api.leagues.getOrganizerContext, {
          orgSlug: 'nope',
          leagueSlug: 'coed-7v7',
        }),
      ).toBeNull();
      expect(
        await caller.query(api.leagues.getOrganizerContext, {
          orgSlug: 'org-a',
          leagueSlug: 'nope',
        }),
      ).toBeNull();
      expect(
        await caller.query(api.leagues.getOrganizerContext, {
          orgSlug: 'org-b',
          leagueSlug: 'coed-7v7',
        }),
      ).toBeNull();
    }
  });

  test('leaves out a location of another organization', async () => {
    const s = await setup();
    const context = await s.as('admin-a').query(api.leagues.getOrganizerContext, L);
    expect(context?.locationNames).not.toContain('B Field');
  });
});
