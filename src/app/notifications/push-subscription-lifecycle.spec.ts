import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject, Subject } from 'rxjs';
import type { MockInstance } from 'vitest';
import { AccountSettingsPage } from '../account/account-settings-page';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT, ConvexOfflineError } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { NotificationsPage } from './notifications-page';
import { PushSubscriptionLifecycle, SIGN_OUT_CHECK_WAIT_MS } from './push-subscription-lifecycle';
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
// Stays under Vitest's 5 s test timeout.
const LIFECYCLE_LOAD_TIMEOUT_MS = 4_000;
const LIFECYCLE_LOAD_POLL_MS = 5;

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

/** What the browser holds for the page, shared by the fakes the way the real registration is shared by SwPush and the container. */
class FakeRegistration {
  held: PushSubscription | null = null;
  directUnsubscribes = 0;

  constructor(private readonly log: string[]) {}

  /** A `PushSubscription.unsubscribe()`: it clears the registration but does not reach `SwPush.subscription`. */
  unsubscribeDirectly(): Promise<boolean> {
    this.log.push('PushSubscription.unsubscribe');
    this.directUnsubscribes++;
    this.held = null;
    return Promise.resolve(true);
  }
}

class SwPushSubscriptions extends BehaviorSubject<PushSubscription | null> {
  constructor(private readonly registration: FakeRegistration) {
    super(null);
  }

  override next(value: PushSubscription | null): void {
    this.registration.held = value;
    super.next(value);
  }
}

const never = <T>() => new Promise<T>(() => undefined);

class FakeSwPush {
  isEnabled = true;
  readonly subscription: SwPushSubscriptions;
  readonly pushSubscriptionChanges = new Subject<{
    oldSubscription: PushSubscription | null;
    newSubscription: PushSubscription | null;
  }>();
  readonly requests: { serverPublicKey: string }[] = [];
  nextSubscription: PushSubscription | Error = fakeSubscription(NEW_ENDPOINT);
  holdRequests = false;
  private releaseHeldRequest: (() => void) | null = null;
  unsubscribes = 0;

  constructor(
    private readonly log: string[],
    registration: FakeRegistration,
    private readonly controlled: () => boolean,
  ) {
    this.subscription = new SwPushSubscriptions(registration);
  }

  requestSubscription(options: { serverPublicKey: string }): Promise<PushSubscription> {
    this.log.push('SwPush.requestSubscription');
    this.requests.push(options);
    if (!this.controlled()) return never();
    const next = this.nextSubscription;
    const answer = (): Promise<PushSubscription> => {
      if (next instanceof Error) return Promise.reject(next);
      this.subscription.next(next);
      return Promise.resolve(next);
    };
    if (!this.holdRequests) return answer();
    return new Promise<void>((resolve) => (this.releaseHeldRequest = resolve)).then(answer);
  }

  releaseRequest(): void {
    this.releaseHeldRequest?.();
    this.releaseHeldRequest = null;
  }

  holdUnsubscribes = false;
  private releaseHeldUnsubscribe: (() => void) | null = null;

  unsubscribe(): Promise<void> {
    this.log.push('SwPush.unsubscribe');
    this.unsubscribes++;
    if (!this.controlled()) return never();
    const answer = (): Promise<void> => {
      if (!this.subscription.value) return Promise.reject(new Error('Not subscribed'));
      this.subscription.next(null);
      return Promise.resolve();
    };
    if (!this.holdUnsubscribes) return answer();
    return new Promise<void>((resolve) => (this.releaseHeldUnsubscribe = resolve)).then(answer);
  }

  releaseUnsubscribe(): void {
    this.holdUnsubscribes = false;
    this.releaseHeldUnsubscribe?.();
    this.releaseHeldUnsubscribe = null;
  }
}

class FakePushDevice implements PushDevice {
  hasPushApis = true;
  needsHomeScreenInstall = false;
  readonly permission = signal<DevicePermission>('granted');
  readonly controlled = signal(true);
  readsFail = false;
  private heldReads = 0;
  private readonly releases: (() => void)[] = [];

  constructor(private readonly registration: FakeRegistration) {}

  requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve('granted');
  }

  workerActivated(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** The next `count` reads wait for `releaseReads()` and then answer with what the registration held when they began. */
  holdNextReads(count = 1): void {
    this.heldReads = count;
  }

  releaseReads(): void {
    for (const release of this.releases.splice(0)) release();
  }

  subscription(): Promise<PushSubscription | null> {
    if (this.readsFail) return Promise.reject(new Error('InvalidStateError'));
    const { held } = this.registration;
    const answer = held
      ? { ...held, unsubscribe: () => this.registration.unsubscribeDirectly() }
      : null;
    if (this.heldReads === 0) return Promise.resolve(answer);
    this.heldReads--;
    return new Promise<void>((resolve) => this.releases.push(resolve)).then(() => answer);
  }
}

@Component({ template: 'home' })
class Home {}

describe('PushSubscriptionLifecycle', () => {
  let log: string[];
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let swPush: FakeSwPush;
  let device: FakePushDevice;
  let registration: FakeRegistration;
  let check: MockInstance<PushSubscriptionLifecycle['check']>;

  beforeEach(() => {
    check = vi.spyOn(PushSubscriptionLifecycle.prototype, 'check');
    log = [];
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    registration = new FakeRegistration(log);
    device = new FakePushDevice(registration);
    swPush = new FakeSwPush(log, registration, () => device.controlled());
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
        { provide: PUSH_DEVICE, useValue: device },
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

  // The lifecycle loads through a dynamic import that, in a full run, can outlast any fixed number of timer turns.
  async function convexAccepts() {
    const checksBefore = check.mock.calls.length;
    authService().onChange(true);
    await vi.waitFor(() => expect(check.mock.calls.length).toBeGreaterThan(checksBefore), {
      timeout: LIFECYCLE_LOAD_TIMEOUT_MS,
      interval: LIFECYCLE_LOAD_POLL_MS,
    });
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

    it('does nothing without a browser subscription', async () => {
      await signedIn();
      await convexAccepts();

      expect(statusQueries()).toEqual([]);
      expect(log).toEqual([]);
    });

    it('reads the subscription without a worker too, and unsubscribes it directly when the row is not the user’s', async () => {
      swPush.isEnabled = false;
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signedIn();
      await convexAccepts();
      await answerStatus(false);

      expect(log).toEqual(['PushSubscription.unsubscribe']);
      expect(swPush.unsubscribes).toBe(0);
    });

    describe('on a page no worker controls', () => {
      beforeEach(() => {
        device.controlled.set(false);
      });

      it('asks about the held subscription and unsubscribes it once, without subscribing, when the row is not the user’s', async () => {
        registration.held = fakeSubscription(ENDPOINT);
        await signedIn();
        await convexAccepts();
        expect(statusQueries().map((s) => s.args)).toEqual([{ endpoint: ENDPOINT }]);

        await answerStatus(false);

        expect(registration.directUnsubscribes).toBe(1);
        expect(registration.held).toBeNull();
        expect(swPush.unsubscribes).toBe(0);
        expect(convex.calls).toEqual([]);
      });

      it('saves the same endpoint again once when the row is the user’s and the key is current', async () => {
        registration.held = fakeSubscription(ENDPOINT);
        await signedIn();
        await convexAccepts();
        await answerStatus(true);
        await answerConfig();

        expect(
          callsTo('push:subscribe').map((c) => (c.args as { endpoint: string }).endpoint),
        ).toEqual([ENDPOINT]);
        expect(registration.directUnsubscribes).toBe(0);
      });

      for (const [title, options] of [
        ['an old key', { key: OLD_KEY }],
        ['a past expirationTime', { expirationTime: Date.now() - 1000 }],
      ] as const) {
        it(`changes nothing when the row is the user’s but has ${title}`, async () => {
          registration.held = fakeSubscription(ENDPOINT, options);
          await signedIn();
          await convexAccepts();
          await answerStatus(true);
          await answerConfig();
          await settleCalls();

          expect(swPush.requests).toEqual([]);
          expect(swPush.unsubscribes).toBe(0);
          expect(registration.directUnsubscribes).toBe(0);
          expect(convex.calls).toEqual([]);
          expect(registration.held?.endpoint).toBe(ENDPOINT);
        });
      }
    });
  });

  describe('a key or subscription change', () => {
    async function expectReplaced() {
      await settleCalls();
      expect(log).toEqual([
        'SwPush.unsubscribe',
        'SwPush.requestSubscription',
        'push:subscribe',
        'push:unsubscribe',
      ]);
      expect(callsTo('push:unsubscribe').map((c) => c.args)).toEqual([{ endpoint: ENDPOINT }]);
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

      await expectReplaced();
    });

    it('subscribes again when expirationTime has passed', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { expirationTime: Date.now() - 1000 }));
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      await answerConfig();

      await expectReplaced();
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

      await expectReplaced();
    });

    it('saves nothing when the browser subscription changed after the status query confirmed it', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signedIn();
      await convexAccepts();
      await answerStatus(true);
      swPush.subscription.next(fakeSubscription(NEW_ENDPOINT));
      await answerConfig();

      expect(convex.calls).toEqual([]);
      expect(swPush.unsubscribes).toBe(0);
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

    it('shows Off when the browser refuses to subscribe again and removing the old row fails offline', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { key: OLD_KEY }));
      swPush.nextSubscription = new Error('NotAllowedError');
      const page = await openPage();

      await answerStatus(true);
      await answerConfig();
      for (const call of callsTo('push:unsubscribe'))
        call.reject(new ConvexOfflineError('offline'));
      await flush();

      expect(log).toEqual(['SwPush.unsubscribe', 'SwPush.requestSubscription', 'push:unsubscribe']);
      expect(registration.directUnsubscribes).toBe(0);
      expect(badge(page)).toBe('Off');
    });
  });

  describe('sign-out', () => {
    async function openAccountSettings() {
      await signedIn();
      const harness = await RouterTestingHarness.create('/app/account');
      await convexAccepts();
      return [...harness.routeNativeElement!.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Sign out'),
      )!;
    }

    async function signOutFromAccountSettings() {
      const button = await openAccountSettings();
      for (const sub of statusQueries()) sub.fail(new Error('Sign in required'));
      await flush();
      button.click();
      await flush();
    }

    it('during a re-subscribe for a new key, ends with no browser subscription and saves nothing', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { key: OLD_KEY }));
      swPush.holdRequests = true;
      const button = await openAccountSettings();
      await answerStatus(true);
      await answerConfig();
      expect(log).toEqual(['SwPush.unsubscribe', 'SwPush.requestSubscription']);

      button.click();
      await flush();
      expect(log).not.toContain('session ends');
      swPush.releaseRequest();
      await flush();
      await settleCalls();

      expect(log).toEqual([
        'SwPush.unsubscribe',
        'SwPush.requestSubscription',
        'SwPush.unsubscribe',
        'push:unsubscribe',
        'session ends',
      ]);
      expect(callsTo('push:unsubscribe').map((c) => c.args)).toEqual([{ endpoint: ENDPOINT }]);
      expect(callsTo('push:subscribe')).toEqual([]);
      expect(swPush.subscription.value).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/');
    });

    /** Signs out while the check waits on a status query that never answers, past the bounded wait. */
    async function signOutPastTheWait(
      button: HTMLButtonElement,
      browserUnsubscribe = 'SwPush.unsubscribe',
    ) {
      vi.useFakeTimers();
      try {
        button.click();
        await vi.advanceTimersByTimeAsync(SIGN_OUT_CHECK_WAIT_MS - 100);
        expect(log).toEqual([]);
        await vi.advanceTimersByTimeAsync(200);
        for (const call of callsTo('push:unsubscribe')) call.resolve(null);
        await vi.advanceTimersByTimeAsync(100);
      } finally {
        vi.useRealTimers();
      }
      await flush();
      expect(log).toEqual(['push:unsubscribe', browserUnsubscribe, 'session ends']);
    }

    const signOutOutcome = () => log.slice(log.indexOf('session ends') + 1);

    for (const [title, key] of [
      ['the same key', CURRENT_KEY],
      ['an old key', OLD_KEY],
    ] as const) {
      it(`waits a bounded time for a check held up offline, and a late true status with ${title} saves nothing`, async () => {
        swPush.subscription.next(fakeSubscription(ENDPOINT, { key }));
        const button = await openAccountSettings();
        await signOutPastTheWait(button);

        await answerStatus(true);
        await answerConfig();

        expect(signOutOutcome()).toEqual([]);
        expect(callsTo('push:subscribe')).toEqual([]);
        expect(swPush.requests).toEqual([]);
        expect(TestBed.inject(Router).url).toBe('/');
      });
    }

    it('a late false status after the wait leaves the next user’s subscription alone', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      const button = await openAccountSettings();
      await signOutPastTheWait(button);
      const [staleQuery] = statusQueries();

      swPush.subscription.next(fakeSubscription(NEW_ENDPOINT));
      auth.emitSession({ id: 's2' });
      await convexAccepts();
      staleQuery.emit(false);
      await flush();

      expect(signOutOutcome()).toEqual([]);
      expect(swPush.subscription.value?.endpoint).toBe(NEW_ENDPOINT);
      expect(statusQueries().map((s) => s.args)).toEqual([{ endpoint: NEW_ENDPOINT }]);
    });

    it('a task queued before sign-out that starts after the wait asks nothing', async () => {
      const old = fakeSubscription(ENDPOINT);
      swPush.subscription.next(old);
      const button = await openAccountSettings();
      swPush.pushSubscriptionChanges.next({ oldSubscription: old, newSubscription: null });
      await signOutPastTheWait(button);

      for (const sub of statusQueries()) sub.fail(new Error('Sign in required'));
      await flush();

      expect(statusQueries()).toEqual([]);
      expect(signOutOutcome()).toEqual([]);
    });

    it('a task queued while sign-out runs does nothing, even after the session ends', async () => {
      const old = fakeSubscription(ENDPOINT);
      swPush.subscription.next(old);
      await signOutFromAccountSettings();
      expect(log).toEqual(['push:unsubscribe']);

      swPush.pushSubscriptionChanges.next({ oldSubscription: old, newSubscription: null });
      authService().onChange(true);
      await flush();
      for (const call of callsTo('push:unsubscribe')) call.resolve(null);
      await flush();

      expect(log).toEqual(['push:unsubscribe', 'SwPush.unsubscribe', 'session ends']);
      expect(statusQueries()).toEqual([]);
      expect(swPush.requests).toEqual([]);
    });

    it('a check whose config arrives during sign-out saves nothing', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      const button = await openAccountSettings();
      await answerStatus(true);
      button.click();
      await flush();
      await answerConfig();

      expect(callsTo('push:subscribe')).toEqual([]);
      for (const call of callsTo('push:unsubscribe')) call.resolve(null);
      await flush();
      expect(log).toEqual(['push:unsubscribe', 'SwPush.unsubscribe', 'session ends']);
    });

    it('a subscription change whose config arrives during sign-out does not subscribe again', async () => {
      const old = fakeSubscription(ENDPOINT);
      swPush.subscription.next(old);
      const button = await openAccountSettings();
      for (const sub of statusQueries()) sub.fail(new Error('Sign in required'));
      await flush();
      swPush.pushSubscriptionChanges.next({ oldSubscription: old, newSubscription: null });
      await flush();
      await answerStatus(true);
      button.click();
      await flush();
      await answerConfig();
      for (const call of callsTo('push:unsubscribe')) call.resolve(null);
      await flush();

      expect(log).toEqual(['push:unsubscribe', 'SwPush.unsubscribe', 'session ends']);
      expect(swPush.requests).toEqual([]);
      expect(callsTo('push:subscribe')).toEqual([]);
    });

    it('sign-out while a re-subscribe unsubscribes the old one does not subscribe again', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT, { key: OLD_KEY }));
      swPush.holdUnsubscribes = true;
      const button = await openAccountSettings();
      await answerStatus(true);
      await answerConfig();
      expect(log).toEqual(['SwPush.unsubscribe']);

      button.click();
      await flush();
      swPush.releaseUnsubscribe();
      await flush();
      for (const call of callsTo('push:unsubscribe')) call.resolve(null);
      await flush();

      expect(log).toEqual(['SwPush.unsubscribe', 'push:unsubscribe', 'session ends']);
      expect(swPush.requests).toEqual([]);
      expect(callsTo('push:subscribe')).toEqual([]);
      expect(swPush.subscription.value).toBeNull();
    });

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

    it('unsubscribes the held subscription directly without a worker, and goes to /', async () => {
      swPush.isEnabled = false;
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await signOutFromAccountSettings();
      for (const call of callsTo('push:unsubscribe')) call.resolve(null);
      await flush();

      expect(log).toEqual(['push:unsubscribe', 'PushSubscription.unsubscribe', 'session ends']);
      expect(swPush.unsubscribes).toBe(0);
      expect(TestBed.inject(Router).url).toBe('/');
    });

    it('unsubscribes through SwPush on a controlled page, so the subscription stream emits null', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      const emitted: (string | undefined)[] = [];
      const watch = swPush.subscription.subscribe((value) => emitted.push(value?.endpoint));
      await signOutFromAccountSettings();
      for (const call of callsTo('push:unsubscribe')) call.resolve(null);
      await flush();
      watch.unsubscribe();

      expect(log).toEqual(['push:unsubscribe', 'SwPush.unsubscribe', 'session ends']);
      expect(emitted).toEqual([ENDPOINT, undefined]);
      expect(registration.directUnsubscribes).toBe(0);
    });

    describe('with no clock moving', () => {
      /** Fake timers that never advance past the current instant, so a wait the sign-out hides fails the test. */
      async function settleWithoutTime() {
        for (let i = 0; i < 10; i++) {
          TestBed.tick();
          await vi.advanceTimersByTimeAsync(0);
        }
      }

      async function signOutWithoutTime(button: HTMLButtonElement) {
        vi.useFakeTimers();
        try {
          button.click();
          await settleWithoutTime();
          for (const call of callsTo('push:unsubscribe')) call.resolve(null);
          await settleWithoutTime();
        } finally {
          vi.useRealTimers();
        }
      }

      async function failStatusQueries() {
        for (const sub of statusQueries()) sub.fail(new Error('Sign in required'));
        await flush();
      }

      it('unsubscribes the held subscription directly on a page no worker controls', async () => {
        device.controlled.set(false);
        registration.held = fakeSubscription(ENDPOINT);
        const button = await openAccountSettings();
        await failStatusQueries();

        await signOutWithoutTime(button);

        expect(log).toEqual(['push:unsubscribe', 'PushSubscription.unsubscribe', 'session ends']);
        expect(callsTo('push:unsubscribe').map((c) => c.args)).toEqual([{ endpoint: ENDPOINT }]);
        expect(registration.held).toBeNull();
        expect(swPush.unsubscribes).toBe(0);
        expect(TestBed.inject(Router).url).toBe('/');
      });

      for (const controlled of [true, false]) {
        it(`only ends the session when there is no registration (controlled: ${controlled})`, async () => {
          device.controlled.set(controlled);
          const button = await openAccountSettings();

          await signOutWithoutTime(button);

          expect(log).toEqual(['session ends']);
          expect(TestBed.inject(Router).url).toBe('/');
        });
      }

      it('still ends the session when reading the subscription rejects', async () => {
        registration.held = fakeSubscription(ENDPOINT);
        const button = await openAccountSettings();
        await failStatusQueries();
        device.readsFail = true;

        await signOutWithoutTime(button);

        expect(log).toEqual(['session ends']);
        expect(TestBed.inject(Router).url).toBe('/');
      });

      it('starts no status query for a check whose read finishes after sign-out', async () => {
        device.controlled.set(false);
        registration.held = fakeSubscription(ENDPOINT);
        device.holdNextReads();
        await signedIn();
        const harness = await RouterTestingHarness.create('/app/account');
        await convexAccepts();
        const button = [...harness.routeNativeElement!.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Sign out'),
        )!;
        expect(statusQueries()).toEqual([]);

        vi.useFakeTimers();
        try {
          button.click();
          await vi.advanceTimersByTimeAsync(SIGN_OUT_CHECK_WAIT_MS + 100);
          for (const call of callsTo('push:unsubscribe')) call.resolve(null);
          await vi.advanceTimersByTimeAsync(100);
        } finally {
          vi.useRealTimers();
        }
        device.releaseReads();
        await flush();

        expect(log).toEqual(['push:unsubscribe', 'PushSubscription.unsubscribe', 'session ends']);
        expect(statusQueries()).toEqual([]);
        expect(callsTo('push:subscribe')).toEqual([]);
      });
    });

    describe('on a page no worker controls', () => {
      beforeEach(() => {
        device.controlled.set(false);
      });

      it('a late true status after the wait saves nothing', async () => {
        registration.held = fakeSubscription(ENDPOINT);
        const button = await openAccountSettings();
        await signOutPastTheWait(button, 'PushSubscription.unsubscribe');

        await answerStatus(true);
        await answerConfig();

        expect(signOutOutcome()).toEqual([]);
        expect(callsTo('push:subscribe')).toEqual([]);
        expect(swPush.requests).toEqual([]);
      });

      it('a late false status after the wait leaves the next user’s subscription alone', async () => {
        registration.held = fakeSubscription(ENDPOINT);
        const button = await openAccountSettings();
        await signOutPastTheWait(button, 'PushSubscription.unsubscribe');
        const [staleQuery] = statusQueries();

        registration.held = fakeSubscription(NEW_ENDPOINT);
        auth.emitSession({ id: 's2' });
        await convexAccepts();
        staleQuery.emit(false);
        await flush();

        expect(signOutOutcome()).toEqual([]);
        expect(registration.held?.endpoint).toBe(NEW_ENDPOINT);
        expect(statusQueries().map((s) => s.args)).toEqual([{ endpoint: NEW_ENDPOINT }]);
      });

      it('leaves the browser subscription alone when sign-out starts while the unsubscribe reads it', async () => {
        registration.held = fakeSubscription(ENDPOINT);
        const button = await openAccountSettings();
        device.holdNextReads();
        await answerStatus(false);

        await signOutPastTheWait(button, 'PushSubscription.unsubscribe');
        device.releaseReads();
        await flush();

        expect(log).toEqual(['push:unsubscribe', 'PushSubscription.unsubscribe', 'session ends']);
        expect(registration.directUnsubscribes).toBe(1);
      });
    });
  });
});
