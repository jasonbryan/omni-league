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
}

function fakeWindow(options: FakeWindowOptions = {}) {
  const documentEvents = new EventTarget();
  const fakeDocument = Object.assign(documentEvents, { visibilityState: 'visible' });
  const container = Object.assign(new EventTarget(), {
    controller: options.controlled === false ? null : {},
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
  it('is supported only with Notification, a service worker container, and PushManager', () => {
    expect(create().device.supported).toBe(true);
    TestBed.resetTestingModule();
    expect(create({ notification: false }).device.supported).toBe(false);
    TestBed.resetTestingModule();
    expect(create({ serviceWorker: false }).device.supported).toBe(false);
    TestBed.resetTestingModule();
    expect(create({ pushManager: false }).device.supported).toBe(false);
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
});
