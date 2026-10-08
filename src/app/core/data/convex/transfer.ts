import { ApplicationRef, Injectable, inject } from '@angular/core';
import { jsonToConvex, type JSONValue } from 'convex/values';
import { ConvexServerQueryError } from './errors';

/** A server query result as written to `TransferState` (ADR 0006 "Fetching (server)"). */
export type TransferredQuery =
  { v: JSONValue } | { u: true } | { e: { name: string; message: string } };

/** Decodes a transferred entry into the helper's settled state. */
export function decodeTransferred(entry: TransferredQuery): { value?: unknown; error?: Error } {
  if ('e' in entry) return { error: new ConvexServerQueryError(entry.e.message) };
  if ('v' in entry) return { value: jsonToConvex(entry.v) };
  return { value: undefined };
}

/**
 * Browser only: whether query helpers may still seed from `TransferState`. Open until the
 * application first becomes stable, then closed for good, mirroring Angular's `HttpClient`
 * transfer cache, so later navigations never show server-render data. `provideConvex()` closes it
 * from an app initializer, which runs while bootstrap holds its own pending task.
 */
@Injectable({ providedIn: 'root' })
export class ConvexHydrationWindow {
  private open = true;
  private readonly appRef = inject(ApplicationRef);

  get isOpen(): boolean {
    return this.open;
  }

  closeWhenStable(): void {
    void this.appRef.whenStable().then(() => {
      this.open = false;
    });
  }
}
