import {
  DestroyRef,
  InjectionToken,
  PLATFORM_ID,
  effect,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  untracked,
  type EnvironmentProviders,
  type Provider,
  type Signal,
  type Type,
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

/** The auth source `provideConvexAuth()` registers (ADR 0006; `AuthService`, ADR 0008). */
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

/** The auth source, provided by `provideConvexAuth()`. Ignored on the server (ADR 0006). */
export const CONVEX_AUTH = new InjectionToken<ConvexAuthSource>('CONVEX_AUTH');

function createConvexClient(): ConvexClientLike | null {
  if (isPlatformServer(inject(PLATFORM_ID))) return null;
  const url = inject(CONVEX_URL);
  if (url === null) return null;
  const client = inject(CONVEX_CLIENT_FACTORY)(url);
  const auth = inject(CONVEX_AUTH, { optional: true });
  if (auth) applyAuth(client, auth);
  // A rejected close() at teardown must not surface as an unhandled rejection.
  inject(DestroyRef).onDestroy(() => void client.close().catch(() => undefined));
  return client;
}

/**
 * ADR 0006 "Auth extension point": `setAuth` now, then `clearAuth` when `signedIn` turns false and
 * `setAuth` again when it turns true. Live queries keep their subscriptions; Convex reruns them
 * with the new identity. Runs in the client factory's injection context (the root injector).
 */
function applyAuth(client: ConvexClientLike, auth: ConvexAuthSource): void {
  client.setAuth(auth.fetchToken, auth.onChange);
  let previous = untracked(auth.signedIn);
  effect(() => {
    const signedIn = auth.signedIn();
    if (signedIn === previous) return;
    previous = signedIn;
    untracked(() => {
      if (signedIn) client.setAuth(auth.fetchToken, auth.onChange);
      else client.clearAuth();
    });
  });
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

/**
 * Registers the auth source for the browser Convex client (ADR 0006), once, at the application root
 * (`app.config.ts`). `source` is an instance or an injectable class, whose root instance is used.
 */
export function provideConvexAuth(
  source: ConvexAuthSource | Type<ConvexAuthSource>,
): EnvironmentProviders {
  const provider: Provider =
    typeof source === 'function'
      ? { provide: CONVEX_AUTH, useExisting: source }
      : { provide: CONVEX_AUTH, useValue: source };
  return makeEnvironmentProviders([provider]);
}
