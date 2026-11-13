import { FakeAuthClient } from './testing/fake-auth-client';
import type { AuthClientLike } from './auth-client';
import {
  requestSignIn,
  requestSignUp,
  type SignInResult,
  type SignUpFailure,
} from './password-auth';

const INPUT = {
  name: 'Maya Okafor',
  email: 'maya.okafor@example.com',
  password: 'sandbar sunset spike 2026',
};

describe('password-auth', () => {
  let fake: FakeAuthClient;
  const client = () => fake as unknown as AuthClientLike;

  beforeEach(() => {
    fake = new FakeAuthClient();
  });

  describe('requestSignUp', () => {
    it('sends the 18+ confirmation with the trimmed email, and answers ok', async () => {
      await expect(
        requestSignUp(client(), { ...INPUT, email: '  maya.okafor@example.com ' }),
      ).resolves.toEqual({ ok: true });
      expect(fake.signUps).toEqual([{ ...INPUT, adultConfirmed: true }]);
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
      // Better Auth answers a malformed email with its body-validation error.
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
      [
        '429 from the per-IP limit',
        { status: 429, message: 'Too many requests. Please try again later.' },
        'rate-limited',
      ],
      ['429 without a body', { status: 429 }, 'rate-limited'],
      ['429 with a code', { status: 429, code: 'TOO_MANY_ATTEMPTS' }, 'rate-limited'],
      ['500 other', { status: 500, message: 'boom' }, 'unexpected'],
    ])('maps %s to %s', async (_, error, expected) => {
      fake.nextSignUpError = error;
      await expect(requestSignUp(client(), INPUT)).resolves.toEqual({ ok: false, error: expected });
    });

    it('maps a network failure to unexpected', async () => {
      fake.signUpThrows = new TypeError('Failed to fetch');
      await expect(requestSignUp(client(), INPUT)).resolves.toEqual({
        ok: false,
        error: 'unexpected',
      });
    });
  });

  describe('requestSignIn', () => {
    const CREDENTIALS = { email: 'maya.okafor@example.com', password: 'sandbar sunset spike 2026' };

    it('sends the trimmed email and the password, and answers ok', async () => {
      await expect(
        requestSignIn(client(), { ...CREDENTIALS, email: '  maya.okafor@example.com ' }),
      ).resolves.toEqual({ ok: true });
      expect(fake.signIns).toEqual([CREDENTIALS]);
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
        '400 over-length password, answered before the address is looked up',
        { status: 400, code: 'PASSWORD_TOO_LONG', message: 'Password too long' },
        { ok: false, error: 'incorrect' },
      ],
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
      [
        '429 from the per-IP limit',
        { status: 429, message: 'Too many requests. Please try again later.' },
        { ok: false, error: 'rate-limited' },
      ],
      ['429 without a body', { status: 429 }, { ok: false, error: 'rate-limited' }],
      [
        '429 with another code',
        { status: 429, code: 'SOMETHING_ELSE' },
        { ok: false, error: 'rate-limited' },
      ],
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
      fake.nextSignInError = error;
      await expect(requestSignIn(client(), CREDENTIALS)).resolves.toEqual(expected);
    });

    it('maps a network failure to unexpected', async () => {
      fake.signInThrows = new TypeError('Failed to fetch');
      await expect(requestSignIn(client(), CREDENTIALS)).resolves.toEqual({
        ok: false,
        error: 'unexpected',
      });
    });
  });
});
