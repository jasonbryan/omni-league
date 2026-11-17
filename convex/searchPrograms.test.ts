/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  defaultDivision,
  insertDraftTournament,
  insertSeason,
  insertTenant,
  publishTournament,
  type NewSeason,
  type NewTournament,
} from './lib/tenantWrites';
import schema from './schema';
import { SEARCH_RESULT_LIMIT, SEARCH_SCAN_LIMIT } from './search';
import { insertCampProgram, modules, setTeamCounts } from './test.setup';

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
    await t.run(async (ctx) => {
      const programId = await insertCampProgram(ctx, gulf, 'Sand Camp', 'sand-camp');
      await ctx.db.patch('programs', programId, { searchText: 'Sand Camp Gulf Beach' });
    });
    const forCamps = await search(t, 'sunday austin', { type: 'camp' });
    expect(forCamps.rows).toEqual([]);
    expect(forCamps.suggestions).toBeUndefined();
    const forLeagues = await search(t, 'sunday austin');
    expect(forLeagues.suggestions).toEqual(['sunday']);
    const campWord = await search(t, 'camp austin', { type: 'camp' });
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

  test('a division filter narrows the rows and the facets are those of the type', async () => {
    const { t } = await setup();
    const result = await browse(t, { type: 'league', gender: ['coed'], playersPerSide: undefined });
    expect(result.total).toBe(2);
    const none = await browse(t, { type: 'tournament', ageGroup: ['u10'] });
    expect(none.rows).toEqual([]);
    expect(none.facets).toHaveLength(1);
  });
});
