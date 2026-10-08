import {
  Injector,
  PLATFORM_ID,
  assertInInjectionContext,
  computed,
  inject,
  runInInjectionContext,
  signal,
  type Signal,
} from '@angular/core';
import { isPlatformServer } from '@angular/common';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { CONVEX_CLIENT, type ConvexClientLike } from './convex-client';
import { ConvexNotConfiguredError, ConvexServerCallError } from './errors';

export interface CallRef<Args, R> {
  run(args: Args): Promise<Awaited<R>>;
  readonly pending: Signal<boolean>;
  readonly error: Signal<Error | undefined>;
}

export function injectMutation<M extends FunctionReference<'mutation'>>(
  mutation: M,
  options?: { injector?: Injector },
): CallRef<FunctionArgs<M>, FunctionReturnType<M>> {
  if (!options?.injector) assertInInjectionContext(injectMutation);
  return createCallRef(options?.injector ?? inject(Injector), (client, args: FunctionArgs<M>) =>
    client.mutation(mutation, args),
  );
}

export function injectAction<A extends FunctionReference<'action'>>(
  action: A,
  options?: { injector?: Injector },
): CallRef<FunctionArgs<A>, FunctionReturnType<A>> {
  if (!options?.injector) assertInInjectionContext(injectAction);
  return createCallRef(options?.injector ?? inject(Injector), (client, args: FunctionArgs<A>) =>
    client.action(action, args),
  );
}

/** Shared mutation/action behaviour (ADR 0006 "Mutation and action helpers"). */
function createCallRef<Args, R>(
  injector: Injector,
  call: (client: ConvexClientLike, args: Args) => Promise<Awaited<R>>,
): CallRef<Args, R> {
  return runInInjectionContext(injector, () => {
    const client = inject(CONVEX_CLIENT);
    const onServer = isPlatformServer(inject(PLATFORM_ID));
    const inFlight = signal(0);
    const error = signal<Error | undefined>(undefined);

    async function run(args: Args): Promise<Awaited<R>> {
      // Mutations and actions are user interactions; they never run during a server render.
      if (onServer || !client) {
        const unavailable = onServer ? new ConvexServerCallError() : new ConvexNotConfiguredError();
        error.set(unavailable);
        throw unavailable;
      }

      inFlight.update((n) => n + 1);
      try {
        const result = await call(client, args);
        error.set(undefined);
        return result;
      } catch (e) {
        const failure = e instanceof Error ? e : new Error(String(e));
        error.set(failure);
        throw failure;
      } finally {
        inFlight.update((n) => n - 1);
      }
    }

    return { run, pending: computed(() => inFlight() > 0), error: error.asReadonly() };
  });
}
