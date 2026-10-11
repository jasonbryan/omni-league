import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { ConvexAuthSource } from '../data/convex';
import { AUTH_CLIENT, type AuthClientLike } from './auth-client';

/** Why a sign-up was refused, as the sign-up page shows it (design/mockups/62-sign-up.html). */
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

/**
 * Why a sign-in was refused, as the sign-in page shows it (design/mockups/63-sign-in.html).
 * `incorrect` is the answer for a wrong password and for an email with no account alike.
 */
export type SignInFailure = 'incorrect' | 'throttled' | 'locked' | 'invalid-email' | 'unexpected';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: Exclude<SignInFailure, 'throttled'> }
  | { ok: false; error: 'throttled'; retryAfterSeconds: number };

export interface SignInInput {
  email: string;
  password: string;
}

/** The wait shown when a throttled answer carries none. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** What Better Auth's client reports for a refused request. */
interface AuthError {
  status: number;
  code?: string;
  message?: string;
  /** Sent with convex/auth.ts's TOO_MANY_ATTEMPTS: the seconds until the next attempt may go. */
  retryAfterSeconds?: unknown;
}

type SessionState = 'unknown' | 'signed-in' | 'signed-out';

/**
 * A session cookie with a value in the crossDomain plugin's store (`better-auth.session_token=…`).
 * An empty value is the sign-out response's, which the session store's refetch then removes.
 */
const STORED_SESSION = /(?:^|; )[^=;]*session_token=[^;]/;

/** Better Auth error codes, and the 18+ code from convex/auth.ts, by the failure they mean. */
const FAILURE_BY_CODE: Record<string, SignUpFailure> = {
  USER_ALREADY_EXISTS: 'exists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'exists',
  PASSWORD_COMPROMISED: 'breached',
  INVALID_EMAIL: 'invalid-email',
  PASSWORD_TOO_SHORT: 'password-too-short',
  PASSWORD_TOO_LONG: 'password-too-long',
  ADULT_CONFIRMATION_REQUIRED: 'adult-required',
};

/**
 * The browser's auth state and actions (ADR 0008 "Angular wiring"), and the `ConvexAuthSource`
 * that `provideConvexAuth()` hands to the Convex client (ADR 0006). Without a client (a server
 * render, or no Convex URL) it is signed out and does nothing.
 */
@Injectable({ providedIn: 'root' })
export class AuthService implements ConvexAuthSource {
  /** The client from its lazy chunk; `null` without one. A failed load counts as no client. */
  private readonly client: Promise<AuthClientLike | null> | null =
    inject(AUTH_CLIENT)?.catch(() => null) ?? null;

  private readonly session = signal<SessionState>(this.client ? 'unknown' : 'signed-out');
  /** True while Better Auth has a session for this browser. */
  readonly signedIn = computed(() => this.session() === 'signed-in');

  private readonly convexAuth = signal(false);
  /** True once the Convex client has accepted a token (its `onChange`). */
  readonly convexAuthenticated = this.convexAuth.asReadonly();

  private readonly destroyRef = inject(DestroyRef);
  private cachedToken: string | null = null;
  /** The token request in flight, which a call that does not force a refresh shares. */
  private pendingToken: Promise<string | null> | null = null;
  /** Rises each time the token is forgotten (sign-out, sign-up, or a signed-out answer). */
  private tokenGeneration = 0;
  private watching = false;
  private resolveKnown: () => void = () => undefined;
  /** Settles once the session store has given its first answer. */
  private readonly known = new Promise<void>((resolve) => (this.resolveKnown = resolve));

  constructor() {
    if (!this.client) {
      this.resolveKnown();
      return;
    }
    void this.client.then((client) => {
      if (this.destroyRef.destroyed) return;
      // No stored session token (never signed in, or signed out): signed out with no get-session
      // request, so an anonymous page view makes none (ADR 0008 "Cost").
      if (!client || !hasStoredSession(client)) {
        this.setSession('signed-out');
        return;
      }
      this.watchSession(client);
    });
  }

  /** Follows Better Auth's session store; subscribing starts its first get-session request. */
  private watchSession(client: AuthClientLike): void {
    if (this.watching || this.destroyRef.destroyed) return;
    this.watching = true;
    const unsubscribe = client.useSession.subscribe((state) => {
      // Pending: the first fetch, or a refetch with no data yet. Keep the last answer.
      if (state.isPending) return;
      this.setSession(state.data?.session ? 'signed-in' : 'signed-out');
    });
    this.destroyRef.onDestroy(unsubscribe);
  }

  /** Whether the browser is signed in, once the session store has answered (route guards). */
  async isSignedIn(): Promise<boolean> {
    await this.known;
    return this.signedIn();
  }

  /**
   * The Convex JWT for the Convex client (`setAuth`). Signed out, it returns `null` without a
   * request, so an anonymous page view makes no token request. The token is cached until the
   * Convex client asks for a fresh one before it expires (15 minutes, ADR 0008). Calls that do not
   * force a refresh share the request in flight, so the Convex client's overlapping `setAuth` calls
   * on a signed-in load make one request.
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
      // A request from a session that has since ended answers `null`, even if another user has
      // signed in meanwhile, and fills no cache. One that a newer forced request replaced in the
      // same session answers with its token but leaves the cache to the newer one.
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

  /**
   * Creates the account and signs it in. The 18+ confirmation is sent as `adultConfirmed`, which
   * the server requires (convex/auth.ts). Never throws: a refusal or a network failure is a
   * `SignUpFailure`.
   */
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

  /**
   * Signs in with email and password (ADR 0008). Never throws: a refusal or a network failure is a
   * `SignInFailure`. A wrong password and an unknown email are both `incorrect`, so the page cannot
   * tell them apart. Like `signUp`, a success is known at once from the response, and only then is
   * the session store watched, so a page with no stored session makes no get-session request.
   */
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

  /**
   * Deletes the session on the server and forgets it here (ADR 0008 "Sign-out"). Never throws: the
   * client clears the stored session before the request, so a failed request still signs this
   * browser out.
   */
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

/**
 * Whether the crossDomain plugin's store holds a session token. `getCookie()` throws when the
 * stored value is `null` or holds a `null` entry (#62 tester); that is no stored session.
 */
function hasStoredSession(client: AuthClientLike): boolean {
  try {
    return STORED_SESSION.test(client.getCookie());
  } catch {
    return false;
  }
}

/**
 * Better Auth's body validation (`VALIDATION_ERROR`, 400) joins one `[body.<field>] <message>` per
 * issue with `; `. A malformed email gives `[body.email] Invalid email address`. Only a refusal
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
  // The breached-password check fails closed with a 500 whose message starts this way (ADR 0008).
  if (error.status === 500 && error.message?.startsWith('Failed to check password')) {
    return 'check-unavailable';
  }
  return 'unexpected';
}
