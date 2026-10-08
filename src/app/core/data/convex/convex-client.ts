import {
  DestroyRef,
  InjectionToken,
  PLATFORM_ID,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  type EnvironmentProviders,
  type Signal,
} from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { ConvexClient } from 'convex/browser';
import { CONVEX_URL } from './convex-url';
import { ConvexHydrationWindow } from './transfer';

/** The part of `ConvexClient` the adapter uses; tests substitute a fake. */
export interface ConvexClientLike {
  onUpdate: ConvexClient['onUpdate'];
  mutation: ConvexClient['mutation'];
  action: ConvexClient['action'];
  setAuth: ConvexClient['setAuth'];
  clearAuth(): void;
  close(): Promise<void>;
}

/** Auth source for the #7 follow-up. Declared only: nothing provides `CONVEX_AUTH` yet. */
export interface ConvexAuthSource {
  fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;
  signedIn: Signal<boolean>;
  onChange?: (isAuthenticated: boolean) => void;
}

/** Adapts a real `ConvexClient` to `ConvexClientLike` (adds `clearAuth`, which lives on the inner client). */
export function wrapConvexClient(client: ConvexClient): ConvexClientLike {
  return {
    onUpdate: client.onUpdate.bind(client),
    mutation: client.mutation.bind(client),
    action: client.action.bind(client),
    setAuth: client.setAuth.bind(client),
    clearAuth: () => client.client.clearAuth(),
    close: () => client.close(),
  };
}

export const CONVEX_CLIENT_FACTORY = new InjectionToken<(url: string) => ConvexClientLike>(
  'CONVEX_CLIENT_FACTORY',
  { providedIn: 'root', factory: () => (url: string) => wrapConvexClient(new ConvexClient(url)) },
);

/** Browser: the app's one client, or `null` with no URL. Server: always `null` (no WebSocket). */
export const CONVEX_CLIENT = new InjectionToken<ConvexClientLike | null>('CONVEX_CLIENT');

/** Auth extension point for the #7 follow-up; not provided yet and ignored on the server. */
export const CONVEX_AUTH = new InjectionToken<ConvexAuthSource>('CONVEX_AUTH');

function createConvexClient(): ConvexClientLike | null {
  if (isPlatformServer(inject(PLATFORM_ID))) return null;
  const url = inject(CONVEX_URL);
  if (url === null) return null;
  const client = inject(CONVEX_CLIENT_FACTORY)(url);
  // A rejected close() at teardown must not surface as an unhandled rejection.
  inject(DestroyRef).onDestroy(() => void client.close().catch(() => undefined));
  return client;
}

/** Registers the Convex client once, at the application root (`app.config.ts`). */
export function provideConvex(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: CONVEX_CLIENT, useFactory: createConvexClient },
    provideAppInitializer(() => {
      if (!isPlatformServer(inject(PLATFORM_ID))) inject(ConvexHydrationWindow).closeWhenStable();
    }),
  ]);
}
