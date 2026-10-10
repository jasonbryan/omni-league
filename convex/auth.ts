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

/**
 * Refuses `/sign-up/email` unless the body's `adultConfirmed` is `true` (accounts are adults only,
 * ADR 0008 "Ages"). It runs for HTTP requests and for server-side `auth.api.signUpEmail` calls, so
 * a direct `POST /api/auth/sign-up/email` cannot skip it. Better Auth ignores the field itself.
 */
const requireAdultConfirmation = createAuthMiddleware((ctx) => {
  if (ctx.path !== '/sign-up/email') return Promise.resolve();
  const body: unknown = ctx.body;
  const confirmed =
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>)[ADULT_CONFIRMATION_FIELD] === true;
  return confirmed
    ? Promise.resolve()
    : Promise.reject(APIError.from('BAD_REQUEST', ADULT_CONFIRMATION_REQUIRED));
});

/**
 * The Better Auth instance for one Convex function call. `registerRoutes` also calls it once with
 * an empty context at module load, to read the static options.
 */
export function createAuth(ctx: GenericCtx<DataModel>) {
  const siteUrl = env.SITE_URL ?? '';
  const isTest = env.IS_TEST === 'true';
  return betterAuth({
    baseURL: env.CONVEX_SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
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
    hooks: { before: requireAdultConfirmation },
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
