// Better Auth through the Convex component (ADR 0008 "Server configuration", #62).
//
// Email + password sign-up (#62) and sign-in with the per-address throttle (#63). No Google (later
// slice), and no email verification or password reset (#26).
import { type AuthFunctions, createClient, type GenericCtx } from '@convex-dev/better-auth';
import type { GenericActionCtx } from 'convex/server';
import { convex, crossDomain } from '@convex-dev/better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { betterAuth } from 'better-auth/minimal';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { env } from './_generated/server';
import authConfig from './auth.config';
import { trustedOrigins } from './lib/authOrigins';
import { hashPassword, verifyPassword } from './lib/password';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { throttleKey, tooManyAttemptsMessage } from './lib/signInThrottle';
import { deleteUserRecord, insertUserRecord } from './lib/users';

/** The sign-up body field that carries the 18+ confirmation; it must be exactly `true`. */
export const ADULT_CONFIRMATION_FIELD = 'adultConfirmed';

/** The error a sign-up without the 18+ confirmation gets (HTTP 400). */
export const ADULT_CONFIRMATION_REQUIRED = {
  code: 'ADULT_CONFIRMATION_REQUIRED',
  message: 'Confirm that you are 18 or older to create an account.',
} as const;

/** The approved breached-password text (design/mockups/62-sign-up.html, "Messages"). */
export const PASSWORD_COMPROMISED_MESSAGE =
  'This password has appeared in a data breach, so it is not safe to use. Choose a different one.';

const DAY_SECONDS = 60 * 60 * 24;

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      // Runs inside the component's create mutation, so a throw here also undoes the auth user.
      onCreate: async (ctx, authUser) => {
        await insertUserRecord(ctx, { authUserId: authUser._id, name: authUser.name });
      },
      onDelete: async (ctx, authUser) => {
        await deleteUserRecord(ctx, authUser._id);
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

/** The longest sign-up `name`, in `String.length` units after `trim()` (as the page counts). */
export const NAME_MAX_LENGTH = 100;

/** The error a sign-up with a missing, blank, or over-long name gets (HTTP 400). */
export const NAME_INVALID = {
  code: 'NAME_INVALID',
  message: 'Enter a name of 1 to 100 characters.',
} as const;

/** The error every endpoint gets while `BETTER_AUTH_SECRET` is unset or empty (HTTP 503). */
export const AUTH_NOT_CONFIGURED = {
  code: 'AUTH_NOT_CONFIGURED',
  message: 'Authentication is not available.',
} as const;

/** The 429 a sign-in gets inside an address's wait, even with the correct password (HTTP 429). */
export const TOO_MANY_ATTEMPTS_CODE = 'TOO_MANY_ATTEMPTS';

/** The 429 a sign-in gets once an address has reached the hard limit (HTTP 429). */
export const SIGN_IN_LOCKED = {
  code: 'SIGN_IN_LOCKED',
  message: 'Password sign-in is locked for this email address.',
} as const;

/**
 * A secret for one `createAuth` call while `BETTER_AUTH_SECRET` is unset. Better Auth would
 * otherwise sign with its public default secret. Nothing signed with this value outlives the call,
 * and the guard below refuses every request, so nothing is signed with it at all.
 */
function placeholderSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The email of a sign-in body, or `null` when it holds none (Better Auth then answers 400). */
function emailOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const email = (body as Record<string, unknown>)['email'];
  return typeof email === 'string' ? email : null;
}

/**
 * The hooks' function context as an action context. Sign-in is served by an HTTP action, whose
 * context can run a mutation. A query context cannot, and the throttle must not be skipped, so the
 * hook fails the sign-in instead.
 */
function mutationRunner(ctx: GenericCtx<DataModel>): GenericActionCtx<DataModel> {
  if (!('runMutation' in ctx)) {
    throw new Error('The sign-in throttle needs a context with runMutation');
  }
  return ctx as GenericActionCtx<DataModel>;
}

/**
 * Starts the sign-in attempt in the per-address throttle (ADR 0008 "Rate limits and lockout"),
 * and refuses it with 429 while the address waits or is locked, even for the correct password.
 * Unknown addresses are counted and answered the same way. A body with no string `email` is left
 * to Better Auth's own 400.
 */
async function beginSignIn(ctx: GenericCtx<DataModel>, body: unknown): Promise<void> {
  const email = emailOf(body);
  if (email === null) return;
  const key = await throttleKey(email);
  const result = await mutationRunner(ctx).runMutation(internal.signInThrottle.begin, { key });
  if (result.status === 'locked') {
    throw APIError.from('TOO_MANY_REQUESTS', SIGN_IN_LOCKED);
  }
  if (result.status === 'throttled') {
    const { retryAfterSeconds } = result;
    throw new APIError(
      'TOO_MANY_REQUESTS',
      {
        code: TOO_MANY_ATTEMPTS_CODE,
        message: tooManyAttemptsMessage(retryAfterSeconds),
        retryAfterSeconds,
      },
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }
}

/**
 * Probe for ADR 0008 "Rate limits and lockout" (#63), on a preview only: logs the
 * `cf-connecting-ip` header of a sign-in or sign-up request, so the owner can read in the Convex
 * logs whether it carries the caller's address and ignores a forged one. Removed before the PR is
 * marked ready.
 */
function probeClientIp(path: string, headers: Headers | undefined): void {
  if (env.PREVIEW_ORIGIN_PATTERN !== PREVIEW_ORIGIN_PATTERN) return;
  if (path !== '/sign-in/email' && path !== '/sign-up/email') return;
  const value = headers?.get('cf-connecting-ip')?.slice(0, 100) ?? 'none';
  console.log(`[ip-probe] ${path.slice(1)} cf-connecting-ip=${value}`);
}

/**
 * The `before` hook for every endpoint, over HTTP and through `auth.api.*`, so a direct request
 * cannot skip it. In order:
 * 1. While the secret is unset (`configured` false), refuses with 503 AUTH_NOT_CONFIGURED. The body
 *    never names the variable; the server log does. It runs first, so it also wins over the
 *    sign-up checks.
 * 2. On a preview, logs `cf-connecting-ip` for sign-in and sign-up (`probeClientIp`).
 * 3. On `/sign-in/email`, starts the attempt in the per-address throttle (`beginSignIn`).
 * 4. On `/sign-up/email`, refuses a `name` that is not a string, is blank, or is longer than
 *    NAME_MAX_LENGTH after `trim()` (NAME_INVALID). The stored name is the trimmed one
 *    (`databaseHooks` in createAuth): a before hook cannot change the body, because the plugins'
 *    before hooks return the original context, which replaces the change.
 * 5. On `/sign-up/email`, refuses a body whose `adultConfirmed` is not `true` (accounts are adults
 *    only, ADR 0008 "Ages"). Better Auth ignores the field itself.
 */
function requestGuard(configured: boolean, fnCtx: GenericCtx<DataModel>) {
  return createAuthMiddleware((ctx) => {
    if (!configured) {
      console.error('BETTER_AUTH_SECRET is not set');
      return Promise.reject(APIError.from('SERVICE_UNAVAILABLE', AUTH_NOT_CONFIGURED));
    }
    probeClientIp(ctx.path, ctx.headers);
    if (ctx.path === '/sign-in/email') return beginSignIn(fnCtx, ctx.body);
    if (ctx.path !== '/sign-up/email') return Promise.resolve();
    const body: unknown = ctx.body;
    const fields =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const name = typeof fields['name'] === 'string' ? fields['name'].trim() : '';
    if (name === '' || name.length > NAME_MAX_LENGTH) {
      return Promise.reject(APIError.from('BAD_REQUEST', NAME_INVALID));
    }
    if (fields[ADULT_CONFIRMATION_FIELD] !== true) {
      return Promise.reject(APIError.from('BAD_REQUEST', ADULT_CONFIRMATION_REQUIRED));
    }
    return Promise.resolve();
  });
}

/**
 * The `after` hook: a sign-in that returned a session deletes its address's failure row. Any error
 * answer leaves the row as `beginSignIn` counted it. A failure to delete is logged (without the
 * address) and swallowed: the session exists, and a stale count only makes the next failures
 * count from where they were.
 */
function afterSignIn(fnCtx: GenericCtx<DataModel>) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/sign-in/email') return;
    const returned: unknown = ctx.context.returned;
    if (typeof returned !== 'object' || returned === null || returned instanceof Error) return;
    const email = emailOf(ctx.body);
    if (email === null) return;
    try {
      const key = await throttleKey(email);
      await mutationRunner(fnCtx).runMutation(internal.signInThrottle.clear, { key });
    } catch {
      console.error('The sign-in throttle could not clear a failure row');
    }
  });
}

/**
 * The Better Auth instance for one Convex function call. `registerRoutes` also calls it once with
 * an empty context at module load, to read the static options.
 */
export function createAuth(ctx: GenericCtx<DataModel>) {
  const siteUrl = env.SITE_URL ?? '';
  // Read on every call, never at module load. Unset or empty: see requestGuard.
  const secret = env.BETTER_AUTH_SECRET;
  const configured = secret !== undefined && secret !== '';
  const isTest = env.IS_TEST === 'true';
  return betterAuth({
    baseURL: env.CONVEX_SITE_URL,
    secret: configured ? secret : placeholderSecret(),
    database: authComponent.adapter(ctx),
    trustedOrigins: (request) =>
      trustedOrigins(request, {
        SITE_URL: env.SITE_URL,
        PREVIEW_ORIGIN_PATTERN: env.PREVIEW_ORIGIN_PATTERN,
      }),
    session: { expiresIn: 7 * DAY_SECONDS, updateAge: DAY_SECONDS },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    account: { accountLinking: { enabled: true, trustedProviders: [] } },
    user: { deleteUser: { enabled: true } },
    // Ships off (#62): #63 runs ADR 0008's `cf-connecting-ip` probe and turns it on (`!IS_TEST`)
    // only if the probe passes. A shared bucket would block everyone after three sign-ups in 10 s.
    rateLimit: { enabled: false, storage: 'database' },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // Explicit, because Better Auth skips the origin check by default whenever NODE_ENV is
      // "test" or TEST is set; no environment variable may turn it off on a deployment.
      disableOriginCheck: false,
    },
    hooks: { before: requestGuard(configured, ctx), after: afterSignIn(ctx) },
    databaseHooks: {
      user: {
        // A direct POST cannot store leading or trailing whitespace in a name (NAME_INVALID covers
        // the rest). Runs inside the sign-up, before the user.onCreate trigger copies the name.
        create: {
          before: (user) => Promise.resolve({ data: { ...user, name: user.name.trim() } }),
        },
      },
    },
    plugins: [
      // Fails closed: an unreachable API refuses the sign-up. Off under IS_TEST, so e2e makes no
      // outside call; convex/auth.test.ts covers it with a mocked fetch.
      haveIBeenPwned({
        enabled: !isTest,
        customPasswordCompromisedMessage: PASSWORD_COMPROMISED_MESSAGE,
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  });
}
