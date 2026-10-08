import { v } from 'convex/values';
import { internalQuery } from './_generated/server';

/** Internal liveness probe; exists to prove the Convex test runner works (#10). */
export const ping = internalQuery({
  args: {},
  returns: v.literal('ok'),
  handler: () => 'ok' as const,
});
