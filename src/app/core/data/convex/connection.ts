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
import { CONVEX_CLIENT } from './convex-client';

/** How long the socket may be down before `online` turns false (ADR 0013, section 3). */
export const OFFLINE_SIGNAL_DELAY_MS = 5_000;
/** How long `run()` waits for a connection before it refuses a change (ADR 0013, Decision 3A). */
export const CALL_CONNECTION_WAIT_MS = 3_000;

/**
 * The app's view of its connection (ADR 0013, section 3 and Decision 3A). Created once in the
 * browser by `provideConvex()`, so the 5-second rule counts from the start of the app.
 *
 * - `online` drives the offline note and the disabled look of submit buttons. It is false at once
 *   when the browser reports offline, and false once the socket has been down for 5 seconds
 *   (including a client that has not connected 5 seconds after start). It is true again as soon
 *   as the socket is connected and the browser reports online. Always true on the server; with no
 *   client (no Convex URL) it follows `navigator.onLine` only.
 * - `canSend()` and `waitUntilCanSend()` are the call-time check of `run()`: the socket must be
 *   connected and `navigator.onLine` true at the moment the client is called, with no 5-second
 *   grace.
 */
@Injectable({ providedIn: 'root' })
export class ConvexConnection {
  private readonly client = inject(CONVEX_CLIENT, { optional: true }) ?? null;
  private readonly window = isPlatformServer(inject(PLATFORM_ID))
    ? null
    : inject(DOCUMENT).defaultView;
  private readonly browserOnline = signal(true);
  private readonly socketLost = signal(false);
  private socketTimer: ReturnType<typeof setTimeout> | undefined;

  readonly online: Signal<boolean> = computed(() => this.browserOnline() && !this.socketLost());

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
    const readBrowser = () => this.browserOnline.set(win.navigator.onLine);
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

  /** True when a change may be handed to the client now. Always false on the server. */
  canSend(): boolean {
    const win = this.window;
    if (!win || !this.client) return false;
    return this.client.connectionState().isWebSocketConnected && win.navigator.onLine;
  }

  /**
   * Resolves true as soon as `canSend()` holds, or with its value after `timeoutMs`. Checks again
   * on every connection-state change and on the browser's `online` event.
   */
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
    } else if (this.socketTimer === undefined && !this.socketLost()) {
      this.socketTimer = setTimeout(() => {
        this.socketTimer = undefined;
        this.socketLost.set(true);
      }, OFFLINE_SIGNAL_DELAY_MS);
    }
  }
}

/**
 * The app's `online` signal (see `ConvexConnection`): false while the offline note shows and submit
 * buttons look disabled. Call it in an injection context.
 */
export function injectOnline(): Signal<boolean> {
  assertInInjectionContext(injectOnline);
  return inject(ConvexConnection).online;
}
