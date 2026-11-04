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

  constructor() {
    const changes = this.enabledSwPush()?.pushSubscriptionChanges.subscribe(
      ({ oldSubscription }) => {
        const endpoint = oldSubscription?.endpoint;
        if (endpoint) void this.enqueue(() => this.checkEndpoint(endpoint, { replace: true }));
      },
    );
    inject(DestroyRef).onDestroy(() => changes?.unsubscribe());
  }

  /** On start and after each sign-in, once the Convex client is authenticated. */
  check(): Promise<void> {
    return this.enqueue(async () => {
      const subscription = await this.browserSubscription();
      if (subscription) await this.checkEndpoint(subscription.endpoint, { replace: false });
    });
  }

  /** Before the session ends; never rejects, so sign-out always completes. */
  async forget(): Promise<void> {
    const subscription = await this.browserSubscription();
    if (!subscription) return;
    await this.removeRow(subscription.endpoint);
    await this.unsubscribeBrowser();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch(() => undefined);
    return this.queue;
  }

  private enabledSwPush(): SwPush | null {
    return this.swPush?.isEnabled ? this.swPush : null;
  }

  private browserSubscription(): Promise<PushSubscription | null> {
    const swPush = this.enabledSwPush();
    if (!swPush) return Promise.resolve(null);
    return firstWithin(swPush.subscription, SUBSCRIPTION_READ_TIMEOUT_MS);
  }

  private async checkEndpoint(endpoint: string, { replace }: { replace: boolean }): Promise<void> {
    const client = this.client;
    if (!client || !this.auth.convexAuthenticated()) return;
    let owned: boolean;
    try {
      owned = await queryOnce(client, api.push.getMyDeviceStatus, { endpoint });
    } catch {
      // Unauthenticated during the token fetch, or offline: a guess here could unsubscribe the owner's own device.
      return;
    }
    if (!owned) {
      // Another user's row, or none: the next user gets nothing without turning notifications on.
      await this.unsubscribeBrowser();
      return;
    }
    const vapidPublicKey = await queryOnce(client, api.push.getConfig, {}).then(
      (config) => config.vapidPublicKey,
      () => null,
    );
    const current = await this.browserSubscription();
    if (replace || (current && needsNewSubscription(current, vapidPublicKey))) {
      await this.replace(endpoint, vapidPublicKey);
    } else if (current) {
      await this.save.run(subscriptionArgs(current)).catch(() => undefined);
    }
  }

  private async replace(oldEndpoint: string, vapidPublicKey: string | null): Promise<void> {
    const swPush = this.enabledSwPush();
    if (!swPush || !vapidPublicKey) return;
    await this.unsubscribeBrowser();
    let next: PushSubscription;
    try {
      // No user gesture here, so Safari may refuse it; the page then shows off and the user turns them on again.
      next = await swPush.requestSubscription({ serverPublicKey: vapidPublicKey });
    } catch {
      await this.removeRow(oldEndpoint);
      return;
    }
    if (!isAllowedPushEndpoint(next.endpoint)) {
      await this.unsubscribeBrowser();
      await this.removeRow(oldEndpoint);
      return;
    }
    await this.save.run(subscriptionArgs(next)).catch(() => undefined);
  }

  private async removeRow(endpoint: string): Promise<void> {
    await this.remove.run({ endpoint }).catch(() => undefined);
  }

  private async unsubscribeBrowser(): Promise<void> {
    await this.swPush?.unsubscribe().catch(() => undefined);
  }
}
