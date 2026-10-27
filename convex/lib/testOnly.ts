import { v } from 'convex/values';
import { env } from '../_generated/server';

// Refuses unless `IS_TEST` is exactly "true", which only the local e2e backend sets.
export function assertTestDeployment(): void {
  if (env.IS_TEST !== 'true') {
    throw new Error('Test-only function refused: IS_TEST is not "true" on this deployment');
  }
}

// Not in `convex/schema.ts`, so `reset` clears them through the component's adapter.
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

export const authModelValidator = v.union(
  ...AUTH_COMPONENT_TABLES.map((model) => v.literal(model)),
);
