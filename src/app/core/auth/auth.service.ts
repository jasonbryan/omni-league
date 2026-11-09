import {
  DOCUMENT,
  DestroyRef,
  Injector,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  type ActivatedRouteSnapshot,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  Router,
} from '@angular/router';
import { filter, take } from 'rxjs';
import type { PushSubscriptionLifecycle } from '../../notifications/push-subscription-lifecycle';
import { ChangesInFlight } from '../changes-in-flight';
import type { ConvexAuthSource } from '../data/convex';
import { OFFLINE_SIGNAL_DELAY_MS } from '../data/convex/connection';
import { AUTH_CLIENT, type AuthClientLike } from './auth-client';
import { SIGN_IN_PATH, requireSignedIn } from './guards';

export type SignUpFailure =
  | 'exists'
  | 'breached'
  | 'check-unavailable'
  | 'invalid-email'
  | 'password-too-short'
  | 'password-too-long'
  | 'adult-required'
  | 'name-invalid'
  | 'rate-limited'
  | 'unexpected';

export type SignUpResult = { ok: true } | { ok: false; error: SignUpFailure };

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

/** `incorrect` covers a wrong password and an email with no account alike, so the answer does not reveal which emails have accounts. */
export type SignInFailure =
  'incorrect' | 'throttled' | 'locked' | 'invalid-email' | 'rate-limited' | 'unexpected';

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

/** `kept`: an unexpired stored token counts as signed in until the server answers, so a fresh load with no connection stays on its page. */
type SessionState = 'unknown' | 'kept' | 'signed-in' | 'signed-out';

type SessionValue = Parameters<Parameters<AuthClientLike['useSession']['subscribe']>[0]>[0];

/** A kept session's check and its Convex token wait no longer than the `online` signal does on a cold start. */
export const SESSION_CHECK_LIMIT_MS = OFFLINE_SIGNAL_DELAY_MS;
export const RECHECK_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000];
export const RECHECK_EVERY_MS = 120_000;

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
  NAME_INVALID: 'name-invalid',
};

@Injectable({ providedIn: 'root' })
export class AuthService implements ConvexAuthSource {
  private readonly client: Promise<AuthClientLike | null> | null =
    inject(AUTH_CLIENT)?.catch(() => null) ?? null;

  private readonly session = signal<SessionState>(this.client ? 'unknown' : 'signed-out');
  readonly signedIn = computed(() => {
    const session = this.session();
    return session === 'signed-in' || session === 'kept';
  });

  private readonly convexAuth = signal(false);
  readonly convexAuthenticated = this.convexAuth.asReadonly();

  private readonly epoch = signal(0);
  readonly authEpoch = this.epoch.asReadonly();

  private readonly destroyRef = inject(DestroyRef);
  private readonly changes = inject(ChangesInFlight);
  private readonly injector = inject(Injector);
  private readonly window = inject(DOCUMENT).defaultView;
  private pushLifecycle: Promise<PushSubscriptionLifecycle | null> | undefined;
  private cachedToken: string | null = null;
  private pendingToken: Promise<string | null> | null = null;
  private tokenGeneration = 0;
  private loadedClient: AuthClientLike | null = null;
  private watching = false;
  private endingSession = false;
  private refetchSession: (() => unknown) | null = null;
  private refetching = false;
  private checkStartedAt: number | null = null;
  private checkInFlight = false;
  private readonly checkWaiters = new Set<() => void>();
  private tokenWithheld = false;
  private recheckTimer: ReturnType<typeof setTimeout> | undefined;
  private rechecks = 0;
  private resolveKnown: () => void = () => undefined;
  private readonly known = new Promise<void>((resolve) => (this.resolveKnown = resolve));

  constructor() {
    if (!this.client) {
      this.resolveKnown();
      return;
    }
    this.destroyRef.onDestroy(() => {
      this.stopRechecks();
      this.settleCheck();
    });
    void this.client.then((client) => {
      if (this.destroyRef.destroyed) return;
      const hasNoStoredSession = !client || !hasStoredSession(client);
      if (hasNoStoredSession) {
        this.setSession('signed-out');
        return;
      }
      this.loadedClient = client;
      this.setSession('kept');
      if (this.browserOnline()) this.checkKeptSession();
    });
  }

  private browserOnline(): boolean {
    return this.window?.navigator.onLine !== false;
  }

  private watchSession(client: AuthClientLike): void {
    if (this.watching || this.destroyRef.destroyed) return;
    this.watching = true;
    // The store's own first fetch starts on a later task, so the check counts from here.
    if (this.session() === 'kept') this.startCheck();
    const unsubscribe = client.useSession.subscribe((value) => this.onSessionValue(client, value));
    this.destroyRef.onDestroy(unsubscribe);
  }

  private onSessionValue(client: AuthClientLike, value: SessionValue): void {
    this.refetchSession = value.refetch;
    const refetching = value.isRefetching === true;
    if (refetching && !this.refetching) this.startCheck();
    this.refetching = refetching;
    // A fetch with no data is pending: keep the last answer.
    if (value.isPending) return;
    if (!refetching) this.settleCheck();
    if (value.data?.session) {
      this.confirmSession();
      return;
    }
    if (refetching) return;
    if (this.session() === 'kept' && neverReachedServer(value.error)) return;
    this.refuseSession(client, value.error);
  }

  private confirmSession(): void {
    const askAgain = this.session() === 'kept' && this.tokenWithheld;
    this.setSession('signed-in');
    if (!askAgain) return;
    this.forgetToken();
    this.epoch.update((epoch) => epoch + 1);
  }

  /**
   * Better Auth leaves the token stored after a 401; `/sign-out`'s request hook clears it before the request goes. Better Auth asks for the session again after
   * a sign-out, so it runs only while a token is still stored.
   */
  private refuseSession(client: AuthClientLike, error: unknown): void {
    const wasKept = this.session() === 'kept';
    this.setSession('signed-out');
    if (this.endingSession) return;
    if (httpStatusOf(error) === 401 && hasStoredSession(client)) {
      void client.signOut().catch(() => undefined);
    }
    if (wasKept) this.redirectRefusedSession();
  }

  private redirectRefusedSession(): void {
    const router = this.injector.get(Router);
    if (!router.currentNavigation()) {
      this.redirectFromGuardedRoute(router);
      return;
    }
    router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd ||
            event instanceof NavigationCancel ||
            event instanceof NavigationError ||
            event instanceof NavigationSkipped,
        ),
        take(1),
      )
      .subscribe((event) => {
        if (event instanceof NavigationEnd) this.redirectFromGuardedRoute(router);
      });
  }

  private redirectFromGuardedRoute(router: Router): void {
    if (this.signedIn() || !requiresSignIn(router.routerState.snapshot.root)) return;
    void router.navigate([SIGN_IN_PATH], {
      queryParams: { returnTo: router.url },
      replaceUrl: true,
    });
  }

  readonly onOnline = (): void => {
    if (this.session() !== 'kept' || !this.browserOnline()) return;
    this.rechecks = 0;
    this.checkKeptSession();
  };

  private checkKeptSession(): void {
    const client = this.loadedClient;
    if (!client) return;
    if (!this.watching) {
      this.watchSession(client);
    } else if (!this.checkedRecently()) {
      this.startCheck();
      // Replaces a check still in flight: Better Auth aborts it.
      void this.refetchSession?.();
    }
    this.scheduleRecheck();
  }

  private checkedRecently(): boolean {
    return (
      this.checkStartedAt !== null && Date.now() - this.checkStartedAt < SESSION_CHECK_LIMIT_MS
    );
  }

  private scheduleRecheck(): void {
    clearTimeout(this.recheckTimer);
    const delay = RECHECK_DELAYS_MS[this.rechecks] ?? RECHECK_EVERY_MS;
    this.rechecks += 1;
    this.recheckTimer = setTimeout(() => {
      if (this.session() !== 'kept') return;
      if (this.browserOnline()) this.checkKeptSession();
      else this.scheduleRecheck();
    }, delay);
  }

  private stopRechecks(): void {
    clearTimeout(this.recheckTimer);
    this.recheckTimer = undefined;
  }

  private startCheck(): void {
    this.checkStartedAt = Date.now();
    this.checkInFlight = true;
  }

  private settleCheck(): void {
    this.checkInFlight = false;
    for (const settle of [...this.checkWaiters]) settle();
  }

  private checkAnsweredOrLimit(): Promise<void> {
    if (!this.checkInFlight || this.checkStartedAt === null) return Promise.resolve();
    const remaining = this.checkStartedAt + SESSION_CHECK_LIMIT_MS - Date.now();
    if (remaining <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const settle = () => {
        clearTimeout(timer);
        this.checkWaiters.delete(settle);
        resolve();
      };
      const timer = setTimeout(settle, remaining);
      this.checkWaiters.add(settle);
    });
  }

  async isSignedIn(): Promise<boolean> {
    await this.known;
    return this.signedIn();
  }

  /**
   * Signed out, it returns `null` without a request. The token is cached until the Convex client asks for a fresh one before it expires (15 minutes).
   * Calls that do not force a refresh share the request in flight, so the Convex client's overlapping `setAuth` calls on a signed-in load make one request.
   * While kept, no request but the session check carries the stored token. `authEpoch` advances on confirm, because the Convex client does not ask again after `null`.
   */
  readonly fetchToken = async ({
    forceRefreshToken,
  }: {
    forceRefreshToken: boolean;
  }): Promise<string | null> => {
    const client = await this.client;
    if (!client) return null;
    await this.known;
    if (this.session() === 'kept') await this.checkAnsweredOrLimit();
    if (this.session() === 'kept') {
      this.tokenWithheld = true;
      return null;
    }
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
    if (isAuthenticated) void this.loadPushLifecycle().then((lifecycle) => lifecycle?.check());
  };

  /**
   * Loaded on demand with the notifications page's chunk, so the initial bundle carries none of it; a chunk of its own would move shared code into the initial bundle.
   * A failed load leaves push as it is.
   */
  private loadPushLifecycle(): Promise<PushSubscriptionLifecycle | null> {
    this.pushLifecycle ??= import('../../notifications/notifications-page')
      .then(({ PushSubscriptionLifecycle }) => this.injector.get(PushSubscriptionLifecycle))
      .catch(() => {
        this.pushLifecycle = undefined;
        return null;
      });
    return this.pushLifecycle;
  }

  signUp(input: SignUpInput): Promise<SignUpResult> {
    return this.changes.track(() => this.requestSignUp(input));
  }

  signIn(input: SignInInput): Promise<SignInResult> {
    return this.changes.track(() => this.requestSignIn(input));
  }

  signOut(): Promise<void> {
    return this.changes.track(() => this.requestSignOut());
  }

  private async requestSignUp({ name, email, password }: SignUpInput): Promise<SignUpResult> {
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

  private async requestSignIn({ email, password }: SignInInput): Promise<SignInResult> {
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

  private async requestSignOut(): Promise<void> {
    const lifecycle = await this.loadPushLifecycle();
    const endSession = () => this.endSession();
    // The device's row goes first, while the session lasts, so it is removed as this user's.
    await (lifecycle ? lifecycle.signOut(endSession) : endSession());
  }

  private async endSession(): Promise<void> {
    this.forgetToken();
    this.endingSession = true;
    try {
      await (await this.client)?.signOut();
    } catch {
      // Signed out here regardless; the server session expires on its own.
    } finally {
      this.endingSession = false;
    }
    this.setSession('signed-out');
  }

  private setSession(state: Exclude<SessionState, 'unknown'>): void {
    if (state === 'signed-out') this.forgetToken();
    if (state !== 'kept') {
      this.stopRechecks();
      this.tokenWithheld = false;
    }
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

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

/** A fetch that never reached the server rejects with no status: a lost connection, or a CORS, TLS, or captive-portal failure. */
function neverReachedServer(error: unknown): boolean {
  return error !== null && error !== undefined && httpStatusOf(error) === undefined;
}

function requiresSignIn(route: ActivatedRouteSnapshot | null): boolean {
  for (let current = route; current; current = current.firstChild) {
    if (current.routeConfig?.canActivate?.includes(requireSignedIn)) return true;
  }
  return false;
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
  // The per-IP limit answers before any route runs, so its 429 has no code.
  if (error.status === 429) return { ok: false, error: 'rate-limited' };
  if (
    error.code === 'INVALID_EMAIL' ||
    (error.code === 'VALIDATION_ERROR' && isEmailValidationError(error.message))
  ) {
    return { ok: false, error: 'invalid-email' };
  }
  return { ok: false, error: 'unexpected' };
}

function failureOf(error: AuthError): SignUpFailure {
  if (error.status === 429) return 'rate-limited';
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
