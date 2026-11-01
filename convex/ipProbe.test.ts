import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import { modules } from './test.setup';

const SITE_URL = 'http://localhost:4000';
const FORGED = '203.0.113.9';

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

async function probe(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await setup().fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE_URL, ...headers },
    body: JSON.stringify(body),
  });
  await response.text();
  return response.headers.get('x-ip-probe');
}

const SIGN_IN = { email: 'nobody.here@example.com', password: 'not the password at all' };
// No adult confirmation, so the request guard refuses it and no account is created.
const SIGN_UP = { name: 'Probe', email: 'nobody.here@example.com', password: 'sandbar sunset' };

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('SITE_URL', SITE_URL);
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  vi.stubEnv('IS_TEST', 'true');
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the client-IP probe on a preview', () => {
  test.each([
    ['sign-in/email', SIGN_IN],
    ['sign-up/email', SIGN_UP],
  ])(
    '%s answers with the header value and the address Better Auth resolves',
    async (path, body) => {
      expect(await probe(path, body, { 'cf-connecting-ip': FORGED })).toBe(
        `cf-connecting-ip=${FORGED}; better-auth-ip=${FORGED}`,
      );
    },
  );

  test('a request without the header says so', async () => {
    expect(await probe('sign-in/email', SIGN_IN)).toMatch(
      /^cf-connecting-ip=none; better-auth-ip=/,
    );
  });

  test('other auth paths answer without it', async () => {
    expect(await probe('sign-out', {}, { 'cf-connecting-ip': FORGED })).toBeNull();
  });

  test('off a preview (production, local) no request answers with it', async () => {
    vi.stubEnv('PREVIEW_ORIGIN_PATTERN', undefined);
    expect(await probe('sign-in/email', SIGN_IN, { 'cf-connecting-ip': FORGED })).toBeNull();
  });
});
