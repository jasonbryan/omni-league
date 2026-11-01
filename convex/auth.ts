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
import { throttleKey, tooManyAttemptsMessage } from './lib/signInThrottle';
import { MAX_USER_NAME_LENGTH } from './lib/userName';
import { deleteUserRecord, insertUserRecord } from './lib/users';

export const ADULT_CONFIRMATION_FIELD = 'adultConfirmed';

export const ADULT_CONFIRMATION_REQUIRED = {
  code: 'ADULT_CONFIRMATION_REQUIRED',
  message: 'Confirm that you are 18 or older to create an account.',
} as const;

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

export const NAME_INVALID = {
  code: 'NAME_INVALID',
  message: 'Enter a name of 1 to 100 characters.',
} as const;

export const AUTH_NOT_CONFIGURED = {
  code: 'AUTH_NOT_CONFIGURED',
  message: 'Authentication is not available.',
} as const;

export const TOO_MANY_ATTEMPTS_CODE = 'TOO_MANY_ATTEMPTS';

export const SIGN_IN_LOCKED = {
  code: 'SIGN_IN_LOCKED',
  message: 'Password sign-in is locked for this email address.',
} as const;

// Better Auth would otherwise sign with its public default secret. The request guard refuses every
// request while the secret is unset, so nothing is signed with this value.
function placeholderSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function emailOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const email = (body as Record<string, unknown>)['email'];
  return typeof email === 'string' ? email : null;
}

// Sign-in is served by an HTTP action, whose context can run a mutation. A query context cannot, and
// the throttle must not be skipped.
function mutationRunner(ctx: GenericCtx<DataModel>): GenericActionCtx<DataModel> {
  if (!('runMutation' in ctx)) {
    throw new Error('The sign-in throttle needs a context with runMutation');
  }
  return ctx as GenericActionCtx<DataModel>;
}

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

function requestGuard(configured: boolean, fnCtx: GenericCtx<DataModel>) {
  return createAuthMiddleware((ctx) => {
    if (!configured) {
      // The response does not name the variable; only the log does.
      console.error('BETTER_AUTH_SECRET is not set');
      return Promise.reject(APIError.from('SERVICE_UNAVAILABLE', AUTH_NOT_CONFIGURED));
    }
    if (ctx.path === '/sign-in/email') return beginSignIn(fnCtx, ctx.body);
    if (ctx.path !== '/sign-up/email') return Promise.resolve();
    const body: unknown = ctx.body;
    const fields =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const name = typeof fields['name'] === 'string' ? fields['name'].trim() : '';
    if (name === '' || name.length > MAX_USER_NAME_LENGTH) {
      return Promise.reject(APIError.from('BAD_REQUEST', NAME_INVALID));
    }
    // Better Auth ignores this field itself.
    if (fields[ADULT_CONFIRMATION_FIELD] !== true) {
      return Promise.reject(APIError.from('BAD_REQUEST', ADULT_CONFIRMATION_REQUIRED));
    }
    return Promise.resolve();
  });
}

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
      // The session exists, and a stale count only makes the next failures count from where they were.
      console.error('The sign-in throttle could not clear a failure row');
    }
  });
}

// `registerRoutes` also calls this once at module load with an empty context, to read the static
// options.
export function createAuth(ctx: GenericCtx<DataModel>) {
  const siteUrl = env.SITE_URL ?? '';
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
    // A shared bucket would block everyone after three sign-ups in 10 s until the header is known to
    // carry the caller's address.
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
        // A before hook cannot change the body (the plugins' before hooks return the original
        // context), so the name is trimmed here, before the `user.onCreate` trigger copies it.
        create: {
          before: (user) => Promise.resolve({ data: { ...user, name: user.name.trim() } }),
        },
      },
    },
    plugins: [
      // Fails closed: an unreachable API refuses the sign-up. Off under IS_TEST, so e2e makes no
      // outside call.
      haveIBeenPwned({
        enabled: !isTest,
        customPasswordCompromisedMessage: PASSWORD_COMPROMISED_MESSAGE,
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  });
}
