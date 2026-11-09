import { Injectable, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../../auth/testing/fake-auth-client';
import { ConvexConnection } from './connection';
import {
  CONVEX_AUTH,
  CONVEX_CLIENT,
  CONVEX_CLIENT_FACTORY,
  CONVEX_URL,
  type ConvexAuthSource,
  provideConvex,
  provideConvexAuth,
} from './index';
import { FakeConvexClient } from './testing/fake-convex-client';

function source(signedIn = false) {
  return {
    fetchToken: vi.fn(() => Promise.resolve<string | null>(null)),
    signedIn: signal(signedIn),
    onChange: vi.fn(),
    authEpoch: signal(0),
    onOnline: vi.fn(),
  } satisfies ConvexAuthSource;
}

describe('provideConvexAuth', () => {
  let created: FakeConvexClient[];

  function configure(
    platform: 'browser' | 'server',
    auth: Parameters<typeof provideConvexAuth>[0],
    url: string | null = 'https://happy-otter-123.convex.cloud',
  ) {
    created = [];
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        provideConvexAuth(auth),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: CONVEX_URL, useValue: url },
        {
          provide: CONVEX_CLIENT_FACTORY,
          useValue: () => {
            const client = new FakeConvexClient();
            created.push(client);
            return client;
          },
        },
      ],
    });
  }

  it("calls setAuth with the source's fetchToken and onChange when the client is created", () => {
    const auth = source();
    configure('browser', auth);
    TestBed.inject(CONVEX_CLIENT);

    expect(created).toHaveLength(1);
    expect(created[0].lifecycle).toEqual(['setAuth']);
    expect(created[0].setAuthCalls).toEqual([[auth.fetchToken, auth.onChange]]);
  });

  it('clears auth when signedIn turns false and sets it again when it turns true', () => {
    const auth = source(true);
    configure('browser', auth);
    TestBed.inject(CONVEX_CLIENT);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth']);

    auth.signedIn.set(false);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth', 'clearAuth']);

    auth.signedIn.set(false);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth', 'clearAuth']);

    auth.signedIn.set(true);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth', 'clearAuth', 'setAuth']);
    expect(created[0].setAuthCalls[1]).toEqual([auth.fetchToken, auth.onChange]);
  });

  it('calls setAuth once more when authEpoch changes while signed in, and not while signed out', () => {
    const auth = source(true);
    configure('browser', auth);
    TestBed.inject(CONVEX_CLIENT);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth']);

    auth.authEpoch.set(1);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth', 'setAuth']);
    expect(created[0].setAuthCalls[1]).toEqual([auth.fetchToken, auth.onChange]);

    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth', 'setAuth']);

    auth.signedIn.set(false);
    TestBed.tick();
    auth.authEpoch.set(2);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual(['setAuth', 'setAuth', 'clearAuth']);
  });

  it('calls onOnline each time the online signal turns true, the first time included', () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      const auth = source();
      configure('browser', auth);
      TestBed.inject(CONVEX_CLIENT);
      TestBed.tick();
      expect(auth.onOnline).toHaveBeenCalledTimes(1);

      online.mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      expect(auth.onOnline).toHaveBeenCalledTimes(1);

      online.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
      TestBed.tick();
      expect(auth.onOnline).toHaveBeenCalledTimes(2);
      TestBed.tick();
      expect(auth.onOnline).toHaveBeenCalledTimes(2);
    } finally {
      online.mockRestore();
    }
  });

  it('accepts an injectable class and uses its root instance', () => {
    @Injectable({ providedIn: 'root' })
    class TestAuth implements ConvexAuthSource {
      readonly signedIn = signal(false);
      readonly fetchToken = () => Promise.resolve(null);
    }
    configure('browser', TestAuth);
    TestBed.inject(CONVEX_CLIENT);

    const instance = TestBed.inject(TestAuth);
    expect(TestBed.inject(CONVEX_AUTH)).toBe(instance);
    expect(created[0].setAuthCalls).toEqual([[instance.fetchToken, undefined]]);
  });

  it('is ignored on the server: no client, so nothing to authenticate', () => {
    const auth = source(true);
    configure('server', auth);
    expect(TestBed.inject(CONVEX_CLIENT)).toBeNull();
    TestBed.tick();
    expect(created).toHaveLength(0);
    expect(auth.fetchToken).not.toHaveBeenCalled();
  });

  it('does nothing in the browser with no Convex URL', () => {
    const auth = source(true);
    configure('browser', auth, null);
    expect(TestBed.inject(CONVEX_CLIENT)).toBeNull();
    expect(created).toHaveLength(0);
  });
});

describe('provideConvex with provideConvexAuth(AuthService)', () => {
  it('boots with no injection cycle, and calls AuthService.onOnline once when online turns true', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const created: FakeConvexClient[] = [];
      TestBed.configureTestingModule({
        providers: [
          provideConvex(),
          provideConvexAuth(AuthService),
          provideFakeAuthClient(new FakeAuthClient()),
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
          {
            provide: CONVEX_CLIENT_FACTORY,
            useValue: () => {
              const client = new FakeConvexClient();
              created.push(client);
              return client;
            },
          },
        ],
      });
      expect(() => TestBed.inject(ConvexConnection)).not.toThrow();
      const auth = TestBed.inject(AuthService);
      expect(TestBed.inject(CONVEX_AUTH)).toBe(auth);
      expect(created).toHaveLength(1);
      expect(created[0].setAuthCalls[0]).toEqual([auth.fetchToken, auth.onChange]);
      TestBed.tick();
      await expect(auth.isSignedIn()).resolves.toBe(true);

      const onOnline = vi.spyOn(auth, 'onOnline');
      online.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
      TestBed.tick();
      expect(onOnline).toHaveBeenCalledTimes(1);
    } finally {
      online.mockRestore();
    }
  });
});

describe('provideConvex without provideConvexAuth', () => {
  it('never calls setAuth', () => {
    const created: FakeConvexClient[] = [];
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
        {
          provide: CONVEX_CLIENT_FACTORY,
          useValue: () => {
            const client = new FakeConvexClient();
            created.push(client);
            return client;
          },
        },
      ],
    });
    TestBed.inject(CONVEX_CLIENT);
    TestBed.tick();
    expect(created[0].lifecycle).toEqual([]);
  });
});
