import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChangesInFlight } from '../changes-in-flight';
import { AUTH_BASE_URL, AUTH_CLIENT } from './auth-client';
import { AuthService, type SignInResult, type SignUpFailure } from './auth.service';
import { FakeAuthClient, provideFakeAuthClient } from './testing/fake-auth-client';

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
    it('is unknown until the session store settles, then follows it', async () => {
      const auth = configure();
      expect(auth.signedIn()).toBe(false);
      let known = false;
      const signedIn = auth.isSignedIn().then((value) => {
        known = true;
        return value;
      });
      await Promise.resolve();
      expect(known).toBe(false);

      client.emitSession({ id: 's1' });
      await expect(signedIn).resolves.toBe(true);
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

    it('with a stored session token, waits for the session store', async () => {
      const auth = configure();
      await loaded();
      expect(client.sessionListeners).toBe(1);
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

      async function configureReal(stored: string | null) {
        const fetchStub = vi.fn<typeof fetch>(() =>
          Promise.resolve(
            new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
          ),
        );
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
        return { auth: TestBed.inject(AuthService), subscribe, requests };
      }

      afterEach(() => {
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
      await expect(auth.signUp(INPUT)).resolves.toEqual({ ok: true });
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
      await expect(auth.signUp(INPUT)).resolves.toEqual({ ok: false, error: 'unexpected' });
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

  describe('signUp', () => {
    it('sends the 18+ confirmation with the trimmed email, and is signed in on success', async () => {
      const auth = configure();
      client.emitSession(null);
      const result = auth.signUp({ ...INPUT, email: '  maya.okafor@example.com ' });
      await expect(result).resolves.toEqual({ ok: true });
      expect(client.signUps).toEqual([{ ...INPUT, adultConfirmed: true }]);
      // Known at once, before the session store refetches, so the /app guard lets it through.
      expect(auth.signedIn()).toBe(true);
      await expect(auth.isSignedIn()).resolves.toBe(true);
    });

    it.each<[string, { status: number; code?: string; message?: string }, SignUpFailure]>([
      [
        '422 already exists',
        { status: 422, code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' },
        'exists',
      ],
      ['422 already exists (short code)', { status: 422, code: 'USER_ALREADY_EXISTS' }, 'exists'],
      ['400 breached', { status: 400, code: 'PASSWORD_COMPROMISED' }, 'breached'],
      [
        '500 check unavailable',
        { status: 500, message: 'Failed to check password. Please try again later.' },
        'check-unavailable',
      ],
      [
        '500 check failed with a status',
        { status: 500, message: 'Failed to check password. Status: 503' },
        'check-unavailable',
      ],
      ['400 invalid email', { status: 400, code: 'INVALID_EMAIL' }, 'invalid-email'],
      // Better Auth 1.6 answers a malformed email with its body-validation error.
      [
        '400 validation error on the email',
        { status: 400, code: 'VALIDATION_ERROR', message: '[body.email] Invalid email address' },
        'invalid-email',
      ],
      [
        '400 validation error on another field',
        { status: 400, code: 'VALIDATION_ERROR', message: '[body.name] Invalid input' },
        'unexpected',
      ],
      [
        '400 validation error on the email and another field',
        {
          status: 400,
          code: 'VALIDATION_ERROR',
          message: '[body.email] Invalid email address; [body.name] Invalid input',
        },
        'unexpected',
      ],
      [
        '400 validation error, the server message for a missing password and a bad email',
        {
          status: 400,
          code: 'VALIDATION_ERROR',
          message:
            '[body.email] Invalid email address; [body.password] Invalid input: expected string, received undefined',
        },
        'unexpected',
      ],
      [
        '400 validation error on the email and the password',
        {
          status: 400,
          code: 'VALIDATION_ERROR',
          message:
            '[body.email] Invalid email address; [body.password] Invalid input: expected string, received number',
        },
        'unexpected',
      ],
      [
        '400 validation error on a field whose name starts with email',
        { status: 400, code: 'VALIDATION_ERROR', message: '[body.emailAddress] Invalid input' },
        'unexpected',
      ],
      [
        '400 validation error on the whole body',
        { status: 400, code: 'VALIDATION_ERROR', message: '[body] Invalid input' },
        'unexpected',
      ],
      [
        '400 with an email issue message but another code',
        { status: 400, code: 'SOMETHING_ELSE', message: '[body.email] Invalid email address' },
        'unexpected',
      ],
      [
        '400 validation error without a message',
        { status: 400, code: 'VALIDATION_ERROR' },
        'unexpected',
      ],
      ['400 too short', { status: 400, code: 'PASSWORD_TOO_SHORT' }, 'password-too-short'],
      ['400 too long', { status: 400, code: 'PASSWORD_TOO_LONG' }, 'password-too-long'],
      ['400 no 18+', { status: 400, code: 'ADULT_CONFIRMATION_REQUIRED' }, 'adult-required'],
      ['403 origin', { status: 403, code: 'INVALID_ORIGIN' }, 'unexpected'],
      ['400 name invalid', { status: 400, code: 'NAME_INVALID' }, 'name-invalid'],
      ['503 auth not configured', { status: 503, code: 'AUTH_NOT_CONFIGURED' }, 'unexpected'],
      ['429', { status: 429 }, 'unexpected'],
      ['500 other', { status: 500, message: 'boom' }, 'unexpected'],
    ])('maps %s to %s', async (_, error, expected) => {
      const auth = configure();
      client.emitSession(null);
      client.nextSignUpError = error;
      await expect(auth.signUp(INPUT)).resolves.toEqual({ ok: false, error: expected });
      expect(auth.signedIn()).toBe(false);
    });

    it('maps a network failure to unexpected', async () => {
      const auth = configure();
      client.signUpThrows = new TypeError('Failed to fetch');
      await expect(auth.signUp(INPUT)).resolves.toEqual({ ok: false, error: 'unexpected' });
    });

    it('is unexpected without a client', async () => {
      const auth = configure(null);
      await expect(auth.signUp(INPUT)).resolves.toEqual({ ok: false, error: 'unexpected' });
    });
  });

  describe('signIn', () => {
    const CREDENTIALS = { email: 'maya.okafor@example.com', password: 'sandbar sunset spike 2026' };

    it('sends the trimmed email and the password, and is signed in on success', async () => {
      const auth = configure();
      client.emitSession(null);
      await expect(
        auth.signIn({ ...CREDENTIALS, email: '  maya.okafor@example.com ' }),
      ).resolves.toEqual({ ok: true });
      expect(client.signIns).toEqual([CREDENTIALS]);
      // Known at once, before the session store refetches, so the /app guard lets it through.
      expect(auth.signedIn()).toBe(true);
      await expect(auth.isSignedIn()).resolves.toBe(true);
    });

    it('makes no session request before it, then follows the session store', async () => {
      client.storedCookie = '';
      const auth = configure();
      await expect(auth.isSignedIn()).resolves.toBe(false);
      expect(client.sessionListeners).toBe(0);
      await auth.signIn(CREDENTIALS);
      expect(client.sessionListeners).toBe(1);
      client.emitSession(null);
      expect(auth.signedIn()).toBe(false);
    });

    it('drops a token fetched before it, so the next one is the new session’s', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      client.nextToken = 'old';
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('old');
      client.nextToken = 'new';
      await auth.signIn(CREDENTIALS);
      await expect(auth.fetchToken({ forceRefreshToken: false })).resolves.toBe('new');
    });

    it.each<
      [
        string,
        { status: number; code?: string; message?: string; retryAfterSeconds?: number },
        SignInResult,
      ]
    >([
      [
        '401 wrong password or unknown email',
        { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
        { ok: false, error: 'incorrect' },
      ],
      ['401 without a code', { status: 401 }, { ok: false, error: 'incorrect' }],
      [
        '429 inside the wait, with the seconds left',
        { status: 429, code: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: 240 },
        { ok: false, error: 'throttled', retryAfterSeconds: 240 },
      ],
      [
        '429 inside the wait, without the seconds',
        { status: 429, code: 'TOO_MANY_ATTEMPTS' },
        { ok: false, error: 'throttled', retryAfterSeconds: 60 },
      ],
      [
        '429 at the hard limit',
        { status: 429, code: 'SIGN_IN_LOCKED' },
        { ok: false, error: 'locked' },
      ],
      ['429 from the per-IP limiter', { status: 429 }, { ok: false, error: 'unexpected' }],
      [
        '400 invalid email',
        { status: 400, code: 'INVALID_EMAIL' },
        { ok: false, error: 'invalid-email' },
      ],
      [
        '400 validation error on the email',
        { status: 400, code: 'VALIDATION_ERROR', message: '[body.email] Invalid email address' },
        { ok: false, error: 'invalid-email' },
      ],
      [
        '400 validation error on the password',
        { status: 400, code: 'VALIDATION_ERROR', message: '[body.password] Invalid input' },
        { ok: false, error: 'unexpected' },
      ],
      ['403 origin', { status: 403, code: 'INVALID_ORIGIN' }, { ok: false, error: 'unexpected' }],
      [
        '503 auth not configured',
        { status: 503, code: 'AUTH_NOT_CONFIGURED' },
        { ok: false, error: 'unexpected' },
      ],
      ['500', { status: 500, message: 'boom' }, { ok: false, error: 'unexpected' }],
    ])('maps %s', async (_, error, expected) => {
      const auth = configure();
      client.emitSession(null);
      client.nextSignInError = error;
      await expect(auth.signIn(CREDENTIALS)).resolves.toEqual(expected);
      expect(auth.signedIn()).toBe(false);
    });

    it('maps a network failure to unexpected', async () => {
      const auth = configure();
      client.signInThrows = new TypeError('Failed to fetch');
      await expect(auth.signIn(CREDENTIALS)).resolves.toEqual({ ok: false, error: 'unexpected' });
    });

    it('is unexpected without a client', async () => {
      const auth = configure(null);
      await expect(auth.signIn(CREDENTIALS)).resolves.toEqual({ ok: false, error: 'unexpected' });
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
  });

  describe('changes in flight', () => {
    it('counts sign-up, sign-in, and sign-out as in flight until each settles', async () => {
      const auth = configure();
      const changes = TestBed.inject(ChangesInFlight);
      client.emitSession(null);

      client.holdSignUp = true;
      const signUp = auth.signUp(INPUT);
      await loaded();
      expect(changes.active()).toBe(true);
      client.releaseSignUp();
      await signUp;
      expect(changes.active()).toBe(false);

      client.holdSignIn = true;
      const signIn = auth.signIn({ email: INPUT.email, password: INPUT.password });
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

      await auth.signIn({ email: INPUT.email, password: INPUT.password });

      expect(changes.active()).toBe(false);
    });
  });
});
