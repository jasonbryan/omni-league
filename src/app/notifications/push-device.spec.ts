import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { BrowserPushDevice } from './push-device';

interface FakeWindowOptions {
  userAgent?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
  notification?: boolean;
  serviceWorker?: boolean;
  pushManager?: boolean;
  permission?: NotificationPermission;
  controlled?: boolean;
  getRegistration?: () => Promise<unknown>;
}

function fakeWindow(options: FakeWindowOptions = {}) {
  const documentEvents = new EventTarget();
  const fakeDocument = Object.assign(documentEvents, { visibilityState: 'visible' });
  const container = Object.assign(new EventTarget(), {
    controller: options.controlled === false ? null : {},
    getRegistration: options.getRegistration ?? (() => Promise.resolve(undefined)),
  });
  const notification = {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(() => Promise.resolve<NotificationPermission>('granted')),
  };
  const navigator = {
    userAgent: options.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36',
    maxTouchPoints: options.maxTouchPoints ?? 0,
    ...(options.standalone === undefined ? {} : { standalone: options.standalone }),
    ...(options.serviceWorker === false ? {} : { serviceWorker: container }),
  };
  const window = {
    navigator,
    document: fakeDocument,
    matchMedia: (query: string) => ({
      matches: query === '(display-mode: standalone)' && options.displayModeStandalone === true,
    }),
    ...(options.notification === false ? {} : { Notification: notification }),
    ...(options.pushManager === false ? {} : { PushManager: class {} }),
  };
  return { window, fakeDocument, container, notification };
}

function create(options: FakeWindowOptions = {}) {
  const fake = fakeWindow(options);
  TestBed.configureTestingModule({
    providers: [{ provide: DOCUMENT, useValue: { defaultView: fake.window } }],
  });
  return { ...fake, device: TestBed.inject(BrowserPushDevice) };
}

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

describe('BrowserPushDevice', () => {
  it('has the push APIs only with Notification, a service worker container, and PushManager', () => {
    expect(create().device.hasPushApis).toBe(true);
    TestBed.resetTestingModule();
    expect(create({ notification: false }).device.hasPushApis).toBe(false);
    TestBed.resetTestingModule();
    expect(create({ serviceWorker: false }).device.hasPushApis).toBe(false);
    TestBed.resetTestingModule();
    expect(create({ pushManager: false }).device.hasPushApis).toBe(false);
  });

  it.each([
    ['iPhone Safari, not installed', { userAgent: IPHONE_SAFARI }, true],
    [
      'iPad Safari (a Mac user agent with touch), not installed',
      { userAgent: IPAD_SAFARI, maxTouchPoints: 5 },
      true,
    ],
    [
      'iPhone, installed (navigator.standalone)',
      { userAgent: IPHONE_SAFARI, standalone: true },
      false,
    ],
    [
      'iPhone, installed (display-mode)',
      { userAgent: IPHONE_SAFARI, displayModeStandalone: true },
      false,
    ],
    ['Safari on a Mac, no touch', { userAgent: IPAD_SAFARI, maxTouchPoints: 0 }, false],
    [
      'Chrome on Android',
      { userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile' },
      false,
    ],
  ])('%s: needsHomeScreenInstall is %s', (_case, options, expected) => {
    expect(create(options).device.needsHomeScreenInstall).toBe(expected);
  });

  it('reads the permission, and again when the page becomes visible', () => {
    const { device, notification, fakeDocument } = create({ permission: 'denied' });
    expect(device.permission()).toBe('denied');

    notification.permission = 'default';
    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(device.permission()).toBe('denied');

    fakeDocument.visibilityState = 'visible';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(device.permission()).toBe('default');
  });

  it('is unsupported for permission without Notification', () => {
    expect(create({ notification: false }).device.permission()).toBe('unsupported');
  });

  it('has no push APIs and is unsupported on the real document when the Notification global is absent', () => {
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
      const device = TestBed.inject(BrowserPushDevice);
      expect(device.hasPushApis).toBe(false);
      expect(device.permission()).toBe('unsupported');
    } finally {
      delete navigatorWithWorker['serviceWorker'];
      vi.unstubAllGlobals();
      if (notification) Object.defineProperty(window, 'Notification', notification);
    }
  });

  it('follows controllerchange for whether a worker controls the page', () => {
    const { device, container } = create({ controlled: false });
    expect(device.controlled()).toBe(false);
    container.controller = {};
    container.dispatchEvent(new Event('controllerchange'));
    expect(device.controlled()).toBe(true);
  });

  it('asks Notification.requestPermission synchronously and records the answer', async () => {
    const { device, notification } = create();
    const answer = device.requestPermission();
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(await answer).toBe('granted');
    expect(device.permission()).toBe('granted');
  });

  describe('subscription', () => {
    const held = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1' };
    const registrationHolding = (getSubscription: () => Promise<unknown>) =>
      Promise.resolve({ pushManager: { getSubscription } });

    it('resolves the subscription the registration holds while no worker controls the page', async () => {
      const { device } = create({
        controlled: false,
        getRegistration: () => registrationHolding(() => Promise.resolve(held)),
      });

      expect(await device.subscription()).toBe(held);
    });

    it.each([
      ['no registration', () => Promise.resolve(undefined)],
      [
        'a registration with no subscription',
        () => registrationHolding(() => Promise.resolve(null)),
      ],
      ['getRegistration rejecting', () => Promise.reject(new Error('SecurityError'))],
      [
        'getSubscription rejecting',
        () => registrationHolding(() => Promise.reject(new Error('InvalidStateError'))),
      ],
      ['a registration with no pushManager', () => Promise.resolve({})],
    ])('resolves null with %s', async (_case, getRegistration) => {
      expect(await create({ controlled: false, getRegistration }).device.subscription()).toBeNull();
    });

    it('resolves null when the window has no serviceWorker', async () => {
      expect(await create({ serviceWorker: false }).device.subscription()).toBeNull();
    });

    it('resolves null with no window', async () => {
      TestBed.configureTestingModule({
        providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }],
      });

      expect(await TestBed.inject(BrowserPushDevice).subscription()).toBeNull();
    });
  });
});
