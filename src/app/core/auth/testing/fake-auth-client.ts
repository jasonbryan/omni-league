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
  /** When set, `convex.token` rejects with it (a network failure, or a fetch a page unload aborted). */
  tokenThrows: Error | null = null;
  /** The next `signUp.email` error; `null` makes it succeed. */
  nextSignUpError: { status: number; code?: string; message?: string } | null = null;
  /** When set, `signUp.email` throws it (a network failure). */
  signUpThrows: Error | null = null;
  /** When true, `signUp.email` waits for `releaseSignUp()`. */
  holdSignUp = false;
  private release: (() => void) | null = null;
  readonly signUps: Record<string, unknown>[] = [];
  signOuts = 0;
  /**
   * What the crossDomain plugin's `getCookie()` returns: the unexpired cookies stored in
   * `localStorage`. A session token by default; `''` models a browser that never signed in.
   */
  storedCookie = 'better-auth.session_token=stored';
  /**
   * When set, `getCookie()` throws it, as the crossDomain plugin does when the stored value is
   * `null` or holds a `null` entry.
   */
  getCookieThrows: Error | null = null;
  /** When true, `convex.token` waits for `releaseTokens()`. */
  holdTokens = false;
  private readonly heldTokens: (() => void)[] = [];

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

  readonly getCookie = () => {
    if (this.getCookieThrows) throw this.getCookieThrows;
    return this.storedCookie;
  };

  readonly convex = {
    token: async () => {
      this.tokenRequests++;
      if (this.holdTokens) await new Promise<void>((resolve) => this.heldTokens.push(resolve));
      if (this.tokenThrows) throw this.tokenThrows;
      const token = this.nextToken;
      return token === null
        ? { data: null, error: { status: 401, statusText: 'Unauthorized' } }
        : { data: { token }, error: null };
    },
  };

  /** Lets every held `convex.token` request finish, with the `nextToken` set at that time. */
  releaseTokens(): void {
    this.holdTokens = false;
    for (const release of this.heldTokens.splice(0)) release();
  }

  readonly signUp = {
    email: async (body: Record<string, unknown>) => {
      this.signUps.push(body);
      if (this.holdSignUp) await new Promise<void>((resolve) => (this.release = resolve));
      if (this.signUpThrows) throw this.signUpThrows;
      const error = this.nextSignUpError;
      if (!error) this.storedCookie = 'better-auth.session_token=t';
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
    this.storedCookie = '';
    this.emitSession(null);
    return Promise.resolve({ data: { success: true }, error: null });
  };

  private set(value: SessionValue): void {
    this.value = value;
    for (const listener of [...this.listeners]) listener(value);
  }
}
