import { PLATFORM_ID, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CONVEX_CLIENT,
  CONVEX_CLIENT_FACTORY,
  CONVEX_URL,
  injectOnline,
  provideConvex,
} from './index';
import { FakeConvexClient } from './testing/fake-convex-client';

/** `navigator.onLine` as the test sets it; jsdom reports true. */
function stubNavigatorOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

function goOffline(): void {
  stubNavigatorOnLine(false);
  window.dispatchEvent(new Event('offline'));
}

function goOnline(): void {
  stubNavigatorOnLine(true);
  window.dispatchEvent(new Event('online'));
}

/** Creates the app's `online` signal the way the app does (provideConvex, app initializer). */
function start(options: {
  client?: FakeConvexClient | null;
  platform?: 'browser' | 'server';
}): Signal<boolean> {
  const client = options.client ?? null;
  TestBed.configureTestingModule({
    providers: [
      provideConvex(),
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
      { provide: CONVEX_URL, useValue: client ? 'https://happy-otter-123.convex.cloud' : null },
      { provide: CONVEX_CLIENT_FACTORY, useValue: () => client },
    ],
  });
  if (options.platform === 'server') TestBed.overrideProvider(CONVEX_CLIENT, { useValue: client });
  const online = TestBed.runInInjectionContext(injectOnline);
  TestBed.tick(); // runs the app initializer's afterNextRender work
  return online;
}

describe('online signal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('with a client', () => {
    it('turns false 5 s after start when the client never connects', async () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const online = start({ client });

      await vi.advanceTimersByTimeAsync(4_900);
      expect(online()).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(online()).toBe(false);
    });

    it('stays true when the client connects 1 s after start', async () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const online = start({ client });

      await vi.advanceTimersByTimeAsync(1_000);
      client.setConnected(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(online()).toBe(true);
    });

    it('turns false 5 s after a disconnect, and true at once when the client reconnects', async () => {
      const client = new FakeConvexClient();
      const online = start({ client });

      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(4_900);
      expect(online()).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(online()).toBe(false);

      client.setConnected(true);
      expect(online()).toBe(true);
    });

    it('counts 5 s from the latest disconnect, not from an earlier one', async () => {
      const client = new FakeConvexClient();
      const online = start({ client });

      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(3_000);
      client.setConnected(true);
      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(4_900);
      expect(online()).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(online()).toBe(false);
    });

    it('turns false at once on the offline event, and true on online while the socket is up', () => {
      const client = new FakeConvexClient();
      const online = start({ client });

      goOffline();
      expect(online()).toBe(false);
      goOnline();
      expect(online()).toBe(true);
    });

    it('stays false after the online event until the socket that was lost reconnects', async () => {
      const client = new FakeConvexClient();
      const online = start({ client });

      goOffline();
      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(5_000);
      goOnline();
      expect(online()).toBe(false);

      client.setConnected(true);
      expect(online()).toBe(true);
    });

    it('starts false when the browser is already offline', () => {
      stubNavigatorOnLine(false);
      const online = start({ client: new FakeConvexClient() });

      expect(online()).toBe(false);
    });

    it('stops listening when the application is destroyed', () => {
      const client = new FakeConvexClient();
      start({ client });
      expect(client.connectionStateListeners).toBe(1);

      TestBed.resetTestingModule();

      expect(client.connectionStateListeners).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('with no Convex URL', () => {
    it('follows navigator.onLine only', async () => {
      const online = start({ client: null });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(online()).toBe(true);
      goOffline();
      expect(online()).toBe(false);
      goOnline();
      expect(online()).toBe(true);
    });
  });

  describe('on the server', () => {
    it('is always true, even with a disconnected client and the browser offline', async () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      stubNavigatorOnLine(false);
      const online = start({ client, platform: 'server' });

      window.dispatchEvent(new Event('offline'));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(online()).toBe(true);
      expect(client.connectionStateListeners).toBe(0);
    });
  });
});
