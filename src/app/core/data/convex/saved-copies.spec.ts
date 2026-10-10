import { TestBed } from '@angular/core/testing';
import { getFunctionName, makeFunctionReference } from 'convex/server';
import { convexToJson } from 'convex/values';
import { api } from '../../../../../convex/_generated/api';
import { getPublicPageReturns } from '../../../../../convex/lib/publicPage';
import { OFFLINE_SAVED_QUERIES } from './offline-saved-queries';
import {
  ConvexSavedCopies,
  SAVED_COPY_MAX_AGE_MS,
  SAVED_COPY_MAX_ENTRIES,
  SAVED_COPY_MAX_FUTURE_MS,
  SAVED_COPY_MAX_TOTAL_LENGTH,
  savedCopyKey,
} from './saved-copies';
import { plantSavedCopy } from './testing/saved-copy';

const getPublicPage = api.organizations.getPublicPage;
/** Same function name as the listed query, with free-form args, for the key-order cases. */
const listedAnyArgs = makeFunctionReference<'query', Record<string, unknown>, unknown>(
  'organizations:getPublicPage',
);
/** A query that is not on the allow-list (a signed-in query, for example). */
const myTeams = makeFunctionReference<'query', { leagueId: string }, unknown>('teams:mine');

const START = Date.UTC(2026, 9, 10, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const VERSION = OFFLINE_SAVED_QUERIES[0].version;

/** A `getPublicPage` result with this name and no leagues or locations. */
const page = (name: string) => ({ name, slug: 'org', leagues: [], locations: [] });

const savedKeys = () =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith('cvx-saved:'))
    .sort();

describe('ConvexSavedCopies', () => {
  let store: ConvexSavedCopies;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    store = TestBed.inject(ConvexSavedCopies);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('lists organizations:getPublicPage, a deliberately public, caller-independent query, with its own returns validator', () => {
    expect(OFFLINE_SAVED_QUERIES).toHaveLength(1);
    expect(getFunctionName(OFFLINE_SAVED_QUERIES[0].query)).toBe('organizations:getPublicPage');
    // The very validator the Convex function declares, not a restated copy.
    expect(OFFLINE_SAVED_QUERIES[0].returns).toBe(getPublicPageReturns);
    expect(Number.isInteger(VERSION)).toBe(true);
  });

  describe('key', () => {
    it('is cvx-saved:<function>:<JSON args with sorted keys>, nested objects included', () => {
      expect(savedCopyKey(getPublicPage, { slug: 'gulf-coast' })).toBe(
        'cvx-saved:organizations:getPublicPage:{"slug":"gulf-coast"}',
      );
      expect(savedCopyKey(listedAnyArgs, { b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] } })).toBe(
        'cvx-saved:organizations:getPublicPage:{"a":{"c":[{"e":2,"f":1}],"d":2},"b":1}',
      );
    });

    it('uses one key for the same args written in two key orders', () => {
      store.write(listedAnyArgs, { season: 's1', page: 2 }, page('One'));
      vi.setSystemTime(START + 1000);
      store.write(listedAnyArgs, { page: 2, season: 's1' }, page('Two'));
      expect(savedKeys()).toEqual([
        'cvx-saved:organizations:getPublicPage:{"page":2,"season":"s1"}',
      ]);
      expect(store.read(listedAnyArgs, { season: 's1', page: 2 })).toEqual({
        value: page('Two'),
        savedAt: START + 1000,
      });
    });
  });

  describe('write', () => {
    it('stores { v: convexToJson(result), savedAt, usedAt, version } for a listed query', () => {
      const result = {
        name: 'Gulf Coast',
        slug: 'gulf-coast',
        locations: [{ name: 'Bayside', address: '4410 Ocean Dr' }],
        leagues: [{ name: 'Coed 2s', sportName: 'Beach volleyball', locationNames: ['Bayside'] }],
      };
      store.write(getPublicPage, { slug: 'gulf-coast' }, result);
      const raw = localStorage.getItem(
        'cvx-saved:organizations:getPublicPage:{"slug":"gulf-coast"}',
      );
      expect(JSON.parse(raw ?? 'null')).toEqual({
        v: convexToJson(result),
        savedAt: START,
        usedAt: START,
        version: VERSION,
      });
      expect(store.read(getPublicPage, { slug: 'gulf-coast' })).toEqual({
        value: result,
        savedAt: START,
      });
    });

    it('writes nothing for a query that is not on the allow-list, and never reads one', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      store.write(myTeams, { leagueId: 'a' }, ['Sharks']);
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);

      // An entry planted under that key by anything else is not used either.
      localStorage.setItem(
        'cvx-saved:teams:mine:{"leagueId":"a"}',
        JSON.stringify({ v: ['Sharks'], savedAt: START, usedAt: START, version: VERSION }),
      );
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      expect(store.read(myTeams, { leagueId: 'a' })).toBeUndefined();
      expect(getItem).not.toHaveBeenCalled();
    });

    it('removes the entry when the live result is null or undefined', () => {
      store.write(getPublicPage, { slug: 'a' }, page('A'));
      store.write(getPublicPage, { slug: 'b' }, page('B'));
      expect(savedKeys()).toHaveLength(2);
      store.write(getPublicPage, { slug: 'a' }, null);
      store.write(getPublicPage, { slug: 'b' }, undefined);
      expect(savedKeys()).toEqual([]);
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
    });

    it(`keeps at most ${SAVED_COPY_MAX_ENTRIES} entries, removing the least recently used first`, () => {
      for (let i = 0; i < SAVED_COPY_MAX_ENTRIES; i++) {
        vi.setSystemTime(START + i * 1000);
        store.write(getPublicPage, { slug: `org-${i}` }, page(`Org ${i}`));
      }
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES);

      // Reading org-0 makes it the most recently used, so org-1 is now the least recently used.
      vi.setSystemTime(START + 100_000);
      expect(store.read(getPublicPage, { slug: 'org-0' })?.value).toEqual(page('Org 0'));

      vi.setSystemTime(START + 200_000);
      store.write(getPublicPage, { slug: 'org-new' }, page('New'));
      const keys = savedKeys();
      expect(keys).toHaveLength(SAVED_COPY_MAX_ENTRIES);
      expect(keys).toContain(savedCopyKey(getPublicPage, { slug: 'org-0' }));
      expect(keys).toContain(savedCopyKey(getPublicPage, { slug: 'org-new' }));
      expect(keys).not.toContain(savedCopyKey(getPublicPage, { slug: 'org-1' }));

      // One more: org-2 goes next.
      vi.setSystemTime(START + 300_000);
      store.write(getPublicPage, { slug: 'org-newer' }, page('Newer'));
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES);
      expect(savedKeys()).not.toContain(savedCopyKey(getPublicPage, { slug: 'org-2' }));
    });

    it(`given ${String(SAVED_COPY_MAX_ENTRIES + 1)} saved results, one more write removes the least recently used down to the limit`, () => {
      // 51 entries already in storage (for example written by another tab at the same moment).
      for (let i = 0; i <= SAVED_COPY_MAX_ENTRIES; i++) {
        const at = START + i * 1000;
        localStorage.setItem(
          savedCopyKey(getPublicPage, { slug: `org-${String(i)}` }),
          JSON.stringify({
            v: page(`Org ${String(i)}`),
            savedAt: at,
            usedAt: at,
            version: VERSION,
          }),
        );
      }
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES + 1);

      vi.setSystemTime(START + 100_000);
      store.write(getPublicPage, { slug: 'org-new' }, page('New'));
      const keys = savedKeys();
      expect(keys).toHaveLength(SAVED_COPY_MAX_ENTRIES);
      expect(keys).toContain(savedCopyKey(getPublicPage, { slug: 'org-new' }));
      // The two least recently used go; the next one stays.
      expect(keys).not.toContain(savedCopyKey(getPublicPage, { slug: 'org-0' }));
      expect(keys).not.toContain(savedCopyKey(getPublicPage, { slug: 'org-1' }));
      expect(keys).toContain(savedCopyKey(getPublicPage, { slug: 'org-2' }));
      expect(keys).toContain(
        savedCopyKey(getPublicPage, { slug: `org-${String(SAVED_COPY_MAX_ENTRIES)}` }),
      );
    });

    it('updating an existing entry removes nothing else', () => {
      for (let i = 0; i < SAVED_COPY_MAX_ENTRIES; i++) {
        vi.setSystemTime(START + i * 1000);
        store.write(getPublicPage, { slug: `org-${i}` }, page(`Org ${i}`));
      }
      vi.setSystemTime(START + 100_000);
      store.write(getPublicPage, { slug: 'org-10' }, page('Org 10 renamed'));
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES);
      expect(store.read(getPublicPage, { slug: 'org-10' })).toEqual({
        value: page('Org 10 renamed'),
        savedAt: START + 100_000,
      });
    });

    it('does not save a result larger than the size budget, and drops the older copy of it', () => {
      store.write(getPublicPage, { slug: 'big' }, page('Small'));
      const huge = page('x'.repeat(SAVED_COPY_MAX_TOTAL_LENGTH));
      store.write(getPublicPage, { slug: 'big' }, huge);
      expect(savedKeys()).toEqual([]);
      expect(store.read(getPublicPage, { slug: 'big' })).toBeUndefined();
    });

    it('removes the least recently used entries until all of them fit the size budget', () => {
      const quarter = page('x'.repeat(Math.floor(SAVED_COPY_MAX_TOTAL_LENGTH / 4)));
      for (let i = 0; i < 4; i++) {
        vi.setSystemTime(START + i * 1000);
        store.write(getPublicPage, { slug: `q-${i}` }, quarter);
      }
      // Four quarters plus their keys and fields exceed the budget: the oldest goes.
      expect(savedKeys()).toEqual([
        savedCopyKey(getPublicPage, { slug: 'q-1' }),
        savedCopyKey(getPublicPage, { slug: 'q-2' }),
        savedCopyKey(getPublicPage, { slug: 'q-3' }),
      ]);
    });

    it('does not save a live result that does not match the query result, and removes the older copy', () => {
      store.write(getPublicPage, { slug: 'a' }, page('A'));
      store.write(getPublicPage, { slug: 'a' }, { name: 'Shape Only' });
      expect(savedKeys()).toEqual([]);
      store.write(getPublicPage, { slug: 'a' }, 42);
      expect(savedKeys()).toEqual([]);
    });

    it('removes entries of another version, of an unlisted query, or saved in the future when it makes room', () => {
      plantSavedCopy(getPublicPage, { slug: 'old-version' }, page('Old'), START, {
        version: VERSION + 1,
      });
      plantSavedCopy(getPublicPage, { slug: 'future' }, page('Future'), START + DAY);
      localStorage.setItem(
        'cvx-saved:teams:mine:{"leagueId":"a"}',
        JSON.stringify({ v: ['Sharks'], savedAt: START, usedAt: START, version: VERSION }),
      );
      localStorage.setItem('cvx-savedX-not-ours', 'kept');
      store.write(getPublicPage, { slug: 'new' }, page('New'));
      expect(savedKeys()).toEqual([savedCopyKey(getPublicPage, { slug: 'new' })]);
      expect(localStorage.getItem('cvx-savedX-not-ours')).toBe('kept');
    });

    it('removes expired entries when it makes room', () => {
      store.write(getPublicPage, { slug: 'old' }, page('Old'));
      vi.setSystemTime(START + SAVED_COPY_MAX_AGE_MS + 1);
      store.write(getPublicPage, { slug: 'new' }, page('New'));
      expect(savedKeys()).toEqual([savedCopyKey(getPublicPage, { slug: 'new' })]);
    });
  });

  describe('read', () => {
    it('uses an entry up to 14 days old', () => {
      store.write(getPublicPage, { slug: 'a' }, page('A'));
      vi.setSystemTime(START + SAVED_COPY_MAX_AGE_MS);
      expect(store.read(getPublicPage, { slug: 'a' })).toEqual({
        value: page('A'),
        savedAt: START,
      });
    });

    it('does not use an entry older than 14 days, and removes it', () => {
      expect(SAVED_COPY_MAX_AGE_MS).toBe(14 * DAY);
      store.write(getPublicPage, { slug: 'a' }, page('A'));
      vi.setSystemTime(START + SAVED_COPY_MAX_AGE_MS + 1);
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
      expect(savedKeys()).toEqual([]);
    });

    it('returns nothing for a missing entry, and drops an entry that is not a saved copy', () => {
      expect(store.read(getPublicPage, { slug: 'none' })).toBeUndefined();
      const key = savedCopyKey(getPublicPage, { slug: 'bad' });
      for (const raw of ['not json', '{"savedAt":1}', '{"v":1,"savedAt":"x"}', 'null']) {
        localStorage.setItem(key, raw);
        expect(store.read(getPublicPage, { slug: 'bad' }), raw).toBeUndefined();
        expect(localStorage.getItem(key), raw).toBeNull();
      }
    });

    // The tester's repros on PR #136: each crashed the organization page offline.
    it.each([
      ['an object missing fields', { name: 'Shape Only' }],
      ['a number', 42],
      ['a string', 'x'],
      ['an array', [1, 2]],
      ['a list of the wrong type', { ...page('A'), leagues: 'none' }],
      ['null (write never stores it)', null],
    ])(
      'does not use a value that does not match the query result (%s), and removes it',
      (_, value) => {
        plantSavedCopy(getPublicPage, { slug: 'bad' }, value, START);
        expect(store.read(getPublicPage, { slug: 'bad' })).toBeUndefined();
        expect(savedKeys()).toEqual([]);
      },
    );

    it('uses a value with a field the query result does not name (a newer build added it)', () => {
      plantSavedCopy(getPublicPage, { slug: 'a' }, { ...page('A'), leagueCount: 0 }, START);
      expect(store.read(getPublicPage, { slug: 'a' })?.value).toEqual({
        ...page('A'),
        leagueCount: 0,
      });
    });

    // Tester, PR #136 round 2: nested shapes, checked through read() rather than the matcher alone.
    const league = { name: 'L', sportName: 'Soccer', locationNames: ['Field'] };
    const location = { name: 'Field', address: '1 Main St' };
    it.each([
      ['a nested field of the wrong type', { ...page('A'), leagues: [{ ...league, name: 1 }] }],
      [
        'a nested list item of the wrong type',
        { ...page('A'), leagues: [{ ...league, locationNames: [1] }] },
      ],
      ['a nested required field missing', { ...page('A'), locations: [{ name: 'Field' }] }],
      ['a null list item', { ...page('A'), locations: [null] }],
      ['a top-level required field missing', { name: 'A', leagues: [], locations: [] }],
    ])('does not use a nested value of the wrong shape (%s), and removes it', (_, value) => {
      plantSavedCopy(getPublicPage, { slug: 'bad' }, value, START);
      expect(store.read(getPublicPage, { slug: 'bad' })).toBeUndefined();
      expect(savedKeys()).toEqual([]);
    });

    it('uses a value with extra fields inside its list items', () => {
      const value = {
        ...page('A'),
        leagues: [{ ...league, logo: 'x' }],
        locations: [{ ...location, lat: 1.5 }],
      };
      plantSavedCopy(getPublicPage, { slug: 'a' }, value, START);
      expect(store.read(getPublicPage, { slug: 'a' })?.value).toEqual(value);
    });

    it.each([
      ['another version', { version: VERSION + 1 }],
      ['no version (saved before versions)', { version: undefined }],
      ['a version that is not a number', { version: String(VERSION) }],
    ])('does not use an entry with %s, and removes it', (_, stored) => {
      plantSavedCopy(getPublicPage, { slug: 'a' }, page('A'), START, stored);
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
      expect(savedKeys()).toEqual([]);
    });

    it('does not use an entry saved in the future, and removes it', () => {
      plantSavedCopy(getPublicPage, { slug: 'a' }, page('A'), START + SAVED_COPY_MAX_FUTURE_MS + 1);
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
      expect(savedKeys()).toEqual([]);

      plantSavedCopy(getPublicPage, { slug: 'b' }, page('B'), START + 365 * DAY);
      expect(store.read(getPublicPage, { slug: 'b' })).toBeUndefined();
      expect(savedKeys()).toEqual([]);
    });

    it('uses an entry saved up to a minute ahead of the clock (a small clock correction)', () => {
      expect(SAVED_COPY_MAX_FUTURE_MS).toBe(60_000);
      plantSavedCopy(getPublicPage, { slug: 'a' }, page('A'), START + SAVED_COPY_MAX_FUTURE_MS);
      expect(store.read(getPublicPage, { slug: 'a' })?.savedAt).toBe(
        START + SAVED_COPY_MAX_FUTURE_MS,
      );
    });

    it('removes an entry whose Convex JSON does not decode', () => {
      plantSavedCopy(getPublicPage, { slug: 'a' }, null, START, {
        v: { ...page('A'), name: { $integer: 'zz' } },
      });
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
      expect(savedKeys()).toEqual([]);
    });
  });

  describe('storage errors', () => {
    it('ignores a throwing setItem, getItem, and removeItem', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(() => {
        store.write(getPublicPage, { slug: 'a' }, page('A'));
      }).not.toThrow();
      expect(() => {
        store.write(getPublicPage, { slug: 'a' }, null);
      }).not.toThrow();
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
    });

    it('ignores a window whose localStorage getter throws (storage blocked)', () => {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(() => {
        store.write(getPublicPage, { slug: 'a' }, page('A'));
      }).not.toThrow();
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
    });
  });
});
