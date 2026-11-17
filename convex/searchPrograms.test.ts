/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { addCalendarDays, dateAtUtcMinus12 } from './lib/registration';
import {
  defaultDivision,
  insertCampSession,
  insertDraftCamp,
  insertDraftTournament,
  insertSeason,
  insertTenant,
  publishCamp,
  publishTournament,
  updateLocation,
  updateOrganizationCityState,
  type NewSeason,
  type NewTournament,
} from './lib/tenantWrites';
import schema from './schema';
import { SEARCH_RESULT_LIMIT, SEARCH_SCAN_LIMIT } from './search';
import { insertLeagueWithProgram, modules, setTeamCounts } from './test.setup';

const OPEN_SEASON: NewSeason = {
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  playersPerSide: 4,
  minimumRosterSize: 4,
};

const BEACH_OPEN: NewTournament = {
  name: 'Gulf Coast Beach Open',
  slug: 'gulf-coast-beach-open',
  sport: 'beachVolleyball',
  locationIds: [],
  division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
  startDate: '2027-07-10',
  endDate: '2027-07-11',
  registrationDeadline: '2027-07-01',
  maximumTeams: 2,
};

type Harness = Awaited<ReturnType<typeof setup>>['t'];

async function publishedTournament(
  t: Harness,
  organizationId: Id<'organizations'>,
  tournament: NewTournament,
) {
  await t.run(async (ctx) => {
    const tournamentId = await insertDraftTournament(ctx, organizationId, tournament);
    await publishTournament(ctx, (await ctx.db.get('tournaments', tournamentId))!);
  });
}

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
        {
          name: 'Coed Draft',
          sport: 'soccer',
          locations: ['North Beach Sand Courts'],
          status: 'draft',
          division: defaultDivision('soccer'),
        },
      ],
    });
    const lakeshore = await insertTenant(ctx, {
      organization: { name: 'Lakeshore Sand League', slug: 'lakeshore' },
      locations: [{ name: 'Driftwood Beach Courts', address: '2 Lake Rd' }],
      leagues: [
        {
          name: 'Saturday Coed 6s',
          sport: 'beachVolleyball',
          locations: ['Driftwood Beach Courts'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    return { gulf, lakeshore };
  });
  await publishedTournament(t, ids.gulf, BEACH_OPEN);
  return { t, ...ids };
}

const search = (t: Harness, q: string, rest: { type?: 'league' | 'tournament' | 'camp' } = {}) =>
  t.query(api.search.programs, { q, ...rest });

const names = (result: { rows: readonly { name: string }[] }) => result.rows.map((row) => row.name);

describe('search.programs', () => {
  test('finds a league and a tournament by one word, each with its type', async () => {
    const { t } = await setup();
    const result = await search(t, 'beach');
    expect(result.rows.map((row) => [row.type, row.name]).sort()).toEqual([
      ['league', 'Saturday Coed 6s'],
      ['league', 'Sunday Reverse Coed 4s'],
      ['tournament', 'Gulf Coast Beach Open'],
    ]);
  });

  test('a league row has the league search row fields, and a tournament row its dates and deadline', async () => {
    const { t } = await setup();
    const rows = (await search(t, 'beach')).rows;
    expect(rows.find((row) => row.name === 'Sunday Reverse Coed 4s')).toEqual({
      type: 'league',
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
      name: 'Sunday Reverse Coed 4s',
      slug: 'sunday-reverse-coed-4s',
      sportName: 'Beach volleyball',
      locationNames: ['North Beach Sand Courts'],
      divisionLabel: 'Coed · 4v4 · BB',
      seasons: [],
    });
    expect(rows.find((row) => row.name === 'Gulf Coast Beach Open')).toEqual({
      type: 'tournament',
      organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
      name: 'Gulf Coast Beach Open',
      slug: 'gulf-coast-beach-open',
      sportName: 'Beach volleyball',
      locationNames: [],
      divisionLabel: 'Coed · 4v4 · BB',
      startDate: '2027-07-10',
      endDate: '2027-07-11',
      registrationDeadline: '2027-07-01',
      isFull: false,
    });
  });

  test('counts each type among the programs that hold every word, whichever type is chosen', async () => {
    const { t } = await setup();
    const all = await search(t, 'beach');
    expect(all.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
    ]);
    const tournaments = await search(t, 'beach', { type: 'tournament' });
    expect(names(tournaments)).toEqual(['Gulf Coast Beach Open']);
    expect(tournaments.typeCounts).toEqual(all.typeCounts);
  });

  test('never finds a draft league or a draft tournament', async () => {
    const { t, gulf } = await setup();
    await publishedTournament(t, gulf, BEACH_OPEN);
    await t.run(async (ctx) => {
      await insertDraftTournament(ctx, gulf, {
        ...BEACH_OPEN,
        name: 'Secret Draft Open',
        slug: 'secret-draft-open',
      });
    });
    expect(names(await search(t, 'draft'))).toEqual([]);
    expect(names(await search(t, 'secret'))).toEqual([]);
  });

  test('a known type with no matches has no rows and no count for it, and an unlisted type has no rows', async () => {
    const { t } = await setup();
    const result = await search(t, 'beach', { type: 'camp' });
    expect(result.rows).toEqual([]);
    expect(result.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
    ]);
    expect(result.facets).toEqual([]);
  });

  test('returns nothing for a blank query', async () => {
    const { t } = await setup();
    expect(await search(t, '  ')).toEqual({ rows: [], more: false, typeCounts: [] });
  });

  test('the division facets are those of the chosen type, and the type is applied after the read', async () => {
    const { t } = await setup();
    const result = await search(t, 'beach', { type: 'tournament' });
    expect(result.facets).toEqual([
      { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
    ]);
  });

  test('a row carries no id or status', async () => {
    const { t } = await setup();
    const result = await search(t, 'beach');
    expect(JSON.stringify(result)).not.toMatch(/_id|_creationTime|Id"|status|searchText/);
  });

  test('a league row’s seasons carry isFull, and a tournament row is full at its maximum teams', async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      const league = (await ctx.db.query('leagues').collect()).find(
        (entry) => entry.slug === 'sunday-reverse-coed-4s',
      )!;
      await insertSeason(ctx, league, { ...OPEN_SEASON, maxTeams: 2 }, 'published');
      const tournament = (await ctx.db.query('tournaments').collect())[0];
      await ctx.db.patch('tournaments', tournament._id, { teamCount: 2 });
    });
    await setTeamCounts(t, { 'summer-2027': { teamCount: 2 } });
    const rows = (await search(t, 'beach')).rows;
    const league = rows.find((row) => row.type === 'league' && row.name.startsWith('Sunday'));
    expect(league?.type === 'league' && league.seasons[0].isFull).toBe(true);
    const tournament = rows.find((row) => row.type === 'tournament');
    expect(tournament?.type === 'tournament' && tournament.isFull).toBe(true);
  });

  test('a sport filter reads only that sport', async () => {
    const { t, gulf } = await setup();
    await publishedTournament(t, gulf, {
      ...BEACH_OPEN,
      name: 'Gulf Coast Soccer Cup',
      slug: 'gulf-coast-soccer-cup',
      sport: 'soccer',
      division: defaultDivision('soccer'),
    });
    const result = await t.query(api.search.programs, { q: 'gulf', sport: 'soccer' });
    expect(names(result)).toEqual(['Gulf Coast Soccer Cup']);
  });

  test('a division filter narrows the rows and the type counts', async () => {
    const { t } = await setup();
    const result = await t.query(api.search.programs, {
      q: 'beach',
      gender: ['coed'],
      ageGroup: ['u10'],
    });
    expect(result.rows).toEqual([]);
    expect(result.typeCounts).toEqual([]);
    expect(result.facets).toHaveLength(3);
  });
});

describe('search.programs with several words', () => {
  test('every row and every type count comes from a program whose text holds both words', async () => {
    const { t } = await setup();
    const result = await search(t, 'coed open');
    expect(names(result)).toEqual(['Gulf Coast Beach Open']);
    expect(result.typeCounts).toEqual([{ type: 'tournament', count: 1 }]);
    const none = await search(t, 'coed austin');
    expect(none.rows).toEqual([]);
    expect(none.typeCounts).toEqual([]);
  });

  test('lists at most 50 rows holding every word and says there are more', async () => {
    const { t, lakeshore } = await setup();
    await insertManyTournaments(t, lakeshore, SEARCH_RESULT_LIMIT + 1, 'alpha beta');
    await insertManyTournaments(t, lakeshore, 30, 'alpha');
    const result = await search(t, 'alpha beta');
    expect(result.rows).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(result.more).toBe(true);
    expect(result.rows.every((row) => row.name.endsWith('alpha beta'))).toBe(true);
  });

  test('reads no further than the scan limit', async () => {
    const { t, lakeshore } = await setup();
    await insertManyTournaments(t, lakeshore, SEARCH_SCAN_LIMIT, 'alpha');
    await insertManyTournaments(t, lakeshore, 5, 'alpha beta');
    expect(names(await search(t, 'alpha beta'))).toEqual([]);
  });
});

async function insertManyTournaments(
  t: Harness,
  organizationId: Id<'organizations'>,
  count: number,
  words: string,
) {
  await t.run(async (ctx) => {
    const start = (await ctx.db.query('programs').collect()).length;
    for (let i = start; i < start + count; i++) {
      const name = `Bulk ${i} ${words}`;
      const programId = await ctx.db.insert('programs', {
        organizationId,
        type: 'tournament',
        name,
        sortName: name.toLowerCase(),
        slug: `bulk-${i}`,
        sport: 'softball',
        status: 'published',
        locationIds: [],
        ...defaultDivision('softball'),
        searchText: name,
      });
      await ctx.db.insert('tournaments', {
        programId,
        organizationId,
        status: 'published',
        sport: 'softball',
        startDate: '2027-07-10',
        endDate: '2027-07-11',
        registrationDeadline: '2027-07-01',
        maximumTeams: 8,
        minimumRosterSize: 9,
        structure: 'bracket',
        bracketType: 'single',
      });
    }
  });
}

describe('search.programs suggestions', () => {
  test('offer the search that drops the word no program holds', async () => {
    const { t } = await setup();
    const result = await search(t, 'Coed Open Austin');
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toEqual(['Coed Open']);
  });

  test('count only programs of the chosen type, so a word only a league holds is not offered for camps', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, { name: 'Sand Camp', slug: 'sand-camp' });
    const forCamps = await searchWithCamps(t, 'sunday austin', { type: 'camp' });
    expect(forCamps.rows).toEqual([]);
    expect(forCamps.suggestions).toBeUndefined();
    const forLeagues = await searchWithCamps(t, 'sunday austin');
    expect(forLeagues.suggestions).toEqual(['sunday']);
    const campWord = await searchWithCamps(t, 'camp austin', { type: 'camp' });
    expect(campWord.suggestions).toEqual(['camp']);
  });

  test('are empty when programs hold every word but the type excludes them all', async () => {
    const { t } = await setup();
    const result = await search(t, 'beach open', { type: 'camp' });
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toBeUndefined();
  });

  test('are empty when programs hold every word but the division filters exclude them all', async () => {
    const { t } = await setup();
    const result = await t.query(api.search.programs, { q: 'beach open', ageGroup: ['u10'] });
    expect(result.rows).toEqual([]);
    expect(result.suggestions).toBeUndefined();
    expect(result.facets).toHaveLength(1);
  });
});

describe('search.programsBrowse', () => {
  const browse = (t: Harness, args: Record<string, unknown> = {}) =>
    t.query(api.search.programsBrowse, { page: 1, ...args });

  test('lists tournaments of a sport by name, with no query', async () => {
    const { t, gulf } = await setup();
    await publishedTournament(t, gulf, {
      ...BEACH_OPEN,
      name: 'Aloha Sand Classic',
      slug: 'aloha-sand-classic',
    });
    const result = await browse(t, { type: 'tournament', sport: 'beachVolleyball' });
    expect(names(result)).toEqual(['Aloha Sand Classic', 'Gulf Coast Beach Open']);
    expect(result.total).toBe(2);
    expect(result.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 2 },
    ]);
  });

  test('with no type lists leagues and tournaments together by name across organizations', async () => {
    const { t } = await setup();
    const result = await browse(t);
    expect(result.rows.map((row) => [row.type, row.name])).toEqual([
      ['tournament', 'Gulf Coast Beach Open'],
      ['league', 'Saturday Coed 6s'],
      ['league', 'Sunday Reverse Coed 4s'],
    ]);
  });

  test('never lists a draft', async () => {
    const { t, gulf } = await setup();
    await t.run(async (ctx) => {
      await insertDraftTournament(ctx, gulf, {
        ...BEACH_OPEN,
        name: 'Draft Open',
        slug: 'draft-open',
      });
    });
    expect(names(await browse(t))).not.toContain('Draft Open');
    expect(names(await browse(t))).not.toContain('Coed Draft');
  });

  test('a known type with no programs has no rows, and the other types keep their counts', async () => {
    const { t } = await setup();
    const result = await browse(t, { type: 'camp' });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
    ]);
  });

  test('pages five rows at a time and reads at most 200 per type', async () => {
    const { t, lakeshore } = await setup();
    await insertManyTournaments(t, lakeshore, 210, 'zebra');
    const first = await browse(t, { type: 'tournament' });
    expect(first.rows).toHaveLength(5);
    expect(first.pageCount).toBe(40);
    expect(first.total).toBe(200);
    const last = await browse(t, { type: 'tournament', page: 40 });
    expect(last.page).toBe(40);
    const beyond = await browse(t, { type: 'tournament', page: 41 });
    expect(beyond.page).toBe(1);
  });

  test('with no sport, lists the first 200 by name across sports, not the first sport’s 200', async () => {
    const { t, lakeshore } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 201; i++) {
        const name = `Zed ${String(i).padStart(3, '0')}`;
        await insertLeagueWithProgram(ctx, {
          organizationId: lakeshore,
          name,
          slug: name.toLowerCase().replace(' ', '-'),
          sport: 'beachVolleyball',
          ...defaultDivision('beachVolleyball'),
          locationIds: [],
          status: 'published',
          searchText: name,
        });
      }
      await insertLeagueWithProgram(ctx, {
        organizationId: lakeshore,
        name: 'Aaa Soccer',
        slug: 'aaa-soccer',
        sport: 'soccer',
        ...defaultDivision('soccer'),
        locationIds: [],
        status: 'published',
        searchText: 'Aaa Soccer',
      });
    });
    const first = await browse(t, { type: 'league' });
    expect(first.total).toBe(200);
    expect(first.rows.map((row) => row.name)).toEqual([
      'Aaa Soccer',
      'Saturday Coed 6s',
      'Sunday Reverse Coed 4s',
      'Zed 000',
      'Zed 001',
    ]);
    const last = await browse(t, { type: 'league', page: 40 });
    expect(last.rows.map((row) => row.name)).toEqual([
      'Zed 192',
      'Zed 193',
      'Zed 194',
      'Zed 195',
      'Zed 196',
    ]);
  });

  test('a division filter narrows the rows and the facets are those of the type', async () => {
    const { t } = await setup();
    const result = await browse(t, { type: 'league', gender: ['coed'], playersPerSide: undefined });
    expect(result.total).toBe(2);
    const none = await browse(t, { type: 'tournament', ageGroup: ['u10'] });
    expect(none.rows).toEqual([]);
    expect(none.facets).toHaveLength(1);
  });
});

interface CampSessionDates {
  name: string;
  startInDays: number;
  endInDays: number;
  places?: number;
}

const FROM_TODAY = () => dateAtUtcMinus12(Date.now());
const inDays = (days: number) => addCalendarDays(FROM_TODAY(), days);

const JUNIOR_CAMP = {
  name: 'Junior Beach Volleyball Camp',
  slug: 'junior-beach-volleyball-camp',
  sessions: [{ name: 'Week 1', startInDays: 14, endInDays: 18 }] as CampSessionDates[],
};

async function insertCamp(
  t: Harness,
  organizationId: Id<'organizations'>,
  camp: Partial<typeof JUNIOR_CAMP> & {
    published?: boolean;
    sport?: 'beachVolleyball' | 'soccer';
  } = {},
) {
  const { published = true, sport = 'beachVolleyball', ...rest } = camp;
  const { name, slug, sessions } = { ...JUNIOR_CAMP, ...rest };
  await t.run(async (ctx) => {
    const location = (await ctx.db.query('locations').collect()).find(
      (row) => row.organizationId === organizationId,
    )!;
    const campId = await insertDraftCamp(ctx, organizationId, {
      name,
      slug,
      sport,
      locationIds: [location._id],
      minimumAge: 9,
      maximumAge: 14,
    });
    for (const session of sessions) {
      await insertCampSession(ctx, (await ctx.db.get('camps', campId))!, {
        name: session.name,
        startDate: inDays(session.startInDays),
        endDate: inDays(session.endInDays),
        places: session.places ?? 20,
        registrationDeadline: inDays(session.startInDays - 3),
      });
    }
    if (published) await publishCamp(ctx, (await ctx.db.get('camps', campId))!);
  });
}

const withCamps = { withCamps: true } as const;

const searchWithCamps = (t: Harness, q: string, rest: Record<string, unknown> = {}) =>
  t.query(api.search.programs, { q, ...withCamps, ...rest });

const browseWithCamps = (t: Harness, rest: Record<string, unknown> = {}) =>
  t.query(api.search.programsBrowse, { page: 1, ...withCamps, ...rest });

describe('search.programs and camps', () => {
  test('finds a camp by a word of its name, with its ages, locations, and the sessions that have not ended', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, {
      sessions: [
        { name: 'Week 0', startInDays: -9, endInDays: -5 },
        { name: 'Week 1', startInDays: 14, endInDays: 18 },
        { name: 'Week 2', startInDays: 21, endInDays: 25, places: 8 },
      ],
    });
    const result = await searchWithCamps(t, 'junior');
    expect(result.rows).toEqual([
      {
        type: 'camp',
        organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf' },
        name: 'Junior Beach Volleyball Camp',
        slug: 'junior-beach-volleyball-camp',
        sportName: 'Beach volleyball',
        minimumAge: 9,
        maximumAge: 14,
        locationNames: ['North Beach Sand Courts'],
        lastSessionEndDate: inDays(25),
        sessions: [
          {
            name: 'Week 1',
            startDate: inDays(14),
            endDate: inDays(18),
            registrationDeadline: inDays(11),
            placesLeft: 20,
          },
          {
            name: 'Week 2',
            startDate: inDays(21),
            endDate: inDays(25),
            registrationDeadline: inDays(18),
            placesLeft: 8,
          },
        ],
      },
    ]);
    expect(result.typeCounts).toEqual([{ type: 'camp', count: 1 }]);
  });

  test('finds a camp by its sport name, its organization, its location, and its City, state', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    for (const q of ['volleyball', 'gulf', 'north beach', 'corpus christi']) {
      expect(names(await searchWithCamps(t, q, { type: 'camp' })), q).toEqual([
        'Junior Beach Volleyball Camp',
      ]);
    }
  });

  test('counts a camp among the types, and a search for a league word counts no camp', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    expect((await searchWithCamps(t, 'beach')).typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
      { type: 'camp', count: 1 },
    ]);
    expect((await searchWithCamps(t, 'sunday')).typeCounts).toEqual([{ type: 'league', count: 1 }]);
  });

  test('a search only a camp matches, with the league type chosen, has no rows and counts the camp', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    const result = await searchWithCamps(t, 'junior', { type: 'league' });
    expect(result.rows).toEqual([]);
    expect(result.typeCounts).toEqual([{ type: 'camp', count: 1 }]);
  });

  test('the division words of a camp’s program row are not in its text, after create, publish, a location rename, and a City, state change', async () => {
    const { t, gulf } = await setup();
    const campText = () =>
      t.run(async (ctx) => {
        const camp = (await ctx.db.query('camps').collect())[0];
        return (await ctx.db.get('programs', camp.programId))!.searchText;
      });
    const divisionSearchesFindNothing = async () => {
      expect(names(await searchWithCamps(t, 'adult', { type: 'camp' }))).toEqual([]);
      expect(names(await searchWithCamps(t, 'coed', { type: 'camp' }))).toEqual([]);
    };
    await insertCamp(t, gulf, { published: false });
    expect(await campText()).not.toMatch(/coed|adult/i);

    await t.run(async (ctx) => {
      await publishCamp(ctx, (await ctx.db.query('camps').collect())[0]);
    });
    expect(names(await searchWithCamps(t, 'junior', { type: 'camp' }))).toHaveLength(1);
    await divisionSearchesFindNothing();

    await t.run(async (ctx) => {
      const location = (await ctx.db.query('locations').collect())[0];
      await updateLocation(ctx, location, { name: 'Omega Courts', address: location.address });
    });
    expect(names(await searchWithCamps(t, 'omega', { type: 'camp' }))).toHaveLength(1);
    await divisionSearchesFindNothing();

    await t.run((ctx) => updateOrganizationCityState(ctx, gulf, 'Galveston, TX'));
    expect(names(await searchWithCamps(t, 'galveston', { type: 'camp' }))).toHaveLength(1);
    await divisionSearchesFindNothing();
  });

  test('a camp stays listed and counted under a division filter, which narrows leagues and tournaments', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    const filtered = await searchWithCamps(t, 'beach', { gender: ['coed'], ageGroup: ['u12'] });
    expect(filtered.rows.map((row) => [row.type, row.name])).toEqual([
      ['camp', 'Junior Beach Volleyball Camp'],
    ]);
    expect(filtered.typeCounts).toEqual([{ type: 'camp', count: 1 }]);
    const coed = await searchWithCamps(t, 'beach', { gender: ['coed'] });
    expect(coed.rows.map((row) => row.type).sort()).toEqual([
      'camp',
      'league',
      'league',
      'tournament',
    ]);
    expect(coed.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
      { type: 'camp', count: 1 },
    ]);
  });

  test('a camp adds no division facet, so the camp type offers no division filter', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    expect((await searchWithCamps(t, 'junior', { type: 'camp' })).facets).toEqual([]);
    expect((await searchWithCamps(t, 'beach')).facets).toHaveLength(3);
    expect((await browseWithCamps(t, { type: 'camp' })).facets).toEqual([]);
    expect((await browseWithCamps(t)).facets).toHaveLength(3);
  });

  test('never lists or counts a draft camp, in a search or a browse, and a camp row holds no id', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, {
      name: 'Fall Break Camp',
      slug: 'fall-break-camp',
      sessions: [],
      published: false,
    });
    await insertCamp(t, gulf);
    const found = await searchWithCamps(t, 'fall');
    expect(found.rows).toEqual([]);
    expect(found.typeCounts).toEqual([]);
    const campsBrowse = await browseWithCamps(t, { type: 'camp' });
    expect(names(campsBrowse)).toEqual(['Junior Beach Volleyball Camp']);
    expect(campsBrowse.total).toBe(1);
    expect(campsBrowse.typeCounts.find(({ type }) => type === 'camp')?.count).toBe(1);
    expect(JSON.stringify([await searchWithCamps(t, 'junior'), campsBrowse])).not.toMatch(
      /_id|_creationTime|Id"|status|searchText|programId|campId|sessionId/,
    );
  });

  test('drops a camp whose last session has ended before the counts, and keeps one that ends today', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, {
      name: 'Ended Junior Camp',
      slug: 'ended-junior-camp',
      sessions: [{ name: 'Week 1', startInDays: -9, endInDays: -1 }],
    });
    await insertCamp(t, gulf, {
      name: 'Today Junior Camp',
      slug: 'today-junior-camp',
      sessions: [{ name: 'Week 1', startInDays: -4, endInDays: 0 }],
    });
    const result = await searchWithCamps(t, 'junior');
    expect(names(result)).toEqual(['Today Junior Camp']);
    expect(result.typeCounts).toEqual([{ type: 'camp', count: 1 }]);
  });

  test('a search only an ended camp matches has no row, no count, and no suggestion', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, {
      name: 'Ended Zebra Camp',
      slug: 'ended-zebra-camp',
      sessions: [{ name: 'Week 1', startInDays: -9, endInDays: -1 }],
    });
    const result = await searchWithCamps(t, 'zebra');
    expect(result).toEqual({ rows: [], more: false, facets: [], typeCounts: [] });
  });

  test('drops a published camp with no session', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, {
      name: 'Empty Junior Camp',
      slug: 'empty-junior-camp',
      sessions: [],
    });
    expect((await searchWithCamps(t, 'junior')).typeCounts).toEqual([]);
    expect((await browseWithCamps(t, { type: 'camp' })).total).toBe(0);
  });

  test('a call with the previous release’s arguments gets no camp row and no camp in the counts', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    const previous = await search(t, 'beach');
    expect(previous.rows.map((row) => row.type).sort()).toEqual(['league', 'league', 'tournament']);
    expect(previous.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
    ]);
    const onlyCamp = await search(t, 'junior');
    expect(onlyCamp).toEqual({ rows: [], more: false, facets: [], typeCounts: [] });
    const camps = await search(t, 'junior', { type: 'camp' });
    expect(camps.rows).toEqual([]);
    expect(camps.typeCounts).toEqual([]);
    expect((await search(t, 'junior austin')).suggestions).toBeUndefined();
  });

  test('a camp does not push a league or a tournament out of the previous release’s counts or its suggestions', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, { name: 'Sunday Camp', slug: 'sunday-camp' });
    const result = await search(t, 'sunday austin');
    expect(result.suggestions).toEqual(['sunday']);
  });
});

describe('search.programsBrowse and camps', () => {
  test('lists a published camp of a sport by name, with its row and the camp count', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    const result = await browseWithCamps(t, { type: 'camp', sport: 'beachVolleyball' });
    expect(names(result)).toEqual(['Junior Beach Volleyball Camp']);
    expect(result.rows[0]).toMatchObject({
      type: 'camp',
      minimumAge: 9,
      maximumAge: 14,
      sessions: [{ name: 'Week 1' }],
    });
    expect(result.total).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
      { type: 'camp', count: 1 },
    ]);
  });

  test('with no type lists camps with leagues and tournaments by name', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    const result = await browseWithCamps(t);
    expect(result.rows.map((row) => [row.type, row.name])).toEqual([
      ['tournament', 'Gulf Coast Beach Open'],
      ['camp', 'Junior Beach Volleyball Camp'],
      ['league', 'Saturday Coed 6s'],
      ['league', 'Sunday Reverse Coed 4s'],
    ]);
    expect(result.total).toBe(4);
  });

  test('a camp of another sport is not listed for a sport', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, {
      name: 'Bayside Soccer Camp',
      slug: 'bayside-soccer-camp',
      sport: 'soccer',
    });
    expect(names(await browseWithCamps(t, { type: 'camp', sport: 'beachVolleyball' }))).toEqual([]);
    expect(names(await browseWithCamps(t, { type: 'camp', sport: 'soccer' }))).toEqual([
      'Bayside Soccer Camp',
    ]);
  });

  test('a camp stays listed and counted under a division filter, in the rows, the total, and the counts', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf);
    const result = await browseWithCamps(t, { gender: ['coed'], ageGroup: ['u12'] });
    expect(result.rows.map((row) => row.type)).toEqual(['camp']);
    expect(result.total).toBe(1);
    expect(result.typeCounts).toEqual([{ type: 'camp', count: 1 }]);
    const camps = await browseWithCamps(t, { type: 'camp', ageGroup: ['u12'] });
    expect(camps.total).toBe(1);
    expect(camps.facets).toEqual([]);
  });

  test('drops an ended camp before the total, the page count, and the type counts', async () => {
    const { t, gulf } = await setup();
    await insertCamp(t, gulf, {
      name: 'Ended Junior Camp',
      slug: 'ended-junior-camp',
      sessions: [{ name: 'Week 1', startInDays: -9, endInDays: -1 }],
    });
    const result = await browseWithCamps(t, { type: 'camp' });
    expect(result).toMatchObject({ rows: [], total: 0, pageCount: 0 });
    expect(result.typeCounts.map(({ type }) => type)).toEqual(['league', 'tournament']);
    expect((await browseWithCamps(t)).total).toBe(3);
  });

  test('a call with the previous release’s arguments gets no camp row, no camp count, and none in the total or page count', async () => {
    const { t, gulf } = await setup();
    for (let i = 0; i < 6; i++) {
      await insertCamp(t, gulf, { name: `Camp ${i}`, slug: `camp-${i}` });
    }
    const previous = await t.query(api.search.programsBrowse, { page: 1 });
    expect(previous.rows.map((row) => row.type).sort()).toEqual(['league', 'league', 'tournament']);
    expect(previous.total).toBe(3);
    expect(previous.pageCount).toBe(1);
    expect(previous.typeCounts).toEqual([
      { type: 'league', count: 2 },
      { type: 'tournament', count: 1 },
    ]);
    const camps = await t.query(api.search.programsBrowse, { page: 1, type: 'camp' });
    expect(camps).toMatchObject({ rows: [], total: 0, pageCount: 0 });
    expect(camps.typeCounts).toEqual(previous.typeCounts);
    expect((await browseWithCamps(t)).total).toBe(9);
    expect((await browseWithCamps(t)).pageCount).toBe(2);
  });
});
