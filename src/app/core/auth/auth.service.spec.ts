import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AUTH_BASE_URL, AUTH_CLIENT } from './auth-client';
import { AuthService, type SignUpFailure } from './auth.service';
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

  /** Lets the client's lazy chunk (here a resolved promise) reach AuthService. */
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
      ['400 too short', { status: 400, code: 'PASSWORD_TOO_SHORT' }, 'password-too-short'],
      ['400 too long', { status: 400, code: 'PASSWORD_TOO_LONG' }, 'password-too-long'],
      ['400 no 18+', { status: 400, code: 'ADULT_CONFIRMATION_REQUIRED' }, 'adult-required'],
      ['403 origin', { status: 403, code: 'INVALID_ORIGIN' }, 'unexpected'],
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

  describe('signOut', () => {
    it('signs out through the client and is signed out at once', async () => {
      const auth = configure();
      client.emitSession({ id: 's1' });
      await auth.signOut();
      expect(client.signOuts).toBe(1);
      expect(auth.signedIn()).toBe(false);
    });
  });
});
