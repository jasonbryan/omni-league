import { InjectionToken } from '@angular/core';
import type { ConvexClient } from 'convex/browser';

// A leaf file: `connection.ts` and `convex-client.ts` both need the token, so keeping it here stops the two from importing each other.

export interface ConvexClientLike {
  onUpdate: ConvexClient['onUpdate'];
  mutation: ConvexClient['mutation'];
  action: ConvexClient['action'];
  setAuth: ConvexClient['setAuth'];
  clearAuth(): void;
  close(): Promise<void>;
  connectionState: ConvexClient['connectionState'];
  subscribeToConnectionState: ConvexClient['subscribeToConnectionState'];
}

export const CONVEX_CLIENT = new InjectionToken<ConvexClientLike | null>('CONVEX_CLIENT');
