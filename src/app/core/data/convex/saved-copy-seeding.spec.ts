import { PLATFORM_ID, TransferState, makeStateKey, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeFunctionReference } from 'convex/server';
import { convexToJson } from 'convex/values';
import { api } from '../../../../../convex/_generated/api';
import {
  CONVEX_CLIENT_FACTORY,
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_URL,
  injectQuery,
  provideConvex,
} from './index';
import { OFFLINE_SAVED_QUERIES } from './offline-saved-queries';
import { savedCopyKey } from './saved-copies';
import { FakeConvexClient } from './testing/fake-convex-client';
import { FakeConvexHttpClient } from './testing/fake-convex-http-client';
import { plantSavedCopy } from './testing/saved-copy';

const getPublicPage = api.organizations.getPublicPage;
const myTeams = makeFunctionReference<'query', { leagueId: string }, unknown>('teams:mine');
const SAVED_AT = Date.UTC(2026, 9, 9, 21, 14);
const NOW = Date.UTC(2026, 9, 10, 9, 0);

const EMPTY = { slug: 'gulf', leagueCount: 0, locationCount: 0, sportCount: 0, sports: [] };
const SAVED = { name: 'Saved name', ...EMPTY };
const LIVE = { name: 'Live name', ...EMPTY };
const TRANSFERRED = { name: 'Transferred name', ...EMPTY };

function plant(slug: string, value: unknown, savedAt = SAVED_AT): void {
  plantSavedCopy(getPublicPage, { slug }, value, savedAt);
}

function stored(slug: string): unknown {
  const raw = localStorage.getItem(savedCopyKey(getPublicPage, { slug }));
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

describe('injectQuery saved copies (browser)', () => {
  let client: FakeConvexClient;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    client = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
        { provide: CONVEX_CLIENT_FACTORY, useValue: () => client },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const create = (slug: string | (() => { slug: string }) = 'gulf') =>
    TestBed.runInInjectionContext(() =>
      injectQuery(getPublicPage, typeof slug === 'string' ? { slug } : slug),
    );

  it('with no TransferState entry and no live result, shows the saved copy at once with savedAt', () => {
    plant('gulf', SAVED);
    const page = create();

    expect(client.subscriptions).toHaveLength(0);
    expect(page.value()).toEqual(SAVED);
    expect(page.isLoading()).toBe(false);
    expect(page.error()).toBeUndefined();
    expect(page.savedAt()).toBe(SAVED_AT);

    TestBed.tick();
    expect(client.activeSubscriptions).toHaveLength(1);
    client.subscriptions[0].emit(LIVE);
    expect(page.value()).toEqual(LIVE);
    expect(page.savedAt()).toBeUndefined();
  });

  it('writes each live result of a listed query as the new saved copy', () => {
    const page = create();
    TestBed.tick();
    expect(page.isLoading()).toBe(true);
    expect(page.savedAt()).toBeUndefined();

    client.subscriptions[0].emit(LIVE);
    expect(stored('gulf')).toEqual({
      v: convexToJson(LIVE),
      savedAt: NOW,
      usedAt: NOW,
      version: OFFLINE_SAVED_QUERIES[0].version,
    });

    vi.setSystemTime(NOW + 60_000);
    client.subscriptions[0].emit({ ...LIVE, name: 'Renamed' });
    expect(stored('gulf')).toMatchObject({ v: { name: 'Renamed' }, savedAt: NOW + 60_000 });
  });

  it('with no saved copy and no result, is loading (seeding order: TransferState, saved copy, loading)', () => {
    plant('other', SAVED);
    const page = create();
    expect(page.value()).toBeUndefined();
    expect(page.isLoading()).toBe(true);
    expect(page.savedAt()).toBeUndefined();
  });

  it('a TransferState entry wins over a saved copy, and savedAt stays undefined', () => {
    plant('gulf', SAVED);
    TestBed.inject(TransferState).set(
      makeStateKey<unknown>('cvx:organizations:getPublicPage:{"slug":"gulf"}'),
      { v: convexToJson(TRANSFERRED) },
    );
    const page = create();
    expect(page.value()).toEqual(TRANSFERRED);
    expect(page.savedAt()).toBeUndefined();
    TestBed.tick();
    client.subscriptions[0].emit(LIVE);
    expect(page.value()).toEqual(LIVE);
    expect(stored('gulf')).toMatchObject({ v: { name: 'Live name' } });
  });

  it('a live null removes the saved entry and shows null with no savedAt', () => {
    plant('gulf', SAVED);
    const page = create();
    expect(page.savedAt()).toBe(SAVED_AT);
    TestBed.tick();
    client.subscriptions[0].emit(null);
    expect(page.value()).toBeNull();
    expect(page.savedAt()).toBeUndefined();
    expect(stored('gulf')).toBeNull();
  });

  it('a live error replaces the saved copy and leaves the saved entry', () => {
    plant('gulf', SAVED);
    const page = create();
    TestBed.tick();
    client.subscriptions[0].fail(new Error('down'));
    expect(page.value()).toBeUndefined();
    expect(page.error()?.message).toBe('down');
    expect(page.savedAt()).toBeUndefined();
    expect(stored('gulf')).toMatchObject({ v: { name: 'Saved name' } });
  });

  it('uses the saved copy of the new args after an args change', () => {
    plant('gulf', SAVED);
    plant('bay', { ...SAVED, name: 'Bay', slug: 'bay' }, SAVED_AT - 1000);
    const slug = signal('gulf');
    const page = create(() => ({ slug: slug() }));
    TestBed.tick();
    client.subscriptions[0].emit(LIVE);
    expect(page.savedAt()).toBeUndefined();

    slug.set('bay');
    expect(page.value()).toMatchObject({ name: 'Bay' });
    expect(page.savedAt()).toBe(SAVED_AT - 1000);
    TestBed.tick();
    expect(client.activeSubscriptions).toHaveLength(1);
    expect(client.activeSubscriptions[0].args).toEqual({ slug: 'bay' });
  });

  it.each([
    ['an object missing fields', { name: 'Shape Only' }],
    ['a number', 42],
    ['a string', 'x'],
    ['an array', [1, 2]],
  ])(
    'treats a saved value that is not a query result (%s) as no saved copy, and removes it',
    (_, value) => {
      plant('gulf', value);
      const page = create();
      expect(page.value()).toBeUndefined();
      expect(page.isLoading()).toBe(true);
      expect(page.savedAt()).toBeUndefined();
      expect(stored('gulf')).toBeNull();
    },
  );

  it('treats a saved copy of another version as no saved copy, and removes it', () => {
    plantSavedCopy(getPublicPage, { slug: 'gulf' }, SAVED, SAVED_AT, {
      version: OFFLINE_SAVED_QUERIES[0].version + 1,
    });
    const page = create();
    expect(page.value()).toBeUndefined();
    expect(page.isLoading()).toBe(true);
    expect(stored('gulf')).toBeNull();
  });

  it('does not use a saved copy older than 14 days', () => {
    plant('gulf', SAVED, NOW - 14 * 24 * 60 * 60 * 1000 - 1);
    const page = create();
    expect(page.value()).toBeUndefined();
    expect(page.isLoading()).toBe(true);
    expect(stored('gulf')).toBeNull();
  });

  it('writes nothing to localStorage when a query that is not on the allow-list emits', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const teams = TestBed.runInInjectionContext(() => injectQuery(myTeams, { leagueId: 'a' }));
    TestBed.tick();
    client.subscriptions[0].emit(['Sharks']);
    expect(teams.value()).toEqual(['Sharks']);
    expect(teams.savedAt()).toBeUndefined();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('renders live data with no error when localStorage throws on read and on write', () => {
    for (const method of ['getItem', 'setItem', 'removeItem', 'key'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
    }
    const page = create();
    expect(page.isLoading()).toBe(true);
    TestBed.tick();
    expect(() => {
      client.subscriptions[0].emit(LIVE);
    }).not.toThrow();
    expect(page.value()).toEqual(LIVE);
    expect(page.error()).toBeUndefined();
  });
});

describe('injectQuery saved copies (server)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('never reads or writes storage during a server render', async () => {
    plant('gulf', SAVED);
    const http = new FakeConvexHttpClient();
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
        { provide: CONVEX_HTTP_CLIENT_FACTORY, useValue: () => http },
      ],
    });
    const spies = (['getItem', 'setItem', 'removeItem', 'key'] as const).map((method) =>
      vi.spyOn(Storage.prototype, method),
    );
    const page = TestBed.runInInjectionContext(() => injectQuery(getPublicPage, { slug: 'gulf' }));
    expect(page.value()).toBeUndefined();
    expect(page.isLoading()).toBe(true);
    expect(page.savedAt()).toBeUndefined();
    TestBed.tick();
    http.queries[0].resolve(LIVE);
    await vi.waitFor(() => {
      expect(page.value()).toEqual(LIVE);
    });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(page.savedAt()).toBeUndefined();
  });
});
