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
  type CanActivateFn,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  Router,
} from '@angular/router';
import { Subject, filter, take } from 'rxjs';
import type { PushSubscriptionLifecycle } from '../../notifications/push-subscription-lifecycle';
import { ChangesInFlight } from '../changes-in-flight';
import type { ConvexAuthSource } from '../data/convex';
import { OFFLINE_SIGNAL_DELAY_MS } from '../data/convex/connection';
import { AUTH_CLIENT, type AuthClientLike } from './auth-client';
import { SIGN_IN_PATH, redirectSignedIn, requireSignedIn } from './guards';
import type {
  SignInInput,
  SignInResult,
  SignUpInput,
  SignUpResult,
  requestSignIn,
  requestSignUp,
} from './password-auth';

/** `kept`: an unexpired stored token counts as signed in until the server answers, so a fresh load with no connection stays on its page. */
type SessionState = 'unknown' | 'kept' | 'signed-in' | 'signed-out';

type SessionValue = Parameters<Parameters<AuthClientLike['useSession']['subscribe']>[0]>[0];

/** A kept session's check and its Convex token wait no longer than the `online` signal does on a cold start. */
export const SESSION_CHECK_LIMIT_MS = OFFLINE_SIGNAL_DELAY_MS;
export const RECHECK_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000];
export const RECHECK_EVERY_MS = 120_000;

/** An empty value is the sign-out response's, which the session store's refetch then removes. */
const STORED_SESSION = /(?:^|; )[^=;]*session_token=[^;]/;

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

  private readonly checkSignedIn = new Subject<void>();
  /** Only from `signed-out`: a kept session sent no page to sign-in, and this tab's own sign-in navigates by itself. */
  readonly signedInByCheck = this.checkSignedIn.asObservable();

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
  private signOutGuard: 'off' | 'signing-out' | 'awaiting-fresh-answer' = 'off';
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
    this.loadedClient = client;
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
    this.endGuardOnFreshAnswer(refetching, value.error);
    if (value.data?.session) {
      if (this.signOutGuard === 'off') this.confirmSession();
      return;
    }
    if (refetching) return;
    if (this.session() === 'kept' && neverReachedServer(value.error)) return;
    this.refuseSession(client, value.error);
  }

  /** Better Auth keeps the last `data` on a failed check, so only an answer with no error says what the server holds. */
  private endGuardOnFreshAnswer(refetching: boolean, error: unknown): void {
    const freshAnswer = !refetching && (error === null || error === undefined);
    if (this.signOutGuard === 'awaiting-fresh-answer' && freshAnswer) this.signOutGuard = 'off';
  }

  private confirmSession(): void {
    const previous = this.session();
    const askAgain = previous === 'kept' && this.tokenWithheld;
    this.setSession('signed-in');
    if (previous === 'signed-out') this.checkSignedIn.next();
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
    const guarded = routeChainHasGuard(router.routerState.snapshot.root, requireSignedIn);
    if (this.signedIn() || !guarded) return;
    void router.navigate([SIGN_IN_PATH], {
      queryParams: { returnTo: router.url },
      replaceUrl: true,
    });
  }

  readonly onOnline = (): void => {
    if (!this.browserOnline()) return;
    if (this.session() === 'kept') {
      this.rechecks = 0;
      this.checkKeptSession();
    } else if (this.refusedWithTokenStored() && this.onSignedOutOnlyRoute()) {
      this.refetchUnlessCheckedRecently();
    }
  };

  private checkKeptSession(): void {
    const client = this.loadedClient;
    if (!client) return;
    if (this.watching) this.refetchUnlessCheckedRecently();
    else this.watchSession(client);
    this.scheduleRecheck();
  }

  /** A refusal other than a 401 leaves the token stored, so the same token may still be confirmed once the server answers. */
  private refusedWithTokenStored(): boolean {
    const client = this.loadedClient;
    return this.session() === 'signed-out' && this.watching && !!client && hasStoredSession(client);
  }

  private onSignedOutOnlyRoute(): boolean {
    const router = this.injector.get(Router);
    return routeChainHasGuard(router.routerState.snapshot.root, redirectSignedIn);
  }

  private refetchUnlessCheckedRecently(): void {
    if (this.checkedRecently()) return;
    this.startCheck();
    // Replaces a check still in flight: Better Auth aborts it.
    void this.refetchSession?.();
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
    if (!this.signedIn() || this.signOutGuard !== 'off') return null;
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

  authenticate(request: typeof requestSignUp, input: SignUpInput): Promise<SignUpResult>;
  authenticate(request: typeof requestSignIn, input: SignInInput): Promise<SignInResult>;
  authenticate(
    request: typeof requestSignUp | typeof requestSignIn,
    input: SignUpInput,
  ): Promise<SignUpResult | SignInResult> {
    return this.changes.track(async () => {
      const client = await this.client;
      if (!client) return { ok: false, error: 'unexpected' };
      const result = await request(client, input);
      // The response set the session, so the answer is known before the store refetches. Started in this tracked call, a reload that waits for `ChangesInFlight` finds it set.
      if (result.ok) this.startFormSession(client);
      return result;
    });
  }

  signOut(): Promise<void> {
    return this.changes.track(() => this.requestSignOut());
  }

  /** The Convex client calls `setAuth` again only when `signedIn` turns true or `authEpoch` advances, so a new session over a confirmed one advances it. */
  private startFormSession(client: AuthClientLike): void {
    const replacesSignedInSession = this.signedIn();
    this.signOutGuard = 'off';
    this.forgetToken();
    this.setSession('signed-in');
    if (replacesSignedInSession) this.epoch.update((epoch) => epoch + 1);
    this.watchSession(client);
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
    this.signOutGuard = 'signing-out';
    // The plugin's `/sign-out` hook clears `refetch` from the store's value, so it is kept before the request; calling it aborts the check in flight.
    const replaceCheck = this.refetching ? this.refetchSession : null;
    const client = await this.client;
    try {
      await client?.signOut();
    } catch {
      // Signed out here regardless; the server session expires on its own.
    } finally {
      if (replaceCheck) {
        if (client) await this.clearRestoredToken(client);
        this.signOutGuard = 'awaiting-fresh-answer';
        this.startCheck();
        void replaceCheck();
      } else {
        this.signOutGuard = 'off';
      }
      this.endingSession = false;
    }
    this.setSession('signed-out');
  }

  /** A check due for a session refresh answers with the token, which the plugin writes back after the `/sign-out` hook cleared it; a second sign-out clears it again. */
  private async clearRestoredToken(client: AuthClientLike): Promise<void> {
    if (!hasStoredSession(client)) return;
    await client.signOut().catch(() => undefined);
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

function routeChainHasGuard(route: ActivatedRouteSnapshot | null, guard: CanActivateFn): boolean {
  for (let current = route; current; current = current.firstChild) {
    if (current.routeConfig?.canActivate?.includes(guard)) return true;
  }
  return false;
}
