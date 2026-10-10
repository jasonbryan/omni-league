/** No Convex URL was configured at build time (CI, e2e build, fresh clone). */
export class ConvexNotConfiguredError extends Error {
  override readonly name = 'ConvexNotConfiguredError';
  constructor() {
    super('Convex URL not configured: set CONVEX_URL (see src/app/core/data/convex/README.md)');
  }
}

/** A mutation or action was called during a server render, where none may run. */
export class ConvexServerCallError extends Error {
  override readonly name = 'ConvexServerCallError';
  constructor() {
    super('Convex mutations and actions cannot run during a server render');
  }
}

/**
 * Browser-side stand-in for a query that failed during the server render. Its message is the fixed
 * text from the transferred marker, never the server's real error.
 */
export class ConvexServerQueryError extends Error {
  override readonly name = 'ConvexServerQueryError';
}

/**
 * A mutation or action was refused because the app had no usable connection when it was called
 * and none came back within the adapter's wait (ADR 0013, Decision 3A). The Convex client was
 * never called, so nothing was queued and nothing is sent later.
 */
export class ConvexOfflineError extends Error {
  override readonly name = 'ConvexOfflineError';
  constructor() {
    super("You're offline. Nothing was sent.");
  }
}
