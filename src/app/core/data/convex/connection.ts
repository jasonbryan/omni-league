import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  assertInInjectionContext,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { BehaviorSubject, distinctUntilChanged, type Observable } from 'rxjs';
import { CONVEX_CLIENT } from './client-token';

export const OFFLINE_SIGNAL_DELAY_MS = 5_000;
/** How long after the socket went down the note waits while a newer version downloads, so the reload can replace it. */
export const NEWER_VERSION_HOLD_MS = 15_000;
export const CALL_CONNECTION_WAIT_MS = 3_000;

/** `offline`: the browser is offline, or nothing shows the site answered. `unreachable`: the site answered and the Convex socket is still down. */
export type OfflineCause = 'offline' | 'unreachable';

@Injectable({ providedIn: 'root' })
export class ConvexConnection {
  private readonly client = inject(CONVEX_CLIENT, { optional: true }) ?? null;
  private readonly window = isPlatformServer(inject(PLATFORM_ID))
    ? null
    : inject(DOCUMENT).defaultView;
  private readonly browserOnline = signal(true);
  private readonly socketLost = signal(false);
  private readonly down = signal(false);
  private readonly siteReached = signal(false);
  private readonly disconnectedOnline = new BehaviorSubject(false);
  private socketTimer: ReturnType<typeof setTimeout> | undefined;
  private downSince = Date.now();
  private newerVersionDetected = false;

  readonly online: Signal<boolean> = computed(() => this.browserOnline() && !this.socketLost());
  readonly cause: Signal<OfflineCause> = computed(() =>
    this.browserOnline() && this.siteReached() ? 'unreachable' : 'offline',
  );
  readonly socketDown: Signal<boolean> = this.down.asReadonly();
  /** Asking the site for a newer version can help only while the browser reports a connection. */
  readonly disconnectedWhileOnline: Observable<boolean> =
    this.disconnectedOnline.pipe(distinctUntilChanged());

  constructor() {
    const win = this.window;
    if (!win) return;
    const destroyRef = inject(DestroyRef);

    if (this.client) {
      const client = this.client;
      this.onSocketState(client.connectionState().isWebSocketConnected);
      const unsubscribe = client.subscribeToConnectionState((state) => {
        this.onSocketState(state.isWebSocketConnected);
      });
      destroyRef.onDestroy(() => {
        unsubscribe();
        clearTimeout(this.socketTimer);
      });
    }

    // `navigator` is read after the first render, so hydration sees the server's `online` (true).
    const readBrowser = () => {
      this.browserOnline.set(win.navigator.onLine);
      this.publishDisconnectedWhileOnline();
    };
    afterNextRender(
      () => {
        if (destroyRef.destroyed) return;
        readBrowser();
        win.addEventListener('online', readBrowser);
        win.addEventListener('offline', readBrowser);
        destroyRef.onDestroy(() => {
          win.removeEventListener('online', readBrowser);
          win.removeEventListener('offline', readBrowser);
        });
      },
      { injector: inject(Injector) },
    );
  }

  hasEverConnected(): boolean {
    return this.client?.connectionState().hasEverConnected ?? false;
  }

  markSiteReached(): void {
    if (this.down()) this.siteReached.set(true);
  }

  markNewerVersionDetected(): void {
    this.newerVersionDetected = true;
  }

  canSend(): boolean {
    const win = this.window;
    if (!win || !this.client) return false;
    return this.client.connectionState().isWebSocketConnected && win.navigator.onLine;
  }

  waitUntilCanSend(timeoutMs: number): Promise<boolean> {
    const win = this.window;
    const client = this.client;
    if (!win || !client) return Promise.resolve(false);
    if (this.canSend()) return Promise.resolve(true);

    return new Promise((resolve) => {
      const finish = (canSend: boolean) => {
        clearTimeout(timer);
        unsubscribe();
        win.removeEventListener('online', check);
        resolve(canSend);
      };
      const check = () => {
        if (this.canSend()) finish(true);
      };
      const timer = setTimeout(() => finish(this.canSend()), timeoutMs);
      const unsubscribe = client.subscribeToConnectionState(check);
      win.addEventListener('online', check);
    });
  }

  private onSocketState(connected: boolean): void {
    if (connected) {
      clearTimeout(this.socketTimer);
      this.socketTimer = undefined;
      this.socketLost.set(false);
      this.down.set(false);
      this.newerVersionDetected = false;
    } else if (!this.down()) {
      this.down.set(true);
      this.downSince = Date.now();
      this.siteReached.set(false);
      this.armNoteTimer(OFFLINE_SIGNAL_DELAY_MS);
    }
    this.publishDisconnectedWhileOnline();
  }

  private publishDisconnectedWhileOnline(): void {
    this.disconnectedOnline.next(this.down() && this.browserOnline());
  }

  private armNoteTimer(delayMs: number): void {
    this.socketTimer = setTimeout(() => {
      this.socketTimer = undefined;
      const holdMs = this.newerVersionDetected ? NEWER_VERSION_HOLD_MS : OFFLINE_SIGNAL_DELAY_MS;
      const remaining = this.downSince + holdMs - Date.now();
      if (remaining > 0) this.armNoteTimer(remaining);
      else this.socketLost.set(true);
    }, delayMs);
  }
}

export function injectOnline(): Signal<boolean> {
  assertInInjectionContext(injectOnline);
  return inject(ConvexConnection).online;
}

export function injectOfflineCause(): Signal<OfflineCause> {
  assertInInjectionContext(injectOfflineCause);
  return inject(ConvexConnection).cause;
}
