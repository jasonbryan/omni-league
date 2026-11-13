import type { AuthClientLike } from './auth-client';

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

export async function requestSignUp(
  client: AuthClientLike,
  { name, email, password }: SignUpInput,
): Promise<SignUpResult> {
  let error: AuthError | null;
  try {
    // `adultConfirmed` is this app's field, which Better Auth's types do not know.
    const body = { name, email: email.trim(), password, adultConfirmed: true };
    ({ error } = await client.signUp.email(body));
  } catch {
    return { ok: false, error: 'unexpected' };
  }
  if (error) return { ok: false, error: failureOf(error) };
  return { ok: true };
}

export async function requestSignIn(
  client: AuthClientLike,
  { email, password }: SignInInput,
): Promise<SignInResult> {
  let error: AuthError | null;
  try {
    ({ error } = await client.signIn.email({ email: email.trim(), password }));
  } catch {
    return { ok: false, error: 'unexpected' };
  }
  if (error) return signInFailureOf(error);
  return { ok: true };
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
  // Sign-up refuses a password over 128 characters, so no account has one: it is a wrong password.
  if (error.status === 401 || error.code === 'PASSWORD_TOO_LONG') {
    return { ok: false, error: 'incorrect' };
  }
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
