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
import { CONVEX_CLIENT } from './client-token';

export const OFFLINE_SIGNAL_DELAY_MS = 5_000;
export const CALL_CONNECTION_WAIT_MS = 3_000;

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
    } else if (this.socketTimer === undefined && !this.socketLost()) {
      this.socketTimer = setTimeout(() => {
        this.socketTimer = undefined;
        this.socketLost.set(true);
      }, OFFLINE_SIGNAL_DELAY_MS);
    }
  }
}

export function injectOnline(): Signal<boolean> {
  assertInInjectionContext(injectOnline);
  return inject(ConvexConnection).online;
}
