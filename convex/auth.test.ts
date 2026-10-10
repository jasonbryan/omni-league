/// <reference types="vite/client" />
// Sign-up through Better Auth's real HTTP route, `POST /api/auth/sign-up/email`, with the
// component registered in convex-test (#62; ADR 0008 "Server configuration").
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { components } from './_generated/api';
import type { GenericCtx } from '@convex-dev/better-auth';
import type { DataModel } from './_generated/dataModel';
import { ADULT_CONFIRMATION_REQUIRED, PASSWORD_COMPROMISED_MESSAGE, createAuth } from './auth';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { modules } from './test.setup';

// When set, the `users` row writer throws, so the component's user.onCreate trigger fails.
const failures = vi.hoisted(() => ({ userRecord: false }));
vi.mock('./lib/users', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/users')>();
  return {
    ...original,
    insertUserRecord: async (...args: Parameters<typeof original.insertUserRecord>) => {
      if (failures.userRecord) throw new Error('users row write failed (test)');
      return original.insertUserRecord(...args);
    },
  };
});

const SITE_URL = 'http://localhost:4000';
const PREVIEW = 'https://deploy-preview-62--charming-longma-28c00d.netlify.app';
const PASSWORD = 'sandbar sunset spike 2026';

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

type T = ReturnType<typeof setup>;

interface SignUpBody {
  name?: string;
  email?: string;
  password?: string;
  adultConfirmed?: unknown;
}

async function signUp(
  t: T,
  body: SignUpBody,
  { origin = SITE_URL }: { origin?: string | null } = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const response = await t.fetch('/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin === null ? {} : { origin }),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers,
  };
}

const valid = (email = 'maya.okafor@example.com'): SignUpBody => ({
  name: 'Maya Okafor',
  email,
  password: PASSWORD,
  adultConfirmed: true,
});

/** Every auth user, account, and session in the component, and every `users` row. */
async function stored(t: T) {
  return t.run(async (ctx) => {
    const all = async (model: 'user' | 'account' | 'session') =>
      (
        (await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model,
          paginationOpts: { numItems: 100, cursor: null },
        })) as { page: Record<string, unknown>[] }
      ).page;
    return {
      authUsers: await all('user'),
      accounts: await all('account'),
      sessions: await all('session'),
      users: await ctx.db.query('users').collect(),
    };
  });
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** A Pwned Passwords range response: padding lines, plus `suffix` when it is breached. */
function rangeResponse(breachedSuffix?: string): Response {
  const lines = ['0018A45C4D1DEF81644B54AB7F969B88D65:0', '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'];
  if (breachedSuffix) lines.push(`${breachedSuffix}:3730471`);
  return new Response(lines.join('\r\n'), { status: 200 });
}

let pwned: ReturnType<typeof vi.fn<(input: RequestInfo | URL) => Promise<Response>>>;

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('SITE_URL', SITE_URL);
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  vi.stubEnv('IS_TEST', undefined);
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', undefined);
  // The breached-password check is on (IS_TEST unset); by default no password is breached.
  pwned = vi.fn(() => Promise.resolve(rangeResponse()));
  vi.stubGlobal('fetch', pwned);
  failures.userRecord = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sign-up', () => {
  test('creates the auth user and a users row with adultConfirmedAt', async () => {
    const t = setup();
    const before = Date.now();
    const { status, json } = await signUp(t, valid());
    expect(status, JSON.stringify(json)).toBe(200);
    expect(json['token']).toEqual(expect.any(String));

    const { authUsers, accounts, users } = await stored(t);
    expect(authUsers).toHaveLength(1);
    const [authUser] = authUsers;
    expect(authUser).toMatchObject({ email: 'maya.okafor@example.com', name: 'Maya Okafor' });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ providerId: 'credential', userId: authUser?.['_id'] });
    // ADR 0008: the stored hash is in convex/lib/password.ts's format, never the default one.
    expect(accounts[0]?.['password']).toMatch(/^scrypt\$15\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{64}$/);

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ authUserId: authUser?.['_id'], name: 'Maya Okafor' });
    expect(users[0]?.adultConfirmedAt).toBeGreaterThanOrEqual(before);
    expect(users[0]?.adultConfirmedAt).toBeLessThanOrEqual(Date.now());
  }, 30_000);

  test.each([
    ['missing', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['1', 1],
    ['null', null],
  ])(
    'without the 18+ confirmation (%s), a direct POST is refused and creates nothing',
    async (_, adultConfirmed) => {
      const t = setup();
      const body = { ...valid(), adultConfirmed };
      if (adultConfirmed === undefined) delete body.adultConfirmed;
      const { status, json } = await signUp(t, body);
      expect(status).toBe(400);
      expect(json).toMatchObject(ADULT_CONFIRMATION_REQUIRED);
      expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
      // Refused before the password is checked or hashed.
      expect(pwned).not.toHaveBeenCalled();
    },
  );

  test('when the user.onCreate trigger throws, no auth user remains', async () => {
    const t = setup();
    failures.userRecord = true;
    const { status } = await signUp(t, valid());
    expect(status).toBeGreaterThanOrEqual(400);
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });

    // The same address can sign up once the trigger works again.
    failures.userRecord = false;
    expect((await signUp(t, valid())).status).toBe(200);
    expect((await stored(t)).users).toHaveLength(1);
  }, 30_000);

  test('an existing email gets 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', async () => {
    const t = setup();
    expect((await signUp(t, valid())).status).toBe(200);
    const { status, json } = await signUp(t, {
      ...valid('Maya.Okafor@Example.com'),
      password: 'a different long passphrase',
    });
    expect(status).toBe(422);
    expect(json['code']).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
    const { authUsers, users } = await stored(t);
    expect(authUsers).toHaveLength(1);
    expect(users).toHaveLength(1);
  }, 30_000);

  test.each([
    ['14 characters', 'a'.repeat(14), 'PASSWORD_TOO_SHORT'],
    ['129 characters', 'a'.repeat(129), 'PASSWORD_TOO_LONG'],
  ])('a password of %s is refused (%s)', async (_, password, code) => {
    const t = setup();
    const { status, json } = await signUp(t, { ...valid(), password });
    expect(status).toBe(400);
    expect(json['code']).toBe(code);
    expect((await stored(t)).authUsers).toEqual([]);
  });
});

describe('trusted origins over HTTP', () => {
  test('without PREVIEW_ORIGIN_PATTERN (production), a preview origin is refused', async () => {
    const t = setup();
    const { status, json } = await signUp(t, valid(), { origin: PREVIEW });
    expect(status).toBe(403);
    expect(json['code']).toBe('INVALID_ORIGIN');
    expect((await stored(t)).authUsers).toEqual([]);
  });

  test('with PREVIEW_ORIGIN_PATTERN set to the constant, a preview origin signs up', async () => {
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
    const t = setup();
    const { status, headers } = await signUp(t, valid(), { origin: PREVIEW });
    expect(status).toBe(200);
    expect(headers.get('access-control-allow-origin')).toBe(PREVIEW);
    expect((await stored(t)).users).toHaveLength(1);
  }, 30_000);

  test('with PREVIEW_ORIGIN_PATTERN set, a non-matching origin is still refused', async () => {
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
    const t = setup();
    for (const origin of [
      'https://evil.example',
      'https://deploy-preview-62--other.netlify.app',
      'https://charming-longma-28c00d.netlify.app',
    ]) {
      const { status, headers } = await signUp(t, valid(), { origin });
      expect(status, origin).toBe(403);
      expect(headers.get('access-control-allow-origin'), origin).not.toBe(origin);
    }
    expect((await stored(t)).authUsers).toEqual([]);
  });
});

describe('breached-password check (Pwned Passwords, mocked fetch)', () => {
  test('a breached password is refused with the approved message', async () => {
    const t = setup();
    const hash = await sha1Hex('passwordpassword');
    pwned.mockImplementation(() => Promise.resolve(rangeResponse(hash.slice(5))));
    const { status, json } = await signUp(t, { ...valid(), password: 'passwordpassword' });
    expect(status).toBe(400);
    expect(json).toMatchObject({
      code: 'PASSWORD_COMPROMISED',
      message: PASSWORD_COMPROMISED_MESSAGE,
    });
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
    // k-anonymity: only the first five hex characters of the SHA-1 leave the deployment.
    expect(pwned).toHaveBeenCalledOnce();
    const input = pwned.mock.calls[0]?.[0];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
  });

  test('an unreachable API refuses the sign-up (fails closed)', async () => {
    const t = setup();
    pwned.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    const { status, json } = await signUp(t, valid());
    expect(status).toBe(500);
    expect(json['message']).toBe('Failed to check password. Please try again later.');
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
  });

  test('an API error status also refuses the sign-up', async () => {
    const t = setup();
    pwned.mockImplementation(() => Promise.resolve(new Response('', { status: 503 })));
    const { status, json } = await signUp(t, valid());
    expect(status).toBe(500);
    expect(String(json['message'])).toMatch(/^Failed to check password\./);
    expect((await stored(t)).authUsers).toEqual([]);
  });

  test('a password not in the range response signs up', async () => {
    const t = setup();
    expect((await signUp(t, valid())).status).toBe(200);
    expect(pwned).toHaveBeenCalledOnce();
  }, 30_000);

  test('under IS_TEST the check is off and makes no outside call', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = setup();
    pwned.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    expect((await signUp(t, valid())).status).toBe(200);
    expect(pwned).not.toHaveBeenCalled();
  }, 30_000);
});

// Tester (#62): the origin check must hold even where Better Auth would skip it by default
// (`NODE_ENV` "test" or `TEST` set, better-auth/dist/context/create-context.mjs), and for every
// lookalike of this project's preview hostnames, over the real HTTP route.
describe('origin check under a test environment (tester)', () => {
  test('Vitest runs with NODE_ENV "test", the case Better Auth skips the check by default', () => {
    // Better Auth reads process.env.NODE_ENV itself (@better-auth/core/env), not the typed `env`.
    // eslint-disable-next-line @convex-dev/no-process-env -- asserts the variable Better Auth reads
    expect(process.env['NODE_ENV']).toBe('test');
  });

  test.each([
    'https://evil.example',
    'https://deploy-preview-0--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-01--charming-longma-28c00d.netlify.app',
    'http://deploy-preview-62--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-62--charming-longma-28c00d.netlify.app.evil.example',
    'https://deploy-preview-62--charming-longma-28c00d-netlify.app',
    'https://xdeploy-preview-62--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-62--charming-longma-28c00d.netlify.app:443',
    'https://charming-longma-28c00d.netlify.app',
  ])('with TEST=true and the preview pattern set, Origin %s is refused', async (origin) => {
    vi.stubEnv('TEST', 'true');
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
    const t = setup();
    const { status, json, headers } = await signUp(t, valid(), { origin });
    expect(status).toBe(403);
    expect(json['code']).toBe('INVALID_ORIGIN');
    expect(headers.get('access-control-allow-origin')).toBeNull();
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
  });

  test('a forged Referer with no Origin is refused too', async () => {
    vi.stubEnv('TEST', 'true');
    const t = setup();
    const response = await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', referer: 'https://evil.example/x' },
      body: JSON.stringify(valid()),
    });
    expect(response.status).toBe(403);
    expect((await stored(t)).authUsers).toEqual([]);
  });

  test('a cross-site callbackURL from a trusted origin is refused', async () => {
    const t = setup();
    const { status, json } = await signUp(t, {
      ...valid(),
      callbackURL: 'https://evil.example/x',
    } as SignUpBody);
    expect(status).toBe(403);
    expect(json['code']).toBe('INVALID_CALLBACK_URL');
    expect((await stored(t)).authUsers).toEqual([]);
  });
});

// Tester (#62): the password never appears in a response or in anything logged, on success and on
// each refusal path (breached, check unavailable, too short, existing email, forged origin).
describe('the password is never echoed or logged (tester)', () => {
  test('across success and every refusal path', async () => {
    const secret = 'unique tester passphrase 7f3a9c';
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const t = setup();
    const outputs: string[] = [];
    const record = async (body: SignUpBody, opts?: { origin?: string | null }): Promise<number> => {
      const { status, json, headers } = await signUp(t, body, opts);
      outputs.push(JSON.stringify(json), JSON.stringify([...headers.entries()]));
      return status;
    };
    expect(await record({ ...valid(), password: secret })).toBe(200);
    expect(await record({ ...valid(), password: secret })).toBe(422);
    expect(await record({ ...valid('b@example.com'), password: secret.slice(0, 14) })).toBe(400);
    expect(
      await record(
        { ...valid('c@example.com'), password: secret },
        { origin: 'https://evil.example' },
      ),
    ).toBe(403);
    pwned.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    expect(await record({ ...valid('d@example.com'), password: secret })).toBe(500);
    const hash = await sha1Hex(secret);
    pwned.mockImplementation(() => Promise.resolve(rangeResponse(hash.slice(5))));
    expect(await record({ ...valid('e@example.com'), password: secret })).toBe(400);

    for (const text of [...outputs, ...logged]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(secret.slice(0, 14));
    }
    vi.restoreAllMocks();
  }, 60_000);
});

// Tester (#62, round 2): the client maps `VALIDATION_ERROR` to the Email field only when every
// `[body.<field>]` issue is on `email` (src/app/core/auth/auth.service.ts). This pins the server's
// message format that mapping reads, and that the refused value is never echoed.
describe('body validation messages the client maps (tester)', () => {
  test.each([
    ['a malformed email', { email: 'not-an-email' }, '[body.email] Invalid email address'],
    ['an empty email', { email: '' }, '[body.email] Invalid email address'],
    [
      'an email with an issue separator in it',
      { email: 'a; [body.name]@example.com' },
      '[body.email] Invalid email address',
    ],
    // A bad `name` no longer reaches body validation: the before hook answers NAME_INVALID first
    // (#111, 'name bounds'), so these cases use `password` for the issue on another field.
    [
      'a missing password and a malformed email',
      { password: undefined, email: 'bad' },
      '[body.email] Invalid email address; [body.password] Invalid input: expected string, received undefined',
    ],
    [
      'a numeric password',
      { password: 123 as unknown as string },
      '[body.password] Invalid input: expected string, received number',
    ],
  ])('%s: 400 VALIDATION_ERROR with %j, nothing created', async (_, change, message) => {
    const t = setup();
    const { status, json } = await signUp(t, { ...valid(), ...change });
    expect(status).toBe(400);
    expect(json).toEqual({ code: 'VALIDATION_ERROR', message });
    expect((await stored(t)).authUsers).toEqual([]);
  });
});

// #111: while BETTER_AUTH_SECRET is unset or empty, Better Auth would sign with its public default
// secret. createAuth refuses every endpoint instead, with a 503 whose body never names the variable.
describe('auth not configured (#111)', () => {
  const NOT_CONFIGURED = {
    code: 'AUTH_NOT_CONFIGURED',
    message: 'Authentication is not available.',
  };

  /** Every row the refusal must not create: the component's tables and the app's `users`. */
  async function rows(t: T) {
    return t.run(async (ctx) => {
      const all = async (model: 'user' | 'account' | 'session' | 'jwks') =>
        (
          (await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model,
            paginationOpts: { numItems: 100, cursor: null },
          })) as { page: unknown[] }
        ).page;
      return {
        user: await all('user'),
        account: await all('account'),
        session: await all('session'),
        jwks: await all('jwks'),
        users: await ctx.db.query('users').collect(),
      };
    });
  }
  const NO_ROWS = { user: [], account: [], session: [], jwks: [], users: [] };

  async function get(t: T, path: string) {
    const response = await t.fetch(path, { headers: { origin: SITE_URL } });
    const text = await response.text();
    return { status: response.status, text, headers: response.headers };
  }

  describe.each([
    ['unset', undefined],
    ['empty', ''],
  ])('with the secret %s', (_, value) => {
    beforeEach(() => {
      vi.stubEnv('BETTER_AUTH_SECRET', value);
    });

    test('POST /sign-up/email is 503 AUTH_NOT_CONFIGURED and creates and sets nothing', async () => {
      const t = setup();
      const { status, json, headers } = await signUp(t, valid());
      expect(status).toBe(503);
      expect(json).toEqual(NOT_CONFIGURED);
      expect(headers.get('set-cookie')).toBeNull();
      expect(headers.get('set-auth-token')).toBeNull();
      expect(headers.get('set-better-auth-cookie')).toBeNull();
      expect(await rows(t)).toEqual(NO_ROWS);
      // Refused before the password is checked or hashed.
      expect(pwned).not.toHaveBeenCalled();
    });

    test('GET /get-session and GET /convex/token are 503, return no token, and add no jwks row', async () => {
      const t = setup();
      for (const path of ['/api/auth/get-session', '/api/auth/convex/token']) {
        const { status, text } = await get(t, path);
        expect(status, path).toBe(503);
        expect(JSON.parse(text), path).toEqual(NOT_CONFIGURED);
        expect(text, path).not.toContain('token":"');
      }
      expect(await rows(t)).toEqual(NO_ROWS);
    });

    test('the 503 body does not contain the variable name', async () => {
      const t = setup();
      const response = await t.fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: SITE_URL },
        body: JSON.stringify(valid()),
      });
      expect(await response.text()).not.toContain('BETTER_AUTH_SECRET');
    });

    test('an invalid name or a missing adultConfirmed still gets 503, not the other refusals', async () => {
      const t = setup();
      for (const body of [
        { ...valid(), name: '   ' },
        { ...valid(), name: 'x'.repeat(101) },
        { ...valid(), adultConfirmed: undefined },
      ]) {
        const { status, json } = await signUp(t, body);
        expect(status).toBe(503);
        expect(json).toEqual(NOT_CONFIGURED);
      }
      expect(await rows(t)).toEqual(NO_ROWS);
    });

    test('auth.api.signUpEmail rejects with AUTH_NOT_CONFIGURED and creates no row', async () => {
      const t = setup();
      const error = await t.run(async (ctx) => {
        try {
          await createAuth(ctx).api.signUpEmail({ body: valid() as never });
          return null;
        } catch (caught) {
          // An APIError is not a Convex value, so it cannot leave `t.run` as it is.
          const { statusCode, body } = caught as { statusCode: number; body: unknown };
          return { statusCode, body };
        }
      });
      expect(error?.statusCode).toBe(503);
      expect(error?.body).toMatchObject(NOT_CONFIGURED);
      expect(await rows(t)).toEqual(NO_ROWS);
    });

    test('createAuth with an empty context (as registerRoutes calls it) does not throw', () => {
      expect(() => createAuth({} as GenericCtx<DataModel>)).not.toThrow();
    });

    test('logs the cause on the server, never a secret value', async () => {
      const t = setup();
      const logged: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
      await signUp(t, valid());
      expect(logged).toContain('BETTER_AUTH_SECRET is not set');
      vi.restoreAllMocks();
    });
  });

  test('is read on every call: setting the secret afterwards turns auth on again', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', undefined);
    const t = setup();
    expect((await signUp(t, valid())).status).toBe(503);
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
    expect((await signUp(t, valid())).status).toBe(200);
  }, 30_000);

  test('never falls back to the default secret: two unset instances sign differently', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', undefined);
    const secrets = await setup().run(async (ctx) => {
      const contexts = await Promise.all([createAuth(ctx).$context, createAuth(ctx).$context]);
      return contexts.map((context) => context.secret);
    });
    expect(secrets[0]).not.toBe(secrets[1]);
    for (const secret of secrets) {
      expect(secret).not.toBe('better-auth-secret-123456789');
      expect(secret.length).toBeGreaterThanOrEqual(32);
    }
  });
});

// #111: the sign-up hook bounds `name`. The page trims and refuses an empty name; a direct POST
// has to meet the same rule, and what is stored is the trimmed value.
describe('name bounds (#111)', () => {
  test.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['a number', 123],
    ['missing', undefined],
    ['101 characters', 'x'.repeat(101)],
    ['101 characters after trimming', `  ${'x'.repeat(101)}  `],
  ])('a name that is %s is 400 NAME_INVALID and creates nothing', async (_, name) => {
    const t = setup();
    const body = { ...valid(), name } as SignUpBody;
    if (name === undefined) delete body.name;
    const { status, json } = await signUp(t, body);
    expect(status, JSON.stringify(json)).toBe(400);
    expect(json['code']).toBe('NAME_INVALID');
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
  });

  test.each([
    ['100 characters', 'x'.repeat(100)],
    ['100 characters with surrounding spaces', `  ${'x'.repeat(100)}  `],
  ])(
    'a name of %s signs up, stored trimmed',
    async (_, name) => {
      const t = setup();
      const { status, json } = await signUp(t, { ...valid(), name });
      expect(status, JSON.stringify(json)).toBe(200);
      const { authUsers, users } = await stored(t);
      expect(authUsers[0]?.['name']).toBe('x'.repeat(100));
      expect(users[0]?.name).toBe('x'.repeat(100));
    },
    30_000,
  );

  test('a direct POST with "  Ada  " stores "Ada" in the auth user and the users row', async () => {
    const t = setup();
    expect((await signUp(t, { ...valid(), name: '  Ada  ' })).status).toBe(200);
    const { authUsers, users } = await stored(t);
    expect(authUsers[0]?.['name']).toBe('Ada');
    expect(users[0]?.name).toBe('Ada');
  }, 30_000);

  test('an over-long name is NAME_INVALID even with adultConfirmed, and a valid name without it is still ADULT_CONFIRMATION_REQUIRED', async () => {
    const t = setup();
    const long = await signUp(t, { ...valid(), name: 'x'.repeat(101), adultConfirmed: true });
    expect(long.status).toBe(400);
    expect(long.json['code']).toBe('NAME_INVALID');
    const body = { ...valid() };
    delete body.adultConfirmed;
    const unconfirmed = await signUp(t, body);
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.json).toMatchObject(ADULT_CONFIRMATION_REQUIRED);
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
  });
});

// Tester (#111): edge cases the criteria imply, beyond the implementer's cases.
describe('name bounds and refusal, tester probes (#111)', () => {
  test.each([
    ['tabs and newlines only', '\t\n\r '],
    ['no-break and ideographic spaces only', ' 　'],
    ['null', null],
    ['an array', ['Ada']],
    ['an object', { first: 'Ada' }],
    ['a boolean', true],
  ])('a name that is %s is 400 NAME_INVALID and creates nothing', async (_, name) => {
    const t = setup();
    const { status, json } = await signUp(t, { ...valid(), name } as unknown as SignUpBody);
    expect(status, JSON.stringify(json)).toBe(400);
    expect(json['code']).toBe('NAME_INVALID');
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
  });

  test('the length is String.length after trim(): 50 emoji pass, 51 do not', async () => {
    const t = setup();
    const ok = await signUp(t, { ...valid(), name: '\u{1F3D0}'.repeat(50) });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const long = await signUp(t, { ...valid('b@example.com'), name: '\u{1F3D0}'.repeat(51) });
    expect(long.status).toBe(400);
    expect(long.json['code']).toBe('NAME_INVALID');
  }, 30_000);

  test('trimming keeps inner whitespace', async () => {
    const t = setup();
    expect((await signUp(t, { ...valid(), name: ' \tAda  Lovelace\n ' })).status).toBe(200);
    expect((await stored(t)).authUsers[0]?.['name']).toBe('Ada  Lovelace');
  }, 30_000);

  test('two concurrent sign-ups with untrimmed names store trimmed names', async () => {
    const t = setup();
    const [a, b] = await Promise.all([
      signUp(t, { ...valid('a@example.com'), name: '  Ada ' }),
      signUp(t, { ...valid('b@example.com'), name: ' Grace  ' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const names = (await stored(t)).authUsers.map((user) => user['name']).sort();
    expect(names).toEqual(['Ada', 'Grace']);
  }, 30_000);

  test('a bad email with a valid name is still the VALIDATION_ERROR the client maps to the email field', async () => {
    const t = setup();
    const { status, json } = await signUp(t, { ...valid(), email: 'nope' });
    expect(status).toBe(400);
    expect(json['code']).toBe('VALIDATION_ERROR');
    expect(json['message']).toBe('[body.email] Invalid email address');
  });

  test.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"x"'],
    ['empty', ''],
  ])('a sign-up body that is %s is a 4xx and creates nothing', async (_, raw) => {
    const t = setup();
    const response = await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE_URL },
      body: raw,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await stored(t)).toEqual({ authUsers: [], accounts: [], sessions: [], users: [] });
  });

  describe.each([
    ['unset', undefined],
    ['empty', ''],
  ])('with the secret %s, every other route', (_, value) => {
    test.each([
      ['GET', '/api/auth/ok'],
      ['GET', '/api/auth/convex/jwks'],
      ['GET', '/api/auth/jwks'],
      ['POST', '/api/auth/sign-in/email'],
      ['POST', '/api/auth/sign-out'],
      ['POST', '/api/auth/convex/token'],
      ['GET', '/api/auth/get-session'],
    ])(
      '%s %s is 503 AUTH_NOT_CONFIGURED or not found, and writes no row and no cookie',
      async (method, path) => {
        vi.stubEnv('BETTER_AUTH_SECRET', value);
        const t = setup();
        const response = await t.fetch(path, {
          method,
          headers: { 'content-type': 'application/json', origin: SITE_URL },
          ...(method === 'POST'
            ? { body: JSON.stringify({ email: 'a@b.co', password: 'x' }) }
            : {}),
        });
        const text = await response.text();
        expect([503, 404], `${path} ${response.status} ${text}`).toContain(response.status);
        if (response.status === 503)
          expect(JSON.parse(text)).toMatchObject({ code: 'AUTH_NOT_CONFIGURED' });
        expect(text).not.toContain('BETTER_AUTH_SECRET');
        expect(response.headers.get('set-cookie')).toBeNull();
        const rows = await t.run(async (ctx) => {
          const page = async (model: 'user' | 'session' | 'jwks') =>
            (
              (await ctx.runQuery(components.betterAuth.adapter.findMany, {
                model,
                paginationOpts: { numItems: 10, cursor: null },
              })) as { page: unknown[] }
            ).page;
          return [await page('user'), await page('session'), await page('jwks')];
        });
        expect(rows).toEqual([[], [], []]);
      },
    );
  });
});
