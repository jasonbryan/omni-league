import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConvexClient } from 'convex/browser';
import { CONVEX_CLIENT, CONVEX_CLIENT_FACTORY, CONVEX_URL, provideConvex } from './index';
import { normalizeConvexUrl, wrapConvexClient } from './convex-client';
import { FakeConvexClient } from './testing/fake-convex-client';

describe('provideConvex', () => {
  let created: FakeConvexClient[];
  let factory: ReturnType<typeof vi.fn<(url: string) => FakeConvexClient>>;

  beforeEach(() => {
    created = [];
    factory = vi.fn<(url: string) => FakeConvexClient>(() => {
      const client = new FakeConvexClient();
      created.push(client);
      return client;
    });
  });

  function configure(platform: 'browser' | 'server', url?: string | null) {
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: CONVEX_CLIENT_FACTORY, useValue: factory },
        ...(url === undefined ? [] : [{ provide: CONVEX_URL, useValue: url }]),
      ],
    });
  }

  it('creates one client with the configured URL in the browser', () => {
    configure('browser', 'https://happy-otter-123.convex.cloud');

    const client = TestBed.inject(CONVEX_CLIENT);
    expect(TestBed.inject(CONVEX_CLIENT)).toBe(client);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('https://happy-otter-123.convex.cloud');
    expect(client).toBe(created[0]);
  });

  it('closes the client exactly once when the application is destroyed', () => {
    configure('browser', 'https://happy-otter-123.convex.cloud');
    TestBed.inject(CONVEX_CLIENT);

    TestBed.resetTestingModule(); // destroys the application's root injector

    expect(created[0].lifecycle).toEqual(['close']);
  });

  it('creates no client in the browser when no URL is configured', () => {
    configure('browser', null);

    expect(TestBed.inject(CONVEX_CLIENT)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('defaults CONVEX_URL to the build-time constant, which is null in the test build', () => {
    configure('browser');

    expect(TestBed.inject(CONVEX_URL)).toBeNull();
    expect(TestBed.inject(CONVEX_CLIENT)).toBeNull();
  });

  it('never calls the client factory on the server platform, with or without a URL', () => {
    configure('server', 'https://happy-otter-123.convex.cloud');

    expect(TestBed.inject(CONVEX_CLIENT)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('normalizeConvexUrl', () => {
  it('treats undefined, null, and the empty string as no URL', () => {
    expect(normalizeConvexUrl(undefined)).toBeNull();
    expect(normalizeConvexUrl(null)).toBeNull();
    expect(normalizeConvexUrl('')).toBeNull();
    expect(normalizeConvexUrl('http://127.0.0.1:3210')).toBe('http://127.0.0.1:3210');
  });
});

describe('wrapConvexClient', () => {
  it('delegates close and clearAuth to the real client', () => {
    // Never connects, so the test makes no network call.
    class NoopWebSocket {
      readyState = 0;
      send = vi.fn();
      close = vi.fn();
    }
    const real = new ConvexClient('https://happy-otter-123.convex.cloud', {
      webSocketConstructor: NoopWebSocket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
      logger: false,
    });
    const clearAuth = vi.spyOn(real.client, 'clearAuth');
    const wrapped = wrapConvexClient(real);

    wrapped.clearAuth();
    expect(clearAuth).toHaveBeenCalledTimes(1);

    // The stub socket never opens, so the close promise stays pending; `closed` flips synchronously.
    void wrapped.close();
    expect(real.closed).toBe(true);
  });
});
