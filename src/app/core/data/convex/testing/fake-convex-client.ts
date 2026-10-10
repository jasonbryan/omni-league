import { getFunctionName, type FunctionReference } from 'convex/server';
import type { ConvexClientLike } from '../convex-client';

/** One `onUpdate` registration on the fake client. */
export interface FakeSubscription {
  readonly name: string;
  readonly args: unknown;
  active: boolean;
  emit(value: unknown): void;
  fail(error: Error): void;
}

/** One `mutation` or `action` call on the fake client, settled by the test. */
export interface FakeCall {
  readonly kind: 'mutation' | 'action';
  readonly name: string;
  readonly args: unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Test double for `ConvexClientLike`. It implements only the surface the adapter uses, typed against
 * the real `ConvexClient` through `ConvexClientLike`, so a `convex` change to that surface is a type
 * error here. Test-only: never imported by app code.
 */
export class FakeConvexClient implements ConvexClientLike {
  readonly subscriptions: FakeSubscription[] = [];
  readonly calls: FakeCall[] = [];
  /** Names of `setAuth`, `clearAuth`, and `close` calls, in order. */
  readonly lifecycle: string[] = [];

  get activeSubscriptions(): FakeSubscription[] {
    return this.subscriptions.filter((s) => s.active);
  }

  readonly onUpdate = ((
    query: FunctionReference<'query'>,
    args: unknown,
    callback: (value: unknown) => unknown,
    onError?: (error: Error) => unknown,
  ) => {
    const sub: FakeSubscription = {
      name: getFunctionName(query),
      args,
      active: true,
      emit: (value) => {
        if (sub.active) callback(value);
      },
      fail: (error) => {
        if (sub.active) onError?.(error);
      },
    };
    this.subscriptions.push(sub);
    const unsubscribe = () => {
      sub.active = false;
    };
    return Object.assign(unsubscribe, { unsubscribe, getCurrentValue: () => undefined });
  }) as ConvexClientLike['onUpdate'];

  readonly mutation = ((fn: FunctionReference<'mutation'>, args: unknown) =>
    this.enqueue('mutation', getFunctionName(fn), args)) as ConvexClientLike['mutation'];

  readonly action = ((fn: FunctionReference<'action'>, args: unknown) =>
    this.enqueue('action', getFunctionName(fn), args)) as ConvexClientLike['action'];

  /** The arguments of each `setAuth` call, in order. */
  readonly setAuthCalls: Parameters<ConvexClientLike['setAuth']>[] = [];

  setAuth(...args: Parameters<ConvexClientLike['setAuth']>): void {
    this.lifecycle.push('setAuth');
    this.setAuthCalls.push(args);
  }

  clearAuth(): void {
    this.lifecycle.push('clearAuth');
  }

  close(): Promise<void> {
    this.lifecycle.push('close');
    return Promise.resolve();
  }

  private enqueue(kind: FakeCall['kind'], name: string, args: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.calls.push({ kind, name, args, resolve, reject });
    });
  }
}
