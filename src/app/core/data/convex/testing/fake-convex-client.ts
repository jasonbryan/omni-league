import type { ConnectionState } from 'convex/browser';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { ConvexClientLike } from '../client-token';

export interface FakeSubscription {
  readonly name: string;
  readonly args: unknown;
  active: boolean;
  emit(value: unknown): void;
  fail(error: Error): void;
}

export interface FakeCall {
  readonly kind: 'mutation' | 'action';
  readonly name: string;
  readonly args: unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class FakeConvexClient implements ConvexClientLike {
  readonly subscriptions: FakeSubscription[] = [];
  readonly calls: FakeCall[] = [];
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

  private state: ConnectionState = {
    hasInflightRequests: false,
    isWebSocketConnected: true,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    connectionRetries: 0,
    inflightMutations: 0,
    inflightActions: 0,
  };
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();

  get connectionStateListeners(): number {
    return this.stateListeners.size;
  }

  connectionState(): ConnectionState {
    return { ...this.state };
  }

  subscribeToConnectionState(cb: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  setConnected(connected: boolean, options: { neverConnected?: boolean } = {}): void {
    this.state = {
      ...this.state,
      isWebSocketConnected: connected,
      hasEverConnected: connected || (!options.neverConnected && this.state.hasEverConnected),
      connectionCount: this.state.connectionCount + (connected ? 1 : 0),
    };
    for (const listener of [...this.stateListeners]) listener(this.connectionState());
  }

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
