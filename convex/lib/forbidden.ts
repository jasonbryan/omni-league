// Imports only `convex/values`, so the app can tell it from a failed query without the server code.
// Convex shows a client only a `ConvexError`'s data, never a plain error's message.
import { ConvexError } from 'convex/values';

export const FORBIDDEN_CODE = 'FORBIDDEN';

export function forbidden(): ConvexError<{ code: typeof FORBIDDEN_CODE }> {
  return new ConvexError({ code: FORBIDDEN_CODE });
}

export function isForbidden(failure: unknown): boolean {
  if (!(failure instanceof ConvexError)) return false;
  const data: unknown = failure.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === FORBIDDEN_CODE
  );
}
