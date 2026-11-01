import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT, ConvexOfflineError } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { NotificationsPage } from './notifications-page';
import { PUSH_DEVICE, type DevicePermission, type PushDevice } from './push-device';

const VAPID_KEY = 'BPublicKeyFromGetConfig';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';

class FakeSwPush {
  isEnabled = true;
  readonly subscription = new BehaviorSubject<PushSubscription | null>(null);
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

function fakeSubscription(endpoint: string): PushSubscription {
  return {
    endpoint,
    expirationTime: null,
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
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  function configure() {
    log = [];
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    swPush = new FakeSwPush();
    device = new FakePushDevice(log);
    const originalRequest = swPush.requestSubscription.bind(swPush);
    swPush.requestSubscription = (options) => {
      log.push('requestSubscription');
      return originalRequest(options);
    };
  }

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        { provide: SwPush, useValue: swPush },
        { provide: PUSH_DEVICE, useValue: device },
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
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();
    await harness.fixture.whenStable();
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
