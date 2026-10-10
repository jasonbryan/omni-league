import { env } from '../_generated/server';

/**
 * The shared guard every function in `convex/testing.ts` calls first: it throws unless `IS_TEST`
 * is exactly "true", which only the local e2e backend sets (ADR 0005, #59).
 */
export function assertTestDeployment(): void {
  if (env.IS_TEST !== 'true') {
    throw new Error('Test-only function refused: IS_TEST is not "true" on this deployment');
  }
}

/**
 * The Better Auth component's tables (`@convex-dev/better-auth` 0.12). They are not in
 * `convex/schema.ts`, so `reset` clears them through the component's adapter. `convex/testingAuth.test.ts`
 * checks this list against the component's schema, so a component upgrade that adds a table fails
 * there.
 */
export const AUTH_COMPONENT_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'twoFactor',
  'oauthApplication',
  'oauthAccessToken',
  'oauthConsent',
  'jwks',
  'rateLimit',
] as const;
