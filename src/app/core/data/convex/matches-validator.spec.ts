import { v } from 'convex/values';
import { getPublicPageReturns } from '../../../../../convex/lib/publicPage';
import { matchesValidator } from './matches-validator';

const PAGE = {
  name: 'Gulf Coast',
  slug: 'gulf-coast',
  locations: [{ name: 'Bayside', address: '4410 Ocean Dr' }],
  leagues: [{ name: 'Coed 2s', sportName: 'Beach volleyball', locationNames: ['Bayside'] }],
};

describe('matchesValidator', () => {
  it('accepts a getPublicPage result, empty lists included, and null', () => {
    expect(matchesValidator(PAGE, getPublicPageReturns)).toBe(true);
    expect(matchesValidator({ ...PAGE, leagues: [], locations: [] }, getPublicPageReturns)).toBe(
      true,
    );
    expect(matchesValidator(null, getPublicPageReturns)).toBe(true);
  });

  it.each([
    ['an object missing fields', { name: 'Shape Only' }],
    ['a number', 42],
    ['a string', 'x'],
    ['an array', [1, 2]],
    ['undefined', undefined],
    ['a list that is not an array', { ...PAGE, leagues: 'none' }],
    ['a list item of the wrong shape', { ...PAGE, locations: [{ name: 'Bayside' }] }],
    ['a nested string that is a number', { ...PAGE, leagues: [{ ...PAGE.leagues[0], name: 3 }] }],
    [
      'a nested array item of the wrong type',
      { ...PAGE, leagues: [{ ...PAGE.leagues[0], locationNames: [1] }] },
    ],
  ])('rejects %s for getPublicPage', (_, value) => {
    expect(matchesValidator(value, getPublicPageReturns)).toBe(false);
  });

  it('accepts extra fields, so a copy from a build that added a field still reads', () => {
    expect(matchesValidator({ ...PAGE, leagueCount: 1 }, getPublicPageReturns)).toBe(true);
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
