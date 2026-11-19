/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { addCalendarDays, dateAtUtcMinus12 } from './lib/registration';
import { PUBLIC_LIST_MAX_ROWS } from './lib/publicList';
import { weekdayOf } from './lib/trainingPattern';
import {
  defaultDivision,
  insertCampSession,
  insertDraftCamp,
  insertDraftTournament,
  insertDraftTraining,
  insertTenant,
  insertTrainingClasses,
  publishCamp,
  publishTournament,
  publishTraining,
} from './lib/tenantWrites';
import schema from './schema';
import { tournamentProgramFields, modules } from './test.setup';

const BULK = PUBLIC_LIST_MAX_ROWS + 1;

// The first moment of the UTC-12 day 2027-02-01.
const NOW = Date.UTC(2027, 1, 1, 12, 0, 0);
const today = () => dateAtUtcMinus12(Date.now());
const inDays = (days: number) => addCalendarDays(today(), days);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

type EndedType = 'camp' | 'tournament' | 'training';
const ENDED_TYPES: readonly EndedType[] = ['camp', 'tournament', 'training'];

type Harness = Awaited<ReturnType<typeof setup>>['t'];

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

// Rows as the writers and the cron leave them for a published program whose last day was yesterday.
async function insertEnded(
  t: Harness,
  organizationId: Id<'organizations'>,
  type: EndedType,
  count: number,
  { prefix = 'aaa', words = '', endDate = inDays(-1) } = {},
) {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      const slug = `${prefix}-${type}-${String(i).padStart(3, '0')}`;
      const name = `${slug} ${words}`.trim();
      const programId = await ctx.db.insert('programs', {
        ...tournamentProgramFields(organizationId, slug, endDate),
        type,
        name,
        sortName: name,
        searchText: `${name} ${type}`,
      });
      const typed = { programId, organizationId, status: 'published', sport: 'soccer' } as const;
      if (type === 'tournament') {
        await ctx.db.insert('tournaments', {
          ...typed,
          startDate: endDate,
          endDate,
          registrationDeadline: endDate,
          maximumTeams: 8,
          minimumRosterSize: 7,
          structure: 'bracket',
          bracketType: 'single',
        });
      } else if (type === 'camp') {
        await ctx.db.insert('camps', {
          ...typed,
          minimumAge: 9,
          maximumAge: 14,
          lastSessionEndDate: endDate,
        });
      } else {
        await ctx.db.insert('trainings', {
          ...typed,
          coachName: 'Dana Ruiz',
          lastClassDate: endDate,
        });
      }
    }
  });
}

// Written through the writers, so the program row holds what an organizer's change leaves.
async function insertUpcoming(
  t: Harness,
  organizationId: Id<'organizations'>,
  type: EndedType,
  { name = `Zebra ${type}`, lastInDays = 5, words = '' } = {},
) {
  const slug = name.toLowerCase().replaceAll(' ', '-');
  const full = `${name} ${words}`.trim();
  await t.run(async (ctx) => {
    if (type === 'tournament') {
      const id = await insertDraftTournament(ctx, organizationId, {
        name: full,
        slug,
        sport: 'soccer',
        locationIds: [],
        division: defaultDivision('soccer'),
        startDate: inDays(lastInDays - 1),
        endDate: inDays(lastInDays),
        registrationDeadline: inDays(lastInDays - 3),
        maximumTeams: 8,
      });
      await publishTournament(ctx, (await ctx.db.get('tournaments', id))!);
    } else if (type === 'camp') {
      const id = await insertDraftCamp(ctx, organizationId, {
        name: full,
        slug,
        sport: 'soccer',
        locationIds: [],
        minimumAge: 9,
        maximumAge: 14,
      });
      await insertCampSession(ctx, (await ctx.db.get('camps', id))!, {
        name: 'Week 1',
        startDate: inDays(lastInDays - 4),
        endDate: inDays(lastInDays),
        places: 20,
        registrationDeadline: inDays(lastInDays - 5),
      });
      await publishCamp(ctx, (await ctx.db.get('camps', id))!);
    } else {
      const id = await insertDraftTraining(ctx, organizationId, {
        name: full,
        slug,
        sport: 'soccer',
        locationIds: [],
        coachName: 'Dana Ruiz',
      });
      const firstDate = inDays(lastInDays);
      await insertTrainingClasses(ctx, (await ctx.db.get('trainings', id))!, {
        weekday: weekdayOf(firstDate),
        startTime: '18:00',
        endTime: '19:00',
        firstDate,
        weeks: 1,
        placesPerClass: 12,
        registrationDeadline: firstDate,
        allowSingleRegistration: false,
      });
      await publishTraining(ctx, (await ctx.db.get('trainings', id))!);
    }
  });
}

const ALL_TYPES = { withCamps: true, withTraining: true } as const;
const names = (result: { rows: readonly { name: string }[] }) => result.rows.map((row) => row.name);

describe('search.programsBrowse with ended programs', () => {
  test.each(ENDED_TYPES)(
    'lists the one upcoming %s program after 201 ended ones that sort before it',
    async (type) => {
      const { t, organizationId } = await setup();
      await insertEnded(t, organizationId, type, BULK);
      await insertUpcoming(t, organizationId, type);
      const result = await t.query(api.search.programsBrowse, {
        page: 1,
        type,
        sport: 'soccer',
        ...ALL_TYPES,
      });
      expect(names(result)).toEqual([`Zebra ${type}`]);
      expect(result.total).toBe(1);
    },
  );

  test('lists an upcoming league after 201 ended tournaments and counts no tournament', async () => {
    const { t, organizationId } = await setup();
    await t.run((ctx) =>
      insertTenant(ctx, {
        organization: { name: 'Zed League Org', slug: 'zed' },
        locations: [],
        leagues: [
          {
            name: 'Zulu Coed 7s',
            sport: 'soccer',
            locations: [],
            division: defaultDivision('soccer'),
          },
        ],
      }),
    );
    await insertEnded(t, organizationId, 'tournament', BULK);
    const result = await t.query(api.search.programsBrowse, { page: 1, sport: 'soccer' });
    expect(names(result)).toEqual(['Zulu Coed 7s']);
    expect(result.typeCounts).toEqual([{ type: 'league', count: 1 }]);
  });
});

describe('search.programs with ended programs', () => {
  test('returns the three upcoming programs after 200 ended ones of each type that match the word', async () => {
    const { t, organizationId } = await setup();
    for (const type of ENDED_TYPES) {
      await insertEnded(t, organizationId, type, PUBLIC_LIST_MAX_ROWS, { words: 'zephyr' });
      await insertUpcoming(t, organizationId, type, { name: `Upcoming ${type}`, words: 'zephyr' });
    }
    const result = await t.query(api.search.programs, { q: 'zephyr', ...ALL_TYPES });
    expect(result.rows.map((row) => row.type).sort()).toEqual(['camp', 'tournament', 'training']);
    expect(result.typeCounts).toEqual([
      { type: 'tournament', count: 1 },
      { type: 'camp', count: 1 },
      { type: 'training', count: 1 },
    ]);
  });
});

describe('at the end of a program’s last day', () => {
  async function endingToday() {
    const s = await setup();
    // The writers leave `current` true while the last day is today.
    for (const type of ENDED_TYPES) {
      await insertUpcoming(s.t, s.organizationId, type, { name: `Today ${type}`, lastInDays: 0 });
    }
    return s;
  }
  const NEXT_DAY_1159 = Date.parse('2027-02-02T11:59:00Z');
  const NEXT_DAY_1200 = Date.parse('2027-02-02T12:00:00Z');

  const listed = async (t: Harness) => {
    const search = await t.query(api.search.programs, { q: 'today', ...ALL_TYPES });
    const browse = await t.query(api.search.programsBrowse, { page: 1, ...ALL_TYPES });
    return [names(search).sort(), names(browse).sort()];
  };
  const all = ['Today camp', 'Today tournament', 'Today training'];

  test('given programs that end today on the UTC-12 day, when either query runs at 11:59Z the next UTC day, then both list them', async () => {
    const { t } = await endingToday();
    expect(today()).toBe('2027-02-01');
    vi.setSystemTime(NEXT_DAY_1159);
    expect(today()).toBe('2027-02-01');
    expect(await listed(t)).toEqual([all, all]);
  });

  test('given programs that ended yesterday on the UTC-12 day, when either query runs at 12:00Z before the cron, then neither lists them', async () => {
    const { t } = await endingToday();
    vi.setSystemTime(NEXT_DAY_1200);
    const rows = await t.run((ctx) => ctx.db.query('programs').collect());
    expect(rows.map((row) => row.current)).toEqual([true, true, true]);
    expect(await listed(t)).toEqual([[], []]);
  });

  test('given programs that ended yesterday, when either query runs after the cron, then neither lists them', async () => {
    const { t } = await endingToday();
    vi.setSystemTime(NEXT_DAY_1200);
    await t.mutation(internal.programEnds.markEnded, {});
    const rows = await t.run((ctx) => ctx.db.query('programs').collect());
    expect(rows.map((row) => row.current)).toEqual([false, false, false]);
    expect(await listed(t)).toEqual([[], []]);
  });
});

describe('a call with the previous release’s arguments', () => {
  test('leaves ended programs out of both queries and keeps the result shape', async () => {
    const { t, organizationId } = await setup();
    await insertEnded(t, organizationId, 'tournament', 3, { words: 'zebra' });
    await insertUpcoming(t, organizationId, 'tournament', { name: 'Zebra Open' });
    const found = await t.query(api.search.programs, { q: 'zebra' });
    expect(names(found)).toEqual(['Zebra Open']);
    expect(Object.keys(found).sort()).toEqual(['facets', 'more', 'rows', 'typeCounts']);
    const browse = await t.query(api.search.programsBrowse, { page: 1, type: 'tournament' });
    expect(names(browse)).toEqual(['Zebra Open']);
    expect(Object.keys(browse).sort()).toEqual([
      'facets',
      'page',
      'pageCount',
      'rows',
      'total',
      'typeCounts',
    ]);
  });
});
