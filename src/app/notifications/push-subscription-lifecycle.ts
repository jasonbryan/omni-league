import { DestroyRef, Injectable, inject } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import type { Observable, Subscription } from 'rxjs';
import {
  isAllowedPushEndpoint,
  unpaddedBase64UrlBytesOrNull,
} from '../../../convex/lib/pushSubscription';
import { AuthService } from '../core/auth/auth.service';
import { CONVEX_CLIENT, api, injectMutation, type ConvexClientLike } from '../core/data/convex';

/** SwPush emits nothing while no worker controls the page, so a read gives up rather than hold up sign-out. */
export const SUBSCRIPTION_READ_TIMEOUT_MS = 2_000;

/** Offline, the running check's query pauses rather than fails, so sign-out waits for it only this long. */
export const SIGN_OUT_CHECK_WAIT_MS = 3_000;

function settledWithin(task: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void task.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function queryOnce<Q extends FunctionReference<'query'>>(
  client: ConvexClientLike,
  query: Q,
  args: FunctionArgs<Q>,
): Promise<FunctionReturnType<Q>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handle: { stop?: () => void } = {};
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      handle.stop?.();
      finish();
    };
    handle.stop = client.onUpdate(
      query,
      args,
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
    if (settled) handle.stop();
  });
}

function firstWithin<T>(source: Observable<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const handle: { subscription?: Subscription } = {};
    const settle = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handle.subscription?.unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), ms);
    handle.subscription = source.subscribe({ next: settle, error: () => settle(null) });
    if (settled) handle.subscription.unsubscribe();
  });
}

function sameBytes(a: ArrayBuffer, b: Uint8Array): boolean {
  const bytes = new Uint8Array(a);
  return bytes.length === b.length && bytes.every((byte, i) => byte === b[i]);
}

function needsNewSubscription(
  subscription: PushSubscription,
  vapidPublicKey: string | null,
): boolean {
  const { expirationTime } = subscription;
  if (expirationTime != null && expirationTime <= Date.now()) return true;
  const current = vapidPublicKey === null ? null : unpaddedBase64UrlBytesOrNull(vapidPublicKey);
  const subscribedWith = subscription.options?.applicationServerKey;
  return !!current && !!subscribedWith && !sameBytes(subscribedWith, current);
}

function subscriptionArgs(subscription: PushSubscription) {
  const { keys } = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh: keys?.['p256dh'] ?? '', auth: keys?.['auth'] ?? '' },
  };
}

/**
 * Keeps this browser's push subscription with the signed-in user only, so a shared device never shows another user's notifications.
 */
@Injectable({ providedIn: 'root' })
export class PushSubscriptionLifecycle {
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly client = inject(CONVEX_CLIENT, { optional: true }) ?? null;
  private readonly auth = inject(AuthService);
  private readonly save = injectMutation(api.push.subscribe);
  private readonly remove = injectMutation(api.push.unsubscribe);
  private queue: Promise<void> = Promise.resolve();
  /** Raised by sign-out; a task queued before it subscribes and saves nothing more. */
  private generation = 0;
  /** From the start of sign-out until the session has ended, a queued task does nothing. */
  private signingOut = false;

  constructor() {
    const changes = this.enabledSwPush()?.pushSubscriptionChanges.subscribe(
      ({ oldSubscription }) => {
        const endpoint = oldSubscription?.endpoint;
        if (endpoint) {
          void this.enqueue((run) => this.checkEndpoint(run, endpoint, { replace: true }));
        }
      },
    );
    inject(DestroyRef).onDestroy(() => changes?.unsubscribe());
  }

  /** On start and after each sign-in, once the Convex client is authenticated. */
  check(): Promise<void> {
    return this.enqueue(async (run) => {
      const subscription = await this.browserSubscription();
      if (subscription) await this.checkEndpoint(run, subscription.endpoint, { replace: false });
    });
  }

  /** Removes this device's row and browser subscription, then ends the session; never rejects, so sign-out always completes. */
  async signOut(endSession: () => Promise<void>): Promise<void> {
    this.signingOut = true;
    this.generation += 1;
    try {
      await this.forget();
      await endSession();
    } finally {
      this.signingOut = false;
    }
  }

  private async forget(): Promise<void> {
    await settledWithin(this.queue, SIGN_OUT_CHECK_WAIT_MS);
    const subscription = await this.browserSubscription();
    if (!subscription) return;
    await this.removeRow(subscription.endpoint);
    await this.unsubscribeBrowser();
  }

  private enqueue(task: (run: number) => Promise<void>): Promise<void> {
    const run = this.signingOut ? -1 : this.generation;
    this.queue = this.queue.then(() => task(run)).catch(() => undefined);
    return this.queue;
  }

  private signingOutSince(run: number): boolean {
    return run !== this.generation;
  }

  private enabledSwPush(): SwPush | null {
    return this.swPush?.isEnabled ? this.swPush : null;
  }

  private browserSubscription(): Promise<PushSubscription | null> {
    const swPush = this.enabledSwPush();
    if (!swPush) return Promise.resolve(null);
    return firstWithin(swPush.subscription, SUBSCRIPTION_READ_TIMEOUT_MS);
  }

  private async checkEndpoint(
    run: number,
    endpoint: string,
    { replace }: { replace: boolean },
  ): Promise<void> {
    const client = this.client;
    if (!client || !this.auth.convexAuthenticated() || this.signingOutSince(run)) return;
    let owned: boolean;
    try {
      owned = await queryOnce(client, api.push.getMyDeviceStatus, { endpoint });
    } catch {
      // Unauthenticated during the token fetch, or offline: a guess here could unsubscribe the owner's own device.
      return;
    }
    // A late answer after sign-out may be about the next user, whose subscription this would remove.
    if (this.signingOutSince(run)) return;
    if (!owned) {
      // Another user's row, or none: the next user gets nothing without turning notifications on.
      await this.unsubscribeBrowser();
      return;
    }
    const vapidPublicKey = await queryOnce(client, api.push.getConfig, {}).then(
      (config) => config.vapidPublicKey,
      () => null,
    );
    if (replace) {
      await this.replace(run, endpoint, vapidPublicKey);
      return;
    }
    const current = await this.browserSubscription();
    // Only the endpoint the status query confirmed: subscribe takes over another user's row.
    if (current?.endpoint !== endpoint || this.signingOutSince(run)) return;
    if (needsNewSubscription(current, vapidPublicKey)) {
      await this.replace(run, endpoint, vapidPublicKey);
      return;
    }
    await this.save.run(subscriptionArgs(current)).catch(() => undefined);
  }

  private async replace(
    run: number,
    oldEndpoint: string,
    vapidPublicKey: string | null,
  ): Promise<void> {
    const swPush = this.enabledSwPush();
    if (!swPush || !vapidPublicKey || this.signingOutSince(run)) return;
    await this.unsubscribeBrowser();
    if (this.signingOutSince(run)) {
      await this.removeRow(oldEndpoint);
      return;
    }
    let next: PushSubscription;
    try {
      // No user gesture here, so Safari may refuse it; the page then shows off and the user turns them on again.
      next = await swPush.requestSubscription({ serverPublicKey: vapidPublicKey });
    } catch {
      await this.removeRow(oldEndpoint);
      return;
    }
    if (!isAllowedPushEndpoint(next.endpoint) || this.signingOutSince(run)) {
      await this.unsubscribeBrowser();
      await this.removeRow(oldEndpoint);
      return;
    }
    await this.save.run(subscriptionArgs(next)).catch(() => undefined);
    if (next.endpoint !== oldEndpoint) await this.removeRow(oldEndpoint);
  }

  private async removeRow(endpoint: string): Promise<void> {
    await this.remove.run({ endpoint }).catch(() => undefined);
  }

  private async unsubscribeBrowser(): Promise<void> {
    await this.swPush?.unsubscribe().catch(() => undefined);
  }
}
