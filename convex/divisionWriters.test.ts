/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { customLevelNameKey } from './lib/divisions';
import {
  findCustomLevel,
  insertCustomLevel,
  insertDraftLeague,
  insertLeague,
  insertTenant,
} from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

function setup() {
  return convexTest(schema, modules);
}

const TENANT = {
  organization: { name: 'Org A', slug: 'org-a' },
  locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
  leagues: [],
};

describe('customLevelNameKey', () => {
  test.each([
    ['D', 'd'],
    ['  Division   Two ', 'division two'],
    ['A\t\n+', 'a +'],
  ])('%j gives %j', (name, key) => {
    expect(customLevelNameKey(name)).toBe(key);
  });
});

describe('insertCustomLevel', () => {
  test('writes the level with its name key and creation time', async () => {
    const t = setup();
    const row = await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const id = await insertCustomLevel(ctx, organizationId, {
        sport: 'softball',
        name: 'Division  D',
        standardLevel: 'rec',
      });
      return { organizationId, row: await ctx.db.get('customLevels', id) };
    });
    expect(row.row).toMatchObject({
      organizationId: row.organizationId,
      sport: 'softball',
      name: 'Division  D',
      nameKey: 'division d',
      standardLevel: 'rec',
    });
    expect(row.row?.createdAt).toBeGreaterThan(0);
  });

  test('refuses a standard level that is not a level of the sport, writing nothing', async () => {
    const t = setup();
    await expect(
      t.run(async (ctx) => {
        const organizationId = await insertTenant(ctx, TENANT);
        await insertCustomLevel(ctx, organizationId, {
          sport: 'softball',
          name: 'AA',
          standardLevel: 'aa',
        });
      }),
    ).rejects.toThrow(/not a level of softball/);
    expect(await t.run((ctx) => ctx.db.query('customLevels').collect())).toEqual([]);
  });

  test('is found by name ignoring case and spacing, within the organization and sport only', async () => {
    const t = setup();
    const found = await t.run(async (ctx) => {
      const a = await insertTenant(ctx, TENANT);
      const b = await insertTenant(ctx, { ...TENANT, organization: { name: 'B', slug: 'org-b' } });
      await insertCustomLevel(ctx, a, { sport: 'softball', name: 'Div D', standardLevel: 'rec' });
      return {
        same: await findCustomLevel(ctx, a, 'softball', '  div   d '),
        otherSport: await findCustomLevel(ctx, a, 'soccer', 'Div D'),
        otherOrganization: await findCustomLevel(ctx, b, 'softball', 'Div D'),
      };
    });
    expect(found.same?.name).toBe('Div D');
    expect(found.otherSport).toBeNull();
    expect(found.otherOrganization).toBeNull();
  });
});

describe('insertLeague with a division', () => {
  const division = {
    gender: 'mens' as const,
    playersPerSide: 10,
    level: 'rec' as const,
    ageGroup: 'adult' as const,
  };
  const league = {
    name: 'D Division',
    sport: 'softball' as const,
    locations: ['Alpha Field'],
  };

  test('writes the division, with the minimum roster size only when given', async () => {
    const t = setup();
    const rows = await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      await insertLeague(ctx, organizationId, { ...league, division });
      await insertLeague(ctx, organizationId, {
        ...league,
        name: 'Raised',
        division: { ...division, minimumRosterSize: 12 },
      });
      return ctx.db.query('leagues').collect();
    });
    expect(rows[0]).toMatchObject(division);
    expect(rows[0]).not.toHaveProperty('minimumRosterSize');
    expect(rows[0]).not.toHaveProperty('customLevelId');
    expect(rows[1]).toMatchObject({ ...division, minimumRosterSize: 12 });
  });

  test('writes no division on a league inserted without one', async () => {
    const t = setup();
    const row = await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      await insertLeague(ctx, organizationId, league);
      return (await ctx.db.query('leagues').collect())[0];
    });
    for (const field of ['gender', 'playersPerSide', 'level', 'ageGroup', 'customLevelId']) {
      expect(row).not.toHaveProperty(field);
    }
  });

  test('links the custom level named by the seed, found through the by_customLevelId index', async () => {
    const t = setup();
    const result = await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const levelId = await insertCustomLevel(ctx, organizationId, {
        sport: 'softball',
        name: 'D',
        standardLevel: 'rec',
      });
      await insertLeague(ctx, organizationId, {
        ...league,
        division: { ...division, customLevel: 'd' },
      });
      const users = await ctx.db
        .query('leagues')
        .withIndex('by_customLevelId', (q) => q.eq('customLevelId', levelId))
        .collect();
      return { users, levelId };
    });
    expect(result.users.map((row) => row.name)).toEqual(['D Division']);
    expect(result.users[0]?.customLevelId).toBe(result.levelId);
  });

  test('refuses a custom level that does not exist or maps to another level, writing no league', async () => {
    const t = setup();
    await expect(
      t.run(async (ctx) => {
        const organizationId = await insertTenant(ctx, TENANT);
        await insertLeague(ctx, organizationId, {
          ...league,
          division: { ...division, customLevel: 'Missing' },
        });
      }),
    ).rejects.toThrow(/No custom level "Missing"/);
    await expect(
      t.run(async (ctx) => {
        const organizationId = await insertTenant(ctx, TENANT);
        await insertCustomLevel(ctx, organizationId, {
          sport: 'softball',
          name: 'D',
          standardLevel: 'intermediate',
        });
        await insertLeague(ctx, organizationId, {
          ...league,
          division: { ...division, customLevel: 'D' },
        });
      }),
    ).rejects.toThrow(/maps to intermediate, not rec/);
    expect(await t.run((ctx) => ctx.db.query('leagues').collect())).toEqual([]);
  });
});

describe('insertDraftLeague', () => {
  test('writes the division it is given', async () => {
    const t = setup();
    const row = await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const location = (await ctx.db.query('locations').collect())[0];
      const id = await insertDraftLeague(ctx, organizationId, {
        name: 'Draft',
        slug: 'draft',
        sport: 'soccer',
        locationIds: [location._id],
        division: { gender: 'womens', playersPerSide: 7, level: 'rec', ageGroup: 'u10' },
      });
      return ctx.db.get('leagues', id);
    });
    expect(row).toMatchObject({
      status: 'draft',
      gender: 'womens',
      playersPerSide: 7,
      level: 'rec',
      ageGroup: 'u10',
    });
  });
});
