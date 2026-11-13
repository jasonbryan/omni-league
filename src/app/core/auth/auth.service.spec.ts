import { Component, PLATFORM_ID, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import type { MockInstance } from 'vitest';
import { ChangesInFlight } from '../changes-in-flight';
import { AUTH_BASE_URL, AUTH_CLIENT } from './auth-client';
import {
  AuthService,
  RECHECK_DELAYS_MS,
  RECHECK_EVERY_MS,
  SESSION_CHECK_LIMIT_MS,
} from './auth.service';
import { redirectSignedIn, requireSignedIn } from './guards';
import { requestSignIn, requestSignUp } from './password-auth';
import { FakeAuthClient, provideFakeAuthClient } from './testing/fake-auth-client';

@Component({ template: '' })
class Page {}

const INPUT = {
  name: 'Maya Okafor',
  email: 'maya.okafor@example.com',
  password: 'sandbar sunset spike 2026',
};

describe('AuthService', () => {
  let client: FakeAuthClient;

  function configure(fake: FakeAuthClient | null = client) {
    TestBed.configureTestingModule({
      providers: [fake ? provideFakeAuthClient(fake) : { provide: AUTH_CLIENT, useValue: null }],
    });
    return TestBed.inject(AuthService);
  }

  const loaded = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    client = new FakeAuthClient();
  });

  describe('session state', () => {
    it('is unknown until the client loads, then kept at once on a stored token, then follows the session store', async () => {
      const auth = configure();
      expect(auth.signedIn()).toBe(false);
      await expect(auth.isSignedIn()).resolves.toBe(true);
      expect(client.sessionListeners).toBe(1);

      client.emitSession({ id: 's1' });
      expect(auth.signedIn()).toBe(true);

      client.emitSession(null);
      expect(auth.signedIn()).toBe(false);
      await expect(auth.isSignedIn()).resolves.toBe(false);
    });

    it('ignores pending emissions (a refetch with no data yet)', async () => {
      const auth = configure();
      await loaded();
      client.emitSession({ id: 's1' });
      client.emitPending();
      expect(auth.signedIn()).toBe(true);
    });

    it.each([
      ['nothing stored', ''],
      ['other cookies only', 'better-auth.two_factor=x'],
      // The sign-out response stores an empty token until the session store's refetch removes it.
      ['an empty session token', 'better-auth.session_token='],
      ['an empty session token before another cookie', 'better-auth.session_token=; other=x'],
    ])('with %s, is signed out without subscribing to the session store', async (_, cookie) => {
      client.storedCookie = cookie;
      const auth = configure();
      await expect(auth.isSignedIn()).resolves.toBe(false);
      expect(client.sessionListeners).toBe(0);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
      expect(client.tokenRequests).toBe(0);
    });

    // The crossDomain plugin's getCookie() throws when the stored value is `null` or holds a `null` entry. That is no stored session, not a check that never settles.
    it('is signed out without subscribing when reading the stored session throws', async () => {
      client.getCookieThrows = new TypeError("Cannot read properties of null (reading 'expires')");
      const auth = configure();
      await expect(auth.isSignedIn()).resolves.toBe(false);
      expect(client.sessionListeners).toBe(0);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
      expect(client.tokenRequests).toBe(0);
    });

    it('with a stored session token, is signed in before the session store answers, and subscribes once', async () => {
      const auth = configure();
      await loaded();
      expect(client.sessionListeners).toBe(1);
      await expect(auth.isSignedIn()).resolves.toBe(true);
      client.emitSession(null);
      await expect(auth.isSignedIn()).resolves.toBe(false);
    });

    it('with a stored session the server rejects, asks once and ends signed out', async () => {
      const auth = configure();
      await loaded();
      expect(client.sessionListeners).toBe(1);
      client.emitSession(null);
      expect(auth.signedIn()).toBe(false);
      await expect(auth.isSignedIn()).resolves.toBe(false);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
      expect(client.tokenRequests).toBe(0);
    });

    // The stored-session test runs on the crossDomain plugin's real store: the entry lives in localStorage under `better-auth_cookie` as
    // `{ "<cookie name>": { value, expires: ISO date | null } }`, and getCookie() drops expired entries.
    describe('with the real crossDomain store', () => {
      const KEY = 'better-auth_cookie';
      const TOKEN = 'better-auth.session_token';
      const entry = (value: string, expires: string | null) =>
        JSON.stringify({ [TOKEN]: { value, expires } });
      const HOUR = 60 * 60 * 1000;

      // Unit tests open no network connection. The real client's session store sends `GET <site>/api/auth/get-session` once subscribed,
      // so `fetch` is stubbed to answer with a `null` session, and the tests count what reaches it.
      const SESSION_URL = 'https://happy-otter-123.convex.site/api/auth/get-session';
      const requestedUrl = (input: Parameters<typeof fetch>[0]) =>
        input instanceof Request ? input.url : String(input);

      const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        });
      const SESSION = {
        session: { id: 's1', token: 't', expiresAt: new Date(Date.now() + HOUR).toISOString() },
        user: { id: 'u1', name: 'Maya Okafor' },
      };

      async function configureReal(
        stored: string | null,
        answer: (url: string, init?: RequestInit) => Promise<Response> = () =>
          Promise.resolve(json(null)),
      ) {
        const fetchStub = vi.fn<typeof fetch>((input, init) => answer(requestedUrl(input), init));
        vi.stubGlobal('fetch', fetchStub);
        localStorage.removeItem(KEY);
        if (stored !== null) localStorage.setItem(KEY, stored);
        const { makeAuthClient } = await import('./make-auth-client');
        const real = makeAuthClient('https://happy-otter-123.convex.site');
        const subscribe = vi.spyOn(real.useSession, 'subscribe');
        TestBed.configureTestingModule({
          providers: [{ provide: AUTH_CLIENT, useValue: Promise.resolve(real) }],
        });
        const requests = () => fetchStub.mock.calls.map(([input]) => requestedUrl(input));
        const storedToken = () => /session_token=[^;]/.test(real.getCookie());
        return { auth: TestBed.inject(AuthService), subscribe, requests, storedToken };
      }

      const unexpired = () => entry('t', new Date(Date.now() + HOUR).toISOString());
      const SIGN_OUT_URL = 'https://happy-otter-123.convex.site/api/auth/sign-out';
      const signOutAnswer = () => Promise.resolve(json({ success: true }));
      const answerSession =
        (session: () => Promise<Response>) =>
        (url: string): Promise<Response> =>
          url === SIGN_OUT_URL ? signOutAnswer() : session();
      const hang = (_url: string, init?: RequestInit): Promise<Response> =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          ),
        );

      let online: MockInstance<() => boolean>;

      beforeEach(() => {
        online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
      });

      afterEach(() => {
        vi.useRealTimers();
        online.mockRestore();
        vi.unstubAllGlobals();
        localStorage.removeItem(KEY);
      });

      it('stubs fetch, so the suite makes no real network call', async () => {
        const { requests } = await configureReal(entry('t', null));
        await vi.waitFor(() => expect(requests()).toHaveLength(1));
        expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
        expect(requests().every((url) => url === SESSION_URL)).toBe(true);
        vi.unstubAllGlobals();
        expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
      });

      it.each([
        ['the key is absent', null],
        ['the entry does not parse', 'not json'],
        ['the entry is null', 'null'],
        ['the entry has no session token', JSON.stringify({ 'better-auth.two_factor': {} })],
        ['the token is empty (what sign-out leaves)', entry('', null)],
        ['the token has expired', entry('t', new Date(Date.now() - HOUR).toISOString())],
      ])('when %s, is signed out without subscribing', async (_, stored) => {
        const { auth, subscribe, requests } = await configureReal(stored);
        await expect(auth.isSignedIn()).resolves.toBe(false);
        expect(subscribe).not.toHaveBeenCalled();
        await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
        await loaded();
        expect(requests()).toEqual([]);
      });

      describe('classifies the check', () => {
        it('stays kept, keeping the token, on a rejected fetch', async () => {
          const { auth, requests, storedToken } = await configureReal(unexpired(), () =>
            Promise.reject(new TypeError('Failed to fetch')),
          );
          await vi.waitFor(() => expect(requests()).toEqual([SESSION_URL]));
          await loaded();
          expect(auth.signedIn()).toBe(true);
          expect(storedToken()).toBe(true);
          expect(requests()).toEqual([SESSION_URL]);
        });

        it('stays kept, with no token request, on a check that hangs past the limit', async () => {
          vi.useFakeTimers();
          const { auth, requests, storedToken } = await configureReal(unexpired(), hang);
          await vi.advanceTimersByTimeAsync(0);
          expect(requests()).toEqual([SESSION_URL]);
          const token = auth.fetchToken({ forceRefreshToken: false });
          await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS);
          await expect(token).resolves.toBeNull();
          expect(auth.signedIn()).toBe(true);
          expect(storedToken()).toBe(true);
          expect(requests()).toEqual([SESSION_URL]);
        });

        it.each([
          ['a 503', () => Promise.resolve(new Response('', { status: 503 }))],
          [
            'a 200 with an HTML body',
            () =>
              Promise.resolve(
                new Response('<html><body>Sign in to the wifi</body></html>', {
                  status: 200,
                  headers: { 'content-type': 'text/html' },
                }),
              ),
          ],
        ])('is signed out on %s, keeping the stored token', async (_, session) => {
          const { auth, requests, storedToken } = await configureReal(
            unexpired(),
            answerSession(session),
          );
          await vi.waitFor(() => expect(auth.signedIn()).toBe(false));
          await loaded();
          expect(storedToken()).toBe(true);
          expect(requests()).toEqual([SESSION_URL]);
        });

        it('is signed out on a 401, and removes the stored token through sign-out', async () => {
          const { auth, requests, storedToken } = await configureReal(
            unexpired(),
            answerSession(() => Promise.resolve(json({ message: 'Unauthorized' }, 401))),
          );
          await vi.waitFor(() => expect(auth.signedIn()).toBe(false));
          await vi.waitFor(() => expect(requests()).toContain(SIGN_OUT_URL));
          expect(storedToken()).toBe(false);
          // Better Auth asks for the session once more after a sign-out; with no token stored, nothing follows.
          await vi.waitFor(() => expect(requests()).toHaveLength(3));
          await new Promise((resolve) => setTimeout(resolve, 50));
          expect(requests()).toEqual([SESSION_URL, SIGN_OUT_URL, SESSION_URL]);
        });

        it('is signed out on a 200 null, whose answer removes the stored token', async () => {
          const { auth, requests, storedToken } = await configureReal(unexpired());
          await vi.waitFor(() => expect(auth.signedIn()).toBe(false));
          await loaded();
          expect(storedToken()).toBe(false);
          expect(requests()).toEqual([SESSION_URL]);
        });

        it('is signed in on a session, and the token request follows', async () => {
          const { auth, requests } = await configureReal(unexpired(), (url) =>
            Promise.resolve(url === SESSION_URL ? json(SESSION) : json({ token: 'jwt' })),
          );
          await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt');
          expect(auth.signedIn()).toBe(true);
          expect(auth.authEpoch()).toBe(0);
          expect(requests()).toEqual([
            SESSION_URL,
            'https://happy-otter-123.convex.site/api/auth/convex/token',
          ]);
        });
      });

      it('offline at start, is kept with no request', async () => {
        online.mockReturnValue(false);
        const { auth, subscribe, requests } = await configureReal(unexpired());
        await expect(auth.isSignedIn()).resolves.toBe(true);
        await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
        await loaded();
        expect(subscribe).not.toHaveBeenCalled();
        expect(requests()).toEqual([]);
      });

      it('signing out while kept and offline removes the stored token', async () => {
        online.mockReturnValue(false);
        const { auth, storedToken } = await configureReal(unexpired(), () =>
          Promise.reject(new TypeError('Failed to fetch')),
        );
        await expect(auth.isSignedIn()).resolves.toBe(true);
        expect(storedToken()).toBe(true);
        await auth.signOut();
        expect(auth.signedIn()).toBe(false);
        expect(storedToken()).toBe(false);
      });

      it('spaces checks: onOnline within the limit starts none; after it, replaces the hung check with one that confirms', async () => {
        vi.useFakeTimers();
        let sessionAnswer: (url: string, init?: RequestInit) => Promise<Response> = hang;
        const signals: AbortSignal[] = [];
        const { auth, requests } = await configureReal(unexpired(), (url, init) => {
          if (init?.signal) signals.push(init.signal);
          return sessionAnswer(url, init);
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests()).toEqual([SESSION_URL]);

        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS - 1);
        auth.onOnline();
        await vi.advanceTimersByTimeAsync(0);
        expect(requests()).toEqual([SESSION_URL]);

        sessionAnswer = () => Promise.resolve(json(SESSION));
        await vi.advanceTimersByTimeAsync(1);
        auth.onOnline();
        await vi.advanceTimersByTimeAsync(0);
        expect(requests()).toEqual([SESSION_URL, SESSION_URL]);
        expect(signals[0].aborted).toBe(true);
        await vi.waitFor(() => expect(auth.signedIn()).toBe(true));
        await vi.advanceTimersByTimeAsync(0);
        expect(auth.authEpoch()).toBe(0);
      });

      describe('sign-out while the session check is out', () => {
        const TOKEN_URL = 'https://happy-otter-123.convex.site/api/auth/convex/token';
        const LATER_ANSWER_MS = 30;
        // Longer than Better Auth's 10 ms refetch after a sign-out plus a later answer.
        const SETTLE_MS = 100;
        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        // `by token`: the server still holds the session, as after a failed `/sign-out`, and answers it only to a request that carries the token.
        type ReplacingCheck = 'null' | '503' | 'rejected' | 'by token';
        const sentToken = (init?: RequestInit) =>
          /session_token=[^;]/.test(new Headers(init?.headers).get('Better-Auth-Cookie') ?? '');
        const REPLACING_ANSWER: Record<ReplacingCheck, (init?: RequestInit) => Promise<Response>> =
          {
            null: () => Promise.resolve(json(null)),
            '503': () => Promise.resolve(new Response('', { status: 503 })),
            rejected: () => Promise.reject(new TypeError('Failed to fetch')),
            'by token': (init) => Promise.resolve(json(sentToken(init) ? SESSION : null)),
          };
        const REFRESHED_TOKEN = {
          'set-better-auth-cookie':
            'better-auth.session_token=t; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax',
        };

        function answerUnlessAborted(
          init: RequestInit | undefined,
          delayMs: number,
          answer: () => Promise<Response>,
        ): Promise<Response> {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              void answer().then(resolve, reject);
            }, delayMs);
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }

        async function keptSessionWithHeldCheck(
          signOutStatus: 200 | 500,
          replacing: ReplacingCheck,
          refreshesToken: boolean,
        ) {
          let releaseCheck!: () => void;
          const checkHeld = new Promise<void>((resolve) => (releaseCheck = resolve));
          let releaseSignOut!: () => void;
          const signOutHeld = new Promise<void>((resolve) => (releaseSignOut = resolve));
          let checks = 0;
          const real = await configureReal(unexpired(), async (url, init) => {
            if (url === SIGN_OUT_URL) {
              await signOutHeld;
              return signOutStatus === 200
                ? json({ success: true })
                : json({ message: 'boom' }, 500);
            }
            if (url === TOKEN_URL) return json({ token: 'jwt' });
            checks += 1;
            return checks === 1
              ? answerUnlessAborted(init, 0, () =>
                  checkHeld.then(() => json(SESSION, 200, refreshesToken ? REFRESHED_TOKEN : {})),
                )
              : answerUnlessAborted(init, LATER_ANSWER_MS, () => REPLACING_ANSWER[replacing](init));
          });
          await vi.waitFor(() => expect(real.requests()).toEqual([SESSION_URL]));
          const signedInByCheck = vi.fn();
          real.auth.signedInByCheck.subscribe(signedInByCheck);
          const waiting = real.auth.fetchToken({ forceRefreshToken: false });
          const signingOut = real.auth.signOut();
          await vi.waitFor(() => expect(real.requests()).toContain(SIGN_OUT_URL));
          return {
            ...real,
            signedInByCheck,
            waiting,
            signingOut,
            releaseCheck,
            releaseSignOut,
            checks: () => checks,
          };
        }

        it.each([
          ['while /sign-out is pending', 'pending', 200, 'null', false],
          ['while /sign-out is pending, then /sign-out fails', 'pending', 500, 'null', false],
          [
            'while /sign-out is pending, and the replacing check gets a 503',
            'pending',
            200,
            '503',
            false,
          ],
          [
            'while /sign-out is pending, /sign-out fails, and the replacing check gets a 503',
            'pending',
            500,
            '503',
            false,
          ],
          [
            'while /sign-out is pending, and the replacing check rejects',
            'pending',
            200,
            'rejected',
            false,
          ],
          [
            'while /sign-out is pending, /sign-out fails, and the replacing check rejects',
            'pending',
            500,
            'rejected',
            false,
          ],
          ['after /sign-out answers', 'after', 200, 'null', false],
          ['after /sign-out fails', 'after', 500, 'null', false],
          [
            'while /sign-out is pending and fails, and the old check refreshed the stored token',
            'pending',
            500,
            'by token',
            true,
          ],
        ] as const)(
          'a held check that answers with a session %s confirms nothing',
          async (_, when, signOutStatus, replacing, refreshesToken) => {
            const held = await keptSessionWithHeldCheck(signOutStatus, replacing, refreshesToken);
            if (when === 'pending') {
              held.releaseCheck();
              await expect(held.waiting).resolves.toBeNull();
              held.releaseSignOut();
              await held.signingOut;
            } else {
              held.releaseSignOut();
              await held.signingOut;
              held.releaseCheck();
              await expect(held.waiting).resolves.toBeNull();
            }
            await pause(SETTLE_MS);

            const expectNothingConfirmed = async () => {
              await expect(held.auth.fetchToken({ forceRefreshToken: true })).resolves.toBeNull();
              expect(held.requests()).not.toContain(TOKEN_URL);
              expect(held.auth.signedIn()).toBe(false);
              expect(held.storedToken()).toBe(false);
              expect(held.signedInByCheck).not.toHaveBeenCalled();
              expect(held.auth.authEpoch()).toBe(0);
            };
            await expectNothingConfirmed();

            if (replacing === '503' || replacing === 'rejected') {
              const checksBefore = held.checks();
              window.dispatchEvent(new Event('online'));
              await vi.waitFor(() => expect(held.checks()).toBeGreaterThan(checksBefore));
              await pause(SETTLE_MS);
              await expectNothingConfirmed();
            }
          },
        );
      });

      describe('signed out on a 503 on /sign-in, with the token still stored', () => {
        async function refusedOnSignIn() {
          vi.useFakeTimers({ toFake: ['Date'] });
          TestBed.configureTestingModule({
            providers: [
              provideRouter([
                { path: 'sign-in', component: Page, canActivate: [redirectSignedIn] },
              ]),
            ],
          });
          let session = () => Promise.resolve(new Response('', { status: 503 }));
          const real = await configureReal(
            unexpired(),
            answerSession(() => session()),
          );
          await expect(real.auth.isSignedIn()).resolves.toBe(true);
          await vi.waitFor(() => expect(real.auth.signedIn()).toBe(false));
          await TestBed.inject(Router).navigateByUrl('/sign-in');
          const signedInByCheck = vi.fn();
          real.auth.signedInByCheck.subscribe(signedInByCheck);
          session = () => Promise.resolve(json(SESSION));
          return { ...real, signedInByCheck };
        }

        it('onOnline after the limit asks again, and the session signs in by the check', async () => {
          const { auth, requests, storedToken, signedInByCheck } = await refusedOnSignIn();
          vi.setSystemTime(Date.now() + SESSION_CHECK_LIMIT_MS);
          auth.onOnline();
          await vi.waitFor(() => expect(auth.signedIn()).toBe(true));
          expect(signedInByCheck).toHaveBeenCalledTimes(1);
          expect(storedToken()).toBe(true);
          expect(requests()).toEqual([SESSION_URL, SESSION_URL]);
        });

        it("Better Auth's own refetch on the browser online event signs in by the check, and onOnline then asks nothing", async () => {
          const { auth, requests, signedInByCheck } = await refusedOnSignIn();
          vi.setSystemTime(Date.now() + SESSION_CHECK_LIMIT_MS);
          window.dispatchEvent(new Event('online'));
          auth.onOnline();
          await vi.waitFor(() => expect(auth.signedIn()).toBe(true));
          expect(signedInByCheck).toHaveBeenCalledTimes(1);
          expect(requests()).toEqual([SESSION_URL, SESSION_URL]);
        });
      });

      it.each([
        ['an unexpired token', entry('t', new Date(Date.now() + HOUR).toISOString())],
        ['a token with no expiry (a session cookie)', entry('t', null)],
      ])('with %s, subscribes exactly once', async (_, stored) => {
        const { auth, subscribe, requests } = await configureReal(stored);
        await loaded();
        expect(subscribe).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(requests()).toEqual([SESSION_URL]));
        await loaded();
        expect(requests()).toEqual([SESSION_URL]);
        expect(auth.signedIn()).toBe(false);
      });
    });

    it('with no stored session token, follows the session store after a sign-up', async () => {
      client.storedCookie = '';
      const auth = configure();
      await loaded();
      await expect(auth.authenticate(requestSignUp, INPUT)).resolves.toEqual({ ok: true });
      expect(auth.signedIn()).toBe(true);
      expect(client.sessionListeners).toBe(1);
      expect(auth.signedIn()).toBe(true);
      client.emitSession(null);
      expect(auth.signedIn()).toBe(false);
    });

    it('is signed out and known at once without a client (server, or no Convex URL)', async () => {
      const auth = configure(null);
      expect(auth.signedIn()).toBe(false);
      await expect(auth.isSignedIn()).resolves.toBe(false);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
    });

    it('is signed out when the client chunk fails to load', async () => {
      TestBed.configureTestingModule({
        providers: [{ provide: AUTH_CLIENT, useValue: Promise.reject(new Error('chunk failed')) }],
      });
      const auth = TestBed.inject(AuthService);
      await expect(auth.isSignedIn()).resolves.toBe(false);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
      await expect(auth.authenticate(requestSignUp, INPUT)).resolves.toEqual({
        ok: false,
        error: 'unexpected',
      });
    });

    it('stops listening to the session store when the application is destroyed', async () => {
      configure();
      expect(client.sessionListeners).toBe(0);
      await loaded();
      expect(client.sessionListeners).toBe(1);
      TestBed.resetTestingModule();
      expect(client.sessionListeners).toBe(0);
    });
  });

  describe('kept session (a stored token the server has not answered for)', () => {
    let online: MockInstance<() => boolean>;

    function setBrowserOnline(value: boolean) {
      online.mockReturnValue(value);
    }

    beforeEach(() => {
      online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    });

    afterEach(() => {
      vi.useRealTimers();
      online.mockRestore();
    });

    it('is signed in and known at once, before any answer', async () => {
      const auth = configure();
      await expect(auth.isSignedIn()).resolves.toBe(true);
      expect(auth.signedIn()).toBe(true);
      expect(client.sessionListeners).toBe(1);
    });

    it('stays kept on a check that never reached the server (no status)', async () => {
      const auth = configure();
      await loaded();
      client.emitChecking();
      client.emitError(new TypeError('Failed to fetch'));
      expect(auth.signedIn()).toBe(true);
      expect(client.signOuts).toBe(0);
    });

    it.each([
      ['a 503', { status: 503, statusText: 'Service Unavailable' }],
      ['a 500', { status: 500, statusText: 'Internal Server Error' }],
    ])('is signed out on %s, keeping the stored token', async (_, error) => {
      const auth = configure();
      await loaded();
      client.emitError(error);
      expect(auth.signedIn()).toBe(false);
      expect(client.signOuts).toBe(0);
    });

    it('is signed out on a 401, and removes the stored token through sign-out', async () => {
      const auth = configure();
      await loaded();
      client.emitError({ status: 401, statusText: 'Unauthorized' });
      expect(auth.signedIn()).toBe(false);
      await loaded();
      expect(client.signOuts).toBe(1);
      expect(client.storedCookie).toBe('');
    });

    it('is signed in after a confirmed check', async () => {
      const auth = configure();
      await loaded();
      client.emitSession({ id: 's1' });
      expect(auth.signedIn()).toBe(true);
      await expect(auth.isSignedIn()).resolves.toBe(true);
    });

    describe('fetchToken', () => {
      it('on a check that confirms within the limit, makes one token request and leaves authEpoch alone', async () => {
        vi.useFakeTimers();
        const auth = configure();
        await vi.advanceTimersByTimeAsync(0);
        const calls = [
          auth.fetchToken({ forceRefreshToken: false }),
          auth.fetchToken({ forceRefreshToken: false }),
        ];
        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS - 1_000);
        expect(client.tokenRequests).toBe(0);
        client.emitSession({ id: 's1' });
        await expect(Promise.all(calls)).resolves.toEqual(['jwt', 'jwt']);
        expect(client.tokenRequests).toBe(1);
        expect(auth.authEpoch()).toBe(0);
      });

      it('on a check that hangs past the limit, returns null with no token request; a later confirm advances authEpoch once', async () => {
        vi.useFakeTimers();
        const auth = configure();
        await vi.advanceTimersByTimeAsync(0);
        let settled = false;
        const token = auth.fetchToken({ forceRefreshToken: false }).then((value) => {
          settled = true;
          return value;
        });
        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(token).resolves.toBeNull();
        expect(client.tokenRequests).toBe(0);
        expect(auth.authEpoch()).toBe(0);

        client.emitSession({ id: 's1' });
        expect(auth.authEpoch()).toBe(1);
        client.emitSession({ id: 's1' });
        expect(auth.authEpoch()).toBe(1);
        await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt');
        expect(client.tokenRequests).toBe(1);
      });

      it('offline at start, returns null at once with no check and no token request', async () => {
        setBrowserOnline(false);
        vi.useFakeTimers();
        const auth = configure();
        let settled = false;
        const token = auth.fetchToken({ forceRefreshToken: false }).then((value) => {
          settled = true;
          return value;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(true);
        await expect(token).resolves.toBeNull();
        expect(client.sessionListeners).toBe(0);
        expect(client.tokenRequests).toBe(0);
        expect(auth.signedIn()).toBe(true);
      });

      it('on a refused check, returns null and never advances authEpoch', async () => {
        const auth = configure();
        await loaded();
        const token = auth.fetchToken({ forceRefreshToken: false });
        client.emitSession(null);
        await expect(token).resolves.toBeNull();
        expect(auth.authEpoch()).toBe(0);
        expect(client.tokenRequests).toBe(0);
      });
    });

    describe('onOnline', () => {
      it('offline at start, subscribes on the first call with the browser online', async () => {
        setBrowserOnline(false);
        const auth = configure();
        await loaded();
        auth.onOnline();
        expect(client.sessionListeners).toBe(0);
        setBrowserOnline(true);
        auth.onOnline();
        expect(client.sessionListeners).toBe(1);
        expect(client.refetches).toBe(0);
      });

      it('refetches only once the last check started at least the limit ago', async () => {
        vi.useFakeTimers();
        const auth = configure();
        await vi.advanceTimersByTimeAsync(0);
        expect(client.sessionListeners).toBe(1);
        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS - 1);
        auth.onOnline();
        expect(client.refetches).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        auth.onOnline();
        expect(client.refetches).toBe(1);
        auth.onOnline();
        expect(client.refetches).toBe(1);
      });

      it("counts Better Auth's own refetch as a check", async () => {
        vi.useFakeTimers();
        const auth = configure();
        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS);
        client.emitError(new TypeError('Failed to fetch'));
        client.emitChecking();
        auth.onOnline();
        expect(client.refetches).toBe(0);
        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS);
        auth.onOnline();
        expect(client.refetches).toBe(1);
      });

      it.each([
        ['signed in', () => client.emitSession({ id: 's1' })],
        ['signed out', () => client.emitSession(null)],
      ])('does nothing while %s', async (_, answer) => {
        vi.useFakeTimers();
        const auth = configure();
        await vi.advanceTimersByTimeAsync(0);
        answer();
        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS);
        auth.onOnline();
        await vi.advanceTimersByTimeAsync(10 * RECHECK_EVERY_MS);
        expect(client.refetches).toBe(0);
      });

      it('does nothing before the client loads, or with no stored token', async () => {
        client.storedCookie = '';
        const auth = configure();
        auth.onOnline();
        await loaded();
        auth.onOnline();
        expect(client.sessionListeners).toBe(0);
        expect(client.refetches).toBe(0);
      });

      it('re-checks after 15 s, 30 s, and 60 s, then every 120 s, while kept with the browser online', async () => {
        vi.useFakeTimers();
        const auth = configure();
        await vi.advanceTimersByTimeAsync(0);
        const refetchesAfter = async (ms: number) => {
          await vi.advanceTimersByTimeAsync(ms - 1);
          const before = client.refetches;
          await vi.advanceTimersByTimeAsync(1);
          expect(client.refetches).toBe(before + 1);
          client.emitError(new TypeError('Failed to fetch'));
        };
        expect([...RECHECK_DELAYS_MS, RECHECK_EVERY_MS]).toEqual([15_000, 30_000, 60_000, 120_000]);
        for (const delay of [...RECHECK_DELAYS_MS, RECHECK_EVERY_MS, RECHECK_EVERY_MS]) {
          await refetchesAfter(delay);
        }
        auth.onOnline();
        expect(client.refetches).toBe(5);
        await vi.advanceTimersByTimeAsync(SESSION_CHECK_LIMIT_MS);
        auth.onOnline();
        expect(client.refetches).toBe(6);
        client.emitError(new TypeError('Failed to fetch'));
        await refetchesAfter(RECHECK_DELAYS_MS[0]);

        setBrowserOnline(false);
        await vi.advanceTimersByTimeAsync(10 * RECHECK_EVERY_MS);
        expect(client.refetches).toBe(7);

        setBrowserOnline(true);
        client.emitSession({ id: 's1' });
        await vi.advanceTimersByTimeAsync(10 * RECHECK_EVERY_MS);
        expect(client.refetches).toBe(7);
      });
    });

    describe('refusal redirect', () => {
      let releaseChunk: () => void = () => undefined;

      const heldComponent = (): Promise<Type<unknown>> =>
        new Promise((resolve) => (releaseChunk = () => resolve(Page)));

      function configureRoutes(routes: Routes) {
        TestBed.configureTestingModule({
          providers: [provideFakeAuthClient(client), provideRouter(routes)],
        });
        const router = TestBed.inject(Router);
        const auth = TestBed.inject(AuthService);
        return { router, auth };
      }

      const ROUTES: Routes = [
        { path: 'sign-in', component: Page },
        { path: 'organizations/x', component: Page },
        {
          path: 'app',
          children: [
            { path: '', component: Page, canActivate: [requireSignedIn] },
            { path: 'account', component: Page, canActivate: [requireSignedIn] },
          ],
        },
      ];

      const HELD_ROUTES: Routes = [
        { path: 'sign-in', component: Page },
        { path: 'organizations/x', loadComponent: heldComponent },
        { path: 'organizations/y', component: Page },
        { path: 'app', canActivate: [requireSignedIn], loadComponent: heldComponent },
      ];

      it('on a guarded route, goes to sign-in with returnTo, replacing the entry', async () => {
        const { router } = configureRoutes(ROUTES);
        await router.navigateByUrl('/app/account');
        expect(router.url).toBe('/app/account');
        const navigate = vi.spyOn(router, 'navigate');
        client.emitSession(null);
        await vi.waitFor(() => expect(router.url).toBe('/sign-in?returnTo=%2Fapp%2Faccount'));
        expect(navigate).toHaveBeenCalledWith(['/sign-in'], {
          queryParams: { returnTo: '/app/account' },
          replaceUrl: true,
        });
      });

      it('on a public page, navigates nowhere', async () => {
        const { router } = configureRoutes(ROUTES);
        await router.navigateByUrl('/organizations/x');
        const navigate = vi.spyOn(router, 'navigate');
        client.emitSession(null);
        await loaded();
        expect(router.url).toBe('/organizations/x');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('runs no redirect for a sign-out while kept', async () => {
        const { router, auth } = configureRoutes(ROUTES);
        await router.navigateByUrl('/app/account');
        const navigate = vi.spyOn(router, 'navigate');
        await auth.signOut();
        await loaded();
        expect(navigate).not.toHaveBeenCalled();
        expect(auth.signedIn()).toBe(false);
      });

      it('while the first navigation to /app waits for its route file, goes to sign-in at NavigationEnd', async () => {
        const { router } = configureRoutes(HELD_ROUTES);
        const first = router.navigateByUrl('/app');
        await vi.waitFor(() => expect(router.currentNavigation()).not.toBeNull());
        await loaded();
        client.emitSession(null);
        await loaded();
        expect(router.url).toBe('/');
        releaseChunk();
        await first;
        await vi.waitFor(() => expect(router.url).toBe('/sign-in?returnTo=%2Fapp'));
      });

      it('while a navigation to a public page is in flight, navigates nowhere', async () => {
        const { router } = configureRoutes(HELD_ROUTES);
        const first = router.navigateByUrl('/organizations/x');
        await loaded();
        expect(router.currentNavigation()).not.toBeNull();
        const navigate = vi.spyOn(router, 'navigate');
        client.emitSession(null);
        releaseChunk();
        await first;
        await loaded();
        expect(router.url).toBe('/organizations/x');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('for a navigation that is cancelled, runs no redirect', async () => {
        const { router } = configureRoutes(HELD_ROUTES);
        const first = router.navigateByUrl('/app');
        await vi.waitFor(() => expect(router.currentNavigation()).not.toBeNull());
        await loaded();
        client.emitSession(null);
        const navigate = vi.spyOn(router, 'navigate');
        await router.navigateByUrl('/organizations/y');
        await expect(first).resolves.toBe(false);
        releaseChunk();
        await loaded();
        expect(router.url).toBe('/organizations/y');
        expect(navigate).not.toHaveBeenCalled();
      });
    });

    describe('re-check on a sign-in route while signed out with the token still stored', () => {
      const ROUTES: Routes = [
        { path: '', component: Page },
        { path: 'sign-in', component: Page, canActivate: [redirectSignedIn] },
        { path: 'sign-up', component: Page, canActivate: [redirectSignedIn] },
        { path: 'organizations/x', component: Page },
        { path: 'app', component: Page, canActivate: [requireSignedIn] },
      ];

      const afterCheckLimit = () => vi.setSystemTime(Date.now() + SESSION_CHECK_LIMIT_MS);

      async function refusedOn(url: string) {
        vi.useFakeTimers({ toFake: ['Date'] });
        TestBed.configureTestingModule({
          providers: [provideFakeAuthClient(client), provideRouter(ROUTES)],
        });
        const router = TestBed.inject(Router);
        const auth = TestBed.inject(AuthService);
        await loaded();
        client.emitError({ status: 503, statusText: 'Service Unavailable' });
        await router.navigateByUrl(url);
        expect(router.url).toBe(url);
        expect(auth.signedIn()).toBe(false);
        const signedInByCheck = vi.fn();
        auth.signedInByCheck.subscribe(signedInByCheck);
        return { auth, signedInByCheck };
      }

      it.each(['/sign-in?returnTo=%2Fapp', '/sign-up'])(
        'on %s, onOnline re-checks once the last check started at least the limit ago, and a session signs in by the check',
        async (url) => {
          const { auth, signedInByCheck } = await refusedOn(url);
          auth.onOnline();
          expect(client.refetches).toBe(0);
          afterCheckLimit();
          auth.onOnline();
          expect(client.refetches).toBe(1);
          auth.onOnline();
          expect(client.refetches).toBe(1);
          expect(signedInByCheck).not.toHaveBeenCalled();

          client.emitSession({ id: 's1' });
          expect(auth.signedIn()).toBe(true);
          expect(signedInByCheck).toHaveBeenCalledTimes(1);
          client.emitSession({ id: 's1' });
          expect(signedInByCheck).toHaveBeenCalledTimes(1);
        },
      );

      it("counts Better Auth's own refetch on the browser online event as a check", async () => {
        const { auth, signedInByCheck } = await refusedOn('/sign-in');
        afterCheckLimit();
        client.emitChecking();
        auth.onOnline();
        expect(client.refetches).toBe(0);
        client.emitSession({ id: 's1' });
        expect(signedInByCheck).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['a public page', '/organizations/x'],
        ['the home page', '/'],
      ])('does not re-check on %s', async (_, url) => {
        const { auth } = await refusedOn(url);
        afterCheckLimit();
        auth.onOnline();
        expect(client.refetches).toBe(0);
      });

      it('does not re-check with no stored token', async () => {
        const { auth } = await refusedOn('/sign-in');
        client.storedCookie = '';
        afterCheckLimit();
        auth.onOnline();
        expect(client.refetches).toBe(0);
      });

      it('does not re-check while the browser reports no network', async () => {
        const { auth } = await refusedOn('/sign-in');
        setBrowserOnline(false);
        afterCheckLimit();
        auth.onOnline();
        expect(client.refetches).toBe(0);
      });
    });

    describe('signedInByCheck', () => {
      it('stays quiet when a check confirms a kept session', async () => {
        const auth = configure();
        await loaded();
        const signedInByCheck = vi.fn();
        auth.signedInByCheck.subscribe(signedInByCheck);
        client.emitSession({ id: 's1' });
        expect(auth.signedIn()).toBe(true);
        expect(signedInByCheck).not.toHaveBeenCalled();
      });

      it.each([
        [
          'sign-in',
          (auth: AuthService) => auth.authenticate(requestSignIn, INPUT),
          () => client.releaseSignIn(),
        ],
        [
          'sign-up',
          (auth: AuthService) => auth.authenticate(requestSignUp, INPUT),
          () => client.releaseSignUp(),
        ],
      ] as const)(
        "a %s that succeeds after a check already signed in advances authEpoch, so Convex asks for the new session's token",
        async (kind, submit, release) => {
          const auth = configure();
          await loaded();
          client.emitError({ status: 503, statusText: 'Service Unavailable' });
          if (kind === 'sign-in') client.holdSignIn = true;
          else client.holdSignUp = true;
          const result = submit(auth);
          await loaded();
          client.emitChecking();
          client.emitSession({ id: 's1' });
          await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt');
          expect(auth.authEpoch()).toBe(0);

          client.nextToken = 'jwt-new-session';
          release();
          await expect(result).resolves.toEqual({ ok: true });
          expect(auth.signedIn()).toBe(true);
          expect(auth.authEpoch()).toBe(1);
          await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe(
            'jwt-new-session',
          );
          expect(client.tokenRequests).toBe(2);
        },
      );

      it('a sign-in from signed out leaves authEpoch alone: signedIn turning true calls setAuth', async () => {
        client.storedCookie = '';
        const auth = configure();
        await loaded();
        await expect(auth.authenticate(requestSignIn, INPUT)).resolves.toEqual({ ok: true });
        expect(auth.signedIn()).toBe(true);
        expect(auth.authEpoch()).toBe(0);
      });

      it("stays quiet for this tab's sign-in, and for the check that follows it", async () => {
        client.storedCookie = '';
        const auth = configure();
        await loaded();
        const signedInByCheck = vi.fn();
        auth.signedInByCheck.subscribe(signedInByCheck);
        await expect(auth.authenticate(requestSignIn, INPUT)).resolves.toEqual({ ok: true });
        client.emitSession({ id: 's1' });
        expect(auth.signedIn()).toBe(true);
        expect(signedInByCheck).not.toHaveBeenCalled();
      });
    });
  });

  describe('AUTH_CLIENT', () => {
    it('is null during a server render, so no Better Auth client exists there', () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'server' },
          { provide: AUTH_BASE_URL, useValue: 'https://happy-otter-123.convex.site' },
        ],
      });
      expect(TestBed.inject(AUTH_CLIENT)).toBeNull();
    });

    it('is null in the browser with no Convex site URL', () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: AUTH_BASE_URL, useValue: null },
        ],
      });
      expect(TestBed.inject(AUTH_CLIENT)).toBeNull();
    });

    it('is a Better Auth client, from a lazy chunk, in the browser with a site URL', async () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: AUTH_BASE_URL, useValue: 'https://happy-otter-123.convex.site' },
        ],
      });
      const loading = TestBed.inject(AUTH_CLIENT);
      expect(loading).toBeInstanceOf(Promise);
      const created = await loading;
      expect(created).not.toBeNull();
      expect(typeof created?.signUp.email).toBe('function');
      expect(typeof created?.convex.token).toBe('function');
    });
  });

  describe('fetchToken (ConvexAuthSource)', () => {
    it('fetches no token while signed out, so anonymous visitors make no token request', async () => {
      const auth = configure();
      const token = auth.fetchToken({ forceRefreshToken: false });
      client.emitSession(null);
      await expect(token).resolves.toBeNull();
      expect(client.tokenRequests).toBe(0);
    });

    it('fetches the Convex JWT when signed in and caches it until a forced refresh', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.nextToken = 'jwt-1';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-1');
      client.nextToken = 'jwt-2';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-1');
      await expect(auth.fetchToken({ forceRefreshToken: true })).resolves.toBe('jwt-2');
      expect(client.tokenRequests).toBe(2);
    });

    // The Convex client calls setAuth again when signedIn turns true while its first fetchToken waits, so two calls overlap. They share one request.
    it('shares one token request between overlapping calls', async () => {
      const auth = configure();
      client.nextToken = 'jwt-1';
      const first = auth.fetchToken({ forceRefreshToken: false });
      const second = auth.fetchToken({ forceRefreshToken: false });
      client.emitSession({ id: 's1' });
      await expect(Promise.all([first, second])).resolves.toEqual(['jwt-1', 'jwt-1']);
      expect(client.tokenRequests).toBe(1);
    });

    it('starts a new request for a forced refresh while one is in flight, and caches it', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.holdTokens = true;
      const first = auth.fetchToken({ forceRefreshToken: false });
      await loaded();
      const forced = auth.fetchToken({ forceRefreshToken: true });
      await loaded();
      expect(client.tokenRequests).toBe(2);
      const later = auth.fetchToken({ forceRefreshToken: false });
      await loaded();
      expect(client.tokenRequests).toBe(2);
      client.nextToken = 'jwt-2';
      client.releaseTokens();
      await expect(Promise.all([first, forced, later])).resolves.toEqual([
        'jwt-2',
        'jwt-2',
        'jwt-2',
      ]);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-2');
      expect(client.tokenRequests).toBe(2);
    });

    it('returns null to every caller of a shared request that fails, and asks again next time', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.nextToken = null;
      const calls = [
        auth.fetchToken({ forceRefreshToken: false }),
        auth.fetchToken({ forceRefreshToken: false }),
      ];
      await expect(Promise.all(calls)).resolves.toEqual([null, null]);
      expect(client.tokenRequests).toBe(1);
      client.nextToken = 'jwt-2';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-2');
      expect(client.tokenRequests).toBe(2);
    });

    it('returns null to every caller of a shared request that throws', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.tokenThrows = new TypeError('Load failed');
      const calls = [
        auth.fetchToken({ forceRefreshToken: false }),
        auth.fetchToken({ forceRefreshToken: false }),
      ];
      await expect(Promise.all(calls)).resolves.toEqual([null, null]);
      expect(client.tokenRequests).toBe(1);
    });

    it('returns null when starting the token request throws', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      vi.spyOn(client.convex, 'token').mockImplementation(() => {
        throw new TypeError('Load failed');
      });
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
    });

    it('neither shares nor caches a request that was in flight at sign-out', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.holdTokens = true;
      client.nextToken = 'jwt-old';
      const stale = auth.fetchToken({ forceRefreshToken: false });
      await loaded();
      await auth.signOut();
      client.emitSession({ id: 's2' });
      client.holdTokens = false;
      client.nextToken = 'jwt-new';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-new');
      expect(client.tokenRequests).toBe(2);
      client.nextToken = 'jwt-old';
      client.releaseTokens();
      await stale;
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-new');
      expect(client.tokenRequests).toBe(2);
    });

    it('returns null from a request that finishes after sign-out', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.holdTokens = true;
      const stale = auth.fetchToken({ forceRefreshToken: false });
      await loaded();
      await auth.signOut();
      client.releaseTokens();
      await expect(stale).resolves.toBeNull();
    });

    it('returns null from a request in flight at sign-out that finishes after the next sign-in', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.holdTokens = true;
      client.nextToken = 'jwt-old';
      const stale = auth.fetchToken({ forceRefreshToken: true });
      await loaded();
      await auth.signOut();
      client.emitSession({ id: 's2' });
      expect(auth.signedIn()).toBe(true);
      client.releaseTokens();
      await expect(stale).resolves.toBeNull();
      client.holdTokens = false;
      client.nextToken = 'jwt-new';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-new');
      expect(client.tokenRequests).toBe(2);
    });

    it('returns null from a request in flight when the session store answers signed out, even after a new session', async () => {
      const auth = configure();
      await loaded();
      client.emitSession({ id: 's1' });
      client.holdTokens = true;
      client.nextToken = 'jwt-old';
      const stale = auth.fetchToken({ forceRefreshToken: false });
      await loaded();
      client.emitSession(null);
      client.emitSession({ id: 's2' });
      expect(auth.signedIn()).toBe(true);
      client.releaseTokens();
      await expect(stale).resolves.toBeNull();
      client.nextToken = 'jwt-new';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-new');
      expect(client.tokenRequests).toBe(2);
    });

    it('answers a request replaced by a forced refresh with its own token, and caches the newer one', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      const releases: ((token: string) => void)[] = [];
      vi.spyOn(client.convex, 'token').mockImplementation(
        () =>
          new Promise((resolve) =>
            releases.push((token) => resolve({ data: { token }, error: null })),
          ),
      );
      const first = auth.fetchToken({ forceRefreshToken: false });
      await loaded();
      const forced = auth.fetchToken({ forceRefreshToken: true });
      await loaded();
      expect(releases).toHaveLength(2);
      releases[1]('jwt-forced');
      await expect(forced).resolves.toBe('jwt-forced');
      releases[0]('jwt-first');
      await expect(first).resolves.toBe('jwt-first');
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-forced');
      expect(releases).toHaveLength(2);
    });

    it('drops the cached token on sign-out', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.nextToken = 'jwt-1';
      await auth.fetchToken({ forceRefreshToken: false });
      client.emitSession(null);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
    });

    it('returns null when the token request fails', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.nextToken = null;
      await expect(auth.fetchToken({ forceRefreshToken: true })).resolves.toBeNull();
    });

    // The Convex client does not catch a rejected fetchToken, so a rejection would be an unhandled
    // error. WebKit rejects a fetch that a page unload aborts with "TypeError: Load failed".
    it('returns null, and keeps no token, when the token request throws', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.nextToken = 'jwt-1';
      await auth.fetchToken({ forceRefreshToken: false });
      client.tokenThrows = new TypeError('Load failed');
      await expect(auth.fetchToken({ forceRefreshToken: true })).resolves.toBeNull();
      client.tokenThrows = null;
      client.nextToken = 'jwt-2';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-2');
    });

    describe('with many simultaneous callers', () => {
      const CALLERS = 50;
      const many = (auth: AuthService, forceRefreshToken = false) =>
        Array.from({ length: CALLERS }, () => auth.fetchToken({ forceRefreshToken }));

      it('makes one request for callers that start before the session check settles', async () => {
        const auth = configure();
        client.nextToken = 'jwt-1';
        const calls = many(auth);
        await loaded();
        expect(client.tokenRequests).toBe(0);
        client.emitSession({ id: 's1' });
        const tokens = await Promise.all(calls);
        expect(new Set(tokens)).toEqual(new Set(['jwt-1']));
        expect(client.tokenRequests).toBe(1);
      });

      it('makes one request for callers that start while it is in flight', async () => {
        const auth = configure();
        client.emitSession({ id: 's1' });
        client.holdTokens = true;
        const calls = many(auth);
        await loaded();
        const late = many(auth);
        await loaded();
        expect(client.tokenRequests).toBe(1);
        client.nextToken = 'jwt-1';
        client.releaseTokens();
        const tokens = await Promise.all([...calls, ...late]);
        expect(tokens).toHaveLength(CALLERS * 2);
        expect(new Set(tokens)).toEqual(new Set(['jwt-1']));
        expect(client.tokenRequests).toBe(1);
      });

      it.each([
        ['is refused', () => (client.nextToken = null)],
        ['throws', () => (client.tokenThrows = new TypeError('Load failed'))],
      ])('returns null to every caller when the shared request %s', async (_, fail) => {
        const auth = configure();
        client.emitSession({ id: 's1' });
        client.holdTokens = true;
        const calls = many(auth);
        await loaded();
        fail();
        client.releaseTokens();
        const tokens = await Promise.all(calls);
        expect(new Set(tokens)).toEqual(new Set([null]));
        expect(client.tokenRequests).toBe(1);
        client.tokenThrows = null;
        client.nextToken = 'jwt-2';
        await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-2');
        expect(client.tokenRequests).toBe(2);
      });

      it('starts one new request per forced refresh among waiting callers', async () => {
        const auth = configure();
        client.emitSession({ id: 's1' });
        client.holdTokens = true;
        const before = many(auth);
        await loaded();
        const forced = auth.fetchToken({ forceRefreshToken: true });
        await loaded();
        const after = many(auth);
        await loaded();
        expect(client.tokenRequests).toBe(2);
        client.nextToken = 'jwt-2';
        client.releaseTokens();
        await Promise.all([...before, forced, ...after]);
        expect(client.tokenRequests).toBe(2);
        await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt-2');
        expect(client.tokenRequests).toBe(2);
      });

      it('returns null to every caller waiting at sign-out, and makes no request after it', async () => {
        const auth = configure();
        client.emitSession({ id: 's1' });
        client.holdTokens = true;
        client.nextToken = 'jwt-old';
        const calls = many(auth);
        await loaded();
        await auth.signOut();
        client.emitSession(null);
        client.releaseTokens();
        const tokens = await Promise.all(calls);
        expect(new Set(tokens)).toEqual(new Set([null]));
        await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBeNull();
        expect(client.tokenRequests).toBe(1);
      });
    });

    it('reports whether Convex accepted the token through onChange', () => {
      const auth = configure();
      expect(auth.convexAuthenticated()).toBe(false);
      auth.onChange(true);
      expect(auth.convexAuthenticated()).toBe(true);
      auth.onChange(false);
      expect(auth.convexAuthenticated()).toBe(false);
    });
  });

  describe('authenticate', () => {
    const CREDENTIALS = { email: 'maya.okafor@example.com', password: 'sandbar sunset spike 2026' };

    it('is signed in at once after a sign-up, before the session store refetches', async () => {
      const auth = configure();
      client.emitSession(null);
      await expect(auth.authenticate(requestSignUp, INPUT)).resolves.toEqual({ ok: true });
      // Known at once, so the /app guard lets it through.
      expect(auth.signedIn()).toBe(true);
      await expect(auth.isSignedIn()).resolves.toBe(true);
    });

    it('is signed in at once after a sign-in, before the session store refetches', async () => {
      const auth = configure();
      client.emitSession(null);
      await expect(auth.authenticate(requestSignIn, CREDENTIALS)).resolves.toEqual({ ok: true });
      expect(auth.signedIn()).toBe(true);
      await expect(auth.isSignedIn()).resolves.toBe(true);
    });

    it('makes no session request before a sign-in, then follows the session store', async () => {
      client.storedCookie = '';
      const auth = configure();
      await expect(auth.isSignedIn()).resolves.toBe(false);
      expect(client.sessionListeners).toBe(0);
      await auth.authenticate(requestSignIn, CREDENTIALS);
      expect(client.sessionListeners).toBe(1);
      client.emitSession(null);
      expect(auth.signedIn()).toBe(false);
    });

    it('drops a token fetched before a sign-in, so the next one is the new session’s', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.nextToken = 'old';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('old');
      client.nextToken = 'new';
      await auth.authenticate(requestSignIn, CREDENTIALS);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('new');
    });

    it('stays signed out, and answers the refusal, when the request is refused', async () => {
      const auth = configure();
      client.emitSession(null);
      client.nextSignUpError = { status: 422, code: 'USER_ALREADY_EXISTS' };
      await expect(auth.authenticate(requestSignUp, INPUT)).resolves.toEqual({
        ok: false,
        error: 'exists',
      });
      client.nextSignInError = { status: 401 };
      await expect(auth.authenticate(requestSignIn, CREDENTIALS)).resolves.toEqual({
        ok: false,
        error: 'incorrect',
      });
      expect(auth.signedIn()).toBe(false);
    });

    it('stays signed out when the request throws', async () => {
      const auth = configure();
      client.emitSession(null);
      client.signUpThrows = new TypeError('Failed to fetch');
      client.signInThrows = new TypeError('Failed to fetch');
      await expect(auth.authenticate(requestSignUp, INPUT)).resolves.toEqual({
        ok: false,
        error: 'unexpected',
      });
      await expect(auth.authenticate(requestSignIn, CREDENTIALS)).resolves.toEqual({
        ok: false,
        error: 'unexpected',
      });
      expect(auth.signedIn()).toBe(false);
    });

    it.each<[string, (auth: AuthService) => Promise<unknown>]>([
      ['sign-up', (auth) => auth.authenticate(requestSignUp, INPUT)],
      ['sign-in', (auth) => auth.authenticate(requestSignIn, CREDENTIALS)],
    ])('is already signed in when changes settle after a %s', async (_, request) => {
      const auth = configure();
      client.emitSession(null);
      const signedInAtSettle: boolean[] = [];
      TestBed.inject(ChangesInFlight).settled.subscribe(() =>
        signedInAtSettle.push(auth.signedIn()),
      );

      await request(auth);

      expect(signedInAtSettle).toEqual([true]);
    });

    it.each<[string, (auth: AuthService) => Promise<unknown>]>([
      ['sign-up', (auth) => auth.authenticate(requestSignUp, INPUT)],
      ['sign-in', (auth) => auth.authenticate(requestSignIn, CREDENTIALS)],
    ])('answers unexpected for a %s without a client, and makes no request', async (_, request) => {
      const auth = configure(null);
      await expect(request(auth)).resolves.toEqual({ ok: false, error: 'unexpected' });
      expect(client.signUps).toEqual([]);
      expect(client.signIns).toEqual([]);
    });
  });

  describe('signOut', () => {
    it('signs out through the client and is signed out at once', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      await auth.signOut();
      expect(client.signOuts).toBe(1);
      expect(auth.signedIn()).toBe(false);
    });

    it('answers a forced token refresh with null, and requests none, while signing out', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.holdSignOut = true;
      const signingOut = auth.signOut();
      await vi.waitFor(() => expect(client.signOuts).toBe(1));

      await expect(auth.fetchToken({ forceRefreshToken: true })).resolves.toBeNull();
      expect(client.tokenRequests).toBe(0);

      client.releaseSignOut();
      await signingOut;
    });

    it('starts no extra session check when none was in flight, and a later session confirms', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      await auth.signOut();
      expect(client.refetches).toBe(0);

      client.emitSession({ id: 's2' });
      expect(auth.signedIn()).toBe(true);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt');
    });

    it('replaces the check in flight, and this tab signing in before it answers gets a token', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.emitChecking();
      await auth.signOut();
      expect(client.refetches).toBe(1);

      await expect(
        auth.authenticate(requestSignIn, { email: INPUT.email, password: INPUT.password }),
      ).resolves.toEqual({
        ok: true,
      });
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('jwt');
      expect(client.tokenRequests).toBe(1);
    });
  });

  describe('changes in flight', () => {
    it('counts sign-up, sign-in, and sign-out as in flight until each settles', async () => {
      const auth = configure();
      const changes = TestBed.inject(ChangesInFlight);
      client.emitSession(null);

      client.holdSignUp = true;
      const signUp = auth.authenticate(requestSignUp, INPUT);
      await loaded();
      expect(changes.active()).toBe(true);
      client.releaseSignUp();
      await signUp;
      expect(changes.active()).toBe(false);

      client.holdSignIn = true;
      const signIn = auth.authenticate(requestSignIn, {
        email: INPUT.email,
        password: INPUT.password,
      });
      await loaded();
      expect(changes.active()).toBe(true);
      client.releaseSignIn();
      await signIn;
      expect(changes.active()).toBe(false);

      const signOut = auth.signOut();
      expect(changes.active()).toBe(true);
      await signOut;
      expect(changes.active()).toBe(false);
    });

    it('stops counting when the request throws', async () => {
      const auth = configure();
      const changes = TestBed.inject(ChangesInFlight);
      client.signInThrows = new Error('network');

      await auth.authenticate(requestSignIn, { email: INPUT.email, password: INPUT.password });

      expect(changes.active()).toBe(false);
    });
  });
});
