/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertCustomLevel, insertDraftLeague, insertTenant } from './lib/tenantWrites';
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
    const tenant = (name: string, slug: string) =>
      insertTenant(ctx, {
        organization: { name, slug },
        locations: [{ name: `${name} Field`, address: '1 Main St' }],
        leagues: [],
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
    return { organizationA, organizationB };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    adminB: t.withIdentity(identity('admin-b')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const rows = (s: Setup) => s.t.run((ctx) => ctx.db.query('customLevels').collect());

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
    ['league organizer of A', s.t.withIdentity(identity('organizer-a')), 'Not allowed'],
    ['org admin of B', s.adminB, 'Not allowed'],
    ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
  ] as const;
}

const gold = (s: Setup) => ({
  organizationId: s.organizationA,
  sport: 'beachVolleyball' as const,
  name: 'Gold',
  standardLevel: 'a',
});

describe('customLevels.create', () => {
  test('stores the level for the organization and sport, with its normalized name', async () => {
    const s = await setup();
    const id = await s.adminA.mutation(api.customLevels.create, {
      ...gold(s),
      name: '  Gold   Plus ',
    });
    expect(await rows(s)).toMatchObject([
      {
        _id: id,
        organizationId: s.organizationA,
        sport: 'beachVolleyball',
        name: 'Gold Plus',
        nameKey: 'gold plus',
        standardLevel: 'a',
      },
    ]);
  });

  test('refuses a name already used in the organization and sport, ignoring case and spacing', async () => {
    const s = await setup();
    await s.adminA.mutation(api.customLevels.create, gold(s));
    for (const name of ['Gold', 'gold', '  GOLD ']) {
      expect(
        await refusal(s.adminA.mutation(api.customLevels.create, { ...gold(s), name })),
      ).toEqual({
        field: 'name',
        code: 'duplicate',
        message: `${name.trim()} is already a custom level for beach volleyball.`,
      });
    }
    expect(await rows(s)).toHaveLength(1);
  });

  test('allows the same name for another sport and in another organization', async () => {
    const s = await setup();
    await s.adminA.mutation(api.customLevels.create, gold(s));
    await s.adminA.mutation(api.customLevels.create, {
      ...gold(s),
      sport: 'soccer',
      standardLevel: 'competitive',
    });
    await s.adminB.mutation(api.customLevels.create, {
      ...gold(s),
      organizationId: s.organizationB,
    });
    expect(await rows(s)).toHaveLength(3);
  });

  test('refuses the label of a standard level of the sport, ignoring case', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.customLevels.create, { ...gold(s), name: 'bb' })),
    ).toEqual({
      field: 'name',
      code: 'standardLevel',
      message: 'BB is a standard level. Choose it above.',
    });
    expect(await rows(s)).toEqual([]);
  });

  test('refuses an empty name and one over 30 characters', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.customLevels.create, { ...gold(s), name: '  ' })),
    ).toMatchObject({
      field: 'name',
      code: 'nameEmpty',
    });
    expect(
      await refusal(
        s.adminA.mutation(api.customLevels.create, { ...gold(s), name: 'x'.repeat(31) }),
      ),
    ).toMatchObject({ field: 'name', code: 'nameTooLong' });
    expect(await rows(s)).toEqual([]);
  });

  test('refuses no standard level, an unknown one, and another sport’s, with the field’s message', async () => {
    const s = await setup();
    for (const standardLevel of ['', 'platinum', 'competitive']) {
      expect(
        await refusal(s.adminA.mutation(api.customLevels.create, { ...gold(s), standardLevel })),
        standardLevel,
      ).toEqual({
        field: 'standardLevel',
        code: 'standardLevelEmpty',
        message: 'Choose the standard level Gold matches, so players can filter for it.',
      });
    }
    expect(await rows(s)).toEqual([]);
  });

  test('allows 20 custom levels for a sport and refuses the 21st, while another sport still has room', async () => {
    const s = await setup();
    for (let n = 1; n <= 20; n++) {
      await s.adminA.mutation(api.customLevels.create, { ...gold(s), name: `Level ${n}` });
    }
    expect(
      await refusal(s.adminA.mutation(api.customLevels.create, { ...gold(s), name: 'Level 21' })),
    ).toEqual({
      field: 'name',
      code: 'limit',
      message: 'You can have at most 20 custom levels for beach volleyball.',
    });
    expect(await rows(s)).toHaveLength(20);
    await s.adminA.mutation(api.customLevels.create, {
      ...gold(s),
      sport: 'soccer',
      standardLevel: 'rec',
    });
    expect(await rows(s)).toHaveLength(21);
  });

  test('stores one of two simultaneous creates of the same name and refuses the other as a duplicate', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.adminA.mutation(api.customLevels.create, gold(s)),
      s.adminA.mutation(api.customLevels.create, { ...gold(s), name: 'gold' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await rows(s)).toHaveLength(1);
  });

  test('refuses every caller who is not an org admin of the organization and changes nothing', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.mutation(api.customLevels.create, gold(s)), label).rejects.toThrow(
        message,
      );
    }
    expect(await rows(s)).toEqual([]);
  });
});

describe('customLevels.remove', () => {
  async function withGold(s: Setup) {
    return s.adminA.mutation(api.customLevels.create, gold(s));
  }

  test('deletes a level no league uses', async () => {
    const s = await setup();
    const id = await withGold(s);
    await s.adminA.mutation(api.customLevels.remove, { customLevelId: id });
    expect(await rows(s)).toEqual([]);
  });

  test('refuses a level a league uses and keeps it, while one no league uses is deleted', async () => {
    const s = await setup();
    const id = await withGold(s);
    const unused = await s.adminA.mutation(api.customLevels.create, { ...gold(s), name: 'Silver' });
    await s.t.run(async (ctx) => {
      const location = (await ctx.db.query('locations').first())!;
      await insertDraftLeague(ctx, s.organizationA, {
        name: 'Gold league',
        slug: 'gold-league',
        sport: 'beachVolleyball',
        locationIds: [location._id],
        division: {
          gender: 'coed',
          playersPerSide: 4,
          level: 'a',
          customLevelId: id,
          ageGroup: 'adult',
        },
      });
    });
    expect(
      await refusal(s.adminA.mutation(api.customLevels.remove, { customLevelId: id })),
    ).toEqual({ field: 'name', code: 'inUse', message: 'A league uses Gold.' });
    expect(await rows(s)).toHaveLength(2);
    await s.adminA.mutation(api.customLevels.remove, { customLevelId: unused });
    expect((await rows(s)).map((row) => row.name)).toEqual(['Gold']);
  });

  test('refuses a level that is gone, as not allowed', async () => {
    const s = await setup();
    const id = await withGold(s);
    await s.adminA.mutation(api.customLevels.remove, { customLevelId: id });
    await expect(s.adminA.mutation(api.customLevels.remove, { customLevelId: id })).rejects.toThrow(
      'Not allowed',
    );
  });

  test('refuses every caller who is not an org admin of the level’s organization and keeps it', async () => {
    const s = await setup();
    const id = await withGold(s);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.customLevels.remove, { customLevelId: id }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await rows(s)).toHaveLength(1);
  });
});

describe('customLevels.listForSport', () => {
  test('lists the sport’s levels of the organization by name, ignoring case', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await insertCustomLevel(ctx, s.organizationA, {
        sport: 'beachVolleyball',
        name: 'silver',
        standardLevel: 'b',
      });
      await insertCustomLevel(ctx, s.organizationA, {
        sport: 'beachVolleyball',
        name: 'Gold',
        standardLevel: 'a',
      });
      await insertCustomLevel(ctx, s.organizationA, {
        sport: 'soccer',
        name: 'Social',
        standardLevel: 'rec',
      });
      await insertCustomLevel(ctx, s.organizationB, {
        sport: 'beachVolleyball',
        name: 'Bronze',
        standardLevel: 'rec',
      });
    });
    const list = await s.adminA.query(api.customLevels.listForSport, {
      organizationId: s.organizationA,
      sport: 'beachVolleyball',
    });
    expect(list.map(({ name, standardLevel }) => [name, standardLevel])).toEqual([
      ['Gold', 'a'],
      ['silver', 'b'],
    ]);
    expect(Object.keys(list[0]).sort()).toEqual(['customLevelId', 'name', 'standardLevel']);
  });

  test('lists nothing for a sport with no custom levels', async () => {
    const s = await setup();
    expect(
      await s.adminA.query(api.customLevels.listForSport, {
        organizationId: s.organizationA,
        sport: 'softball',
      }),
    ).toEqual([]);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.customLevels.listForSport, {
          organizationId: s.organizationA,
          sport: 'beachVolleyball',
        }),
        label,
      ).rejects.toThrow(message);
    }
  });
});
