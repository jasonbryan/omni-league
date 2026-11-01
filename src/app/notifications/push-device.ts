import { DestroyRef, Injectable, InjectionToken, inject, signal, type Signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';

export type DevicePermission = NotificationPermission | 'unsupported';

/** The browser facts the notifications page reads. A token, so that tests can give fakes. */
export interface PushDevice {
  /** Notifications, a service worker, and the Push API all exist. */
  readonly supported: boolean;
  /** iPhone or iPad in Safari, not the app added to the Home Screen: Web Push works only in the installed app there. */
  readonly needsHomeScreenInstall: boolean;
  readonly permission: Signal<DevicePermission>;
  /** A service worker controls the page, so `SwPush.requestSubscription` can resolve. */
  readonly controlled: Signal<boolean>;
  /** Must be called synchronously in the click handler: Safari grants the prompt only from a direct user action. */
  requestPermission(): Promise<NotificationPermission>;
}

export const PUSH_DEVICE = new InjectionToken<PushDevice>('PUSH_DEVICE', {
  factory: () => inject(BrowserPushDevice),
});

function isIosOrIpadOs(navigator: Navigator): boolean {
  // iPadOS reports a Mac user agent; a touch screen tells it apart.
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(window: Window): boolean {
  const legacy = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return legacy === true || window.matchMedia('(display-mode: standalone)').matches;
}

@Injectable({ providedIn: 'root' })
export class BrowserPushDevice implements PushDevice {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly notification =
    this.window && 'Notification' in this.window ? this.window.Notification : null;
  private readonly container =
    this.window && 'serviceWorker' in this.window.navigator
      ? this.window.navigator.serviceWorker
      : null;

  readonly supported =
    this.notification !== null && this.container !== null && 'PushManager' in (this.window ?? {});
  readonly needsHomeScreenInstall =
    this.window !== null && isIosOrIpadOs(this.window.navigator) && !isStandalone(this.window);

  private readonly permissionState = signal<DevicePermission>(this.readPermission());
  private readonly controlledState = signal(this.container?.controller != null);
  readonly permission = this.permissionState.asReadonly();
  readonly controlled = this.controlledState.asReadonly();

  constructor() {
    const document = this.window?.document;
    const container = this.container;
    // Allowing notifications in the browser's settings happens on another screen, so the page reads the permission again on return.
    const onVisible = () => {
      if (document?.visibilityState === 'visible') this.permissionState.set(this.readPermission());
    };
    const onControllerChange = () => this.controlledState.set(container?.controller != null);
    document?.addEventListener('visibilitychange', onVisible);
    container?.addEventListener('controllerchange', onControllerChange);
    inject(DestroyRef).onDestroy(() => {
      document?.removeEventListener('visibilitychange', onVisible);
      container?.removeEventListener('controllerchange', onControllerChange);
    });
  }

  requestPermission(): Promise<NotificationPermission> {
    if (!this.notification) return Promise.resolve('denied');
    return this.notification.requestPermission().then((permission) => {
      this.permissionState.set(permission);
      return permission;
    });
  }

  private readPermission(): DevicePermission {
    return this.notification ? this.notification.permission : 'unsupported';
  }
}
