import { v } from 'convex/values';
import {
  getPublicPageReturns,
  publicLeaguesValidator,
  publicLocationsValidator,
} from '../../../../../convex/lib/publicPage';
import { matchesValidator } from './matches-validator';

const PAGE = {
  name: 'Gulf Coast',
  slug: 'gulf-coast',
  leagueCount: 1,
  locationCount: 1,
  sportCount: 1,
  sports: [
    {
      key: 'beachVolleyball',
      segment: 'beach-volleyball',
      name: 'Beach volleyball',
      leagueCount: 1,
      locationCount: 1,
    },
  ],
};

const LOCATION = { name: 'Bayside', address: '4410 Ocean Dr' };
const LEAGUE = {
  name: 'Coed 2s',
  slug: 'coed-2s',
  sportName: 'Beach volleyball',
  locationNames: ['Bayside'],
};
const LIST = { page: 1, pageCount: 1, total: 1 };

describe('matchesValidator', () => {
  it('accepts a getPublicPage result and null', () => {
    expect(matchesValidator(PAGE, getPublicPageReturns)).toBe(true);
    expect(
      matchesValidator({ ...PAGE, leagueCount: 0, locationCount: 0 }, getPublicPageReturns),
    ).toBe(true);
    expect(matchesValidator(null, getPublicPageReturns)).toBe(true);
  });

  it.each([
    ['an object missing fields', { name: 'Shape Only' }],
    ['a number', 42],
    ['a string', 'x'],
    ['an array', [1, 2]],
    ['undefined', undefined],
    ['a total that is a string', { ...PAGE, leagueCount: '1' }],
    ['a missing total', { name: PAGE.name, slug: PAGE.slug, leagueCount: 1, locationCount: 1 }],
    [
      'the shape before issue 101 (totals, no sports)',
      { name: PAGE.name, slug: PAGE.slug, leagueCount: 1, locationCount: 1, sportCount: 1 },
    ],
    [
      'a sport key that is not a sport',
      { ...PAGE, sports: [{ ...PAGE.sports[0], key: 'hockey' }] },
    ],
    ['a sport missing its segment', { ...PAGE, sports: [{ key: 'soccer', name: 'Soccer' }] }],
    [
      'the earlier shape with lists and no totals',
      { name: PAGE.name, slug: PAGE.slug, locations: [LOCATION], leagues: [LEAGUE] },
    ],
  ])('rejects %s for getPublicPage', (_, value) => {
    expect(matchesValidator(value, getPublicPageReturns)).toBe(false);
  });

  it('accepts extra fields, so a copy from a build that added a field still reads', () => {
    expect(matchesValidator({ ...PAGE, seasonCount: 1 }, getPublicPageReturns)).toBe(true);
  });

  it('accepts a page of a list, an empty one included', () => {
    expect(matchesValidator({ rows: [LOCATION], ...LIST }, publicLocationsValidator)).toBe(true);
    expect(matchesValidator({ rows: [LEAGUE], ...LIST }, publicLeaguesValidator)).toBe(true);
    const empty = { rows: [], page: 1, pageCount: 0, total: 0 };
    expect(matchesValidator(empty, publicLocationsValidator)).toBe(true);
    expect(matchesValidator(empty, publicLeaguesValidator)).toBe(true);
  });

  it.each([
    ['an object missing fields', { rows: [LEAGUE] }],
    ['rows that are not an array', { rows: 'none', ...LIST }],
    ['a league of the wrong shape', { rows: [{ name: 'Coed 2s' }], ...LIST }],
    ['a league name that is a number', { rows: [{ ...LEAGUE, name: 3 }], ...LIST }],
    [
      'a location name that is not a string',
      { rows: [{ ...LEAGUE, locationNames: [1] }], ...LIST },
    ],
    ['a page that is a string', { rows: [LEAGUE], ...LIST, page: '1' }],
    ['null', null],
  ])('rejects %s for listPublicLeagues', (_, value) => {
    expect(matchesValidator(value, publicLeaguesValidator)).toBe(false);
  });

  it.each([
    ['a location missing its address', { rows: [{ name: 'Bayside' }], ...LIST }],
    ['a league row, which has no address', { rows: [LEAGUE], ...LIST }],
    ['a total that is missing', { rows: [LOCATION], page: 1, pageCount: 1 }],
    ['null', null],
  ])('rejects %s for listPublicLocations', (_, value) => {
    expect(matchesValidator(value, publicLocationsValidator)).toBe(false);
  });

  it('checks optional fields only when present', () => {
    const validator = v.object({ a: v.string(), b: v.optional(v.number()) });
    expect(matchesValidator({ a: 'x' }, validator)).toBe(true);
    expect(matchesValidator({ a: 'x', b: 1 }, validator)).toBe(true);
    expect(matchesValidator({ a: 'x', b: 'y' }, validator)).toBe(false);
    expect(matchesValidator({ b: 1 }, validator)).toBe(false);
  });

  it('does not take a required field from the prototype', () => {
    expect(matchesValidator({}, v.object({ toString: v.any() }))).toBe(false);
  });

  it('checks every other validator kind', () => {
    const cases: [Parameters<typeof matchesValidator>[1], unknown[], unknown[]][] = [
      [v.boolean(), [true, false], [0, 'true', null]],
      [v.number(), [0, 1.5, -2], ['1', 1n, null]],
      [v.int64(), [1n], [1, '1']],
      [v.id('leagues'), ['k57abc'], [1, null]],
      [v.bytes(), [new ArrayBuffer(2)], [[1, 2], 'AQI=']],
      [v.literal('soccer'), ['soccer'], ['softball', 1]],
      [v.literal(2n), [2n], [2]],
      [v.any(), [1, 'x', null, [1], { a: 1 }], []],
      [v.record(v.string(), v.number()), [{}, { a: 1, b: 2 }], [{ a: 'x' }, [1], null]],
      [v.union(v.string(), v.number()), ['a', 1], [true, null]],
      [v.array(v.null()), [[], [null]], [[0], {}]],
      [v.object({}), [{}, { extra: 1 }], [[], null, new ArrayBuffer(1)]],
    ];
    for (const [validator, accepted, rejected] of cases) {
      for (const value of accepted) {
        expect(matchesValidator(value, validator), `${validator.kind} accepts`).toBe(true);
      }
      for (const value of rejected) {
        expect(matchesValidator(value, validator), `${validator.kind} rejects`).toBe(false);
      }
    }
  });

  it('rejects a validator kind it does not know', () => {
    const unknownKind = { kind: 'somethingNew', isOptional: 'required' } as unknown as Parameters<
      typeof matchesValidator
    >[1];
    expect(matchesValidator('x', unknownKind)).toBe(false);
  });
});
