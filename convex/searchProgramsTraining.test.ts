/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { weekdayOf } from './lib/trainingPattern';
import { addCalendarDays, dateAtUtcMinus12 } from './lib/registration';
import {
  insertDraftCamp,
  insertCampSession,
  insertDraftTraining,
  insertTenant,
  insertTrainingClasses,
  publishCamp,
  publishTraining,
  setTrainingClassStatus,
  updateLocation,
  updateOrganizationCityState,
} from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// 2027-02-01, a Monday, at noon UTC.
const NOW = Date.UTC(2027, 1, 1, 12, 0, 0);
const today = () => dateAtUtcMinus12(Date.now());
const inDays = (days: number) => addCalendarDays(today(), days);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type Harness = Awaited<ReturnType<typeof setup>>['t'];

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const gulf = await insertTenant(ctx, {
      organization: {
        name: 'Gulf Coast Sport & Social',
        slug: 'gulf',
        cityState: 'Corpus Christi, TX',
      },
      locations: [{ name: 'North Beach Sand Courts', address: '1 Beach Rd' }],
      leagues: [
        {
          name: 'Sunday Reverse Coed 4s',
          sport: 'beachVolleyball',
          locations: ['North Beach Sand Courts'],
          division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
        },
      ],
    });
    return { gulf };
  });
  return { t, ...ids };
}

const CLINIC = { name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' };

async function insertTraining(
  t: Harness,
  organizationId: Id<'organizations'>,
  options: {
    name?: string;
    slug?: string;
    published?: boolean;
    sport?: 'beachVolleyball' | 'soccer';
    firstInDays?: number;
    weeks?: number;
    minimumAge?: number;
  } = {},
) {
  const { published = true, sport = 'beachVolleyball', firstInDays = 7, weeks = 4 } = options;
  const { name, slug } = { ...CLINIC, ...options };
  await t.run(async (ctx) => {
    const location = (await ctx.db.query('locations').collect()).find(
      (row) => row.organizationId === organizationId,
    )!;
    const trainingId = await insertDraftTraining(ctx, organizationId, {
      name,
      slug,
      sport,
      locationIds: [location._id],
      coachName: 'Dana Ruiz',
      ...(options.minimumAge !== undefined && { minimumAge: options.minimumAge }),
    });
    const firstDate = inDays(firstInDays);
    await insertTrainingClasses(ctx, (await ctx.db.get('trainings', trainingId))!, {
      weekday: weekdayOf(firstDate),
      startTime: '18:00',
      endTime: '19:00',
      firstDate,
      weeks,
      placesPerClass: 12,
      registrationDeadline: firstDate,
      allowSingleRegistration: false,
    });
    if (published) await publishTraining(ctx, (await ctx.db.get('trainings', trainingId))!);
  });
}

const withTraining = { withTraining: true } as const;

const search = (t: Harness, q: string, rest: Record<string, unknown> = {}) =>
  t.query(api.search.programs, { q, ...withTraining, ...rest });

const browse = (t: Harness, rest: Record<string, unknown> = {}) =>
  t.query(api.search.programsBrowse, { page: 1, ...withTraining, ...rest });

const names = (result: { rows: readonly { name: string }[] }) => result.rows.map((row) => row.name);

describe('search.programs and training programs', () => {
  test('finds a training program by a word of its name, with its coach, ages, pattern, and last class', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, { minimumAge: 16 });
    const result = await search(t, 'serving');
    expect(result.rows).toEqual([
      {
        type: 'training',
        organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
        name: 'Tuesday Serving Clinic',
        slug: 'tuesday-serving-clinic',
        sportName: 'Beach volleyball',
        coachName: 'Dana Ruiz',
        minimumAge: 16,
        locationNames: ['North Beach Sand Courts'],
        weekday: weekdayOf(inDays(7)),
        startTime: '18:00',
        endTime: '19:00',
        firstDate: inDays(7),
        registrationDeadline: inDays(7),
        weeks: 4,
        lastClassDate: inDays(7 + 21),
      },
    ]);
    expect(result.typeCounts).toEqual([{ type: 'training', count: 1 }]);
  });

  test('finds it by its sport name, its organization, its location, and its City, state, but not by its coach or a division word', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf);
    for (const q of ['volleyball', 'gulf', 'north beach', 'corpus']) {
      expect(names(await search(t, q, { type: 'training' })), q).toEqual([CLINIC.name]);
    }
    for (const q of ['dana', 'coed', 'adult']) {
      expect(names(await search(t, q, { type: 'training' })), q).toEqual([]);
    }
  });

  test('counts a training program among the types, and a search for a league word counts none', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, { name: 'Sunday Clinic', slug: 'sunday-clinic' });
    expect((await search(t, 'sunday')).typeCounts).toEqual([
      { type: 'league', count: 1 },
      { type: 'training', count: 1 },
    ]);
    expect((await search(t, 'reverse')).typeCounts).toEqual([{ type: 'league', count: 1 }]);
  });

  test('keeps the words current after a location rename and a City, state change', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf);
    await t.run(async (ctx) => {
      const location = (await ctx.db.query('locations').collect())[0];
      await updateLocation(ctx, location, { name: 'Omega Courts', address: location.address });
      await updateOrganizationCityState(ctx, gulf, 'Galveston, TX');
    });
    expect(names(await search(t, 'omega', { type: 'training' }))).toEqual([CLINIC.name]);
    expect(names(await search(t, 'galveston', { type: 'training' }))).toEqual([CLINIC.name]);
    expect(names(await search(t, 'north', { type: 'training' }))).toEqual([]);
  });

  test('stays listed and counted under a division filter, which narrows leagues and tournaments', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf);
    const filtered = await search(t, 'beach', { gender: ['mens'] });
    expect(filtered.rows.map((row) => [row.type, row.name])).toEqual([['training', CLINIC.name]]);
    expect(filtered.typeCounts).toEqual([{ type: 'training', count: 1 }]);
  });

  test('adds no division facet, so the training type offers no division filter', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf);
    expect((await search(t, 'serving', { type: 'training' })).facets).toEqual([]);
    expect((await browse(t, { type: 'training' })).facets).toEqual([]);
  });

  test('never lists or counts a draft training program, and a row holds no id', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf);
    await insertTraining(t, gulf, { name: 'Draft Clinic', slug: 'draft-clinic', published: false });
    expect(names(await search(t, 'clinic'))).toEqual([CLINIC.name]);
    const browsed = await browse(t, { type: 'training' });
    expect(names(browsed)).toEqual([CLINIC.name]);
    expect(browsed.total).toBe(1);
    expect(JSON.stringify([await search(t, 'clinic'), browsed])).not.toMatch(
      /_id|_creationTime|Id"|status|searchText|programId|trainingId|allowSingle|placesPerClass/,
    );
  });

  test('drops a training program whose last class has passed, in a search and a browse, and keeps one whose last class is today', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, {
      name: 'Ended Clinic',
      slug: 'ended-clinic',
      firstInDays: 1,
      weeks: 1,
    });
    await insertTraining(t, gulf, {
      name: 'Today Clinic',
      slug: 'today-clinic',
      firstInDays: 3,
      weeks: 1,
    });
    vi.setSystemTime(NOW + 3 * 24 * 60 * 60 * 1000);
    expect(names(await search(t, 'clinic'))).toEqual(['Today Clinic']);
    expect((await search(t, 'clinic')).typeCounts).toEqual([{ type: 'training', count: 1 }]);
    expect(names(await browse(t, { type: 'training' }))).toEqual(['Today Clinic']);
  });

  test('a search only an ended training program matches has no row, no count, and no suggestion', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, { name: 'Zebra Clinic', slug: 'zebra-clinic', weeks: 1 });
    vi.setSystemTime(NOW + 30 * 24 * 60 * 60 * 1000);
    const result = await search(t, 'zebra');
    expect(result.rows).toEqual([]);
    expect(result.typeCounts).toEqual([]);
    expect(result.suggestions).toBeUndefined();
  });

  test('drops a training program with no scheduled class', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, { name: 'Empty Clinic', slug: 'empty-clinic', weeks: 1 });
    await t.run(async (ctx) => {
      await setTrainingClassStatus(
        ctx,
        (await ctx.db.query('trainingClasses').first())!,
        'cancelled',
      );
    });
    expect((await browse(t, { type: 'training' })).total).toBe(0);
  });

  test('a call without withTraining gets no training row and no training in the counts, and a camp-only call gets none either', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, { name: 'Sunday Clinic', slug: 'sunday-clinic' });
    for (const args of [{}, { withCamps: true }]) {
      const previous = await t.query(api.search.programs, { q: 'sunday', ...args });
      expect(previous.rows.map((row) => row.type)).toEqual(['league']);
      expect(previous.typeCounts).toEqual([{ type: 'league', count: 1 }]);
      const onlyTraining = await t.query(api.search.programs, { q: 'clinic', ...args });
      expect(onlyTraining).toEqual({ rows: [], more: false, facets: [], typeCounts: [] });
      const typed = await t.query(api.search.programs, { q: 'clinic', type: 'training', ...args });
      expect(typed.rows).toEqual([]);
      const browsed = await t.query(api.search.programsBrowse, {
        page: 1,
        type: 'training',
        ...args,
      });
      expect(browsed.rows).toEqual([]);
      expect(browsed.typeCounts.map(({ type }) => type)).not.toContain('training');
    }
  });

  test('a training program does not push a league out of an earlier release’s suggestions', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, { name: 'Sunday Clinic', slug: 'sunday-clinic' });
    const result = await t.query(api.search.programs, { q: 'sunday austin' });
    expect(result.suggestions).toEqual(['sunday']);
  });

  test('lists camps and training programs together when a call asks for both', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, { name: 'Zeta Clinic', slug: 'zeta-clinic' });
    await t.run(async (ctx) => {
      const location = (await ctx.db.query('locations').collect())[0];
      const campId = await insertDraftCamp(ctx, gulf, {
        name: 'Zeta Camp',
        slug: 'zeta-camp',
        sport: 'beachVolleyball',
        locationIds: [location._id],
        minimumAge: 9,
        maximumAge: 14,
      });
      await insertCampSession(ctx, (await ctx.db.get('camps', campId))!, {
        name: 'Week 1',
        startDate: inDays(14),
        endDate: inDays(18),
        places: 20,
        registrationDeadline: inDays(10),
      });
      await publishCamp(ctx, (await ctx.db.get('camps', campId))!);
    });
    const result = await search(t, 'zeta', { withCamps: true });
    expect(result.rows.map((row) => [row.type, row.name]).sort()).toEqual([
      ['camp', 'Zeta Camp'],
      ['training', 'Zeta Clinic'],
    ]);
    expect(result.typeCounts).toEqual([
      { type: 'camp', count: 1 },
      { type: 'training', count: 1 },
    ]);
  });
});

describe('search.programsBrowse and training programs', () => {
  test('lists a published training program of a sport by name, with its row and the training count', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf);
    const result = await browse(t, { type: 'training', sport: 'beachVolleyball' });
    expect(result.rows.map((row) => [row.type, row.name])).toEqual([['training', CLINIC.name]]);
    expect(result.total).toBe(1);
    expect(result.typeCounts).toEqual([
      { type: 'league', count: 1 },
      { type: 'training', count: 1 },
    ]);
  });

  test('with no type lists training programs with leagues by name', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf);
    expect((await browse(t)).rows.map((row) => [row.type, row.name])).toEqual([
      ['league', 'Sunday Reverse Coed 4s'],
      ['training', CLINIC.name],
    ]);
  });

  test('a training program of another sport is not listed for a sport', async () => {
    const { t, gulf } = await setup();
    await insertTraining(t, gulf, {
      name: 'Soccer Clinic',
      slug: 'soccer-clinic',
      sport: 'soccer',
    });
    expect(names(await browse(t, { type: 'training', sport: 'beachVolleyball' }))).toEqual([]);
    expect(names(await browse(t, { type: 'training', sport: 'soccer' }))).toEqual([
      'Soccer Clinic',
    ]);
  });
});
