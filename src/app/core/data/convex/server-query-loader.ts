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

export interface ConvexHttpClientLike {
  query: ConvexHttpClient['query'];
}

export const CONVEX_SERVER_QUERY_TIMEOUT_MS = new InjectionToken<number>(
  'CONVEX_SERVER_QUERY_TIMEOUT_MS',
  {
    providedIn: 'root',
    factory: () => 5000,
  },
);

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

export function transferKey(query: FunctionReference<'query'>, argsKey: string): string {
  return `cvx:${getFunctionName(query)}:${argsKey}`;
}

export type ServerQueryResult =
  { value: unknown; error?: undefined } | { value?: undefined; error: Error };

const FAILED_MESSAGE = 'Convex query failed during server render';

class LoaderTimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

/** One instance per render: Angular SSR bootstraps a new application per request, so nothing is shared across requests. */
@Injectable({ providedIn: 'root' })
export class ConvexServerQueryLoader {
  private readonly url = inject(CONVEX_URL);
  private readonly createClient = inject(CONVEX_HTTP_CLIENT_FACTORY);
  private readonly timeoutMs = inject(CONVEX_SERVER_QUERY_TIMEOUT_MS);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly transferState = inject(TransferState);
  private client?: ConvexHttpClientLike;
  private readonly inflight = new Map<string, Promise<ServerQueryResult>>();

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
      // Either timer may fire first (the loader's own error, or the default fetch's AbortSignal
      // DOMException); both read the same. Any other error keeps its identity, whatever its name.
      const timedOut =
        caught instanceof LoaderTimeoutError ||
        (caught instanceof DOMException && caught.name === 'TimeoutError');
      const error = timedOut
        ? caught instanceof LoaderTimeoutError
          ? caught
          : this.timeoutError()
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

  private withTimeout<T>(query: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(this.timeoutError()), this.timeoutMs);
    });
    return Promise.race([query, timeout]).finally(() => clearTimeout(timer));
  }

  private timeoutError(): Error {
    return new LoaderTimeoutError(`Convex query timed out after ${this.timeoutMs} ms`);
  }
}
