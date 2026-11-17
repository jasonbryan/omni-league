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
  insertDraftCamp,
  insertDraftLeague,
  insertDraftTraining,
  insertDraftTournament,
  insertLeague,
  insertLocation,
  insertTenant,
  leagueSlugTaken,
  MAX_PROGRAMS_SEARCH_UPDATED,
  programSlugTaken,
  publishCamp,
  publishLeague,
  publishTournament,
  restoreLeague,
  updateLeague,
  updateLocation,
  updateOrganizationCityState,
  updateTournamentDetails,
  type LeagueDivision,
  type NewTournament,
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
    searchText: league.searchText,
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

describe('programs.searchText', () => {
  const TOURNAMENT: NewTournament = {
    name: 'Spring Cup',
    slug: 'spring-cup',
    sport: 'soccer',
    locationIds: [],
    division: {
      gender: 'mens',
      playersPerSide: 7,
      level: 'rec',
      ageGroup: 'adult',
    },
    startDate: '2027-04-10',
    endDate: '2027-04-11',
    registrationDeadline: '2027-04-01',
    maximumTeams: 8,
  };

  async function world() {
    const t = setup();
    const ids = await t.run(async (ctx) => {
      const organizationId = await insertTenant(ctx, {
        ...TENANT,
        organization: { ...TENANT.organization, cityState: 'Corpus Christi, TX' },
      });
      const otherId = await insertTenant(ctx, {
        ...OTHER_TENANT,
        organization: { ...OTHER_TENANT.organization, cityState: 'Chicago, IL' },
      });
      const alpha = (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', 'Alpha Field'),
        )
        .unique())!;
      const bravo = (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', 'Bravo Beach'),
        )
        .unique())!;
      return { organizationId, otherId, alpha, bravo };
    });
    return { t, ...ids };
  }

  const programNamed = (ctx: MutationCtx, organizationId: Id<'organizations'>, slug: string) =>
    ctx.db
      .query('programs')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', slug),
      )
      .unique()
      .then((program) => program!);

  test('a league inserted into an organization holds its name, sport, division, organization, location, and City, state', async () => {
    const { t, organizationId } = await world();
    await t.run(async (ctx) => {
      const { leagueId } = await insertLeague(ctx, organizationId, SOCCER);
      const { league, program } = await programOfLeague(ctx, leagueId);
      expect(program.searchText).toBe(
        'Coed 7v7 Soccer Coed 7v7 Rec Org A Alpha Field Corpus Christi, TX',
      );
      expect(program.searchText).toBe(league.searchText);
    });
  });

  test('a soccer league’s program holds Soccer and the words of its division label', async () => {
    const { t, organizationId } = await world();
    await t.run(async (ctx) => {
      const { leagueId } = await insertLeague(ctx, organizationId, {
        ...SOCCER,
        division: { ...SOCCER.division, gender: 'womens', ageGroup: 'u10' },
      });
      const { program } = await programOfLeague(ctx, leagueId);
      expect(program.searchText).toContain('Soccer Girls 7v7 Rec U10');
    });
  });

  test('a draft league holds it too', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      const leagueId = await insertDraftLeague(ctx, organizationId, {
        name: 'Draft Sand',
        slug: 'draft-sand',
        sport: 'beachVolleyball',
        locationIds: [alpha._id],
        division: defaultDivision('beachVolleyball'),
      });
      expect((await programOfLeague(ctx, leagueId)).program.searchText).toBe(
        'Draft Sand Beach volleyball Coed 2v2 Rec Org A Alpha Field Corpus Christi, TX',
      );
    });
  });

  test('a draft tournament holds its name, sport, division, organization, location, and City, state', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        locationIds: [alpha._id],
      });
      expect((await programNamed(ctx, organizationId, 'spring-cup')).searchText).toBe(
        'Spring Cup Soccer Men 7v7 Rec mens Org A Alpha Field Corpus Christi, TX',
      );
    });
  });

  test('a tournament with a custom level holds its name and the standard level it maps to', async () => {
    const { t, organizationId } = await world();
    await t.run(async (ctx) => {
      const customLevelId = await insertCustomLevel(ctx, organizationId, {
        sport: 'soccer',
        name: 'Gold',
        standardLevel: 'rec',
      });
      await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        division: { ...TOURNAMENT.division, customLevelId },
      });
      expect((await programNamed(ctx, organizationId, 'spring-cup')).searchText).toBe(
        'Spring Cup Soccer Men 7v7 Gold (Rec) mens Org A Corpus Christi, TX',
      );
    });
  });

  test('updating a league rewrites its program’s text, and undoing the update puts the old text back', async () => {
    const { t, organizationId } = await world();
    await t.run(async (ctx) => {
      const { leagueId } = await insertLeague(ctx, organizationId, SOCCER);
      const league = (await ctx.db.get('leagues', leagueId))!;
      const earlier = await updateLeague(ctx, league, {
        name: 'Fall Sevens',
        division: { gender: 'womens', playersPerSide: 11, level: 'competitive', ageGroup: 'adult' },
      });
      const updated = await programOfLeague(ctx, leagueId);
      expect(updated.program.searchText).toBe(
        'Fall Sevens Soccer Women 11v11 Competitive womens Org A Alpha Field Corpus Christi, TX',
      );
      expect(updated.program.searchText).toBe(updated.league.searchText);

      await restoreLeague(ctx, updated.league, earlier);
      const restored = await programOfLeague(ctx, leagueId);
      expect(restored.program.searchText).toBe(
        'Coed 7v7 Soccer Coed 7v7 Rec Org A Alpha Field Corpus Christi, TX',
      );
      expect(restored.program.searchText).toBe(restored.league.searchText);
    });
  });

  test('publishing a league rewrites its program’s text from the row', async () => {
    const { t, organizationId } = await world();
    await t.run(async (ctx) => {
      const { leagueId } = await insertLeague(ctx, organizationId, { ...SOCCER, status: 'draft' });
      const { league } = await programOfLeague(ctx, leagueId);
      await ctx.db.patch('programs', league.programId, { searchText: 'stale' });

      await publishLeague(ctx, league);

      expect((await programOfLeague(ctx, leagueId)).program.searchText).toBe(
        'Coed 7v7 Soccer Coed 7v7 Rec Org A Alpha Field Corpus Christi, TX',
      );
    });
  });

  test('publishing a tournament rewrites its program’s text from the row', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      const tournamentId = await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        locationIds: [alpha._id],
      });
      const tournament = (await ctx.db.get('tournaments', tournamentId))!;
      await ctx.db.patch('programs', tournament.programId, { searchText: 'stale' });

      await publishTournament(ctx, tournament);

      const program = (await ctx.db.get('programs', tournament.programId))!;
      expect(program.status).toBe('published');
      expect(program.searchText).toBe(
        'Spring Cup Soccer Men 7v7 Rec mens Org A Alpha Field Corpus Christi, TX',
      );
    });
  });

  test('editing a tournament’s dates and size leaves its text as it was', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      const tournamentId = await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        locationIds: [alpha._id],
      });
      const tournament = (await ctx.db.get('tournaments', tournamentId))!;
      const before = (await ctx.db.get('programs', tournament.programId))!.searchText;

      await updateTournamentDetails(ctx, tournament, {
        startDate: '2027-05-01',
        endDate: '2027-05-02',
        registrationDeadline: '2027-04-20',
        maximumTeams: 12,
        setsPerGame: 1,
      });

      expect((await ctx.db.get('programs', tournament.programId))!.searchText).toBe(before);
    });
  });

  test('renaming a location rewrites the league and tournament programs held there, and no other', async () => {
    const { t, organizationId, otherId, alpha, bravo } = await world();
    await t.run(async (ctx) => {
      await insertLeague(ctx, organizationId, SOCCER);
      await insertLeague(ctx, organizationId, {
        ...SOCCER,
        name: 'Bravo Sevens',
        locations: ['Bravo Beach'],
      });
      await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        locationIds: [alpha._id, bravo._id],
      });
      await insertLocation(ctx, otherId, { name: 'Alpha Field', address: '9 Lake Rd' });
      await insertLeague(ctx, otherId, { ...SOCCER, name: 'Lake Sevens' });

      await updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address });

      expect((await programNamed(ctx, organizationId, 'coed-7v7')).searchText).toBe(
        'Coed 7v7 Soccer Coed 7v7 Rec Org A Omega Field Corpus Christi, TX',
      );
      expect((await programNamed(ctx, organizationId, 'spring-cup')).searchText).toBe(
        'Spring Cup Soccer Men 7v7 Rec mens Org A Omega Field Bravo Beach Corpus Christi, TX',
      );
      expect((await programNamed(ctx, organizationId, 'bravo-sevens')).searchText).toBe(
        'Bravo Sevens Soccer Coed 7v7 Rec Org A Bravo Beach Corpus Christi, TX',
      );
      expect((await programNamed(ctx, otherId, 'lake-sevens')).searchText).toBe(
        'Lake Sevens Soccer Coed 7v7 Rec Org B Alpha Field Chicago, IL',
      );
    });
  });

  test('changing City, state rewrites every league and tournament program of the organization, and clearing it removes the words', async () => {
    const { t, organizationId, otherId, alpha } = await world();
    await t.run(async (ctx) => {
      await insertLeague(ctx, organizationId, SOCCER);
      await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        locationIds: [alpha._id],
      });
      await insertLeague(ctx, otherId, {
        ...SOCCER,
        name: 'Lake Sevens',
        locations: ['B Field'],
      });

      await updateOrganizationCityState(ctx, organizationId, 'Galveston, TX');
      expect((await programNamed(ctx, organizationId, 'coed-7v7')).searchText).toBe(
        'Coed 7v7 Soccer Coed 7v7 Rec Org A Alpha Field Galveston, TX',
      );
      expect((await programNamed(ctx, organizationId, 'spring-cup')).searchText).toBe(
        'Spring Cup Soccer Men 7v7 Rec mens Org A Alpha Field Galveston, TX',
      );

      await updateOrganizationCityState(ctx, organizationId, null);
      expect((await programNamed(ctx, organizationId, 'spring-cup')).searchText).toBe(
        'Spring Cup Soccer Men 7v7 Rec mens Org A Alpha Field',
      );
      expect((await programNamed(ctx, otherId, 'lake-sevens')).searchText).toContain('Chicago, IL');
    });
  });

  test('a location rename that reaches 200 programs rewrites all 200', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_PROGRAMS_SEARCH_UPDATED; i++) {
        await ctx.db.insert('programs', {
          ...tournamentProgramFields(organizationId, `bulk-${i}`),
          locationIds: [alpha._id],
        });
      }

      await updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address });

      const programs = await ctx.db
        .query('programs')
        .withIndex('by_organizationId_and_slug', (q) => q.eq('organizationId', organizationId))
        .collect();
      expect(programs).toHaveLength(MAX_PROGRAMS_SEARCH_UPDATED);
      expect(programs.every((program) => program.searchText?.includes('Omega Field'))).toBe(true);
    });
  });

  test('a location rename that would reach 201 programs is refused with the bound, and writes nothing', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      for (let i = 0; i <= MAX_PROGRAMS_SEARCH_UPDATED; i++) {
        await ctx.db.insert('programs', {
          ...tournamentProgramFields(organizationId, `bulk-${i}`),
          locationIds: [alpha._id],
        });
      }
    });
    await expect(
      t.run((ctx) => updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address })),
    ).rejects.toThrow(/more than 200 tournament programs/);
    await t.run(async (ctx) => {
      expect((await ctx.db.get('locations', alpha._id))!.name).toBe('Alpha Field');
      const programs = await ctx.db.query('programs').collect();
      expect(programs.every((program) => program.searchText === undefined)).toBe(true);
    });
  });

  test('the search index finds a program by its words within a type, and the browse index lists a status, type, and sport by sort name', async () => {
    const { t, organizationId, otherId, alpha } = await world();
    await t.run(async (ctx) => {
      await insertLeague(ctx, organizationId, SOCCER);
      await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        locationIds: [alpha._id],
      });
      const tournamentId = await insertDraftTournament(ctx, otherId, {
        ...TOURNAMENT,
        name: 'Autumn Cup',
        slug: 'autumn-cup',
      });
      await publishTournament(ctx, (await ctx.db.get('tournaments', tournamentId))!);

      const found = await ctx.db
        .query('programs')
        .withSearchIndex('search_searchText', (search) =>
          search.search('searchText', 'corpus').eq('status', 'draft').eq('type', 'tournament'),
        )
        .collect();
      expect(found.map((program) => program.slug)).toEqual(['spring-cup']);

      const browsed = await ctx.db
        .query('programs')
        .withIndex('by_status_and_type_and_sport_and_sortName', (q) =>
          q.eq('status', 'published').eq('type', 'tournament').eq('sport', 'soccer'),
        )
        .collect();
      expect(browsed.map((program) => program.slug)).toEqual(['autumn-cup']);
    });
  });

  const SAND_CAMP = {
    name: 'Sand Camp',
    slug: 'sand-camp',
    sport: 'beachVolleyball' as const,
    minimumAge: 9,
    maximumAge: 14,
  };

  async function insertCamp(
    ctx: MutationCtx,
    organizationId: Id<'organizations'>,
    alpha: Doc<'locations'>,
  ) {
    return insertDraftCamp(ctx, organizationId, { ...SAND_CAMP, locationIds: [alpha._id] });
  }

  test('a draft camp holds its name, sport, organization, location, and City, state, and no division word', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      await insertCamp(ctx, organizationId, alpha);

      expect((await programNamed(ctx, organizationId, 'sand-camp')).searchText).toBe(
        'Sand Camp Beach volleyball Org A Alpha Field Corpus Christi, TX',
      );
    });
  });

  test('publishing a camp rewrites its program’s text from the row', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      const campId = await insertCamp(ctx, organizationId, alpha);
      const camp = (await ctx.db.get('camps', campId))!;
      await ctx.db.patch('programs', camp.programId, { searchText: 'stale' });

      await publishCamp(ctx, camp);

      const program = (await ctx.db.get('programs', camp.programId))!;
      expect(program.status).toBe('published');
      expect(program.searchText).toBe(
        'Sand Camp Beach volleyball Org A Alpha Field Corpus Christi, TX',
      );
    });
  });

  test('publishing a published camp again leaves its text as it was', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      const campId = await insertCamp(ctx, organizationId, alpha);
      const camp = (await ctx.db.get('camps', campId))!;
      await publishCamp(ctx, camp);
      const before = (await ctx.db.get('programs', camp.programId))!;

      await publishCamp(ctx, camp);

      expect((await ctx.db.get('programs', camp.programId))!.searchText).toBe(before.searchText);
    });
  });

  test('renaming a location rewrites the camps held there with no division word, and a camp elsewhere keeps its text', async () => {
    const { t, organizationId, alpha, bravo } = await world();
    await t.run(async (ctx) => {
      await insertCamp(ctx, organizationId, alpha);
      await insertDraftCamp(ctx, organizationId, {
        ...SAND_CAMP,
        name: 'Bravo Camp',
        slug: 'bravo-camp',
        locationIds: [bravo._id],
      });
      const before = (await programNamed(ctx, organizationId, 'bravo-camp')).searchText;

      await updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address });

      expect((await programNamed(ctx, organizationId, 'sand-camp')).searchText).toBe(
        'Sand Camp Beach volleyball Org A Omega Field Corpus Christi, TX',
      );
      expect((await programNamed(ctx, organizationId, 'bravo-camp')).searchText).toBe(before);
    });
  });

  test('changing City, state rewrites the organization’s camps, and clearing it removes the words', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      await insertCamp(ctx, organizationId, alpha);

      await updateOrganizationCityState(ctx, organizationId, 'Galveston, TX');
      expect((await programNamed(ctx, organizationId, 'sand-camp')).searchText).toBe(
        'Sand Camp Beach volleyball Org A Alpha Field Galveston, TX',
      );

      await updateOrganizationCityState(ctx, organizationId, null);
      expect((await programNamed(ctx, organizationId, 'sand-camp')).searchText).toBe(
        'Sand Camp Beach volleyball Org A Alpha Field',
      );
    });
  });

  test('training programs get no text from a location rename or a City, state change', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      await insertDraftTraining(ctx, organizationId, {
        name: 'Serving Clinic',
        slug: 'serving-clinic',
        sport: 'beachVolleyball',
        locationIds: [alpha._id],
        coachName: 'Dana Ruiz',
      });

      await updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address });
      await updateOrganizationCityState(ctx, organizationId, 'Galveston, TX');

      expect(
        (await programNamed(ctx, organizationId, 'serving-clinic')).searchText,
      ).toBeUndefined();
    });
  });

  test('training programs do not count toward the bound of a rename', async () => {
    const { t, organizationId, alpha } = await world();
    await t.run(async (ctx) => {
      for (let i = 0; i <= MAX_PROGRAMS_SEARCH_UPDATED; i++) {
        await ctx.db.insert('programs', {
          ...tournamentProgramFields(organizationId, `training-${i}`),
          type: 'training',
          locationIds: [alpha._id],
        });
      }

      await updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address });
      await updateOrganizationCityState(ctx, organizationId, 'Galveston, TX');

      expect((await ctx.db.get('locations', alpha._id))!.name).toBe('Omega Field');
      const programs = await ctx.db.query('programs').collect();
      expect(programs.every((program) => program.searchText === undefined)).toBe(true);
    });
  });

  async function insertBulkCamps(
    t: Awaited<ReturnType<typeof world>>['t'],
    organizationId: Id<'organizations'>,
    alpha: Doc<'locations'>,
    count: number,
  ) {
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert('programs', {
          ...tournamentProgramFields(organizationId, `camp-${i}`),
          type: 'camp',
          locationIds: [alpha._id],
        });
      }
    });
  }

  test('a location rename that reaches 200 camps rewrites all 200', async () => {
    const { t, organizationId, alpha } = await world();
    await insertBulkCamps(t, organizationId, alpha, MAX_PROGRAMS_SEARCH_UPDATED);
    await t.run(async (ctx) => {
      await updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address });

      const programs = await ctx.db.query('programs').collect();
      expect(programs).toHaveLength(MAX_PROGRAMS_SEARCH_UPDATED);
      expect(programs.every((program) => program.searchText?.includes('Omega Field'))).toBe(true);
    });
  });

  test('a location rename in an organization with 201 camps is refused with the bound, and writes nothing', async () => {
    const { t, organizationId, alpha } = await world();
    await insertBulkCamps(t, organizationId, alpha, MAX_PROGRAMS_SEARCH_UPDATED + 1);
    await expect(
      t.run((ctx) => updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address })),
    ).rejects.toThrow(/more than 200 camp programs/);
    await t.run(async (ctx) => {
      expect((await ctx.db.get('locations', alpha._id))!.name).toBe('Alpha Field');
      const programs = await ctx.db.query('programs').collect();
      expect(programs.every((program) => program.searchText === undefined)).toBe(true);
    });
  });

  test('a City, state change in an organization with 201 camps is refused with the bound, and writes nothing', async () => {
    const { t, organizationId, alpha } = await world();
    await insertBulkCamps(t, organizationId, alpha, MAX_PROGRAMS_SEARCH_UPDATED + 1);
    await expect(
      t.run((ctx) => updateOrganizationCityState(ctx, organizationId, 'Galveston, TX')),
    ).rejects.toThrow(/more than 200 camp programs/);
    await t.run(async (ctx) => {
      expect((await ctx.db.get('organizations', organizationId))!.cityState).toBe(
        'Corpus Christi, TX',
      );
      const programs = await ctx.db.query('programs').collect();
      expect(programs.every((program) => program.searchText === undefined)).toBe(true);
    });
  });

  test('a City, state change on an organization with 201 tournament programs is refused with the bound, and writes nothing', async () => {
    const { t, organizationId } = await world();
    await t.run(async (ctx) => {
      for (let i = 0; i <= MAX_PROGRAMS_SEARCH_UPDATED; i++) {
        await ctx.db.insert('programs', tournamentProgramFields(organizationId, `bulk-${i}`));
      }
    });
    await expect(
      t.run((ctx) => updateOrganizationCityState(ctx, organizationId, 'Galveston, TX')),
    ).rejects.toThrow(/more than 200 tournament programs/);
    await t.run(async (ctx) => {
      expect((await ctx.db.get('organizations', organizationId))!.cityState).toBe(
        'Corpus Christi, TX',
      );
    });
  });

  test('a location rename leaves the tournament programs of another location as they were', async () => {
    const { t, organizationId, alpha, bravo } = await world();
    await t.run(async (ctx) => {
      await insertDraftTournament(ctx, organizationId, {
        ...TOURNAMENT,
        locationIds: [bravo._id],
      });
      await ctx.db.patch('programs', (await programNamed(ctx, organizationId, 'spring-cup'))._id, {
        searchText: 'kept as it was',
      });

      await updateLocation(ctx, alpha, { name: 'Omega Field', address: alpha.address });

      expect((await programNamed(ctx, organizationId, 'spring-cup')).searchText).toBe(
        'kept as it was',
      );
    });
  });
});
