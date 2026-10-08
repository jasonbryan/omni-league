import { getFunctionName, type FunctionReference } from 'convex/server';
import type { ConvexHttpClientLike } from '../server-query-loader';

/** One `query()` call on the fake HTTP client, settled by the test. */
export interface FakeHttpQuery {
  readonly name: string;
  readonly args: unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Test double for `ConvexHttpClientLike`, typed against the real `ConvexHttpClient['query']`.
 * `setAuth` exists only so a spec can prove the adapter never calls it. Test-only.
 */
export class FakeConvexHttpClient implements ConvexHttpClientLike {
  readonly queries: FakeHttpQuery[] = [];
  readonly setAuthCalls: unknown[][] = [];

  readonly query = ((fn: FunctionReference<'query'>, args?: unknown) =>
    new Promise((resolve, reject) => {
      this.queries.push({ name: getFunctionName(fn), args, resolve, reject });
    })) as ConvexHttpClientLike['query'];

  setAuth(...args: unknown[]): void {
    this.setAuthCalls.push(args);
  }
}
