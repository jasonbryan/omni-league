import type { Provider } from '@angular/core';
import { AUTH_CLIENT, type AuthClientLike } from '../auth-client';

export function provideFakeAuthClient(fake: FakeAuthClient): Provider {
  return { provide: AUTH_CLIENT, useValue: Promise.resolve(fake as unknown as AuthClientLike) };
}

interface SessionValue {
  data: { session: { id: string }; user: { id: string; name: string } } | null;
  error: null;
  isPending: boolean;
  isRefetching: boolean;
}

export class FakeAuthClient {
  private value: SessionValue = { data: null, error: null, isPending: true, isRefetching: false };
  private readonly listeners = new Set<(value: SessionValue) => void>();

  nextToken: string | null = 'jwt';
  tokenRequests = 0;
  tokenThrows: Error | null = null;
  nextSignUpError: { status: number; code?: string; message?: string } | null = null;
  signUpThrows: Error | null = null;
  holdSignUp = false;
  private release: (() => void) | null = null;
  readonly signUps: Record<string, unknown>[] = [];
  nextSignInError: {
    status: number;
    code?: string;
    message?: string;
    retryAfterSeconds?: number;
  } | null = null;
  signInThrows: Error | null = null;
  holdSignIn = false;
  private releaseHeldSignIn: (() => void) | null = null;
  readonly signIns: Record<string, unknown>[] = [];
  signOuts = 0;
  signOutRejects = false;
  holdSignOut = false;
  private releaseHeldSignOut: (() => void) | null = null;
  storedCookie = 'better-auth.session_token=stored';
  getCookieThrows: Error | null = null;
  holdTokens = false;
  private readonly heldTokens: (() => void)[] = [];

  get sessionListeners(): number {
    return this.listeners.size;
  }

  emitSession(session: { id: string } | null): void {
    this.set({
      data: session ? { session, user: { id: 'u1', name: 'Maya Okafor' } } : null,
      error: null,
      isPending: false,
      isRefetching: false,
    });
  }

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

  readonly signIn = {
    email: async (body: Record<string, unknown>) => {
      this.signIns.push(body);
      if (this.holdSignIn) await new Promise<void>((resolve) => (this.releaseHeldSignIn = resolve));
      if (this.signInThrows) throw this.signInThrows;
      const error = this.nextSignInError;
      if (!error) this.storedCookie = 'better-auth.session_token=t';
      return error
        ? { data: null, error: { statusText: '', ...error } }
        : { data: { token: 't', user: { id: 'u1' } }, error: null };
    },
  };

  releaseSignIn(): void {
    this.releaseHeldSignIn?.();
    this.releaseHeldSignIn = null;
  }

  releaseSignUp(): void {
    this.release?.();
    this.release = null;
  }

  readonly signOut = async () => {
    this.signOuts++;
    if (this.holdSignOut) await new Promise<void>((resolve) => (this.releaseHeldSignOut = resolve));
    if (this.signOutRejects) throw new Error('network');
    this.storedCookie = '';
    this.emitSession(null);
    return { data: { success: true }, error: null };
  };

  releaseSignOut(): void {
    this.releaseHeldSignOut?.();
    this.releaseHeldSignOut = null;
  }

  private set(value: SessionValue): void {
    this.value = value;
    for (const listener of [...this.listeners]) listener(value);
  }
}
