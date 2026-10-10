import {
  Injector,
  PLATFORM_ID,
  TransferState,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  makeStateKey,
  runInInjectionContext,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { isPlatformServer } from '@angular/common';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { convexToJson } from 'convex/values';
import { CONVEX_CLIENT } from './client-token';
import { CONVEX_URL } from './convex-url';
import { ConvexNotConfiguredError } from './errors';
import { ConvexSavedCopies } from './saved-copies';
import { ConvexServerQueryLoader, transferKey } from './server-query-loader';
import { ConvexHydrationWindow, decodeTransferred, type TransferredQuery } from './transfer';

/** Args value that keeps a query helper idle: no subscription, `isLoading()` false. */
export const skipToken = Symbol('convex.skipToken');
export type SkipToken = typeof skipToken;

export interface QueryRef<T> {
  readonly value: Signal<T | undefined>;
  readonly isLoading: Signal<boolean>;
  readonly error: Signal<Error | undefined>;
  /**
   * When the value shown was saved, in epoch milliseconds, while `value()` is a saved copy (an
   * allow-listed query in the browser with no transferred value and no live result yet, ADR 0013
   * section 3); `undefined` otherwise, and from the first live result on.
   */
  readonly savedAt: Signal<number | undefined>;
}

function isArgsFn<A>(args: A | (() => A | SkipToken)): args is () => A | SkipToken {
  return typeof args === 'function';
}

/**
 * Convex query as signals, owned by the current (or given) injector: a live subscription in the
 * browser (seeded from the server render during hydration), one HTTP fetch during a server render.
 * See README.md; the behaviour is fixed by ADR 0006 "Query helper".
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
      savedAt?: number;
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

    const server = isPlatformServer(inject(PLATFORM_ID));
    // Server: the per-render HTTP loader, only with a URL. Browser: the app's live client.
    const loader = server && inject(CONVEX_URL) !== null ? inject(ConvexServerQueryLoader) : null;
    const client = server ? null : inject(CONVEX_CLIENT);
    if (!loader && !client) {
      // No URL (either platform): no client, no network, nothing logged.
      const error = new ConvexNotConfiguredError();
      return {
        value: signal<FunctionReturnType<Q> | undefined>(undefined).asReadonly(),
        isLoading: signal(false).asReadonly(),
        error: signal<Error | undefined>(error).asReadonly(),
        savedAt: signal<number | undefined>(undefined).asReadonly(),
      };
    }

    // Hydration seed: decided once, on the first read of the args (inputs are bound after
    // construction, so the args function must not run here). The seed is taken only if that first
    // read is ready and the hydration window is still open. A first read of skipToken, or a first
    // read after stable, never seeds, and later args changes never use transferred entries.
    const transferState = inject(TransferState);
    const hydrationWindow = server ? null : inject(ConvexHydrationWindow);
    let seedDecided = false;
    let seed: Result | undefined;
    const readRequest = (): Request | SkipToken => {
      const req = request();
      if (!seedDecided) {
        seedDecided = true;
        if (req !== skipToken && hydrationWindow?.isOpen) {
          const entry = transferState.get<TransferredQuery | null>(
            makeStateKey(transferKey(query, req.key)),
            null,
          );
          if (entry)
            seed = { request: req, ...(decodeTransferred(entry) as Omit<Result, 'request'>) };
        }
      }
      return req;
    };

    // Saved copies (ADR 0013 section 3): browser only, allow-listed queries only, and only for a
    // request with no transferred seed. Read once per request, synchronously, so a page opened
    // offline renders its saved copy on the first render. The server never reads them.
    const savedCopies = client ? inject(ConvexSavedCopies) : null;
    const saved = computed<Result | undefined>(() => {
      const req = readRequest();
      if (req === skipToken || !savedCopies || seed?.request === req) return undefined;
      const copy = untracked(() => savedCopies.read(query, req.args));
      return copy
        ? { request: req, value: copy.value as FunctionReturnType<Q>, savedAt: copy.savedAt }
        : undefined;
    });

    // A result counts only for the request that produced it, so an args change reads as loading.
    // Precedence: the live result, then the transferred seed, then a saved copy, then loading.
    const result = signal<Result | undefined>(undefined);
    const current = computed(() => {
      const req = readRequest();
      if (req === skipToken) return undefined;
      const latest = result();
      if (latest?.request === req) return latest;
      if (seed?.request === req) return seed;
      const copy = saved();
      return copy?.request === req ? copy : undefined;
    });

    effect((onCleanup) => {
      const req = readRequest();
      if (req === skipToken) return;
      if (loader) {
        void loader.load(query, req.args, req.key).then((settled) => {
          result.set({ request: req, ...(settled as Omit<Result, 'request'>) });
        });
        return;
      }
      const unsubscribe = untracked(() =>
        client!.onUpdate(
          query,
          req.args,
          (value) => {
            result.set({ request: req, value });
            // Each live result becomes the saved copy; `null` removes it. Not listed: no-op.
            savedCopies?.write(query, req.args, value);
          },
          (error) => result.set({ request: req, error }),
        ),
      );
      onCleanup(() => unsubscribe());
    });

    return {
      value: computed(() => current()?.value),
      isLoading: computed(() => readRequest() !== skipToken && !current()),
      error: computed(() => current()?.error),
      savedAt: computed(() => current()?.savedAt),
    };
  });
}
