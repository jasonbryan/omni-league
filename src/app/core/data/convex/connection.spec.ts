import { PLATFORM_ID, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CONVEX_CLIENT,
  CONVEX_CLIENT_FACTORY,
  CONVEX_URL,
  ConvexConnection,
  injectOfflineTitle,
  injectOnline,
  offlineTitle,
  provideConvex,
} from './index';
import { FakeConvexClient } from './testing/fake-convex-client';

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
  TestBed.tick();
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

describe('why the connection is down', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function connect(client: FakeConvexClient): {
    connection: ConvexConnection;
    online: Signal<boolean>;
  } {
    const online = start({ client });
    return { connection: TestBed.inject(ConvexConnection), online };
  }

  describe('cause', () => {
    it('is offline while nothing shows the site answered', async () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);

      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(6_000);

      expect(connection.cause()).toBe('offline');
    });

    it('is unreachable when the site answered while the socket is down and the browser is online', () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);

      client.setConnected(false);
      connection.markSiteReached();

      expect(connection.cause()).toBe('unreachable');
    });

    it('is offline when the browser is offline, even after the site answered', () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);
      client.setConnected(false);
      connection.markSiteReached();

      goOffline();

      expect(connection.cause()).toBe('offline');
    });

    it('ignores an answer from the site that came while the socket was up', () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);

      connection.markSiteReached();
      client.setConnected(false);

      expect(connection.cause()).toBe('offline');
    });

    it('keeps the answer through a reconnect, so an alert still on screen keeps its title', () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);
      client.setConnected(false);
      connection.markSiteReached();

      client.setConnected(true);

      expect(connection.cause()).toBe('unreachable');
      expect(offlineTitle(connection.cause())).toBe(
        "Can't reach Omni League right now. Nothing was sent.",
      );
    });

    it('forgets the answer when the socket next goes down', () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);
      client.setConnected(false);
      connection.markSiteReached();
      client.setConnected(true);

      client.setConnected(false);

      expect(connection.cause()).toBe('offline');
    });

    it('counts an answer that came before the socket first connected', () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const { connection } = connect(client);

      connection.markSiteReached();

      expect(connection.cause()).toBe('unreachable');
    });
  });

  describe('holding the note while a newer version downloads', () => {
    it('shows the note at 5 s when no newer version was detected', async () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const { online } = connect(client);

      await vi.advanceTimersByTimeAsync(4_900);
      expect(online()).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(online()).toBe(false);
    });

    it('holds the note until 15 s after page start when a newer version was detected before 5 s', async () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const { connection, online } = connect(client);

      await vi.advanceTimersByTimeAsync(1_200);
      connection.markNewerVersionDetected();
      await vi.advanceTimersByTimeAsync(13_700);
      expect(online()).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(online()).toBe(false);
    });

    it('counts the 15 s from the time the socket went down', async () => {
      const client = new FakeConvexClient();
      const { connection, online } = connect(client);
      await vi.advanceTimersByTimeAsync(60_000);

      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(2_000);
      connection.markNewerVersionDetected();
      await vi.advanceTimersByTimeAsync(12_900);
      expect(online()).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(online()).toBe(false);
    });

    it('keeps the note when the version is detected after the note showed', async () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const { connection, online } = connect(client);

      await vi.advanceTimersByTimeAsync(5_000);
      connection.markNewerVersionDetected();

      expect(online()).toBe(false);
    });

    it('does not hold a later drop for a version detected before the socket reconnected', async () => {
      const client = new FakeConvexClient();
      const { connection, online } = connect(client);
      client.setConnected(false);
      connection.markNewerVersionDetected();
      client.setConnected(true);
      await vi.advanceTimersByTimeAsync(60_000);

      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(online()).toBe(false);
    });

    it('shows no note when the socket connects during the hold', async () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const { connection, online } = connect(client);

      connection.markNewerVersionDetected();
      await vi.advanceTimersByTimeAsync(9_000);
      client.setConnected(true);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(online()).toBe(true);
    });

    it('shows the note at once while the browser is offline, with no hold', () => {
      const client = new FakeConvexClient();
      const { connection, online } = connect(client);
      connection.markNewerVersionDetected();

      goOffline();

      expect(online()).toBe(false);
    });
  });

  describe('socket facts for the update check', () => {
    it('tells whether the socket has ever connected', () => {
      const client = new FakeConvexClient();
      client.setConnected(false, { neverConnected: true });
      const { connection } = connect(client);
      expect(connection.hasEverConnected()).toBe(false);

      client.setConnected(true);
      expect(connection.hasEverConnected()).toBe(true);
    });

    it('is down at once, long before the note shows', () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);
      expect(connection.socketDown()).toBe(false);

      client.setConnected(false);

      expect(connection.socketDown()).toBe(true);
    });

    it('reports when the socket is down while the browser is online, and when that stops', () => {
      const client = new FakeConvexClient();
      const { connection } = connect(client);
      const seen: boolean[] = [];
      connection.disconnectedWhileOnline.subscribe((value) => seen.push(value));

      client.setConnected(false);
      client.setConnected(false);
      goOffline();
      goOnline();
      client.setConnected(true);

      expect(seen).toEqual([false, true, false, true, false]);
    });
  });
});

describe('the offline title of a form alert', () => {
  it('names the cause: offline, or unreachable', () => {
    expect(offlineTitle('offline')).toBe("You're offline. Nothing was sent.");
    expect(offlineTitle('unreachable')).toBe(
      "Can't reach Omni League right now. Nothing was sent.",
    );
  });

  it('says what was not done for the other actions', () => {
    expect(offlineTitle('offline', 'removed')).toBe("You're offline. Nothing was removed.");
    expect(offlineTitle('unreachable', 'undone')).toBe(
      "Can't reach Omni League right now. Nothing was undone.",
    );
  });

  it('follows the connection cause as a signal', () => {
    vi.useFakeTimers();
    try {
      const client = new FakeConvexClient();
      TestBed.configureTestingModule({
        providers: [
          provideConvex(),
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
          { provide: CONVEX_CLIENT_FACTORY, useValue: () => client },
        ],
      });
      const title = TestBed.runInInjectionContext(() => injectOfflineTitle());
      const connection = TestBed.inject(ConvexConnection);
      client.setConnected(false);
      expect(title()).toBe("You're offline. Nothing was sent.");

      connection.markSiteReached();
      expect(title()).toBe("Can't reach Omni League right now. Nothing was sent.");
    } finally {
      vi.useRealTimers();
    }
  });
});
