import type { OfflineCause } from './connection';
import { offlineTitle } from './offline-title';

export class ConvexNotConfiguredError extends Error {
  override readonly name = 'ConvexNotConfiguredError';
  constructor() {
    super('Convex URL not configured: set CONVEX_URL (see src/app/core/data/convex/README.md)');
  }
}

export class ConvexServerCallError extends Error {
  override readonly name = 'ConvexServerCallError';
  constructor() {
    super('Convex mutations and actions cannot run during a server render');
  }
}

export class ConvexServerQueryError extends Error {
  override readonly name = 'ConvexServerQueryError';
}

export class ConvexOfflineError extends Error {
  override readonly name = 'ConvexOfflineError';
  constructor(readonly offlineCause: OfflineCause = 'offline') {
    super(offlineTitle(offlineCause));
  }
}
