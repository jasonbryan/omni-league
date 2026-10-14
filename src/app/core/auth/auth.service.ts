import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { ConvexAuthSource } from '../data/convex';
import { AUTH_CLIENT, type AuthClientLike } from './auth-client';

export type SignUpFailure =
  | 'exists'
  | 'breached'
  | 'check-unavailable'
  | 'invalid-email'
  | 'password-too-short'
  | 'password-too-long'
  | 'adult-required'
  | 'unexpected';

export type SignUpResult = { ok: true } | { ok: false; error: SignUpFailure };

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

/** `incorrect` covers a wrong password and an email with no account alike, so the answer does not reveal which emails have accounts. */
export type SignInFailure = 'incorrect' | 'throttled' | 'locked' | 'invalid-email' | 'unexpected';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: Exclude<SignInFailure, 'throttled'> }
  | { ok: false; error: 'throttled'; retryAfterSeconds: number };

export interface SignInInput {
  email: string;
  password: string;
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;

interface AuthError {
  status: number;
  code?: string;
  message?: string;
  /** Sent with convex/auth.ts's TOO_MANY_ATTEMPTS: the seconds until the next attempt may go. */
  retryAfterSeconds?: unknown;
}

type SessionState = 'unknown' | 'signed-in' | 'signed-out';

/** An empty value is the sign-out response's, which the session store's refetch then removes. */
const STORED_SESSION = /(?:^|; )[^=;]*session_token=[^;]/;

const FAILURE_BY_CODE: Record<string, SignUpFailure> = {
  USER_ALREADY_EXISTS: 'exists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'exists',
  PASSWORD_COMPROMISED: 'breached',
  INVALID_EMAIL: 'invalid-email',
  PASSWORD_TOO_SHORT: 'password-too-short',
  PASSWORD_TOO_LONG: 'password-too-long',
  ADULT_CONFIRMATION_REQUIRED: 'adult-required',
};

@Injectable({ providedIn: 'root' })
export class AuthService implements ConvexAuthSource {
  private readonly client: Promise<AuthClientLike | null> | null =
    inject(AUTH_CLIENT)?.catch(() => null) ?? null;

  private readonly session = signal<SessionState>(this.client ? 'unknown' : 'signed-out');
  readonly signedIn = computed(() => this.session() === 'signed-in');

  private readonly convexAuth = signal(false);
  readonly convexAuthenticated = this.convexAuth.asReadonly();

  private readonly destroyRef = inject(DestroyRef);
  private cachedToken: string | null = null;
  private pendingToken: Promise<string | null> | null = null;
  private tokenGeneration = 0;
  private watching = false;
  private resolveKnown: () => void = () => undefined;
  private readonly known = new Promise<void>((resolve) => (this.resolveKnown = resolve));

  constructor() {
    if (!this.client) {
      this.resolveKnown();
      return;
    }
    void this.client.then((client) => {
      if (this.destroyRef.destroyed) return;
      const hasNoStoredSession = !client || !hasStoredSession(client);
      if (hasNoStoredSession) {
        this.setSession('signed-out');
        return;
      }
      this.watchSession(client);
    });
  }

  private watchSession(client: AuthClientLike): void {
    if (this.watching || this.destroyRef.destroyed) return;
    this.watching = true;
    const unsubscribe = client.useSession.subscribe((state) => {
      const awaitingFirstAnswer = state.isPending;
      if (awaitingFirstAnswer) return;
      this.setSession(state.data?.session ? 'signed-in' : 'signed-out');
    });
    this.destroyRef.onDestroy(unsubscribe);
  }

  async isSignedIn(): Promise<boolean> {
    await this.known;
    return this.signedIn();
  }

  /**
   * Signed out, it returns `null` without a request. The token is cached until the Convex client asks for a fresh one before it expires (15 minutes).
   * Calls that do not force a refresh share the request in flight, so the Convex client's overlapping `setAuth` calls on a signed-in load make one request.
   */
  readonly fetchToken = async ({
    forceRefreshToken,
  }: {
    forceRefreshToken: boolean;
  }): Promise<string | null> => {
    const client = await this.client;
    if (!client) return null;
    await this.known;
    if (!this.signedIn()) return null;
    if (!forceRefreshToken) {
      if (this.cachedToken) return this.cachedToken;
      if (this.pendingToken) return this.pendingToken;
    }
    return this.requestToken(client);
  };

  /** One token request. Never rejects: the Convex client does not catch a rejected fetchToken. */
  private requestToken(client: AuthClientLike): Promise<string | null> {
    const generation = this.tokenGeneration;
    const request = (async (): Promise<string | null> => {
      try {
        const { data } = await client.convex.token({ fetchOptions: { throw: false } });
        return data?.token ?? null;
      } catch {
        // A network failure, or (WebKit) a fetch that a page unload aborted, is "no token", as a
        // refused request is.
        return null;
      }
    })().then((token) => {
      // A request from a session that has since ended answers `null`, even if another user has signed in meanwhile, and fills no cache.
      // One that a newer forced request replaced in the same session answers with its token but leaves the cache to the newer one.
      if (generation !== this.tokenGeneration) return null;
      if (this.pendingToken !== request) return token;
      this.pendingToken = null;
      this.cachedToken = token;
      return token;
    });
    this.pendingToken = request;
    return request;
  }

  readonly onChange = (isAuthenticated: boolean): void => {
    this.convexAuth.set(isAuthenticated);
  };

  async signUp({ name, email, password }: SignUpInput): Promise<SignUpResult> {
    const client = await this.client;
    if (!client) return { ok: false, error: 'unexpected' };
    let error: AuthError | null;
    try {
      // `adultConfirmed` is this app's field, which Better Auth's types do not know.
      const body = { name, email: email.trim(), password, adultConfirmed: true };
      ({ error } = await client.signUp.email(body));
    } catch {
      return { ok: false, error: 'unexpected' };
    }
    if (error) return { ok: false, error: failureOf(error) };
    // The response set the session; the store refetches it, but the answer is already known.
    this.forgetToken();
    this.setSession('signed-in');
    this.watchSession(client);
    return { ok: true };
  }

  async signIn({ email, password }: SignInInput): Promise<SignInResult> {
    const client = await this.client;
    if (!client) return { ok: false, error: 'unexpected' };
    let error: AuthError | null;
    try {
      ({ error } = await client.signIn.email({ email: email.trim(), password }));
    } catch {
      return { ok: false, error: 'unexpected' };
    }
    if (error) return signInFailureOf(error);
    this.forgetToken();
    this.setSession('signed-in');
    this.watchSession(client);
    return { ok: true };
  }

  async signOut(): Promise<void> {
    this.forgetToken();
    try {
      await (await this.client)?.signOut();
    } catch {
      // Signed out here regardless; the server session expires on its own.
    }
    this.setSession('signed-out');
  }

  private setSession(state: Exclude<SessionState, 'unknown'>): void {
    if (state === 'signed-out') this.forgetToken();
    this.session.set(state);
    this.resolveKnown();
  }

  private forgetToken(): void {
    this.tokenGeneration += 1;
    this.cachedToken = null;
    this.pendingToken = null;
  }
}

/** `getCookie()` throws when the stored value is `null` or holds a `null` entry; that is no stored session. */
function hasStoredSession(client: AuthClientLike): boolean {
  try {
    return STORED_SESSION.test(client.getCookie());
  } catch {
    return false;
  }
}

/**
 * Better Auth's body validation (`VALIDATION_ERROR`, 400) joins one `[body.<field>] <message>` per issue with `; `. Only a refusal
 * whose every issue is on `email` is the Email field's error; any other field is unexpected here.
 */
function isEmailValidationError(message: string | undefined): boolean {
  if (!message) return false;
  return message.split(/; (?=\[)/).every((issue) => issue.startsWith('[body.email] '));
}

function signInFailureOf(error: AuthError): SignInResult {
  if (error.status === 401) return { ok: false, error: 'incorrect' };
  if (error.status === 429 && error.code === 'SIGN_IN_LOCKED')
    return { ok: false, error: 'locked' };
  if (error.status === 429 && error.code === 'TOO_MANY_ATTEMPTS') {
    const seconds = error.retryAfterSeconds;
    return {
      ok: false,
      error: 'throttled',
      retryAfterSeconds:
        typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
          ? seconds
          : DEFAULT_RETRY_AFTER_SECONDS,
    };
  }
  if (
    error.code === 'INVALID_EMAIL' ||
    (error.code === 'VALIDATION_ERROR' && isEmailValidationError(error.message))
  ) {
    return { ok: false, error: 'invalid-email' };
  }
  return { ok: false, error: 'unexpected' };
}

function failureOf(error: AuthError): SignUpFailure {
  const byCode = error.code === undefined ? undefined : FAILURE_BY_CODE[error.code];
  if (byCode) return byCode;
  if (error.code === 'VALIDATION_ERROR' && isEmailValidationError(error.message)) {
    return 'invalid-email';
  }
  // The breached-password check fails closed with a 500 whose message starts this way.
  if (error.status === 500 && error.message?.startsWith('Failed to check password')) {
    return 'check-unavailable';
  }
  return 'unexpected';
}
