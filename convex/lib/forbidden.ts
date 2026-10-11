// The `ConvexError` an admin-area query throws for a caller who may not open it (#65). Imports only
// `convex/values`, so the app tells it from a failed query without the server code (convex.md,
// Functions). Convex shows a client only a `ConvexError`'s data, never a plain error's message.
import { ConvexError } from 'convex/values';

/** The `code` in the data of the error that means "signed in or not, you may not manage this". */
export const FORBIDDEN_CODE = 'FORBIDDEN';

/** The error to throw: `ConvexError({ code: 'FORBIDDEN' })`. */
export function forbidden(): ConvexError<{ code: typeof FORBIDDEN_CODE }> {
  return new ConvexError({ code: FORBIDDEN_CODE });
}

/** Whether `failure` is the error `forbidden()` makes. */
export function isForbidden(failure: unknown): boolean {
  if (!(failure instanceof ConvexError)) return false;
  const data: unknown = failure.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === FORBIDDEN_CODE
  );
}
