import { getFunctionName, type FunctionReference } from 'convex/server';
import type { ConvexHttpClientLike } from '../server-query-loader';

export interface FakeHttpQuery {
  readonly name: string;
  readonly args: unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

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
