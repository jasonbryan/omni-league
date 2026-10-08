import {
  ApplicationRef,
  PLATFORM_ID,
  PendingTasks,
  TransferState,
  makeStateKey,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeFunctionReference } from 'convex/server';
import { jsonToConvex, type JSONValue } from 'convex/values';
import type { MockInstance } from 'vitest';
import {
  CONVEX_AUTH,
  CONVEX_CLIENT_FACTORY,
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_SERVER_QUERY_TIMEOUT_MS,
  CONVEX_URL,
  ConvexNotConfiguredError,
  injectQuery,
  provideConvex,
  skipToken,
} from './index';
import { FakeConvexClient } from './testing/fake-convex-client';
import { FakeConvexHttpClient } from './testing/fake-convex-http-client';

const listTeams = makeFunctionReference<'query', { leagueId: string }, unknown>('teams:list');
const DEPLOYMENT_URL = 'https://happy-otter-123.convex.cloud';
const KEY = 'cvx:teams:list:{"leagueId":"a"}';

describe('injectQuery on the server platform', () => {
  let httpClients: FakeConvexHttpClient[];
  let httpFactory: ReturnType<typeof vi.fn<(url: string) => FakeConvexHttpClient>>;
  let wsFactory: ReturnType<typeof vi.fn<(url: string) => FakeConvexClient>>;
  let consoleSpies: MockInstance[];

  beforeEach(() => {
    httpClients = [];
    httpFactory = vi.fn<(url: string) => FakeConvexHttpClient>(() => {
      const client = new FakeConvexHttpClient();
      httpClients.push(client);
      return client;
    });
    wsFactory = vi.fn<(url: string) => FakeConvexClient>(() => new FakeConvexClient());
    consoleSpies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled(); // nothing is logged by the adapter
      spy.mockRestore();
    }
  });

  function configure(
    options: { platform?: 'server' | 'browser'; url?: string | null; timeoutMs?: number } = {},
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: options.platform ?? 'server' },
        { provide: CONVEX_URL, useValue: options.url === undefined ? DEPLOYMENT_URL : options.url },
        { provide: CONVEX_CLIENT_FACTORY, useValue: wsFactory },
        { provide: CONVEX_HTTP_CLIENT_FACTORY, useValue: httpFactory },
        ...(options.timeoutMs === undefined
          ? []
          : [{ provide: CONVEX_SERVER_QUERY_TIMEOUT_MS, useValue: options.timeoutMs }]),
      ],
    });
  }

  /** Counts `PendingTasks.add()` calls and the release of each returned remover. */
  function trackPendingTasks() {
    const tasks = TestBed.inject(PendingTasks);
    const add = tasks.add.bind(tasks);
    const counts = { added: 0, released: 0 };
    vi.spyOn(tasks, 'add').mockImplementation(() => {
      counts.added++;
      const release = add();
      return () => {
        counts.released++;
        release();
      };
    });
    return counts;
  }

  function createQuery(
    args: { leagueId: string } | (() => { leagueId: string } | typeof skipToken) = {
      leagueId: 'a',
    },
  ) {
    const ref = TestBed.runInInjectionContext(() => injectQuery(listTeams, args));
    TestBed.tick();
    return ref;
  }

  const stable = () => TestBed.inject(ApplicationRef).whenStable();
  const transferred = () => TestBed.inject(TransferState).get<unknown>(makeStateKey(KEY), null);

  it('fetches once over HTTP, holds a pending task until it settles, then holds the value', async () => {
    configure();
    const tasks = trackPendingTasks();
    const teams = createQuery();

    expect(wsFactory).not.toHaveBeenCalled();
    expect(httpFactory).toHaveBeenCalledExactlyOnceWith(DEPLOYMENT_URL);
    expect(httpClients[0].queries).toHaveLength(1);
    expect(httpClients[0].queries[0]).toMatchObject({
      name: 'teams:list',
      args: { leagueId: 'a' },
    });
    expect(tasks).toEqual({ added: 1, released: 0 });
    expect(teams.isLoading()).toBe(true);
    expect(teams.value()).toBeUndefined();

    httpClients[0].queries[0].resolve(['Sharks']);
    await stable();

    expect(tasks).toEqual({ added: 1, released: 1 });
    expect(teams.value()).toEqual(['Sharks']);
    expect(teams.isLoading()).toBe(false);
    expect(teams.error()).toBeUndefined();
  });

  it('shares one HTTP query between two helpers for the same function and args in one render', async () => {
    configure();
    const first = createQuery();
    const second = createQuery(() => ({ leagueId: 'a' }));

    expect(httpFactory).toHaveBeenCalledTimes(1);
    expect(httpClients[0].queries).toHaveLength(1);

    httpClients[0].queries[0].resolve(['Sharks']);
    await stable();
    expect(first.value()).toEqual(['Sharks']);
    expect(second.value()).toEqual(['Sharks']);
  });

  it('creates a new HTTP client and query per render (no client or promise shared across renders)', async () => {
    for (const render of [1, 2]) {
      configure();
      const teams = createQuery();
      expect(httpFactory).toHaveBeenCalledTimes(render);
      expect(httpClients).toHaveLength(render);
      expect(httpClients[render - 1].queries).toHaveLength(1);

      httpClients[render - 1].queries[0].resolve([`render ${render}`]);
      await stable();
      expect(teams.value()).toEqual([`render ${render}`]);
      TestBed.resetTestingModule(); // the next bootstrap is a new application
    }
    expect(httpClients.map((c) => c.queries.length)).toEqual([1, 1]);
  });

  it('with no URL: no HTTP client, no pending task, no TransferState write, ConvexNotConfiguredError', () => {
    configure({ url: null });
    const tasks = trackPendingTasks();
    const teams = createQuery();

    expect(httpFactory).not.toHaveBeenCalled();
    expect(tasks.added).toBe(0);
    expect(TestBed.inject(TransferState).isEmpty).toBe(true);
    expect(teams.error()).toBeInstanceOf(ConvexNotConfiguredError);
    expect(teams.isLoading()).toBe(false);
    expect(teams.value()).toBeUndefined();
  });

  it('never creates an HTTP client in the browser', () => {
    configure({ platform: 'browser' });
    createQuery();

    expect(wsFactory).toHaveBeenCalledTimes(1);
    expect(httpFactory).not.toHaveBeenCalled();
  });

  it('transfers the result with convexToJson under cvx:<function>:<args>; a bigint survives', async () => {
    configure();
    const teams = createQuery();
    httpClients[0].queries[0].resolve({ count: 5n, names: ['Sharks'] });
    await stable();

    expect(teams.value()).toEqual({ count: 5n, names: ['Sharks'] });
    const entry = transferred() as { v: JSONValue };
    expect(Object.keys(entry)).toEqual(['v']);
    // Round trip through the serialised ng-state blob, as the browser receives it.
    const blob = JSON.parse(TestBed.inject(TransferState).toJson()) as Record<
      string,
      { v: JSONValue }
    >;
    expect(jsonToConvex(blob[KEY].v)).toEqual({ count: 5n, names: ['Sharks'] });
  });

  it('transfers { u: true } for a query that resolves to undefined', async () => {
    configure();
    const teams = createQuery();
    httpClients[0].queries[0].resolve(undefined);
    await stable();

    expect(transferred()).toEqual({ u: true });
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(false);
    expect(teams.error()).toBeUndefined();
  });

  it('on rejection: error() is the real error, the task is released, the marker is fixed text', async () => {
    configure();
    const tasks = trackPendingTasks();
    const teams = createQuery();
    const failure = new Error('fetch failed: connect ECONNREFUSED internal-db.corp.example:443');
    httpClients[0].queries[0].reject(failure);
    await stable();

    expect(teams.error()).toBe(failure);
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(false);
    expect(tasks).toEqual({ added: 1, released: 1 });
    expect(transferred()).toEqual({
      e: { name: 'Error', message: 'Convex query failed during server render' },
    });
    expect(TestBed.inject(TransferState).toJson()).not.toContain('internal-db');
  });

  it('times out on the loader timer (fake timers) with a TimeoutError and the timeout marker', async () => {
    vi.useFakeTimers();
    configure({ timeoutMs: 1234 });
    const tasks = trackPendingTasks();
    const teams = createQuery(); // the fake query never settles

    await vi.advanceTimersByTimeAsync(1233);
    expect(teams.isLoading()).toBe(true);
    expect(tasks.released).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    const error = teams.error();
    expect(error).toBeInstanceOf(Error);
    expect(error?.name).toBe('TimeoutError');
    expect(error?.message).toBe('Convex query timed out after 1234 ms');
    expect(teams.isLoading()).toBe(false);
    expect(teams.value()).toBeUndefined();
    expect(tasks).toEqual({ added: 1, released: 1 });
    expect(transferred()).toEqual({
      e: { name: 'TimeoutError', message: 'Convex query timed out after 1234 ms' },
    });
  });

  it('reports a fetch-level abort (DOMException TimeoutError) as the same timeout error', async () => {
    configure({ timeoutMs: 1234 });
    const teams = createQuery();
    httpClients[0].queries[0].reject(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    );
    await stable();

    expect(teams.error()?.name).toBe('TimeoutError');
    expect(teams.error()?.message).toBe('Convex query timed out after 1234 ms');
    expect(transferred()).toEqual({
      e: { name: 'TimeoutError', message: 'Convex query timed out after 1234 ms' },
    });
  });

  it.each([
    [
      'an Error named TimeoutError',
      () => Object.assign(new Error('upstream: lock wait'), { name: 'TimeoutError' }),
    ],
    [
      'a plain object named TimeoutError',
      () => ({ name: 'TimeoutError', message: 'upstream: lock wait' }),
    ],
  ])(
    'keeps %s that is not a timeout as the real error, with the fixed failure marker',
    async (_label, make) => {
      configure({ timeoutMs: 1234 });
      const teams = createQuery();
      const failure = make();
      httpClients[0].queries[0].reject(failure);
      await stable();

      const error = teams.error();
      expect(error?.message).not.toBe('Convex query timed out after 1234 ms');
      if (failure instanceof Error) expect(error).toBe(failure);
      else expect(error?.name).not.toBe('TimeoutError');
      expect(transferred()).toEqual({
        e: { name: 'Error', message: 'Convex query failed during server render' },
      });
      expect(TestBed.inject(TransferState).toJson()).not.toContain('lock wait');
    },
  );

  it('keeps a DOMException that is not a timeout as the real error', async () => {
    configure({ timeoutMs: 1234 });
    const teams = createQuery();
    const failure = new DOMException('The operation was aborted', 'AbortError');
    httpClients[0].queries[0].reject(failure);
    await stable();

    expect(teams.error()?.message).toContain('The operation was aborted');
    expect(teams.error()?.message).not.toContain('timed out');
    expect(transferred()).toEqual({
      e: { name: 'Error', message: 'Convex query failed during server render' },
    });
  });

  it('defaults the timeout to 5000 ms', async () => {
    vi.useFakeTimers();
    configure();
    const teams = createQuery();

    await vi.advanceTimersByTimeAsync(4999);
    expect(teams.isLoading()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(teams.error()?.message).toBe('Convex query timed out after 5000 ms');
  });

  it('clears the loader timer when the query settles (no handle left open)', async () => {
    vi.useFakeTimers();
    configure();
    const teams = createQuery();
    await vi.advanceTimersByTimeAsync(0); // let the scheduler's own timers run
    expect(vi.getTimerCount()).toBe(1); // the loader's timeout

    httpClients[0].queries[0].resolve(['Sharks']);
    await vi.advanceTimersByTimeAsync(0);

    expect(teams.value()).toEqual(['Sharks']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('makes no query, adds no task, and writes nothing for skipToken args', () => {
    configure();
    const tasks = trackPendingTasks();
    const teams = createQuery(() => skipToken);

    expect(httpClients.flatMap((c) => c.queries)).toHaveLength(0);
    expect(tasks.added).toBe(0);
    expect(TestBed.inject(TransferState).isEmpty).toBe(true);
    expect(teams.isLoading()).toBe(false);
  });

  it('ignores a later args change result that belongs to the old args', async () => {
    configure();
    const leagueId = signal('a');
    const teams = createQuery(() => ({ leagueId: leagueId() }));
    leagueId.set('b');
    TestBed.tick();
    expect(httpClients[0].queries.map((q) => q.args)).toEqual([
      { leagueId: 'a' },
      { leagueId: 'b' },
    ]);

    httpClients[0].queries[0].resolve(['old']);
    await Promise.resolve();
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    httpClients[0].queries[1].resolve(['new']);
    await stable();
    expect(teams.value()).toEqual(['new']);
  });

  it('never calls setAuth on the HTTP client, even with CONVEX_AUTH provided', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CONVEX_AUTH,
          useValue: { fetchToken: () => Promise.resolve('secret-jwt'), signedIn: signal(true) },
        },
      ],
    });
    configure();
    const teams = createQuery();
    httpClients[0].queries[0].resolve(['Sharks']);
    await stable();

    expect(teams.value()).toEqual(['Sharks']);
    expect(httpClients[0].setAuthCalls).toEqual([]);
    expect(TestBed.inject(TransferState).toJson()).not.toContain('secret-jwt');
  });
});
