import { TestBed } from '@angular/core/testing';
import { makeFunctionReference } from 'convex/server';
import { convexToJson } from 'convex/values';
import { api } from '../../../../../convex/_generated/api';
import { OFFLINE_SAVED_QUERIES } from './offline-saved-queries';
import {
  ConvexSavedCopies,
  SAVED_COPY_MAX_AGE_MS,
  SAVED_COPY_MAX_ENTRIES,
  SAVED_COPY_MAX_TOTAL_LENGTH,
  savedCopyKey,
} from './saved-copies';

const getPublicPage = api.organizations.getPublicPage;
/** Same function name as the listed query, with free-form args, for the key-order cases. */
const listedAnyArgs = makeFunctionReference<'query', Record<string, unknown>, unknown>(
  'organizations:getPublicPage',
);
/** A query that is not on the allow-list (a signed-in query, for example). */
const myTeams = makeFunctionReference<'query', { leagueId: string }, unknown>('teams:mine');

const START = Date.UTC(2026, 9, 10, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

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

  it('lists organizations:getPublicPage, a deliberately public, caller-independent query', () => {
    expect(OFFLINE_SAVED_QUERIES).toEqual([getPublicPage]);
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
      store.write(listedAnyArgs, { season: 's1', page: 2 }, { n: 1 });
      vi.setSystemTime(START + 1000);
      store.write(listedAnyArgs, { page: 2, season: 's1' }, { n: 2 });
      expect(savedKeys()).toEqual([
        'cvx-saved:organizations:getPublicPage:{"page":2,"season":"s1"}',
      ]);
      expect(store.read(listedAnyArgs, { season: 's1', page: 2 })).toEqual({
        value: { n: 2 },
        savedAt: START + 1000,
      });
    });
  });

  describe('write', () => {
    it('stores { v: convexToJson(result), savedAt, usedAt } for a listed query', () => {
      const result = { name: 'Gulf Coast', count: 5n };
      store.write(getPublicPage, { slug: 'gulf-coast' }, result);
      const raw = localStorage.getItem(
        'cvx-saved:organizations:getPublicPage:{"slug":"gulf-coast"}',
      );
      expect(JSON.parse(raw ?? 'null')).toEqual({
        v: convexToJson(result),
        savedAt: START,
        usedAt: START,
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
        JSON.stringify({ v: ['Sharks'], savedAt: START, usedAt: START }),
      );
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      expect(store.read(myTeams, { leagueId: 'a' })).toBeUndefined();
      expect(getItem).not.toHaveBeenCalled();
    });

    it('removes the entry when the live result is null or undefined', () => {
      store.write(getPublicPage, { slug: 'a' }, { name: 'A' });
      store.write(getPublicPage, { slug: 'b' }, { name: 'B' });
      expect(savedKeys()).toHaveLength(2);
      store.write(getPublicPage, { slug: 'a' }, null);
      store.write(getPublicPage, { slug: 'b' }, undefined);
      expect(savedKeys()).toEqual([]);
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
    });

    it(`keeps at most ${SAVED_COPY_MAX_ENTRIES} entries, removing the least recently used first`, () => {
      for (let i = 0; i < SAVED_COPY_MAX_ENTRIES; i++) {
        vi.setSystemTime(START + i * 1000);
        store.write(getPublicPage, { slug: `org-${i}` }, { name: `Org ${i}` });
      }
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES);

      // Reading org-0 makes it the most recently used, so org-1 is now the least recently used.
      vi.setSystemTime(START + 100_000);
      expect(store.read(getPublicPage, { slug: 'org-0' })?.value).toEqual({ name: 'Org 0' });

      vi.setSystemTime(START + 200_000);
      store.write(getPublicPage, { slug: 'org-new' }, { name: 'New' });
      const keys = savedKeys();
      expect(keys).toHaveLength(SAVED_COPY_MAX_ENTRIES);
      expect(keys).toContain(savedCopyKey(getPublicPage, { slug: 'org-0' }));
      expect(keys).toContain(savedCopyKey(getPublicPage, { slug: 'org-new' }));
      expect(keys).not.toContain(savedCopyKey(getPublicPage, { slug: 'org-1' }));

      // One more: org-2 goes next.
      vi.setSystemTime(START + 300_000);
      store.write(getPublicPage, { slug: 'org-newer' }, { name: 'Newer' });
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES);
      expect(savedKeys()).not.toContain(savedCopyKey(getPublicPage, { slug: 'org-2' }));
    });

    it(`given ${String(SAVED_COPY_MAX_ENTRIES + 1)} saved results, one more write removes the least recently used down to the limit`, () => {
      // 51 entries already in storage (for example written by another tab at the same moment).
      for (let i = 0; i <= SAVED_COPY_MAX_ENTRIES; i++) {
        const at = START + i * 1000;
        localStorage.setItem(
          savedCopyKey(getPublicPage, { slug: `org-${String(i)}` }),
          JSON.stringify({ v: { name: `Org ${String(i)}` }, savedAt: at, usedAt: at }),
        );
      }
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES + 1);

      vi.setSystemTime(START + 100_000);
      store.write(getPublicPage, { slug: 'org-new' }, { name: 'New' });
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
        store.write(getPublicPage, { slug: `org-${i}` }, { name: `Org ${i}` });
      }
      vi.setSystemTime(START + 100_000);
      store.write(getPublicPage, { slug: 'org-10' }, { name: 'Org 10 renamed' });
      expect(savedKeys()).toHaveLength(SAVED_COPY_MAX_ENTRIES);
      expect(store.read(getPublicPage, { slug: 'org-10' })).toEqual({
        value: { name: 'Org 10 renamed' },
        savedAt: START + 100_000,
      });
    });

    it('does not save a result larger than the size budget, and drops the older copy of it', () => {
      store.write(getPublicPage, { slug: 'big' }, { name: 'Small' });
      const huge = { name: 'x'.repeat(SAVED_COPY_MAX_TOTAL_LENGTH) };
      store.write(getPublicPage, { slug: 'big' }, huge);
      expect(savedKeys()).toEqual([]);
      expect(store.read(getPublicPage, { slug: 'big' })).toBeUndefined();
    });

    it('removes the least recently used entries until all of them fit the size budget', () => {
      const quarter = { name: 'x'.repeat(Math.floor(SAVED_COPY_MAX_TOTAL_LENGTH / 4)) };
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

    it('removes expired entries when it makes room', () => {
      store.write(getPublicPage, { slug: 'old' }, { name: 'Old' });
      vi.setSystemTime(START + SAVED_COPY_MAX_AGE_MS + 1);
      store.write(getPublicPage, { slug: 'new' }, { name: 'New' });
      expect(savedKeys()).toEqual([savedCopyKey(getPublicPage, { slug: 'new' })]);
    });
  });

  describe('read', () => {
    it('uses an entry up to 14 days old', () => {
      store.write(getPublicPage, { slug: 'a' }, { name: 'A' });
      vi.setSystemTime(START + SAVED_COPY_MAX_AGE_MS);
      expect(store.read(getPublicPage, { slug: 'a' })).toEqual({
        value: { name: 'A' },
        savedAt: START,
      });
    });

    it('does not use an entry older than 14 days, and removes it', () => {
      expect(SAVED_COPY_MAX_AGE_MS).toBe(14 * DAY);
      store.write(getPublicPage, { slug: 'a' }, { name: 'A' });
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
        store.write(getPublicPage, { slug: 'a' }, { name: 'A' });
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
        store.write(getPublicPage, { slug: 'a' }, { name: 'A' });
      }).not.toThrow();
      expect(store.read(getPublicPage, { slug: 'a' })).toBeUndefined();
    });
  });
});
