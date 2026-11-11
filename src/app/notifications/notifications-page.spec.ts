import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject, Subject } from 'rxjs';
import type { Mock } from 'vitest';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT, ConvexOfflineError } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { RELOAD_PAGE } from '../core/service-worker/app-updates';
import { NotificationsPage } from './notifications-page';
import { PUSH_DEVICE, type DevicePermission, type PushDevice } from './push-device';
import { PushSubscriptionLifecycle } from './push-subscription-lifecycle';
import { expectPendingSpinner } from '../ui/testing/spinner';

const VAPID_KEY = 'BPublicKeyFromGetConfig';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';

class FakeSwPush {
  isEnabled = true;
  /** A plain Subject on an uncontrolled page, where the real one emits nothing. */
  subscription: Subject<PushSubscription | null> = new BehaviorSubject<PushSubscription | null>(
    null,
  );
  readonly requests: { serverPublicKey: string }[] = [];
  nextSubscription: PushSubscription | Error = fakeSubscription(ENDPOINT);
  unsubscribes = 0;
  unsubscribeRejects = false;

  requestSubscription(options: { serverPublicKey: string }): Promise<PushSubscription> {
    this.requests.push(options);
    const next = this.nextSubscription;
    if (next instanceof Error) return Promise.reject(next);
    this.subscription.next(next);
    return Promise.resolve(next);
  }

  unsubscribe(): Promise<void> {
    this.unsubscribes++;
    if (this.unsubscribeRejects) return Promise.reject(new Error('no worker'));
    this.subscription.next(null);
    return Promise.resolve();
  }
}

function fakeSubscription(
  endpoint: string,
  unsubscribe: () => Promise<boolean> = () => Promise.resolve(true),
): PushSubscription {
  return {
    endpoint,
    expirationTime: null,
    unsubscribe,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    }),
  } as unknown as PushSubscription;
}

class FakePushDevice implements PushDevice {
  hasPushApis = true;
  needsHomeScreenInstall = false;
  readonly permission = signal<DevicePermission>('default');
  readonly controlled = signal(true);
  readonly permissionRequests: number[] = [];
  registrationSubscription: PushSubscription | null = null;
  activated = false;
  subscriptionReads = 0;
  /** A pending read keeps `whenStable` from settling, so `settle` skips it while one is held. */
  holdingRead = false;
  private gates = { subscription: Promise.resolve(), activated: Promise.resolve() };
  private answer: ((permission: NotificationPermission) => void) | null = null;
  /** The order of calls across the fakes, so a test can check what came first. */
  constructor(private readonly log: string[]) {}

  requestPermission(): Promise<NotificationPermission> {
    this.log.push('requestPermission');
    this.permissionRequests.push(Date.now());
    return new Promise((resolve) => {
      this.answer = (permission) => {
        this.permission.set(permission);
        resolve(permission);
      };
    });
  }

  subscription(): Promise<PushSubscription | null> {
    this.subscriptionReads++;
    return this.gates.subscription.then(() => this.registrationSubscription);
  }

  workerActivated(): Promise<boolean> {
    return this.gates.activated.then(() => this.activated);
  }

  /** Keeps one read unanswered until the returned function is called. */
  holdRead(read: 'subscription' | 'activated'): () => void {
    this.holdingRead = true;
    let release!: () => void;
    this.gates[read] = new Promise<void>((resolve) => (release = resolve));
    return () => {
      this.holdingRead = false;
      release();
    };
  }

  respond(permission: NotificationPermission): void {
    this.answer?.(permission);
  }
}

describe('NotificationsPage', () => {
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let swPush: FakeSwPush;
  let device: FakePushDevice;
  let log: string[];
  let reloadPage: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  function configure() {
    log = [];
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    swPush = new FakeSwPush();
    device = new FakePushDevice(log);
    reloadPage = vi.fn();
    const originalRequest = swPush.requestSubscription.bind(swPush);
    swPush.requestSubscription = (options) => {
      log.push('requestSubscription');
      return originalRequest(options);
    };
  }

  async function open({ realDevice = false } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        { provide: SwPush, useValue: swPush },
        // The start-up check has its own spec; here it would answer the page's status query too.
        {
          provide: PushSubscriptionLifecycle,
          useValue: {
            check: () => Promise.resolve(),
            signOut: (endSession: () => Promise<void>) => endSession(),
          },
        },
        { provide: RELOAD_PAGE, useValue: reloadPage },
        ...(realDevice ? [] : [{ provide: PUSH_DEVICE, useValue: device }]),
        provideRouter([{ path: 'app/notifications', component: NotificationsPage }]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create('/app/notifications');
    page = harness.routeNativeElement!;
    TestBed.inject(AuthService).onChange(true);
    await settle();
  }

  async function settle() {
    TestBed.tick();
    if (!device.holdingRead) await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();
    if (!device.holdingRead) await harness.fixture.whenStable();
  }

  const subscriptionsTo = (name: string) =>
    convex.activeSubscriptions.filter((s) => s.name === name);
  async function emitConfig(vapidPublicKey: string | null) {
    for (const sub of subscriptionsTo('push:getConfig')) sub.emit({ vapidPublicKey });
    await settle();
  }
  async function emitStatus(value: boolean) {
    for (const sub of subscriptionsTo('push:getMyDeviceStatus')) sub.emit(value);
    await settle();
  }
  const panel = () => page.querySelector<HTMLElement>('section[aria-labelledby="device-heading"]')!;
  const text = (el: Element | null | undefined) =>
    el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const badge = () => text(panel().querySelector('[data-slot="badge"]'));
  const button = () => panel().querySelector<HTMLButtonElement>('button');
  // The result region sits last in the panel, in the page from the first render, so a change is announced.
  const changeStatus = () => text([...panel().querySelectorAll('[role="status"]')].at(-1));
  const alertBox = () => panel().querySelector<HTMLElement>('[data-slot="alert"]');

  async function goOffline() {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    await settle();
  }

  async function goOnline() {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();
  }

  beforeEach(() => {
    configure();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has one h1, the breadcrumb back to Home, and the device-only note', async () => {
    await open();
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(text(page.querySelector('h1'))).toBe('Notifications');
    const crumbs = [...page.querySelectorAll('nav[aria-label="Breadcrumb"] a')];
    expect(
      crumbs.map((a) => [text(a), a.getAttribute('href'), a.getAttribute('aria-current')]),
    ).toEqual([
      ['Home', '/app', null],
      ['Notifications', '/app/notifications', 'page'],
    ]);
    expect(text(page)).toContain(
      'This setting is for this device only. Turn notifications on in each browser or installed app where you want them. Signing out turns them off here.',
    );
  });

  describe('checking', () => {
    it('shows skeleton lines and a polite status until the device is known', async () => {
      await open();
      expect(badge()).toBe('');
      expect(text(panel().querySelector('[role="status"]'))).toBe(
        'Checking notifications on this device.',
      );
      expect(panel().querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0);
      expect(button()).toBeNull();
    });

    it('stays checking while a browser subscription waits for push.getMyDeviceStatus', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      await open();
      await emitConfig(VAPID_KEY);
      expect(subscriptionsTo('push:getMyDeviceStatus').map((s) => s.args)).toEqual([
        { endpoint: ENDPOINT },
      ]);
      expect(text(panel().querySelector('[role="status"]'))).toBe(
        'Checking notifications on this device.',
      );
    });
  });

  describe('not available', () => {
    const NOT_AVAILABLE =
      "This browser can't show notifications from Omni League. Try a current version of Chrome, Edge, Firefox, or Safari. On an iPhone or iPad, you need iOS 16.4 or later.";

    it.each([
      ['the deployment has no VAPID key', () => undefined, null],
      ['there is no service worker', () => (swPush.isEnabled = false), VAPID_KEY],
      ['the browser has no Push API', () => (device.hasPushApis = false), VAPID_KEY],
    ])('shows when %s, with no button', async (_case, arrange, key) => {
      arrange();
      await open();
      await emitConfig(key);
      expect(badge()).toBe('Not available');
      expect(text(panel())).toContain(NOT_AVAILABLE);
      expect(button()).toBeNull();
    });

    it('shows with the real device when the Notification global is absent, with no button', async () => {
      const win = window as unknown as Record<string, unknown>;
      const navigatorWithWorker = navigator as unknown as Record<string, unknown>;
      const notification = Object.getOwnPropertyDescriptor(window, 'Notification');
      delete win['Notification'];
      expect('Notification' in window).toBe(false);
      vi.stubGlobal('PushManager', class {});
      Object.defineProperty(navigatorWithWorker, 'serviceWorker', {
        value: new EventTarget(),
        configurable: true,
      });
      try {
        await open({ realDevice: true });
        await emitConfig(VAPID_KEY);
        expect(badge()).toBe('Not available');
        expect(text(panel())).toContain(NOT_AVAILABLE);
        expect(button()).toBeNull();
      } finally {
        delete navigatorWithWorker['serviceWorker'];
        vi.unstubAllGlobals();
        if (notification) Object.defineProperty(window, 'Notification', notification);
      }
    });

    it('shows when the browser’s push service is outside the allow-list, removing that subscription', async () => {
      swPush.nextSubscription = fakeSubscription('https://push.example.com/x');
      await open();
      await emitConfig(VAPID_KEY);
      button()!.click();
      device.respond('granted');
      await settle();
      expect(convex.calls).toEqual([]);
      expect(swPush.unsubscribes).toBe(1);
      expect(badge()).toBe('Not available');
    });
  });

  it('iPhone or iPad in Safari, not installed: the Home Screen steps and the fresh sign-in, no button', async () => {
    device.needsHomeScreenInstall = true;
    await open();
    await emitConfig(VAPID_KEY);
    expect(badge()).toBe('Install first');
    const body = text(panel());
    expect(body).toContain(
      'On iPhone and iPad, notifications work only in the Omni League app on your Home Screen.',
    );
    expect(
      [...panel().querySelectorAll('ol li')].map((li) => [
        text(li.firstElementChild),
        text(li.lastElementChild),
      ]),
    ).toEqual([
      ['1', 'In Safari, tap Share in the toolbar.'],
      ['2', 'Tap Add to Home Screen , then Add.'],
      ['3', 'Open Omni League from your Home Screen, sign in, and come back to this page.'],
    ]);
    // Safari's own icons: Share, then Add to Home Screen (a plus in a rounded square).
    expect(
      [...panel().querySelectorAll('ol li ng-icon')].map((icon) => icon.getAttribute('name')),
    ).toEqual(['lucideShare', 'lucideSquarePlus']);
    expect(body).toContain(
      'The Home Screen app keeps its own sign-in, separate from Safari, so you sign in once more there. Needs iOS 16.4 or later.',
    );
    expect(button()).toBeNull();
  });

  it('blocked: says how to allow notifications, with no button, and turns to Off once allowed', async () => {
    device.permission.set('denied');
    await open();
    await emitConfig(VAPID_KEY);
    expect(badge()).toBe('Blocked');
    expect(text(panel())).toContain(
      "Notifications for Omni League are blocked in this browser's settings, so they can't be turned on from here.",
    );
    expect([...panel().querySelectorAll('ol li')].map((li) => text(li))).toEqual([
      "Open your browser's settings for this site. In most browsers, select the icon at the start of the address bar.",
      'Set Notifications to Allow.',
      'Come back to this page. It updates on its own.',
    ]);
    expect(text(panel())).toContain(
      'On an iPhone or iPad: open Settings, then Notifications, then Omni League.',
    );
    expect(button()).toBeNull();

    device.permission.set('default');
    await settle();
    expect(badge()).toBe('Off');
  });

  describe('off', () => {
    it('offers Turn on notifications and says the browser will ask', async () => {
      await open();
      await emitConfig(VAPID_KEY);
      expect(badge()).toBe('Off');
      expect(text(panel())).toContain(
        'Get a notification on this device when a game is coming up, the schedule changes, or a score is confirmed.',
      );
      expect(text(button())).toBe('Turn on notifications');
      expect(button()!.disabled).toBe(false);
      expect(text(panel())).toContain('Your browser will ask for permission.');
    });

    it('asks for no permission and requests no subscription on load', async () => {
      await open();
      await emitConfig(VAPID_KEY);
      expect(log).toEqual([]);
      expect(swPush.requests).toEqual([]);
    });

    it('keeps the button disabled with the reason until the worker controls the page', async () => {
      device.controlled.set(false);
      await open();
      await emitConfig(VAPID_KEY);
      expect(badge()).toBe('Off');
      expect(button()!.disabled).toBe(true);
      const help = panel().querySelector(`#${button()!.getAttribute('aria-describedby') ?? ''}`);
      expect(text(help)).toBe(
        'Getting this device ready. This takes a few seconds the first time.',
      );
      expect(help?.getAttribute('role')).toBe('status');
      const spinner = help!.querySelector('hlm-spinner');
      expect(spinner?.getAttribute('aria-hidden')).toBe('true');
      expect(spinner?.hasAttribute('data-icon')).toBe(false);
      expect(help!.firstElementChild).toBe(spinner);

      button()!.click();
      expect(log).toEqual([]);

      device.controlled.set(true);
      await settle();
      expect(button()!.disabled).toBe(false);
      expect(button()!.hasAttribute('aria-describedby')).toBe(false);
    });
  });

  describe('turning on', () => {
    it('asks for permission synchronously in the click, then requests one subscription, then saves it', async () => {
      await open();
      await emitConfig(VAPID_KEY);

      button()!.click();
      // Nothing asynchronous has run yet: the prompt was asked for inside the click.
      expect(log).toEqual(['requestPermission']);
      await settle();
      expect(text(button())).toBe('Turning on…');
      expect(button()!.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(button());
      expect(text(panel().querySelector('[role="status"]'))).toBe(
        "Choose Allow in your browser's prompt.",
      );

      device.respond('granted');
      await settle();
      expect(log).toEqual(['requestPermission', 'requestSubscription']);
      expect(swPush.requests).toEqual([{ serverPublicKey: VAPID_KEY }]);
      expect(convex.calls.map((c) => [c.name, c.args])).toEqual([
        [
          'push:subscribe',
          {
            endpoint: ENDPOINT,
            expirationTime: null,
            keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
          },
        ],
      ]);

      convex.calls[0].resolve(null);
      await settle();
      expect(badge()).toBe('On');
      // The pressed button is gone; focus moves to the one that replaced it, and the result is announced.
      expect(document.activeElement).toBe(button());
      expect(text(button())).toBe('Turn off');
      expect(changeStatus()).toBe('Notifications are on for this device.');
      await emitStatus(true);
      expect(badge()).toBe('On');
      expect(text(button())).toBe('Turn off');
    });

    it('a second press while turning on asks nothing more', async () => {
      await open();
      await emitConfig(VAPID_KEY);
      button()!.click();
      button()!.click();
      expect(log).toEqual(['requestPermission']);
    });

    it('permission denied: shows Blocked and requests no subscription', async () => {
      await open();
      await emitConfig(VAPID_KEY);
      button()!.click();
      device.respond('denied');
      await settle();
      expect(swPush.requests).toEqual([]);
      expect(convex.calls).toEqual([]);
      expect(badge()).toBe('Blocked');
    });

    it('the prompt dismissed: back to Off with no subscription', async () => {
      await open();
      await emitConfig(VAPID_KEY);
      button()!.click();
      device.respond('default');
      await settle();
      expect(swPush.requests).toEqual([]);
      expect(badge()).toBe('Off');
      expect(text(button())).toBe('Turn on notifications');
    });

    it('a rejected requestSubscription shows the failed alert, focused, and the button works again', async () => {
      swPush.nextSubscription = new Error('push service unavailable');
      await open();
      await emitConfig(VAPID_KEY);
      button()!.click();
      device.respond('granted');
      await settle();

      expect(text(alertBox()?.querySelector('[data-slot="alert-title"]'))).toBe(
        'Notifications could not be turned on.',
      );
      expect(text(alertBox()?.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alertBox());
      expect(badge()).toBe('Off');
      expect(text(button())).toBe('Turn on notifications');
      expect(button()!.hasAttribute('aria-disabled')).toBe(false);
    });

    it('a server error removes the browser subscription again and shows the failed alert', async () => {
      await open();
      await emitConfig(VAPID_KEY);
      button()!.click();
      device.respond('granted');
      await settle();
      convex.calls[0].reject(new Error('Server Error'));
      await settle();
      expect(swPush.unsubscribes).toBe(1);
      expect(text(alertBox()?.querySelector('[data-slot="alert-title"]'))).toBe(
        'Notifications could not be turned on.',
      );
      expect(badge()).toBe('Off');
    });

    it('refused offline: removes the browser subscription again and shows the offline alert, focused', async () => {
      await open();
      await emitConfig(VAPID_KEY);
      button()!.click();
      device.respond('granted');
      await settle();
      convex.calls[0].reject(new ConvexOfflineError('offline'));
      await settle();

      expect(swPush.unsubscribes).toBe(1);
      expect(text(alertBox()?.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(text(alertBox()?.querySelector('[data-slot="alert-description"]'))).toBe(
        "Notifications are still off. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(alertBox());
      expect(badge()).toBe('Off');
    });
  });

  describe('on', () => {
    async function openOn() {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      device.permission.set('granted');
      await open();
      await emitConfig(VAPID_KEY);
      await emitStatus(true);
    }

    it('shows On and Turn off when push.getMyDeviceStatus says the subscription is the caller’s', async () => {
      await openOn();
      expect(badge()).toBe('On');
      expect(text(panel())).toContain(
        'This device gets game reminders, schedule changes, and score updates.',
      );
      expect(text(button())).toBe('Turn off');
    });

    it('shows Off when the browser’s subscription is not the caller’s', async () => {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      device.permission.set('granted');
      await open();
      await emitConfig(VAPID_KEY);
      await emitStatus(false);
      expect(badge()).toBe('Off');
    });

    it('Turn off: push.unsubscribe first, then SwPush.unsubscribe, then Off', async () => {
      await openOn();
      button()!.click();
      await settle();
      expect(text(button())).toBe('Turning off…');
      expect(button()!.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(button());
      expect(text(panel().querySelector('[role="status"]'))).toBe('Turning off notifications.');
      expect(convex.calls.map((c) => [c.name, c.args])).toEqual([
        ['push:unsubscribe', { endpoint: ENDPOINT }],
      ]);
      expect(swPush.unsubscribes).toBe(0);

      convex.calls[0].resolve(null);
      await settle();
      expect(swPush.unsubscribes).toBe(1);
      expect(badge()).toBe('Off');
      expect(text(button())).toBe('Turn on notifications');
      expect(document.activeElement).toBe(button());
      expect(changeStatus()).toBe('Notifications are off for this device.');
    });

    it('the result status is empty until a change and again once another press starts', async () => {
      await openOn();
      expect(changeStatus()).toBe('');
      button()!.click();
      await settle();
      convex.calls[0].resolve(null);
      await settle();
      expect(changeStatus()).toBe('Notifications are off for this device.');
      button()!.click();
      await settle();
      expect(changeStatus()).toBe('');
    });

    it('Turn off still ends Off when the browser cannot unsubscribe', async () => {
      await openOn();
      swPush.unsubscribeRejects = true;
      button()!.click();
      await settle();
      convex.calls[0].resolve(null);
      await settle();
      await emitStatus(false);
      expect(badge()).toBe('Off');
      expect(alertBox()).toBeNull();
    });

    it('Turn off refused offline keeps it on and the browser subscription, with the offline alert', async () => {
      await openOn();
      button()!.click();
      await settle();
      convex.calls[0].reject(new ConvexOfflineError('offline'));
      await settle();
      expect(swPush.unsubscribes).toBe(0);
      expect(badge()).toBe('On');
      expect(text(alertBox()?.querySelector('[data-slot="alert-description"]'))).toBe(
        "Notifications are still on. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(alertBox());
    });

    it('offline: the button looks disabled and says why, and a press sends nothing', async () => {
      await openOn();
      await goOffline();
      expect(badge()).toBe('On');
      expect(button()!.getAttribute('aria-disabled')).toBe('true');
      expect(button()!.classList.contains('opacity-50')).toBe(true);
      expect(button()!.hasAttribute('disabled')).toBe(false);
      const help = panel().querySelector(`#${button()!.getAttribute('aria-describedby') ?? ''}`);
      expect(text(help)).toBe('Connect to the internet to change this.');

      button()!.click();
      await settle();
      expect(convex.calls).toEqual([]);
      expect(text(alertBox()?.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
    });
  });

  describe('test notification', () => {
    async function openOn() {
      swPush.subscription.next(fakeSubscription(ENDPOINT));
      device.permission.set('granted');
      await open();
      await emitConfig(VAPID_KEY);
      await emitStatus(true);
    }
    const testButton = () =>
      [...panel().querySelectorAll('button')].find(
        (b) => text(b).includes('test notification') || text(b) === 'Sending…',
      ) ?? null;
    const resultAlert = () =>
      panel().querySelector<HTMLElement>('app-test-notification [data-slot="alert"]');
    const alertTitle = () => text(resultAlert()?.querySelector('[data-slot="alert-title"]'));
    const alertDescription = () =>
      text(resultAlert()?.querySelector('[data-slot="alert-description"]'));

    async function press() {
      testButton()!.click();
      await settle();
    }
    async function answer(value: unknown) {
      convex.calls.find((c) => c.name === 'push:sendTest')!.resolve(value);
      await settle();
    }

    it.each([
      [
        'off',
        async () => {
          await open();
          await emitConfig(VAPID_KEY);
        },
      ],
      [
        'blocked',
        async () => {
          device.permission.set('denied');
          await open();
          await emitConfig(VAPID_KEY);
        },
      ],
      [
        'not available',
        async () => {
          await open();
          await emitConfig(null);
        },
      ],
      [
        'checking',
        async () => {
          await open();
        },
      ],
      [
        'on a device whose subscription is another user’s',
        async () => {
          swPush.subscription.next(fakeSubscription(ENDPOINT));
          await open();
          await emitConfig(VAPID_KEY);
          await emitStatus(false);
        },
      ],
    ])('has no test button while %s', async (_state, arrange) => {
      await arrange();
      expect(testButton()).toBeNull();
      expect(text(panel())).not.toContain('test notification');
    });

    it('is offered with Turn off when this device is on, below it', async () => {
      await openOn();
      expect(badge()).toBe('On');
      expect(text(button())).toBe('Turn off');
      expect(text(testButton())).toBe('Send a test notification');
      expect(testButton()!.getAttribute('data-slot')).toBe('button');
      expect(testButton()!.hasAttribute('aria-disabled')).toBe(false);
      expect(alertBox()).toBeNull();
      expect(
        button()!.compareDocumentPosition(testButton()!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('a press calls push.sendTest once, shows the pending label, and keeps focus on the button', async () => {
      await openOn();
      testButton()!.focus();
      testButton()!.click();
      await settle();

      expect(convex.calls.map((c) => [c.name, c.args])).toEqual([['push:sendTest', {}]]);
      expect(text(testButton())).toBe('Sending…');
      expect(testButton()!.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(testButton());
      expect(text(panel().querySelector('app-test-notification [role="status"]'))).toBe(
        'Sending the test notification.',
      );
      testButton()!.click();
      await settle();
      expect(convex.calls).toHaveLength(1);
      expect(document.activeElement).toBe(testButton());
    });

    it.each([
      [1, 'It should arrive on your device in a few seconds.'],
      [3, 'It should arrive on your 3 devices in a few seconds.'],
    ])(
      'sent to %i device(s): a success status, the button is ready again, focus stays',
      async (devices, description) => {
        await openOn();
        testButton()!.focus();
        await press();
        await answer({ status: 'sent', devices });

        expect(resultAlert()!.getAttribute('role')).toBe('status');
        expect(alertTitle()).toBe('Test notification sent.');
        expect(alertDescription()).toBe(description);
        // Below the button, so the result does not move the button the user just pressed.
        expect(
          testButton()!.compareDocumentPosition(resultAlert()!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(text(testButton())).toBe('Send a test notification');
        expect(testButton()!.hasAttribute('aria-disabled')).toBe(false);
        expect(document.activeElement).toBe(testButton());
      },
    );

    it('a new press clears the previous result', async () => {
      await openOn();
      await press();
      await answer({ status: 'sent', devices: 1 });
      expect(resultAlert()).not.toBeNull();
      testButton()!.click();
      await settle();
      expect(resultAlert()).toBeNull();
    });

    it('no device: an alert that says what to do', async () => {
      await openOn();
      await press();
      await answer({ status: 'noDevice' });

      expect(resultAlert()!.getAttribute('role')).toBe('alert');
      expect(alertTitle()).toBe('No device to send to.');
      expect(alertDescription()).toBe('Turn notifications on for a device, then try again.');
      expect(document.activeElement).not.toBe(resultAlert());
    });

    it.each([
      [421, '8 minutes'],
      [60, '1 minute'],
      [1, '1 minute'],
    ])(
      'rate limited with %i seconds to wait: an alert that says how long',
      async (retryAfterSeconds, wait) => {
        await openOn();
        await press();
        await answer({ status: 'rateLimited', retryAfterSeconds });

        expect(resultAlert()!.getAttribute('role')).toBe('alert');
        expect(alertTitle()).toBe('Too many tests.');
        expect(alertDescription()).toBe(
          `You can send 3 tests every 10 minutes. Try again in ${wait}.`,
        );
      },
    );

    it('a server error: a failed alert, and the button works again', async () => {
      await openOn();
      await press();
      convex.calls.find((c) => c.name === 'push:sendTest')!.reject(new Error('Server Error'));
      await settle();

      expect(resultAlert()!.getAttribute('role')).toBe('alert');
      expect(alertTitle()).toBe('The test notification could not be sent.');
      expect(alertDescription()).toBe('Check your connection and try again.');
      expect(testButton()!.hasAttribute('aria-disabled')).toBe(false);
    });

    it('not set up on the server: a failed alert that says to try later', async () => {
      await openOn();
      await press();
      await answer({ status: 'unconfigured' });

      expect(resultAlert()!.getAttribute('role')).toBe('alert');
      expect(alertTitle()).toBe('The test notification could not be sent.');
      expect(alertDescription()).toBe(
        'Notifications are not available right now. Try again later.',
      );
    });

    it('refused for lack of a connection: the offline alert with its cause', async () => {
      await openOn();
      await press();
      convex.calls
        .find((c) => c.name === 'push:sendTest')!
        .reject(new ConvexOfflineError('offline'));
      await settle();

      expect(resultAlert()!.getAttribute('role')).toBe('alert');
      expect(alertTitle()).toBe("You're offline. Nothing was sent.");
      expect(alertDescription()).toBe("Try again when you're connected.");
      expect(text(testButton())).toBe('Send a test notification');
    });

    it('offline: the button looks disabled and says why, and a press sends nothing but shows the offline alert', async () => {
      await openOn();
      await goOffline();

      expect(testButton()!.getAttribute('aria-disabled')).toBe('true');
      expect(testButton()!.classList.contains('opacity-50')).toBe(true);
      expect(testButton()!.hasAttribute('disabled')).toBe(false);
      const help = panel().querySelector(
        `#${testButton()!.getAttribute('aria-describedby') ?? ''}`,
      );
      expect(text(help)).toBe('Connect to the internet to send a test.');

      testButton()!.click();
      await settle();
      expect(convex.calls).toEqual([]);
      expect(alertTitle()).toBe("You're offline. Nothing was sent.");
    });

    it('does not take over the page’s own result status', async () => {
      await openOn();
      await press();
      await answer({ status: 'sent', devices: 1 });
      expect(changeStatus()).toBe('');
    });
  });

  describe('a page no service worker controls', () => {
    const RELOAD_TEXT = 'Reload this page to turn notifications on.';
    const OFFLINE_TEXT = 'Connect to the internet to change this.';

    let registrationSubscription: PushSubscription;
    let unsubscribeHeld: Mock<() => Promise<boolean>>;
    beforeEach(() => {
      unsubscribeHeld = vi.fn(() => Promise.resolve(true));
      registrationSubscription = fakeSubscription(ENDPOINT, unsubscribeHeld);
      device.controlled.set(false);
      device.activated = true;
      device.registrationSubscription = registrationSubscription;
      swPush.subscription = new Subject<PushSubscription | null>();
    });

    const reloadButton = () =>
      [...panel().querySelectorAll('button')].find((b) => text(b) === 'Reload page') ?? null;
    const describedBy = (el: Element | null) =>
      text(panel().querySelector(`#${el?.getAttribute('aria-describedby') ?? ''}`));
    const spinners = () => panel().querySelectorAll('hlm-spinner');
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const subscriptionUnsubscribes = () => unsubscribeHeld.mock.calls.length;

    async function openOn() {
      device.permission.set('granted');
      await open();
      await emitConfig(VAPID_KEY);
      await emitStatus(true);
    }

    function expectReloadState() {
      expect(badge()).toBe('Off');
      expect(text(button())).toBe('Turn on notifications');
      expect(button()!.getAttribute('aria-disabled')).toBe('true');
      expect(button()!.hasAttribute('disabled')).toBe(false);
      expect(describedBy(button())).toBe(RELOAD_TEXT);
      expect(text(panel())).not.toContain('Getting this device ready');
      expect(spinners()).toHaveLength(0);
      expect(reloadButton()).not.toBeNull();
      expect(reloadButton()!.hasAttribute('aria-disabled')).toBe(false);
    }

    describe('showing what the device holds', () => {
      it('shows On with Turn off and the test-notification section when the status says it is the caller’s', async () => {
        await openOn();

        expect(badge()).toBe('On');
        expect(text(panel())).toContain('On');
        expect(text(panel())).toContain(
          'This device gets game reminders, schedule changes, and score updates.',
        );
        expect(text(button())).toBe('Turn off');
        expect(panel().querySelector('app-test-notification')).not.toBeNull();
        expect(text(panel())).toContain('Send a test notification');
        expect(text(panel())).not.toContain('Getting this device ready');
        expect(subscriptionsTo('push:getMyDeviceStatus').map((s) => s.args)).toEqual([
          { endpoint: ENDPOINT },
        ]);
      });

      it('shows the checking skeleton and its status until the subscription read answers', async () => {
        const answer = device.holdRead('subscription');
        await open();
        await emitConfig(VAPID_KEY);

        expect(badge()).toBe('');
        expect(text(panel().querySelector('[role="status"]'))).toBe(
          'Checking notifications on this device.',
        );
        expect(panel().querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0);
        expect(button()).toBeNull();
        expect(text(panel())).not.toContain('Getting this device ready');

        answer();
        await settle();
        expect(badge()).toBe('');
        await emitStatus(true);
        expect(badge()).toBe('On');
      });

      it('shows the checking skeleton until the read of whether the worker is activated answers', async () => {
        const answer = device.holdRead('activated');
        device.registrationSubscription = null;
        await open();
        await emitConfig(VAPID_KEY);

        expect(badge()).toBe('');
        expect(text(panel().querySelector('[role="status"]'))).toBe(
          'Checking notifications on this device.',
        );
        expect(button()).toBeNull();
        expect(text(panel())).not.toContain('Getting this device ready');

        answer();
        await settle();
        expectReloadState();
      });

      it('shows the checking skeleton until the status query answers', async () => {
        await open();
        await emitConfig(VAPID_KEY);

        expect(badge()).toBe('');
        expect(text(panel().querySelector('[role="status"]'))).toBe(
          'Checking notifications on this device.',
        );
        expect(text(panel())).not.toContain('Getting this device ready');
      });

      it('shows the reload state when the status is false', async () => {
        await open();
        await emitConfig(VAPID_KEY);
        await emitStatus(false);

        expectReloadState();
      });

      it('shows the reload state when the status query errors', async () => {
        await open();
        await emitConfig(VAPID_KEY);
        for (const sub of subscriptionsTo('push:getMyDeviceStatus')) sub.fail(new Error('boom'));
        await settle();

        expectReloadState();
      });

      it('shows the reload state when the registration holds no subscription', async () => {
        device.registrationSubscription = null;
        await open();
        await emitConfig(VAPID_KEY);

        expectReloadState();
        expect(subscriptionsTo('push:getMyDeviceStatus')).toEqual([]);
      });
    });

    describe('turning off', () => {
      it('removes the row, then the subscription read from the registration, never through SwPush', async () => {
        await openOn();
        button()!.click();
        await settle();

        expect(text(button())).toBe('Turning off…');
        expect(convex.calls.map((c) => [c.name, c.args])).toEqual([
          ['push:unsubscribe', { endpoint: ENDPOINT }],
        ]);
        expect(subscriptionUnsubscribes()).toBe(0);

        convex.calls[0].resolve(null);
        await settle();

        expect(subscriptionUnsubscribes()).toBe(1);
        expect(swPush.unsubscribes).toBe(0);
        expect(badge()).toBe('Off');
        expect(text(button())).toBe('Turn on notifications');
        expect(changeStatus()).toBe('Notifications are off for this device.');
        expect(document.activeElement).toBe(button());
        expectReloadState();
      });

      it.each([
        ['rejects', () => unsubscribeHeld.mockRejectedValue(new Error('gone'))],
        ['resolves false', () => unsubscribeHeld.mockResolvedValue(false)],
      ])(
        'shows the reload state when the browser unsubscribe %s, because the row is gone',
        async (_case, arrange) => {
          await openOn();
          arrange();
          button()!.click();
          await settle();
          convex.calls[0].resolve(null);
          await settle();

          expect(subscriptionUnsubscribes()).toBe(1);
          expect(swPush.unsubscribes).toBe(0);
          expect(alertBox()).toBeNull();
          expect(changeStatus()).toBe('Notifications are off for this device.');
          expectReloadState();
          expect(document.activeElement).toBe(button());
        },
      );

      it('offline: stays On with the offline alert and leaves the browser subscription alone', async () => {
        await openOn();
        await goOffline();
        button()!.click();
        await settle();

        expect(convex.calls).toEqual([]);
        expect(subscriptionUnsubscribes()).toBe(0);
        expect(badge()).toBe('On');
        expect(text(alertBox()?.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was sent.",
        );
      });

      it('refused offline or failing: stays On with the alert and leaves the browser subscription alone', async () => {
        await openOn();
        button()!.click();
        await settle();
        convex.calls[0].reject(new ConvexOfflineError('offline'));
        await settle();
        expect(badge()).toBe('On');
        expect(text(alertBox()?.querySelector('[data-slot="alert-description"]'))).toBe(
          "Notifications are still on. Try again when you're connected.",
        );

        button()!.click();
        await settle();
        convex.calls[1].reject(new Error('Server Error'));
        await settle();
        expect(badge()).toBe('On');
        expect(text(alertBox()?.querySelector('[data-slot="alert-title"]'))).toBe(
          'Notifications could not be turned off.',
        );
        expect(subscriptionUnsubscribes()).toBe(0);
        expect(swPush.unsubscribes).toBe(0);
      });
    });

    describe('Turn on and Reload page', () => {
      beforeEach(() => {
        device.registrationSubscription = null;
      });

      it('Turn on asks for no permission and requests no subscription, and a press does nothing', async () => {
        await open();
        await emitConfig(VAPID_KEY);
        button()!.focus();
        button()!.click();
        await settle();

        expect(log).toEqual([]);
        expect(swPush.requests).toEqual([]);
        expect(reloadPage).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(button());
        expectReloadState();
      });

      it('Reload page sits next to the reload text and calls the reload once per press', async () => {
        await open();
        await emitConfig(VAPID_KEY);
        const help = panel().querySelector(`#${button()!.getAttribute('aria-describedby')}`)!;
        expect(reloadButton()!.parentElement).toBe(help.parentElement);
        expect(reloadButton()!.getAttribute('data-slot')).toBe('button');

        reloadButton()!.click();
        await settle();
        expect(reloadPage).toHaveBeenCalledTimes(1);
      });

      it('offline: Reload page is aria-disabled, says why, and a press does not reload; back online both return', async () => {
        await open();
        await emitConfig(VAPID_KEY);
        await goOffline();

        expect(reloadButton()!.getAttribute('aria-disabled')).toBe('true');
        expect(reloadButton()!.hasAttribute('disabled')).toBe(false);
        expect(describedBy(reloadButton())).toBe(OFFLINE_TEXT);
        expect(button()!.getAttribute('aria-disabled')).toBe('true');
        expect(text(panel())).not.toContain(RELOAD_TEXT);

        reloadButton()!.click();
        await settle();
        expect(reloadPage).not.toHaveBeenCalled();
        expect(log).toEqual([]);

        await goOnline();
        expectReloadState();
        reloadButton()!.click();
        await settle();
        expect(reloadPage).toHaveBeenCalledTimes(1);
      });
    });

    describe('before the worker is activated (first visit)', () => {
      beforeEach(() => {
        device.activated = false;
        device.registrationSubscription = null;
      });

      it('keeps "Getting this device ready" and a disabled button, with no Reload page', async () => {
        await open();
        await emitConfig(VAPID_KEY);

        expect(badge()).toBe('Off');
        expect(button()!.disabled).toBe(true);
        expect(describedBy(button())).toBe(
          'Getting this device ready. This takes a few seconds the first time.',
        );
        expect(reloadButton()).toBeNull();
        expect(text(panel())).not.toContain(RELOAD_TEXT);
      });

      it('enables the button when the worker takes control', async () => {
        await open();
        await emitConfig(VAPID_KEY);
        device.controlled.set(true);
        swPush.subscription.next(null);
        await settle();

        expect(button()!.disabled).toBe(false);
        expect(button()!.hasAttribute('aria-describedby')).toBe(false);
        expect(reloadButton()).toBeNull();
      });
    });

    it('a worker taking control keeps the badge On at every tick, and Turn off then goes through SwPush', async () => {
      await openOn();
      expect(badge()).toBe('On');

      // As NgswCommChannel.registration: SwPush.subscription emits after controllerchange and a promise.
      device.controlled.set(true);
      TestBed.tick();
      await harness.fixture.whenStable();
      expect(badge()).toBe('On');
      expect(panel().querySelector('[role="status"]')?.textContent).not.toContain('Checking');
      await tick();
      expect(badge()).toBe('On');
      TestBed.tick();
      expect(badge()).toBe('On');

      swPush.subscription.next(registrationSubscription);
      await settle();
      expect(badge()).toBe('On');
      expect(text(button())).toBe('Turn off');

      button()!.click();
      await settle();
      convex.calls[0].resolve(null);
      await settle();
      expect(swPush.unsubscribes).toBe(1);
      expect(subscriptionUnsubscribes()).toBe(0);
      expect(badge()).toBe('Off');
      expect(button()!.disabled).toBe(false);
      expect(reloadButton()).toBeNull();
    });

    it('makes no direct read on a controlled page', async () => {
      device.controlled.set(true);
      swPush.subscription = new BehaviorSubject<PushSubscription | null>(null);
      await open();
      await emitConfig(VAPID_KEY);

      expect(device.subscriptionReads).toBe(0);
      expect(badge()).toBe('Off');
      expect(reloadButton()).toBeNull();
    });

    it.each([
      ['there is no service worker', () => (swPush.isEnabled = false)],
      ['the browser has no Push API', () => (device.hasPushApis = false)],
    ])('makes no registration read and shows Not available when %s', async (_case, arrange) => {
      arrange();
      await open();
      await emitConfig(VAPID_KEY);

      expect(device.subscriptionReads).toBe(0);
      expect(badge()).toBe('Not available');
      expect(button()).toBeNull();
      expect(reloadButton()).toBeNull();
    });

    it('shows Blocked with no Turn on or Reload page when permission is denied', async () => {
      device.permission.set('denied');
      await open();
      await emitConfig(VAPID_KEY);

      expect(badge()).toBe('Blocked');
      expect(button()).toBeNull();
      expect(reloadButton()).toBeNull();
    });

    it('two quick presses of Turn off remove the row and the subscription once each', async () => {
      await openOn();
      button()!.click();
      button()!.click();
      await settle();
      convex.calls[0].resolve(null);
      await settle();

      expect(convex.calls).toHaveLength(1);
      expect(subscriptionUnsubscribes()).toBe(1);
      expect(swPush.unsubscribes).toBe(0);
      expectReloadState();
    });
  });

  it('offline and off: a press asks for no permission and shows the offline alert', async () => {
    await open();
    await emitConfig(VAPID_KEY);
    await goOffline();
    expect(button()!.getAttribute('aria-disabled')).toBe('true');
    button()!.click();
    await settle();
    expect(log).toEqual([]);
    expect(text(alertBox()?.querySelector('[data-slot="alert-description"]'))).toBe(
      "Notifications are still off. Try again when you're connected.",
    );
  });
});
