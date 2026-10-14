import { v } from 'convex/values';
import { internalQuery } from './_generated/server';

export const ping = internalQuery({
  args: {},
  returns: v.literal('ok'),
  handler: () => 'ok' as const,
});
