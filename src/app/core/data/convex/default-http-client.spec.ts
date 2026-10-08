import { TestBed } from '@angular/core/testing';
import { makeFunctionReference } from 'convex/server';
import { CONVEX_HTTP_CLIENT_FACTORY, CONVEX_SERVER_QUERY_TIMEOUT_MS } from './index';
import { fetchWithTimeout } from './server-query-loader';

const listTeams = makeFunctionReference<'query', { leagueId: string }, string[]>('teams:list');

/** A `fetch` stub that never answers and settles only when its signal aborts. */
function hangingFetch() {
  const signals: (AbortSignal | undefined)[] = [];
  const stub = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason as Error));
    });
  });
  return { stub, signals };
}

describe('default CONVEX_HTTP_CLIENT_FACTORY (real timers)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the fetch installed after the factory ran, with a signal that aborts after the timeout', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: CONVEX_SERVER_QUERY_TIMEOUT_MS, useValue: 50 }],
    });
    const client = TestBed.inject(CONVEX_HTTP_CLIENT_FACTORY)(
      'https://happy-otter-123.convex.cloud',
    );

    const { stub, signals } = hangingFetch();
    vi.stubGlobal('fetch', stub); // installed after the factory and the client were created
    const started = Date.now();
    const result = client.query(listTeams, { leagueId: 'a' });

    await expect(result).rejects.toThrow();
    expect(stub).toHaveBeenCalledTimes(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it('combines a caller-supplied signal with the timeout, so the caller can still abort first', async () => {
    const { stub, signals } = hangingFetch();
    vi.stubGlobal('fetch', stub);
    const caller = new AbortController();

    const response = fetchWithTimeout(10_000)('https://happy-otter-123.convex.cloud/api/query', {
      method: 'POST',
      signal: caller.signal,
    });
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(caller.signal);
    expect(signals[0]?.aborted).toBe(false);

    caller.abort(new Error('caller gave up'));
    await expect(response).rejects.toThrow('caller gave up');
    expect(signals[0]?.aborted).toBe(true);
    expect(stub.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });
});
