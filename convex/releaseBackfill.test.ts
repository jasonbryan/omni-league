/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { BACKFILL_TEAM_COUNT_SCAN_LIMIT } from './lib/rosterWrites';
import { BACKFILL_SCAN_LIMIT, programSlugTaken } from './lib/tenantWrites';
import { BATCH_SIZE } from './releaseBackfill';
import schema from './schema';
import {
  modules,
  leagueRequiredFields,
  organizationListFields,
  tournamentProgramFields,
} from './test.setup';

type T = ReturnType<typeof setup>;

function setup() {
  return convexTest(schema, modules);
}

const ZERO = {
  locations: 0,
  leagues: 0,
  programs: 0,
  organizations: 0,
  staffCounts: 0,
  staffInviteCounts: 0,
  draftLeagueCounts: 0,
  teamCounts: 0,
  waitlistCounts: 0,
  pendingInviteCounts: 0,
};

beforeEach(() => {
  // A production deployment has no preview origin pattern, and the backfill must still run there.
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const SEASON = {
  startDate: '2030-06-01',
  endDate: '2030-08-01',
  registrationDeadline: '2030-05-01',
  playersPerSide: 6,
  minimumRosterSize: 6,
};

async function insertTenantWithoutCounters(
  t: T,
  slug: string,
  shape: { published?: number; draft?: number; unstatused?: number } = {},
) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert('organizations', {
      ...organizationListFields(`Org ${slug}`),
      name: `Org ${slug}`,
      slug,
    });
    const locationIds: Id<'locations'>[] = [];
    for (const name of ['Alpha Field', 'Beta Field']) {
      locationIds.push(
        await ctx.db.insert('locations', { organizationId, name, address: '1 Main St' }),
      );
    }
    const leagueIds: Id<'leagues'>[] = [];
    const league = async (name: string, status?: 'draft' | 'published') =>
      ctx.db.insert('leagues', {
        ...leagueRequiredFields('soccer', name),
        organizationId,
        name,
        slug: name.toLowerCase().replaceAll(' ', '-'),
        sport: 'soccer',
        locationIds,
        ...(status !== undefined && { status }),
      });
    for (let i = 0; i < (shape.published ?? 0); i++) {
      leagueIds.push(await league(`Published ${i}`, 'published'));
    }
    for (let i = 0; i < (shape.draft ?? 0); i++)
      leagueIds.push(await league(`Draft ${i}`, 'draft'));
    for (let i = 0; i < (shape.unstatused ?? 0); i++) leagueIds.push(await league(`Old ${i}`));
    return { organizationId, locationIds, leagueIds };
  });
}

async function insertLegacySeasonWithTeams(
  t: T,
  tenant: { organizationId: Id<'organizations'>; leagueIds: Id<'leagues'>[] },
  shape: { status: 'draft' | 'published'; teams: number; waiting: number },
) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      authUserId: `u-${Math.random()}`,
      name: 'U',
      adultConfirmedAt: 1,
    });
    const seasonId = await ctx.db.insert('seasons', {
      organizationId: tenant.organizationId,
      leagueId: tenant.leagueIds[0],
      name: `Season ${Math.random()}`,
      slug: `season-${Math.random()}`.replace('0.', ''),
      status: shape.status,
      ...SEASON,
    });
    const teamIds: Id<'teams'>[] = [];
    for (let i = 0; i < shape.teams; i++) {
      teamIds.push(
        await ctx.db.insert('teams', {
          organizationId: tenant.organizationId,
          leagueId: tenant.leagueIds[0],
          seasonId,
          name: `Team ${i}`,
          sortName: `team ${i}`,
          captainUserId: userId,
          rosterCount: 0,
          createdAt: 1,
        }),
      );
    }
    for (let i = 0; i < shape.waiting; i++) {
      await ctx.db.insert('waitlistEntries', {
        organizationId: tenant.organizationId,
        seasonId,
        userId,
        teamName: `Waiting ${i}`,
        sortName: `waiting ${i}`,
        status: 'waiting',
        requestedAt: 1,
      });
    }
    return { seasonId, teamIds };
  });
}

async function insertStaffAndInvites(
  t: T,
  organizationId: Id<'organizations'>,
  shape: { staff: number; pending: number; revoked: number },
) {
  await t.run(async (ctx) => {
    for (let i = 0; i < shape.staff; i++) {
      const userId = await ctx.db.insert('users', {
        authUserId: `staff-${organizationId}-${i}`,
        name: 'S',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId,
        role: 'orgAdmin',
        leagueIds: [],
      });
    }
    const invite = (status: 'pending' | 'revoked', i: number) =>
      ctx.db.insert('invites', {
        organizationId,
        email: `${status}-${i}@example.test`,
        role: 'leagueOrganizer',
        leagueIds: [],
        tokenHash: `${status}-${organizationId}-${i}`,
        expiresAt: 9_999_999_999_999,
        status,
      });
    for (let i = 0; i < shape.pending; i++) await invite('pending', i);
    for (let i = 0; i < shape.revoked; i++) await invite('revoked', i);
  });
}

async function expectCountersUnset(t: T, organizationId: Id<'organizations'>) {
  const organization = await t.run((ctx) => ctx.db.get('organizations', organizationId));
  expect(organization?.leagueCount).toBeUndefined();
  expect(organization?.locationCount).toBeUndefined();
  expect(organization?.sportLeagueCounts).toBeUndefined();
}

async function snapshot(t: T) {
  return t.run(async (ctx) => ({
    organizations: await ctx.db.query('organizations').collect(),
    locations: await ctx.db.query('locations').collect(),
    leagues: await ctx.db.query('leagues').collect(),
    programs: await ctx.db.query('programs').collect(),
    seasons: await ctx.db.query('seasons').collect(),
    teams: await ctx.db.query('teams').collect(),
    sportLocations: await ctx.db.query('sportLocations').collect(),
  }));
}

describe('the release backfill', () => {
  test('is not part of the public api', () => {
    expectTypeOf(api).not.toHaveProperty('releaseBackfill');
  });

  test('sets every counter on rows written before the counters existed', async () => {
    const t = setup();
    const tenant = await insertTenantWithoutCounters(t, 'legacy', {
      published: 2,
      draft: 1,
      unstatused: 1,
    });
    await insertStaffAndInvites(t, tenant.organizationId, { staff: 3, pending: 2, revoked: 1 });
    const full = await insertLegacySeasonWithTeams(t, tenant, {
      status: 'published',
      teams: 3,
      waiting: 2,
    });
    await insertLegacySeasonWithTeams(t, tenant, { status: 'draft', teams: 0, waiting: 0 });

    const result = await t.action(internal.releaseBackfill.run, {});

    expect(result.backfilled).toEqual({
      ...ZERO,
      locations: 2,
      leagues: 4,
      programs: 4,
      organizations: 1,
      staffCounts: 1,
      staffInviteCounts: 1,
      draftLeagueCounts: 1,
      teamCounts: 2,
      waitlistCounts: 2,
      pendingInviteCounts: 3,
    });
    const after = await t.run(async (ctx) => ({
      organization: (await ctx.db.get('organizations', tenant.organizationId))!,
      locations: await ctx.db.query('locations').collect(),
      leagues: await ctx.db.query('leagues').collect(),
      programs: await ctx.db.query('programs').collect(),
      season: (await ctx.db.get('seasons', full.seasonId))!,
      teams: await ctx.db.query('teams').collect(),
      sportLocations: await ctx.db.query('sportLocations').collect(),
    }));
    expect(after.organization).toMatchObject({
      leagueCount: 3,
      draftLeagueCount: 1,
      locationCount: 2,
      staffCount: 3,
      pendingInviteCount: 2,
      sportLeagueCounts: { soccer: 3 },
      sportLocationCounts: { soccer: 2 },
    });
    expect(after.sportLocations.map((row) => row.leagueCount)).toEqual([3, 3]);
    expect(after.locations.map((location) => location.sortName).sort()).toEqual([
      'alpha field',
      'beta field',
    ]);
    const [leagueWithSeasons] = tenant.leagueIds;
    const byId = new Map(after.leagues.map((league) => [league._id, league]));
    expect(byId.get(leagueWithSeasons)).toMatchObject({
      status: 'published',
      publishedSeasonCount: 1,
    });
    expect(after.leagues.every((league) => league.sortName === league.name.toLowerCase())).toBe(
      true,
    );
    expect(after.leagues.find((league) => league.name === 'Old 0')?.status).toBe('published');
    expect(after.leagues.find((league) => league.name === 'Draft 0')?.status).toBe('draft');
    expect(after.programs).toHaveLength(4);
    expect(after.season).toMatchObject({ teamCount: 3, waitlistCount: 2 });
    expect(after.teams.every((team) => team.pendingInviteCount === 0)).toBe(true);
  });

  test('runs on a deployment that is not a preview or staging one', async () => {
    const t = setup();
    await insertTenantWithoutCounters(t, 'prod-like', { published: 1 });
    await expect(t.action(internal.releaseBackfill.run, {})).resolves.toMatchObject({
      backfilled: { organizations: 1 },
    });
  });

  test('changes nothing on a second run', async () => {
    const t = setup();
    const tenant = await insertTenantWithoutCounters(t, 'again', { published: 2, draft: 1 });
    await insertStaffAndInvites(t, tenant.organizationId, { staff: 2, pending: 1, revoked: 0 });
    await insertLegacySeasonWithTeams(t, tenant, { status: 'published', teams: 2, waiting: 1 });
    await t.action(internal.releaseBackfill.run, {});
    const before = await snapshot(t);

    const second = await t.action(internal.releaseBackfill.run, {});

    expect(second.backfilled).toEqual(ZERO);
    expect(await snapshot(t)).toEqual(before);
  });

  test('leaves a counter that is already set alone and sets the ones that are not', async () => {
    const t = setup();
    const tenant = await insertTenantWithoutCounters(t, 'partial', { published: 1, draft: 1 });
    await insertStaffAndInvites(t, tenant.organizationId, { staff: 2, pending: 1, revoked: 0 });
    await t.run(async (ctx) => {
      await ctx.db.patch('organizations', tenant.organizationId, {
        leagueCount: 99,
        locationCount: 98,
        sportLeagueCounts: { soccer: 97 },
        sportLocationCounts: { soccer: 96 },
        staffCount: 95,
      });
    });

    await t.action(internal.releaseBackfill.run, {});

    const organization = await t.run((ctx) => ctx.db.get('organizations', tenant.organizationId));
    expect(organization).toMatchObject({
      leagueCount: 99,
      locationCount: 98,
      sportLeagueCounts: { soccer: 97 },
      sportLocationCounts: { soccer: 96 },
      staffCount: 95,
      draftLeagueCount: 1,
      pendingInviteCount: 1,
    });
  });

  test('picks up where an interrupted run stopped', async () => {
    const t = setup();
    const tenant = await insertTenantWithoutCounters(t, 'interrupted', { published: 1 });
    await insertLegacySeasonWithTeams(t, tenant, { status: 'published', teams: 1, waiting: 0 });
    const firstBatch = await t.mutation(internal.releaseBackfill.backfillBatch, {
      phase: 'locations',
      cursor: null,
    });
    expect(firstBatch.backfilled.locations).toBe(2);

    const result = await t.action(internal.releaseBackfill.run, {});

    expect(result.backfilled.locations).toBe(0);
    expect(result.backfilled).toMatchObject({ leagues: 1, organizations: 1, teamCounts: 1 });
  });

  describe('the programs pass', () => {
    test('gives every league its program, with the league’s fields and the status the league pass set', async () => {
      const t = setup();
      const tenant = await insertTenantWithoutCounters(t, 'legacy', {
        published: 1,
        draft: 1,
        unstatused: 1,
      });

      const result = await t.action(internal.releaseBackfill.run, {});

      expect(result.backfilled.programs).toBe(3);
      await t.run(async (ctx) => {
        const leagues = await ctx.db.query('leagues').collect();
        const programs = await ctx.db.query('programs').collect();
        expect(programs).toHaveLength(3);
        for (const league of leagues) {
          const program = programs.find((row) => row.leagueId === league._id);
          expect(league.programId, league.name).toBe(program?._id);
          expect(program, league.name).toMatchObject({
            organizationId: tenant.organizationId,
            type: 'league',
            name: league.name,
            sortName: league.name.toLowerCase(),
            slug: league.slug,
            sport: 'soccer',
            status: league.status,
            locationIds: tenant.locationIds,
            gender: league.gender,
            playersPerSide: league.playersPerSide,
            level: league.level,
            ageGroup: league.ageGroup,
          });
        }
        expect(programs.find((row) => row.name === 'Old 0')?.status).toBe('published');
        expect(programs.find((row) => row.name === 'Draft 0')?.status).toBe('draft');
      });
    });

    test('copies a custom level to the program', async () => {
      const t = setup();
      const tenant = await insertTenantWithoutCounters(t, 'custom', { published: 1 });
      const customLevelId = await t.run(async (ctx) => {
        const id = await ctx.db.insert('customLevels', {
          organizationId: tenant.organizationId,
          sport: 'soccer',
          name: 'Gold',
          nameKey: 'gold',
          standardLevel: 'rec',
          createdAt: 1,
        });
        await ctx.db.patch('leagues', tenant.leagueIds[0], { customLevelId: id });
        return id;
      });

      await t.action(internal.releaseBackfill.run, {});

      const program = await t.run(async (ctx) => {
        const league = await ctx.db.get('leagues', tenant.leagueIds[0]);
        return ctx.db.get('programs', league!.programId!);
      });
      expect(program?.customLevelId).toBe(customLevelId);
    });

    test('gives leagues of different organizations the same slug each its own program', async () => {
      const t = setup();
      const a = await insertTenantWithoutCounters(t, 'org-one', { published: 1 });
      const b = await insertTenantWithoutCounters(t, 'org-two', { published: 1 });

      await t.action(internal.releaseBackfill.run, {});

      await t.run(async (ctx) => {
        for (const tenant of [a, b]) {
          expect(await programSlugTaken(ctx, tenant.organizationId, 'published-0')).toBe(true);
          const program = await ctx.db.get(
            'programs',
            (await ctx.db.get('leagues', tenant.leagueIds[0]))!.programId!,
          );
          expect(program?.organizationId).toBe(tenant.organizationId);
        }
        expect(await ctx.db.query('programs').collect()).toHaveLength(2);
      });
    });

    test('changes nothing on a second run, and leaves a league that already has a program alone', async () => {
      const t = setup();
      const tenant = await insertTenantWithoutCounters(t, 'again', { published: 2 });
      const linked = tenant.leagueIds[0];
      const existing = await t.run(async (ctx) => {
        const league = (await ctx.db.get('leagues', linked))!;
        const programId = await ctx.db.insert('programs', {
          ...tournamentProgramFields(tenant.organizationId, league.slug),
          type: 'league',
          leagueId: linked,
          name: 'Kept as it was',
        });
        await ctx.db.patch('leagues', linked, { programId });
        return programId;
      });

      const first = await t.action(internal.releaseBackfill.run, {});
      const afterFirst = await snapshot(t);
      const second = await t.action(internal.releaseBackfill.run, {});

      expect(first.backfilled.programs).toBe(1);
      expect(second.backfilled).toEqual(ZERO);
      expect(await snapshot(t)).toEqual(afterFirst);
      const kept = await t.run((ctx) => ctx.db.get('programs', existing));
      expect(kept?.name).toBe('Kept as it was');
      expect(afterFirst.programs).toHaveLength(2);
    });

    test('leaves a tournament, its program, and its slug alone, and gives only the league a program', async () => {
      const t = setup();
      const tenant = await insertTenantWithoutCounters(t, 'mixed', { published: 1 });
      const tournament = await t.run(async (ctx) => {
        const programId = await ctx.db.insert(
          'programs',
          tournamentProgramFields(tenant.organizationId, 'winter-open'),
        );
        const tournamentId = await ctx.db.insert('tournaments', {
          programId,
          organizationId: tenant.organizationId,
          startDate: '2027-01-16',
          endDate: '2027-01-16',
          registrationDeadline: '2027-01-09',
          maximumTeams: 8,
          minimumRosterSize: 4,
          structure: 'bracket',
          bracketType: 'single',
        });
        return {
          program: (await ctx.db.get('programs', programId))!,
          row: (await ctx.db.get('tournaments', tournamentId))!,
        };
      });

      const first = await t.action(internal.releaseBackfill.run, {});
      const second = await t.action(internal.releaseBackfill.run, {});

      expect(first.backfilled.programs).toBe(1);
      expect(second.backfilled).toEqual(ZERO);
      await t.run(async (ctx) => {
        expect(await ctx.db.get('programs', tournament.program._id)).toEqual(tournament.program);
        expect(await ctx.db.get('tournaments', tournament.row._id)).toEqual(tournament.row);
        const programs = await ctx.db.query('programs').collect();
        expect(programs.map((program) => program.type).sort()).toEqual(['league', 'tournament']);
      });
    });

    test('picks up where an interrupted pass stopped, without a second program for a league', async () => {
      const t = setup();
      const leagues = BATCH_SIZE.programs + 1;
      const tenant = await insertTenantWithoutCounters(t, 'interrupted', { published: leagues });
      await t.mutation(internal.releaseBackfill.backfillBatch, { phase: 'leagues', cursor: null });
      const first = await t.mutation(internal.releaseBackfill.backfillBatch, {
        phase: 'programs',
        cursor: null,
      });
      expect(first.isDone).toBe(false);
      expect(first.backfilled.programs).toBeGreaterThan(0);
      expect(first.backfilled.programs).toBeLessThanOrEqual(BATCH_SIZE.programs);

      const result = await t.action(internal.releaseBackfill.run, {});

      expect(first.backfilled.programs + result.backfilled.programs).toBe(leagues);
      await t.run(async (ctx) => {
        const programs = await ctx.db.query('programs').collect();
        expect(programs).toHaveLength(leagues);
        expect(new Set(programs.map((program) => program.leagueId)).size).toBe(leagues);
        for (const leagueId of tenant.leagueIds) {
          const league = await ctx.db.get('leagues', leagueId);
          expect(league?.programId, league?.name).toBeDefined();
        }
      });
    });

    test('covers more leagues than one batch holds', async () => {
      const t = setup();
      const leagues = BATCH_SIZE.programs * 2 + 1;
      await insertTenantWithoutCounters(t, 'bulk', { published: leagues });

      const result = await t.action(internal.releaseBackfill.run, {});

      expect(result.backfilled.programs).toBe(leagues);
      const unlinked = await t.run(async (ctx) => {
        const rows = await ctx.db.query('leagues').collect();
        return rows.filter((league) => league.programId === undefined).length;
      });
      expect(unlinked).toBe(0);
    });

    test('a league whose slug another program of the organization holds fails the run and gets no program', async () => {
      const t = setup();
      const tenant = await insertTenantWithoutCounters(t, 'clash', { published: 1 });
      await t.run(async (ctx) => {
        await ctx.db.insert(
          'programs',
          tournamentProgramFields(tenant.organizationId, 'published-0'),
        );
      });

      await expect(t.action(internal.releaseBackfill.run, {})).rejects.toThrow(
        /slug "published-0" is held by another program/,
      );

      const league = await t.run((ctx) => ctx.db.get('leagues', tenant.leagueIds[0]));
      expect(league?.programId).toBeUndefined();
    });

    test('a run that fails at the scan limit keeps the programs it made, and the repeat adds none', async () => {
      const t = setup();
      const { organizationId, leagueIds } = await insertTenantWithoutCounters(t, 'many', {
        published: 2,
      });
      await t.run(async (ctx) => {
        for (let i = 0; i < BACKFILL_SCAN_LIMIT; i++) {
          await ctx.db.insert('locations', {
            organizationId,
            name: `Field ${i}`,
            address: '3 Main St',
          });
        }
      });

      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(t.action(internal.releaseBackfill.run, {})).rejects.toThrow(
          /cannot be recounted in one change/,
        );
        await t.run(async (ctx) => {
          expect(await ctx.db.query('programs').collect()).toHaveLength(2);
          for (const leagueId of leagueIds) {
            expect((await ctx.db.get('leagues', leagueId))?.programId).toBeDefined();
          }
        });
      }
      await expectCountersUnset(t, organizationId);
    });
  });

  describe('batching', () => {
    test('a batch of rows that each recount to the scan limit stays inside the documents one transaction may read', () => {
      const readLimit = 16_384;
      const tablesCountedPerRow = {
        organizations: 6,
        seasons: 2,
        leagues: 1,
        programs: 0,
        locations: 0,
        teams: 0,
      };
      for (const [phase, tables] of Object.entries(tablesCountedPerRow)) {
        const rowsRead =
          BATCH_SIZE[phase as keyof typeof BATCH_SIZE] * (1 + tables * (BACKFILL_SCAN_LIMIT - 1));
        expect(rowsRead, phase).toBeLessThanOrEqual(readLimit);
      }
    });

    test('a batch handles at most its batch size and returns a cursor for the rest', async () => {
      const t = setup();
      const count = BATCH_SIZE.organizations + 1;
      for (let i = 0; i < count; i++)
        await insertTenantWithoutCounters(t, `many-${i}`, { published: 1 });

      const first = await t.mutation(internal.releaseBackfill.backfillBatch, {
        phase: 'organizations',
        cursor: null,
      });
      expect(first.isDone).toBe(false);
      expect(first.backfilled.organizations).toBe(BATCH_SIZE.organizations);

      const second = await t.mutation(internal.releaseBackfill.backfillBatch, {
        phase: 'organizations',
        cursor: first.continueCursor,
      });
      expect(second.backfilled.organizations).toBe(1);
      expect(second.isDone).toBe(true);
    });

    test('a run covers more rows than one batch holds, in every phase', async () => {
      const t = setup();
      const organizations = BATCH_SIZE.organizations * 2 + 1;
      const tenants = [];
      for (let i = 0; i < organizations; i++) {
        tenants.push(await insertTenantWithoutCounters(t, `bulk-${i}`, { published: 1, draft: 1 }));
      }
      const first = tenants[0];
      const seasons = BATCH_SIZE.seasons + 1;
      for (let i = 0; i < seasons; i++) {
        await insertLegacySeasonWithTeams(t, first, { status: 'draft', teams: 1, waiting: 1 });
      }
      await t.run(async (ctx) => {
        for (let i = 0; i < BATCH_SIZE.locations + 1; i++) {
          await ctx.db.insert('locations', {
            organizationId: first.organizationId,
            name: `Extra ${i}`,
            address: '2 Main St',
          });
        }
      });

      const result = await t.action(internal.releaseBackfill.run, {});

      expect(result.backfilled.organizations).toBe(organizations);
      expect(result.backfilled.draftLeagueCounts).toBe(organizations);
      expect(result.backfilled.leagues).toBe(organizations * 2);
      expect(result.backfilled.locations).toBe(organizations * 2 + BATCH_SIZE.locations + 1);
      expect(result.backfilled.teamCounts).toBe(seasons);
      expect(result.backfilled.waitlistCounts).toBe(seasons);
      expect(result.backfilled.pendingInviteCounts).toBe(seasons);
      expect(result.batches).toBeGreaterThan(5);
      const unset = await t.run(async (ctx) => {
        const rows = await ctx.db.query('organizations').collect();
        return rows.filter(
          (organization) =>
            organization.leagueCount === undefined ||
            organization.draftLeagueCount === undefined ||
            organization.staffCount === undefined ||
            organization.pendingInviteCount === undefined,
        ).length;
      });
      expect(unset).toBe(0);
    });

    test('an organization with as many locations as the scan limit fails the run and keeps its counters unset', async () => {
      const t = setup();
      const { organizationId } = await insertTenantWithoutCounters(t, 'many-locations', {
        published: 1,
      });
      await t.run(async (ctx) => {
        for (let i = 0; i < BACKFILL_SCAN_LIMIT; i++) {
          await ctx.db.insert('locations', {
            organizationId,
            name: `Field ${i}`,
            address: '3 Main St',
          });
        }
      });

      await expect(t.action(internal.releaseBackfill.run, {})).rejects.toThrow(
        /cannot be recounted in one change/,
      );
      await expectCountersUnset(t, organizationId);
    });

    test('an organization with as many leagues as the scan limit fails the run and keeps its counters unset', async () => {
      const t = setup();
      const { organizationId } = await insertTenantWithoutCounters(t, 'many-leagues');
      await t.run(async (ctx) => {
        for (let i = 0; i < BACKFILL_SCAN_LIMIT; i++) {
          await ctx.db.insert('leagues', {
            ...leagueRequiredFields('soccer', `League ${i}`),
            organizationId,
            name: `League ${i}`,
            slug: `league-${i}`,
            sport: 'soccer',
            locationIds: [],
            status: 'published',
            publishedSeasonCount: 0,
            sortName: `league ${i}`,
          });
        }
      });

      await expect(t.action(internal.releaseBackfill.run, {})).rejects.toThrow(
        /cannot be recounted in one change/,
      );
      await expectCountersUnset(t, organizationId);
    });

    test('an organization with as many sport location rows as the scan limit fails the run and keeps its counters unset', async () => {
      const t = setup();
      const { organizationId, locationIds } = await insertTenantWithoutCounters(t, 'many-rows', {
        published: 1,
      });
      await t.run(async (ctx) => {
        for (let i = 0; i < BACKFILL_SCAN_LIMIT; i++) {
          await ctx.db.insert('sportLocations', {
            organizationId,
            sport: 'soccer',
            locationId: locationIds[0],
            leagueCount: i,
          });
        }
      });

      await expect(t.action(internal.releaseBackfill.run, {})).rejects.toThrow(
        /cannot be recounted in one change/,
      );
      await expectCountersUnset(t, organizationId);
    });

    test.each([
      { counted: 'teams', shape: { teams: BACKFILL_TEAM_COUNT_SCAN_LIMIT, waiting: 0 } },
      { counted: 'waiting entries', shape: { teams: 0, waiting: BACKFILL_TEAM_COUNT_SCAN_LIMIT } },
    ])(
      'a season with as many $counted as the scan limit fails the run and keeps its counter unset',
      async ({ shape }) => {
        const t = setup();
        const tenant = await insertTenantWithoutCounters(t, 'big-season', { published: 1 });
        const { seasonId } = await insertLegacySeasonWithTeams(t, tenant, {
          status: 'draft',
          ...shape,
        });

        await expect(t.action(internal.releaseBackfill.run, {})).rejects.toThrow(/scan limit/);
        const season = await t.run((ctx) => ctx.db.get('seasons', seasonId));
        expect(season?.teamCount).toBeUndefined();
        expect(season?.waitlistCount).toBeUndefined();
      },
    );

    test('an organization at the scan limit fails the run instead of getting a short count', async () => {
      const t = setup();
      const { organizationId } = await insertTenantWithoutCounters(t, 'huge');
      await t.run(async (ctx) => {
        for (let i = 0; i < BACKFILL_SCAN_LIMIT; i++) {
          await ctx.db.insert('invites', {
            organizationId,
            email: `i${i}@example.test`,
            role: 'leagueOrganizer',
            leagueIds: [],
            tokenHash: `huge-${i}`,
            expiresAt: 9_999_999_999_999,
            status: 'pending',
          });
        }
      });

      await expect(t.action(internal.releaseBackfill.run, {})).rejects.toThrow(/scan limit/);
      const organization = await t.run((ctx) => ctx.db.get('organizations', organizationId));
      expect(organization?.pendingInviteCount).toBeUndefined();
    });
  });
});
