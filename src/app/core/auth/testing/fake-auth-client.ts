import type { Provider } from '@angular/core';
import { AUTH_CLIENT, type AuthClientLike } from '../auth-client';

/** Provides `fake` as the Better Auth client, as the lazy `AUTH_CLIENT` factory would. */
export function provideFakeAuthClient(fake: FakeAuthClient): Provider {
  return { provide: AUTH_CLIENT, useValue: Promise.resolve(fake as unknown as AuthClientLike) };
}

/** A session store value, as Better Auth's `useSession` atom emits it. */
interface SessionValue {
  data: { session: { id: string }; user: { id: string; name: string } } | null;
  error: null;
  isPending: boolean;
  isRefetching: boolean;
}

/**
 * Test double for the part of the Better Auth client `AuthService` uses (`AuthClientLike`). The
 * test drives the session store and settles requests. Test-only: never imported by app code.
 */
export class FakeAuthClient {
  private value: SessionValue = { data: null, error: null, isPending: true, isRefetching: false };
  private readonly listeners = new Set<(value: SessionValue) => void>();

  /** The next `convex.token` result; `null` makes the request fail. */
  nextToken: string | null = 'jwt';
  tokenRequests = 0;
  /** The next `signUp.email` error; `null` makes it succeed. */
  nextSignUpError: { status: number; code?: string; message?: string } | null = null;
  /** When set, `signUp.email` throws it (a network failure). */
  signUpThrows: Error | null = null;
  /** When true, `signUp.email` waits for `releaseSignUp()`. */
  holdSignUp = false;
  private release: (() => void) | null = null;
  readonly signUps: Record<string, unknown>[] = [];
  signOuts = 0;

  get sessionListeners(): number {
    return this.listeners.size;
  }

  /** Settles the session store: signed in with `session`, or signed out with `null`. */
  emitSession(session: { id: string } | null): void {
    this.set({
      data: session ? { session, user: { id: 'u1', name: 'Maya Okafor' } } : null,
      error: null,
      isPending: false,
      isRefetching: false,
    });
  }

  /** A refetch that has no data yet. */
  emitPending(): void {
    this.set({ ...this.value, isPending: true, isRefetching: true });
  }

  readonly useSession = {
    subscribe: (listener: (value: SessionValue) => void) => {
      this.listeners.add(listener);
      listener(this.value);
      return () => {
        this.listeners.delete(listener);
      };
    },
  };

  readonly convex = {
    token: () => {
      this.tokenRequests++;
      const token = this.nextToken;
      return Promise.resolve(
        token === null
          ? { data: null, error: { status: 401, statusText: 'Unauthorized' } }
          : { data: { token }, error: null },
      );
    },
  };

  readonly signUp = {
    email: async (body: Record<string, unknown>) => {
      this.signUps.push(body);
      if (this.holdSignUp) await new Promise<void>((resolve) => (this.release = resolve));
      if (this.signUpThrows) throw this.signUpThrows;
      const error = this.nextSignUpError;
      return error
        ? { data: null, error: { statusText: '', ...error } }
        : { data: { token: 't', user: { id: 'u1' } }, error: null };
    },
  };

  /** Lets a held `signUp.email` finish. */
  releaseSignUp(): void {
    this.release?.();
    this.release = null;
  }

  readonly signOut = () => {
    this.signOuts++;
    this.emitSession(null);
    return Promise.resolve({ data: { success: true }, error: null });
  };

  private set(value: SessionValue): void {
    this.value = value;
    for (const listener of [...this.listeners]) listener(value);
  }
}
