import { InjectionToken } from '@angular/core';
import type { ConvexClient } from 'convex/browser';

// A leaf file, as convex-url.ts is: `connection.ts` and `convex-client.ts` both need the token, so
// keeping it here stops the two from importing each other.

/** The part of `ConvexClient` the adapter uses; tests substitute a fake. */
export interface ConvexClientLike {
  onUpdate: ConvexClient['onUpdate'];
  mutation: ConvexClient['mutation'];
  action: ConvexClient['action'];
  setAuth: ConvexClient['setAuth'];
  clearAuth(): void;
  close(): Promise<void>;
  /** Read by the `online` signal and by the offline guard in `run()` (ADR 0013, #88). */
  connectionState: ConvexClient['connectionState'];
  subscribeToConnectionState: ConvexClient['subscribeToConnectionState'];
}

/** Browser: the app's one client, or `null` with no URL. Server: always `null` (no WebSocket). */
export const CONVEX_CLIENT = new InjectionToken<ConvexClientLike | null>('CONVEX_CLIENT');
