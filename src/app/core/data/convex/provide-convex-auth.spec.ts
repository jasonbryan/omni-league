import { Injectable, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
