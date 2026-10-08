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
