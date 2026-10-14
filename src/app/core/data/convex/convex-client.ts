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
import { CONVEX_CLIENT, type ConvexClientLike } from './client-token';
import { ConvexConnection } from './connection';
import { CONVEX_URL } from './convex-url';
import { ConvexHydrationWindow } from './transfer';

export interface ConvexAuthSource {
  fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;
  signedIn: Signal<boolean>;
  onChange?: (isAuthenticated: boolean) => void;
}

export function wrapConvexClient(client: ConvexClient): ConvexClientLike {
  return {
    onUpdate: client.onUpdate.bind(client),
    mutation: client.mutation.bind(client),
    action: client.action.bind(client),
    setAuth: client.setAuth.bind(client),
    clearAuth: () => client.client.clearAuth(),
    close: () => client.close(),
    connectionState: client.connectionState.bind(client),
    subscribeToConnectionState: client.subscribeToConnectionState.bind(client),
  };
}

export const CONVEX_CLIENT_FACTORY = new InjectionToken<(url: string) => ConvexClientLike>(
  'CONVEX_CLIENT_FACTORY',
  { providedIn: 'root', factory: () => (url: string) => wrapConvexClient(new ConvexClient(url)) },
);

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

export function provideConvex(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: CONVEX_CLIENT, useFactory: createConvexClient },
    provideAppInitializer(() => {
      if (isPlatformServer(inject(PLATFORM_ID))) return;
      inject(ConvexHydrationWindow).closeWhenStable();
      // Created at start, so the `online` signal's 5-second rule counts from the start of the app.
      inject(ConvexConnection);
    }),
  ]);
}

export function provideConvexAuth(
  source: ConvexAuthSource | Type<ConvexAuthSource>,
): EnvironmentProviders {
  const provider: Provider =
    typeof source === 'function'
      ? { provide: CONVEX_AUTH, useExisting: source }
      : { provide: CONVEX_AUTH, useValue: source };
  return makeEnvironmentProviders([provider]);
}
