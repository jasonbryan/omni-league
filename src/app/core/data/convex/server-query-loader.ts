import {
  Injectable,
  InjectionToken,
  PendingTasks,
  TransferState,
  inject,
  makeStateKey,
} from '@angular/core';
import { ConvexHttpClient } from 'convex/browser';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { convexToJson, type Value } from 'convex/values';
import { CONVEX_URL } from './convex-url';
import type { TransferredQuery } from './transfer';

/** The part of `ConvexHttpClient` the server path uses; tests substitute a fake. */
export interface ConvexHttpClientLike {
  query: ConvexHttpClient['query'];
}

/** Limit for each server-render query, enforced by the loader and by the default client's fetch. */
export const CONVEX_SERVER_QUERY_TIMEOUT_MS = new InjectionToken<number>(
  'CONVEX_SERVER_QUERY_TIMEOUT_MS',
  {
    providedIn: 'root',
    factory: () => 5000,
  },
);

/**
 * A `fetch` that aborts after `timeoutMs` (releasing a hung socket) and still honours a caller's
 * signal. It reads `globalThis.fetch` at call time, so a stubbed or patched `fetch` is the one used.
 */
export function fetchWithTimeout(timeoutMs: number): typeof globalThis.fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return globalThis.fetch(input, { ...init, signal });
  };
}

export const CONVEX_HTTP_CLIENT_FACTORY = new InjectionToken<(url: string) => ConvexHttpClientLike>(
  'CONVEX_HTTP_CLIENT_FACTORY',
  {
    providedIn: 'root',
    factory: () => {
      const timeoutMs = inject(CONVEX_SERVER_QUERY_TIMEOUT_MS);
      return (url: string) =>
        new ConvexHttpClient(url, { logger: false, fetch: fetchWithTimeout(timeoutMs) });
    },
  },
);

/** `TransferState` key shared by the server write and the browser seed: `cvx:<function>:<JSON args>`. */
export function transferKey(query: FunctionReference<'query'>, argsKey: string): string {
  return `cvx:${getFunctionName(query)}:${argsKey}`;
}

/** A settled server query: exactly one of `value` (possibly `undefined`) or `error`. */
export type ServerQueryResult =
  { value: unknown; error?: undefined } | { value?: undefined; error: Error };

const FAILED_MESSAGE = 'Convex query failed during server render';

/**
 * Server-only, one instance per render (root-provided; Angular SSR bootstraps a new application
 * per request). Holds that render's HTTP client and its dedupe map, so nothing is shared across
 * requests. Injected only on the server with a URL; never calls `setAuth`.
 */
@Injectable({ providedIn: 'root' })
export class ConvexServerQueryLoader {
  private readonly url = inject(CONVEX_URL);
  private readonly createClient = inject(CONVEX_HTTP_CLIENT_FACTORY);
  private readonly timeoutMs = inject(CONVEX_SERVER_QUERY_TIMEOUT_MS);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly transferState = inject(TransferState);
  private client?: ConvexHttpClientLike;
  private readonly inflight = new Map<string, Promise<ServerQueryResult>>();

  /** One HTTP query per distinct function and args in this render; never rejects. */
  load(
    query: FunctionReference<'query'>,
    args: unknown,
    argsKey: string,
  ): Promise<ServerQueryResult> {
    const key = transferKey(query, argsKey);
    let result = this.inflight.get(key);
    if (!result) {
      result = this.fetch(query, args, key);
      this.inflight.set(key, result);
    }
    return result;
  }

  private async fetch(
    query: FunctionReference<'query'>,
    args: unknown,
    key: string,
  ): Promise<ServerQueryResult> {
    const release = this.pendingTasks.add(); // the zoneless render serialises only after this settles
    const stateKey = makeStateKey<TransferredQuery>(key);
    try {
      if (this.url === null) throw new Error('ConvexServerQueryLoader requires a Convex URL');
      this.client ??= this.createClient(this.url);
      const run = this.client.query as (
        q: FunctionReference<'query'>,
        a: unknown,
      ) => Promise<unknown>;
      const value = await this.withTimeout(run.call(this.client, query, args));
      this.transferState.set(
        stateKey,
        value === undefined ? { u: true } : { v: convexToJson(value as Value) },
      );
      return { value };
    } catch (caught) {
      const timedOut = (caught as { name?: unknown } | null)?.name === 'TimeoutError';
      // Either timer may fire first (the loader's, or the default fetch's AbortSignal); both read the same.
      const error = timedOut
        ? this.timeoutError()
        : caught instanceof Error
          ? caught
          : new Error(String(caught));
      // Fixed text only: the marker lands in public, cacheable HTML. The real error stays in error().
      const marker = timedOut
        ? { name: 'TimeoutError', message: error.message }
        : { name: 'Error', message: FAILED_MESSAGE };
      this.transferState.set(stateKey, { e: marker });
      return { error };
    } finally {
      release();
    }
  }

  /** Races the query against the loader's own timer (cleared on settle), so any client is bounded. */
  private withTimeout<T>(query: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(this.timeoutError()), this.timeoutMs);
    });
    return Promise.race([query, timeout]).finally(() => clearTimeout(timer));
  }

  private timeoutError(): Error {
    const error = new Error(`Convex query timed out after ${this.timeoutMs} ms`);
    error.name = 'TimeoutError';
    return error;
  }
}
