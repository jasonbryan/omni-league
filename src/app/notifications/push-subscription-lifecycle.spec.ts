import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject, Subject } from 'rxjs';
import { AccountSettingsPage } from '../account/account-settings-page';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT, ConvexOfflineError } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { NotificationsPage } from './notifications-page';
import { PUSH_DEVICE, type DevicePermission, type PushDevice } from './push-device';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const keyBytes = (seed: number) =>
  Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i + seed) % 256));
const CURRENT_KEY = keyBytes(1);
const OLD_KEY = keyBytes(7);
const VAPID_KEY = base64Url(CURRENT_KEY);
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';
const NEW_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-2';

function fakeSubscription(
  endpoint: string,
  { key = CURRENT_KEY, expirationTime = null as number | null } = {},
): PushSubscription {
  return {
    endpoint,
    expirationTime,
    options: { applicationServerKey: key.slice().buffer, userVisibleOnly: true },
    toJSON: () => ({
      endpoint,
      expirationTime,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    }),
  } as unknown as PushSubscription;
}

class FakeSwPush {
  isEnabled = true;
  readonly subscription = new BehaviorSubject<PushSubscription | null>(null);
  readonly pushSubscriptionChanges = new Subject<{
    oldSubscription: PushSubscription | null;
    newSubscription: PushSubscription | null;
  }>();
  readonly requests: { serverPublicKey: string }[] = [];
  nextSubscription: PushSubscription | Error = fakeSubscription(NEW_ENDPOINT);
  unsubscribes = 0;

  constructor(private readonly log: string[]) {}

  requestSubscription(options: { serverPublicKey: string }): Promise<PushSubscription> {
    this.log.push('SwPush.requestSubscription');
    this.requests.push(options);
    const next = this.nextSubscription;
    if (next instanceof Error) return Promise.reject(next);
    this.subscription.next(next);
    return Promise.resolve(next);
  }

  unsubscribe(): Promise<void> {
    this.log.push('SwPush.unsubscribe');
    this.unsubscribes++;
    if (!this.subscription.value) return Promise.reject(new Error('Not subscribed'));
    this.subscription.next(null);
    return Promise.resolve();
  }
}

class FakePushDevice implements PushDevice {
  hasPushApis = true;
  needsHomeScreenInstall = false;
  readonly permission = signal<DevicePermission>('granted');
  readonly controlled = signal(true);
  requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve('granted');
  }
}

@Component({ template: 'home' })
class Home {}

describe('PushSubscriptionLifecycle', () => {
  let log: string[];
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let swPush: FakeSwPush;

  beforeEach(() => {
    log = [];
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    swPush = new FakeSwPush(log);
    const signOut = auth.signOut;
    Object.assign(auth, {
      signOut: () => {
        log.push('session ends');
        return signOut();
      },
    });
    const mutation = convex.mutation;
    Object.assign(convex, {
      mutation: (...args: Parameters<typeof mutation>) => {
        const result = mutation(...args);
        log.push(convex.calls.at(-1)!.name);
        return result;
      },
    });
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        { provide: SwPush, useValue: swPush },
        { provide: PUSH_DEVICE, useValue: new FakePushDevice() },
        provideRouter([
          { path: 'app/notifications', component: NotificationsPage },
          { path: 'app/account', component: AccountSettingsPage },
          { path: '', component: Home },
        ]),
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function flush() {
    for (let i = 0; i < 10; i++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const authService = () => TestBed.inject(AuthService);

  async function signedIn() {
    auth.emitSession({ id: 's1' });
    authService();
    await flush();
  }

  async function convexAccepts() {
    authService().onChange(true);
    await flush();
  }

  const statusQueries = () =>
    convex.activeSubscriptions.filter((s) => s.name === 'push:getMyDeviceStatus');
  const callsTo = (name: string) => convex.calls.filter((c) => c.name === name);

  async function answerStatus(owned: boolean) {
    for (const sub of statusQueries()) sub.emit(owned);
    await flush();
  }

  async function answerConfig() {
    for (const sub of convex.activeSubscriptions.filter((s) => s.name === 'push:getConfig')) {
      sub.emit({ vapidPublicKey: VAPID_KEY });
    }
    await flush();
  }

  async function settleCalls() {
    for (const call of [...convex.calls]) call.resolve(null);
    await flush();
  }

  describe('the start-up and sign-in check', () => {
    it('unsubscribes the browser once and saves nothing when the row is not the user’s', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signedIn();
      await convexAccepts();
      expect(statusQueries().map((s) => s.args)).toEqual([{ endpoint: ENDPOINT }]);

      await answerStatus(false);

      expect(swPush.unsubscribes).toBe(1);
      expect(convex.calls).toEqual([]);
      expect(swPush.subscription.value).toBeNull();
    });

    it('runs again after the next sign-in', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();
      await settleCalls();
      expect(callsTo('push:subscribe')).toHaveLength(1);

      await convexAccepts();
      expect(statusQueries().map((s) => s.args)).toEqual([{ endpoint: ENDPOINT }]);
      await answerStatus(false);

      expect(swPush.unsubscribes).toBe(1);
      expect(callsTo('push:subscribe')).toHaveLength(1);
    });

    it('saves the same endpoint again once, and keeps the browser subscription, when the row is the user’s', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();

      expect(callsTo('push:subscribe').map((c) => c.args)).toEqual([
        {
          endpoint: ENDPOINT,
          expirationTime: null,
          keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
        },
      ]);
      expect(swPush.unsubscribes).toBe(0);
      expect(swPush.requests).toEqual([]);
    });

    it('does nothing while no user is signed in', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      auth.emitSession(null);
      authService();
      await flush();

      expect(statusQueries()).toEqual([]);
      expect(swPush.unsubscribes).toBe(0);
      expect(convex.calls).toEqual([]);
    });

    it('waits for the Convex client to be authenticated, not only for the session', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signedIn();
      expect(authService().signedIn()).toBe(true);
      expect(convex.subscriptions.filter((s) => s.name === 'push:getMyDeviceStatus')).toEqual([]);

      await convexAccepts();

      expect(statusQueries()).toHaveLength(1);
    });

    for (const [title, error] of [
      ['unauthenticated during the token fetch', new Error('Sign in required')],
      ['offline', new ConvexOfflineError('offline')],
    ] as const) {
      it(`changes nothing when the status query fails (${title})`, async () => {
        swPush.subscription.next(fakeSubscription(ENDPOINT));
        await signedIn();
        await convexAccepts();

        for (const sub of statusQueries()) sub.fail(error);
        await flush();

        expect(swPush.unsubscribes).toBe(0);
        expect(convex.calls).toEqual([]);
        expect(swPush.subscription.value?.endpoint).toBe(ENDPOINT);
      });
    }

    it('does nothing without a browser subscription, or without a worker', async () => {
      await signedIn();
      await convexAccepts();
      expect(statusQueries()).toEqual([]);

      swPush.isEnabled = false;
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await convexAccepts();
      expect(statusQueries()).toEqual([]);
      expect(swPush.unsubscribes).toBe(0);
    });
  });

  describe('a key or subscription change', () => {
    function expectReplaced() {
      expect(log.filter((entry) => entry.startsWith('SwPush.'))).toEqual([
        'SwPush.unsubscribe',
        'SwPush.requestSubscription',
      ]);
      expect(swPush.requests).toEqual([{ serverPublicKey: VAPID_KEY }]);
      expect(
        callsTo('push:subscribe').map((c) => (c.args as { endpoint: string }).endpoint),
      ).toEqual([NEW_ENDPOINT]);
      expect(swPush.subscription.value?.endpoint).toBe(NEW_ENDPOINT);
    }

    it('subscribes again with the current key when the key differs from getConfig', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { key: OLD_KEY }));
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();

      expectReplaced();
    });

    it('subscribes again when expirationTime has passed', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { expirationTime: Date.now() - 1000 }));
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();

      expectReplaced();
    });

    it('subscribes again when pushSubscriptionChanges reports a new subscription', async () => {
      const old = fakeSubscription(ENDPOINT);
      swPush.subscription.next(old);
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();
      await settleCalls();
      convex.calls.length = 0;
      log.length = 0;

      swPush.pushSubscriptionChanges.next({ oldSubscription: old, newSubscription: null });
      await flush();
      expect(statusQueries().map((s) => s.args)).toEqual([{ endpoint: ENDPOINT }]);
      await answerStatus(true);
      await answerConfig();

      expectReplaced();
    });

    it('keeps no subscription, saves nothing, and removes the old row when the browser refuses to subscribe again', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { key: OLD_KEY }));
      swPush.nextSubscription = new Error('NotAllowedError');
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();

      expect(swPush.subscription.value).toBeNull();
      expect(callsTo('push:subscribe')).toEqual([]);
      expect(callsTo('push:unsubscribe').map((c) => c.args)).toEqual([{ endpoint: ENDPOINT }]);
    });

    it('still keeps no subscription when removing the old row fails offline', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { key: OLD_KEY }));
      swPush.nextSubscription = new Error('NotAllowedError');
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();
      for (const call of callsTo('push:unsubscribe'))
        call.reject(new ConvexOfflineError('offline'));
      await flush();

      expect(swPush.subscription.value).toBeNull();
      expect(callsTo('push:subscribe')).toEqual([]);
    });
  });

  describe('the notifications page', () => {
    const badge = (page: HTMLElement) =>
      page
        .querySelector('section[aria-labelledby="device-heading"] [data-slot="badge"]')
        ?.textContent?.trim();

    async function openPage() {
      await signedIn();
      const harness = await RouterTestingHarness.create('/app/notifications');
      await convexAccepts();
      await answerConfig();
      return harness.routeNativeElement!;
    }

    it('shows Off when the check finds another user’s row', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      const page = await openPage();

      await answerStatus(false);

      expect(swPush.unsubscribes).toBe(1);
      expect(badge(page)).toBe('Off');
    });

    it('shows Off when the browser refuses to subscribe again', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { key: OLD_KEY }));
      swPush.nextSubscription = new Error('NotAllowedError');
      const page = await openPage();

      await answerStatus(true);
      await answerConfig();

      expect(callsTo('push:subscribe')).toEqual([]);
      expect(badge(page)).toBe('Off');
    });
  });

  describe('sign-out', () => {
    async function signOutFromAccountSettings() {
      await signedIn();
      const harness = await RouterTestingHarness.create('/app/account');
      await convexAccepts();
      const button = [...harness.routeNativeElement!.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Sign out'),
      )!;
      button.click();
      await flush();
    }

    it('removes the row and then the browser subscription before the session ends', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signOutFromAccountSettings();
      expect(log).toEqual(['push:unsubscribe']);
      expect(callsTo('push:unsubscribe').map((c) => c.args)).toEqual([{ endpoint: ENDPOINT }]);

      for (const call of callsTo('push:unsubscribe')) call.resolve(null);
      await flush();

      expect(log).toEqual(['push:unsubscribe', 'SwPush.unsubscribe', 'session ends']);
      expect(TestBed.inject(Router).url).toBe('/');
    });

    it('still unsubscribes the browser and goes to / when push.unsubscribe fails offline', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signOutFromAccountSettings();
      for (const call of callsTo('push:unsubscribe'))
        call.reject(new ConvexOfflineError('offline'));
      await flush();

      expect(log).toEqual(['push:unsubscribe', 'SwPush.unsubscribe', 'session ends']);
      expect(TestBed.inject(Router).url).toBe('/');
    });

    it('calls neither without a worker, and goes to /', async () => {
      swPush.isEnabled = false;
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signOutFromAccountSettings();

      expect(callsTo('push:unsubscribe')).toEqual([]);
      expect(swPush.unsubscribes).toBe(0);
      expect(log).toEqual(['session ends']);
      expect(TestBed.inject(Router).url).toBe('/');
    });
  });
});
