/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MARK_ENDED_BATCH } from './programEnds';
import { weekdayOf } from './lib/trainingPattern';
import {
  defaultDivision,
  deleteCampSession,
  insertCampSession,
  insertDraftCamp,
  insertDraftTournament,
  insertDraftTraining,
  insertLeague,
  insertTenant,
  insertTrainingClasses,
  setTrainingClassStatus,
  updateTournamentDetails,
} from './lib/tenantWrites';
import schema from './schema';
import {
  insertLeagueWithProgram,
  leagueRequiredFields,
  modules,
  tournamentProgramFields,
} from './test.setup';

// 2027-02-02 at 12:00 UTC: the first moment of the UTC-12 day 2027-02-02.
const NOW = Date.parse('2027-02-02T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const organizationId = await t.run((ctx) =>
    insertTenant(ctx, {
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
      locations: [],
      leagues: [],
    }),
  );
  return { t, organizationId };
}

type Harness = Awaited<ReturnType<typeof setup>>['t'];

// As the writers leave a program until the cron runs: `current`, with its last day set.
function insertCurrent(
  t: Harness,
  organizationId: Id<'organizations'>,
  slug: string,
  endDate: string,
) {
  return t.run((ctx) =>
    ctx.db.insert('programs', {
      ...tournamentProgramFields(organizationId, slug),
      endDate,
      current: true,
    }),
  );
}

const currentOf = (t: Harness, id: Id<'programs'>) =>
  t.run(async (ctx) => (await ctx.db.get('programs', id))?.current);

describe('programEnds.markEnded', () => {
  test('marks only the programs that ended before today, and a second run changes nothing', async () => {
    const { t, organizationId } = await setup();
    const yesterday = await insertCurrent(t, organizationId, 'yesterday', '2027-02-01');
    const longAgo = await insertCurrent(t, organizationId, 'long-ago', '2026-06-01');
    const today = await insertCurrent(t, organizationId, 'today', '2027-02-02');
    const later = await insertCurrent(t, organizationId, 'later', '2027-03-01');
    const league = await t.run(async (ctx) => {
      const leagueId = await insertLeagueWithProgram(ctx, {
        organizationId,
        name: 'Coed 7s',
        slug: 'coed-7s',
        sport: 'soccer',
        locationIds: [],
        publishedSeasonCount: 0,
        sortName: 'coed 7s',
        ...leagueRequiredFields('soccer', 'Coed 7s'),
      });
      return (await ctx.db.get('leagues', leagueId))!.programId;
    });

    await t.mutation(internal.programEnds.markEnded, {});

    expect(await currentOf(t, yesterday)).toBe(false);
    expect(await currentOf(t, longAgo)).toBe(false);
    expect(await currentOf(t, today)).toBe(true);
    expect(await currentOf(t, later)).toBe(true);
    expect(await currentOf(t, league)).toBe(true);
    const before = await t.run((ctx) => ctx.db.query('programs').collect());
    await t.mutation(internal.programEnds.markEnded, {});
    expect(await t.run((ctx) => ctx.db.query('programs').collect())).toEqual(before);
  });

  test('leaves a camp with no session, which has no end date, as it is', async () => {
    const { t, organizationId } = await setup();
    const campId = await t.run((ctx) =>
      insertDraftCamp(ctx, organizationId, {
        name: 'Empty Camp',
        slug: 'empty-camp',
        sport: 'soccer',
        locationIds: [],
        minimumAge: 9,
        maximumAge: 14,
      }),
    );
    await t.mutation(internal.programEnds.markEnded, {});
    const program = await t.run(async (ctx) =>
      ctx.db.get('programs', (await ctx.db.get('camps', campId))!.programId),
    );
    expect(program).toMatchObject({ current: false });
    expect(program).not.toHaveProperty('endDate');
  });

  test('schedules itself until every program that ended is marked', async () => {
    const { t, organizationId } = await setup();
    const count = MARK_ENDED_BATCH * 2 + 50;
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert('programs', {
          ...tournamentProgramFields(organizationId, `ended-${i}`),
          endDate: '2027-02-01',
          current: true,
        });
      }
    });
    expect(count).toBe(250);

    await t.mutation(internal.programEnds.markEnded, {});
    expect(
      (await t.run((ctx) => ctx.db.query('programs').collect())).filter((row) => row.current),
    ).toHaveLength(count - MARK_ENDED_BATCH);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run((ctx) => ctx.db.query('programs').collect());
    expect(rows).toHaveLength(count);
    expect(rows.every((row) => row.current === false)).toBe(true);
  });

  test('catches up a day the cron missed on its next run', async () => {
    const { t, organizationId } = await setup();
    const missed = await insertCurrent(t, organizationId, 'missed', '2027-02-01');
    vi.setSystemTime(Date.parse('2027-02-05T12:01:00Z'));
    await t.mutation(internal.programEnds.markEnded, {});
    expect(await currentOf(t, missed)).toBe(false);
  });

  test('marks a camp whose last session ended and not one whose last session ends today', async () => {
    const { t, organizationId } = await setup();
    await t.run(async (ctx) => {
      for (const [slug, endDate] of [
        ['ended', '2027-02-02'],
        ['ends-today', '2027-02-03'],
      ] as const) {
        const campId = await insertDraftCamp(ctx, organizationId, {
          name: slug,
          slug,
          sport: 'soccer',
          locationIds: [],
          minimumAge: 9,
          maximumAge: 14,
        });
        await insertCampSession(ctx, (await ctx.db.get('camps', campId))!, {
          name: 'Week 1',
          startDate: '2027-01-25',
          endDate,
          places: 10,
          registrationDeadline: '2027-01-20',
        });
      }
    });
    vi.setSystemTime(Date.parse('2027-02-03T12:01:00Z'));
    await t.mutation(internal.programEnds.markEnded, {});
    const rows = await t.run((ctx) => ctx.db.query('programs').collect());
    expect(rows.map((row) => [row.slug, row.current])).toEqual([
      ['ended', false],
      ['ends-today', true],
    ]);
  });
});

describe('the writers of a program’s end', () => {
  const programOf = (t: Harness, id: Id<'programs'>) => t.run((ctx) => ctx.db.get('programs', id));

  test('a tournament created with a past end date is not current, and moving its end date to next week makes it current', async () => {
    const { t, organizationId } = await setup();
    const { programId, tournamentId } = await t.run(async (ctx) => {
      const id = await insertDraftTournament(ctx, organizationId, {
        name: 'Past Open',
        slug: 'past-open',
        sport: 'soccer',
        locationIds: [],
        division: defaultDivision('soccer'),
        startDate: '2027-01-10',
        endDate: '2027-01-11',
        registrationDeadline: '2027-01-01',
        maximumTeams: 8,
      });
      return { tournamentId: id, programId: (await ctx.db.get('tournaments', id))!.programId };
    });
    expect(await programOf(t, programId)).toMatchObject({ endDate: '2027-01-11', current: false });

    await t.run(async (ctx) => {
      const tournament = (await ctx.db.get('tournaments', tournamentId))!;
      await updateTournamentDetails(ctx, tournament, {
        startDate: '2027-02-08',
        endDate: '2027-02-09',
        registrationDeadline: '2027-02-05',
        maximumTeams: 8,
        setsPerGame: 1,
      });
    });
    expect(await programOf(t, programId)).toMatchObject({ endDate: '2027-02-09', current: true });
  });

  test('a camp’s first session sets its end date, and deleting its last session clears it', async () => {
    const { t, organizationId } = await setup();
    const { campId, programId } = await t.run(async (ctx) => {
      const id = await insertDraftCamp(ctx, organizationId, {
        name: 'Sand Camp',
        slug: 'sand-camp',
        sport: 'soccer',
        locationIds: [],
        minimumAge: 9,
        maximumAge: 14,
      });
      return { campId: id, programId: (await ctx.db.get('camps', id))!.programId };
    });
    const empty = await programOf(t, programId);
    expect(empty).toMatchObject({ current: false });
    expect(empty).not.toHaveProperty('endDate');

    const sessionId = await t.run(async (ctx) =>
      insertCampSession(ctx, (await ctx.db.get('camps', campId))!, {
        name: 'Week 1',
        startDate: '2027-02-08',
        endDate: '2027-02-12',
        places: 10,
        registrationDeadline: '2027-02-01',
      }),
    );
    expect(await programOf(t, programId)).toMatchObject({ endDate: '2027-02-12', current: true });

    await t.run(async (ctx) =>
      deleteCampSession(ctx, (await ctx.db.get('campSessions', sessionId))!),
    );
    const cleared = await programOf(t, programId);
    expect(cleared).toMatchObject({ current: false });
    expect(cleared).not.toHaveProperty('endDate');
  });

  test('scheduling a training program sets its end date to the last class, and cancelling and restoring the last class moves it', async () => {
    const { t, organizationId } = await setup();
    const { trainingId, programId } = await t.run(async (ctx) => {
      const id = await insertDraftTraining(ctx, organizationId, {
        name: 'Serving Clinic',
        slug: 'serving-clinic',
        sport: 'soccer',
        locationIds: [],
        coachName: 'Dana Ruiz',
      });
      return { trainingId: id, programId: (await ctx.db.get('trainings', id))!.programId };
    });
    // 2027-02-08 is a Monday.
    await t.run(async (ctx) =>
      insertTrainingClasses(ctx, (await ctx.db.get('trainings', trainingId))!, {
        weekday: weekdayOf('2027-02-08'),
        startTime: '18:00',
        endTime: '19:00',
        firstDate: '2027-02-08',
        weeks: 3,
        placesPerClass: 12,
        registrationDeadline: '2027-02-08',
        allowSingleRegistration: false,
      }),
    );
    expect(await programOf(t, programId)).toMatchObject({ endDate: '2027-02-22', current: true });

    const last = await t.run(async (ctx) =>
      (await ctx.db.query('trainingClasses').collect()).find((row) => row.date === '2027-02-22')!,
    );
    await t.run((ctx) => setTrainingClassStatus(ctx, last, 'cancelled'));
    expect(await programOf(t, programId)).toMatchObject({ endDate: '2027-02-15', current: true });
    await t.run((ctx) => setTrainingClassStatus(ctx, last, 'scheduled'));
    expect(await programOf(t, programId)).toMatchObject({ endDate: '2027-02-22', current: true });
  });

  test('a league’s program is current with no end date, before and after the league changes', async () => {
    const { t, organizationId } = await setup();
    const programId = await t.run(async (ctx) => {
      const { leagueId: id } = await insertLeague(ctx, organizationId, {
        name: 'Coed 7s',
        sport: 'soccer',
        locations: [],
        division: defaultDivision('soccer'),
      });
      return (await ctx.db.get('leagues', id))!.programId;
    });
    const program = await programOf(t, programId);
    expect(program).toMatchObject({ current: true });
    expect(program).not.toHaveProperty('endDate');
  });
});
