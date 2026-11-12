/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import schema from '../schema';
import { modules, tournamentProgramFields } from '../test.setup';
import {
  defaultDivision,
  insertCustomLevel,
  insertDraftLeague,
  insertLeague,
  insertTenant,
  leagueSlugTaken,
  programSlugTaken,
  publishLeague,
  restoreLeague,
  updateLeague,
  type LeagueDivision,
} from './tenantWrites';

function setup() {
  return convexTest(schema, modules);
}

const TENANT = {
  organization: { name: 'Org A', slug: 'org-a' },
  locations: [
    { name: 'Alpha Field', address: '1 Alpha St' },
    { name: 'Bravo Beach', address: '2 Bravo St' },
  ],
  leagues: [],
};

const OTHER_TENANT = {
  organization: { name: 'Org B', slug: 'org-b' },
  locations: [{ name: 'B Field', address: '9 B St' }],
  leagues: [],
};

const SOCCER = {
  name: 'Coed 7v7',
  sport: 'soccer' as const,
  locations: ['Alpha Field'],
  division: { ...defaultDivision('soccer'), playersPerSide: 7, level: 'rec' as const },
};

function mirrored(league: Doc<'leagues'>) {
  return {
    organizationId: league.organizationId,
    type: 'league',
    leagueId: league._id,
    name: league.name,
    sortName: league.sortName,
    slug: league.slug,
    sport: league.sport,
    status: league.status,
    locationIds: league.locationIds,
    gender: league.gender,
    playersPerSide: league.playersPerSide,
    level: league.level,
    customLevelId: league.customLevelId,
    ageGroup: league.ageGroup,
  };
}

async function programOfLeague(ctx: MutationCtx, leagueId: Id<'leagues'>) {
  const league = (await ctx.db.get('leagues', leagueId))!;
  const program = (await ctx.db.get('programs', league.programId))!;
  const { _id, _creationTime, ...fields } = program;
  void _id;
  void _creationTime;
  return { league, program, fields };
}

async function expectProgramMatches(ctx: MutationCtx, leagueId: Id<'leagues'>) {
  const { league, fields } = await programOfLeague(ctx, leagueId);
  expect(fields).toEqual(mirrored(league));
}

describe('insertLeague', () => {
  test('writes one league program holding the league’s fields, and points the league to it', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const { leagueId } = await insertLeague(ctx, organizationId, {
        ...SOCCER,
        locations: ['Alpha Field', 'Bravo Beach'],
        division: { ...SOCCER.division, gender: 'womens', ageGroup: 'over40' },
      });
      const { league, program } = await programOfLeague(ctx, leagueId);
      expect(program).toMatchObject({
        organizationId,
        type: 'league',
        leagueId,
        name: 'Coed 7v7',
        sortName: 'coed 7v7',
        slug: 'coed-7v7',
        sport: 'soccer',
        status: 'published',
        locationIds: league.locationIds,
        gender: 'womens',
        playersPerSide: 7,
        level: 'rec',
        ageGroup: 'over40',
      });
      expect(league.locationIds).toHaveLength(2);
      expect(await ctx.db.query('programs').collect()).toHaveLength(1);
    });
  });

  test('gives a league with a custom level the same custom level on its program', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const customLevelId = await insertCustomLevel(ctx, organizationId, {
        sport: 'soccer',
        name: 'Gold',
        standardLevel: 'rec',
      });
      const { leagueId } = await insertLeague(ctx, organizationId, {
        ...SOCCER,
        division: { ...SOCCER.division, customLevel: 'Gold' },
      });
      const { program } = await programOfLeague(ctx, leagueId);
      expect(program.customLevelId).toBe(customLevelId);
      await expectProgramMatches(ctx, leagueId);
    });
  });

  test('writes a program for every league of a tenant, each in its own organization', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const a = await insertTenant(ctx, {
        ...TENANT,
        leagues: [SOCCER, { ...SOCCER, name: 'Sunday Soccer' }],
      });
      const b = await insertTenant(ctx, {
        ...OTHER_TENANT,
        locations: [{ name: 'Alpha Field', address: '9 B St' }],
        leagues: [SOCCER],
      });
      const programs = await ctx.db.query('programs').collect();
      expect(programs).toHaveLength(3);
      expect(programs.filter((program) => program.organizationId === a)).toHaveLength(2);
      expect(programs.filter((program) => program.organizationId === b)).toHaveLength(1);
      for (const league of await ctx.db.query('leagues').collect()) {
        await expectProgramMatches(ctx, league._id);
        expect((await ctx.db.get('programs', league.programId))?.organizationId, league.name).toBe(
          league.organizationId,
        );
      }
    });
  });

  test('writes nothing for a league it refuses', async () => {
    const t = setup();
    await expect(
      t.run(async (ctx) => {
        const organizationId = await insertTenant(ctx, TENANT);
        await insertLeague(ctx, organizationId, {
          ...SOCCER,
          division: { ...SOCCER.division, playersPerSide: 3 },
        });
      }),
    ).rejects.toThrow(/not a format of soccer/);
    expect(await t.run((ctx) => ctx.db.query('programs').collect())).toEqual([]);
  });
});

describe('insertDraftLeague', () => {
  test('writes a draft program with the league’s slug and division', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const alpha = (await ctx.db.query('locations').first())!._id;
      const leagueId = await insertDraftLeague(ctx, organizationId, {
        name: 'Sunday Reverse Coed 4s',
        slug: 'sunday-reverse-coed-4s',
        sport: 'beachVolleyball',
        locationIds: [alpha],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      });
      const { program } = await programOfLeague(ctx, leagueId);
      expect(program).toMatchObject({
        organizationId,
        type: 'league',
        leagueId,
        slug: 'sunday-reverse-coed-4s',
        status: 'draft',
        playersPerSide: 4,
        level: 'bb',
      });
      await expectProgramMatches(ctx, leagueId);
    });
  });
});

describe('updateLeague', () => {
  async function insertedLeague(ctx: MutationCtx) {
    const organizationId = await insertTenant(ctx, TENANT);
    const { leagueId } = await insertLeague(ctx, organizationId, SOCCER);
    return { organizationId, leagueId };
  }

  test('a renamed league and its program carry the new name and sort name, and keep the slug', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const { leagueId } = await insertedLeague(ctx);
      const league = (await ctx.db.get('leagues', leagueId))!;
      await updateLeague(ctx, league, { name: 'Sunday Soccer', division: SOCCER.division });
      const { program } = await programOfLeague(ctx, leagueId);
      expect(program).toMatchObject({
        name: 'Sunday Soccer',
        sortName: 'sunday soccer',
        slug: 'coed-7v7',
      });
      await expectProgramMatches(ctx, leagueId);
    });
  });

  test('a changed division reaches the program, and a cleared custom level leaves it', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const { organizationId, leagueId } = await insertedLeague(ctx);
      const customLevelId = await insertCustomLevel(ctx, organizationId, {
        sport: 'soccer',
        name: 'Gold',
        standardLevel: 'competitive',
      });
      const division: LeagueDivision = {
        gender: 'mens',
        playersPerSide: 9,
        level: 'competitive',
        customLevelId,
        ageGroup: 'over35',
      };
      await updateLeague(ctx, (await ctx.db.get('leagues', leagueId))!, {
        name: 'Coed 7v7',
        division,
      });
      expect((await programOfLeague(ctx, leagueId)).program).toMatchObject({
        gender: 'mens',
        playersPerSide: 9,
        level: 'competitive',
        customLevelId,
        ageGroup: 'over35',
      });
      await expectProgramMatches(ctx, leagueId);

      await updateLeague(ctx, (await ctx.db.get('leagues', leagueId))!, {
        name: 'Coed 7v7',
        division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
      });
      const { program } = await programOfLeague(ctx, leagueId);
      expect(program.customLevelId).toBeUndefined();
      expect(program).toMatchObject({ gender: 'coed', playersPerSide: 7, level: 'rec' });
      await expectProgramMatches(ctx, leagueId);
    });
  });

  test('leaves the program of another league and of another organization alone', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const { leagueId } = await insertedLeague(ctx);
      const sibling = await insertLeague(
        ctx,
        (await ctx.db.get('leagues', leagueId))!.organizationId,
        {
          ...SOCCER,
          name: 'Sibling',
        },
      );
      const other = await insertTenant(ctx, {
        ...OTHER_TENANT,
        locations: [{ name: 'Alpha Field', address: '9 B St' }],
        leagues: [SOCCER],
      });
      const otherLeague = (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', other).eq('slug', 'coed-7v7'),
        )
        .unique())!;
      const before = [
        await programOfLeague(ctx, sibling.leagueId),
        await programOfLeague(ctx, otherLeague._id),
      ].map(({ program }) => program);

      await updateLeague(ctx, (await ctx.db.get('leagues', leagueId))!, {
        name: 'Renamed',
        division: SOCCER.division,
      });

      const after = [
        await programOfLeague(ctx, sibling.leagueId),
        await programOfLeague(ctx, otherLeague._id),
      ].map(({ program }) => program);
      expect(after).toEqual(before);
    });
  });

  test('a refused update leaves the program as it was', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const { leagueId } = await insertedLeague(ctx);
      const before = (await programOfLeague(ctx, leagueId)).program;
      await expect(
        updateLeague(ctx, (await ctx.db.get('leagues', leagueId))!, {
          name: 'Renamed',
          division: { ...SOCCER.division, playersPerSide: 3 },
        }),
      ).rejects.toThrow(/not a format of soccer/);
      expect((await programOfLeague(ctx, leagueId)).program).toEqual(before);
    });
  });
});

describe('restoreLeague', () => {
  test('puts the program back with the league’s earlier name and division', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const { leagueId } = await insertLeague(ctx, organizationId, SOCCER);
      const { program: original } = await programOfLeague(ctx, leagueId);
      const earlier = await updateLeague(ctx, (await ctx.db.get('leagues', leagueId))!, {
        name: 'Renamed',
        division: { gender: 'womens', playersPerSide: 9, level: 'competitive', ageGroup: 'u12' },
      });
      expect((await programOfLeague(ctx, leagueId)).program.name).toBe('Renamed');

      await restoreLeague(ctx, (await ctx.db.get('leagues', leagueId))!, earlier);

      const { program } = await programOfLeague(ctx, leagueId);
      expect(program).toEqual(original);
      await expectProgramMatches(ctx, leagueId);
    });
  });

  test('puts back a custom level the update had cleared', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const customLevelId = await insertCustomLevel(ctx, organizationId, {
        sport: 'soccer',
        name: 'Gold',
        standardLevel: 'rec',
      });
      const { leagueId } = await insertLeague(ctx, organizationId, {
        ...SOCCER,
        division: { ...SOCCER.division, customLevel: 'Gold' },
      });
      const earlier = await updateLeague(ctx, (await ctx.db.get('leagues', leagueId))!, {
        name: 'Coed 7v7',
        division: SOCCER.division,
      });
      expect((await programOfLeague(ctx, leagueId)).program.customLevelId).toBeUndefined();

      await restoreLeague(ctx, (await ctx.db.get('leagues', leagueId))!, earlier);

      expect((await programOfLeague(ctx, leagueId)).program.customLevelId).toBe(customLevelId);
      await expectProgramMatches(ctx, leagueId);
    });
  });
});

describe('publishLeague', () => {
  test('moves the program from draft to published with the league', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const { leagueId } = await insertLeague(ctx, organizationId, { ...SOCCER, status: 'draft' });
      expect((await programOfLeague(ctx, leagueId)).program.status).toBe('draft');

      await publishLeague(ctx, (await ctx.db.get('leagues', leagueId))!);

      expect((await programOfLeague(ctx, leagueId)).program.status).toBe('published');
      await expectProgramMatches(ctx, leagueId);
    });
  });

  test('publishing a published league changes nothing and adds no program', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, TENANT);
      const { leagueId } = await insertLeague(ctx, organizationId, SOCCER);
      const before = await ctx.db.query('programs').collect();
      await publishLeague(ctx, (await ctx.db.get('leagues', leagueId))!);
      expect(await ctx.db.query('programs').collect()).toEqual(before);
    });
  });
});

describe('program slugs', () => {
  test('programSlugTaken sees a program of any type, in its own organization only', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const a = await insertTenant(ctx, TENANT);
      const b = await insertTenant(ctx, OTHER_TENANT);
      await ctx.db.insert('programs', tournamentProgramFields(a, 'summer-open'));
      await insertLeague(ctx, a, SOCCER);

      expect(await programSlugTaken(ctx, a, 'summer-open')).toBe(true);
      expect(await programSlugTaken(ctx, a, 'coed-7v7')).toBe(true);
      expect(await programSlugTaken(ctx, a, 'free-slug')).toBe(false);
      expect(await programSlugTaken(ctx, b, 'summer-open')).toBe(false);
    });
  });

  test('leagueSlugTaken refuses a slug a program of another type holds, in the same organization only', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const a = await insertTenant(ctx, TENANT);
      const b = await insertTenant(ctx, OTHER_TENANT);
      await ctx.db.insert('programs', tournamentProgramFields(a, 'summer-open'));

      expect(await leagueSlugTaken(ctx, a, 'summer-open')).toBe(true);
      expect(await leagueSlugTaken(ctx, b, 'summer-open')).toBe(false);
      expect(await leagueSlugTaken(ctx, a, 'another-slug')).toBe(false);
    });
  });

  test('a generated league slug steps past a slug a program of another type holds', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const a = await insertTenant(ctx, TENANT);
      await ctx.db.insert('programs', tournamentProgramFields(a, 'summer-open'));

      const { slug } = await insertLeague(ctx, a, { ...SOCCER, name: 'Summer Open' });

      expect(slug).toBe('summer-open-2');
      await expectProgramMatches(
        ctx,
        (await ctx.db
          .query('leagues')
          .withIndex('by_organizationId_and_slug', (q) =>
            q.eq('organizationId', a).eq('slug', 'summer-open-2'),
          )
          .unique())!._id,
      );
    });
  });
});
