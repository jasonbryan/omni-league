// Better Auth through the Convex component (ADR 0008 "Server configuration", #62).
//
// Email + password sign-up only in this slice: no Google (later slice), no email verification or
// password reset (#26), and the per-address sign-in throttle arrives with #63.
import { type AuthFunctions, createClient, type GenericCtx } from '@convex-dev/better-auth';
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

/**
 * A secret for one `createAuth` call while `BETTER_AUTH_SECRET` is unset. Better Auth would
 * otherwise sign with its public default secret. Nothing signed with this value outlives the call,
 * and the guard below refuses every request, so nothing is signed with it at all.
 */
function placeholderSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The `before` hook for every endpoint, over HTTP and through `auth.api.*`, so a direct request
 * cannot skip it. In order:
 * 1. While the secret is unset (`configured` false), refuses with 503 AUTH_NOT_CONFIGURED. The body
 *    never names the variable; the server log does. It runs first, so it also wins over the
 *    sign-up checks.
 * 2. On `/sign-up/email`, refuses a `name` that is not a string, is blank, or is longer than
 *    NAME_MAX_LENGTH after `trim()` (NAME_INVALID). The stored name is the trimmed one
 *    (`databaseHooks` in createAuth): a before hook cannot change the body, because the plugins'
 *    before hooks return the original context, which replaces the change.
 * 3. On `/sign-up/email`, refuses a body whose `adultConfirmed` is not `true` (accounts are adults
 *    only, ADR 0008 "Ages"). Better Auth ignores the field itself.
 */
function requestGuard(configured: boolean) {
  return createAuthMiddleware((ctx) => {
    if (!configured) {
      console.error('BETTER_AUTH_SECRET is not set');
      return Promise.reject(APIError.from('SERVICE_UNAVAILABLE', AUTH_NOT_CONFIGURED));
    }
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
    hooks: { before: requestGuard(configured) },
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
