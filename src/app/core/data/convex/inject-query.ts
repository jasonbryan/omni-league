import {
  Injector,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  runInInjectionContext,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { convexToJson } from 'convex/values';
import { CONVEX_CLIENT } from './convex-client';
import { CONVEX_URL } from './convex-url';
import { ConvexNotConfiguredError } from './errors';

/** Args value that keeps a query helper idle: no subscription, `isLoading()` false. */
export const skipToken = Symbol('convex.skipToken');
export type SkipToken = typeof skipToken;

export interface QueryRef<T> {
  readonly value: Signal<T | undefined>;
  readonly isLoading: Signal<boolean>;
  readonly error: Signal<Error | undefined>;
}

function isArgsFn<A>(args: A | (() => A | SkipToken)): args is () => A | SkipToken {
  return typeof args === 'function';
}

/**
 * Live Convex query as signals, owned by the current (or given) injector. See README.md for the
 * state table; the behaviour is fixed by ADR 0006 "Query helper".
 */
export function injectQuery<Q extends FunctionReference<'query'>>(
  query: Q,
  args: FunctionArgs<Q> | (() => FunctionArgs<Q> | SkipToken),
  options?: { injector?: Injector },
): QueryRef<FunctionReturnType<Q>> {
  if (!options?.injector) assertInInjectionContext(injectQuery);
  const injector = options?.injector ?? inject(Injector);

  return runInInjectionContext(injector, () => {
    interface Request {
      readonly args: FunctionArgs<Q>;
      readonly key: string;
    }
    interface Result {
      request: Request;
      value?: FunctionReturnType<Q>;
      error?: Error;
    }

    const readArgs = (): FunctionArgs<Q> | SkipToken => (isArgsFn(args) ? args() : args);
    // Structural comparison: a new object with equal content keeps the same Request (no resubscribe).
    const request = computed<Request | SkipToken>(
      () => {
        const current = readArgs();
        if (current === skipToken) return skipToken;
        return { args: current, key: JSON.stringify(convexToJson(current)) };
      },
      { equal: (a, b) => a === b || (a !== skipToken && b !== skipToken && a.key === b.key) },
    );

    const client = inject(CONVEX_CLIENT);
    if (!client) {
      // No URL (either platform), or the server platform before #24: no client, no network.
      const error = inject(CONVEX_URL) === null ? new ConvexNotConfiguredError() : undefined;
      return {
        value: signal<FunctionReturnType<Q> | undefined>(undefined).asReadonly(),
        isLoading: computed(() => !error && request() !== skipToken),
        error: signal<Error | undefined>(error).asReadonly(),
      };
    }

    // A result counts only for the request that produced it, so an args change reads as loading.
    const result = signal<Result | undefined>(undefined);
    const current = computed(() => {
      const latest = result();
      return latest?.request === request() ? latest : undefined;
    });

    effect((onCleanup) => {
      const req = request();
      if (req === skipToken) return;
      const unsubscribe = untracked(() =>
        client.onUpdate(
          query,
          req.args,
          (value) => result.set({ request: req, value }),
          (error) => result.set({ request: req, error }),
        ),
      );
      onCleanup(() => unsubscribe());
    });

    return {
      value: computed(() => current()?.value),
      isLoading: computed(() => request() !== skipToken && !current()),
      error: computed(() => current()?.error),
    };
  });
}
