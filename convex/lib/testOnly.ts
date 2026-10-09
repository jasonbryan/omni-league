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
