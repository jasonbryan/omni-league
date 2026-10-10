// Public surface of the Convex adapter (ADR 0006). Code outside this folder imports only from here.
export { CONVEX_CLIENT, type ConvexClientLike } from './client-token';
export {
  CONVEX_AUTH,
  CONVEX_CLIENT_FACTORY,
  provideConvex,
  type ConvexAuthSource,
} from './convex-client';
export { CONVEX_URL } from './convex-url';
export {
  ConvexNotConfiguredError,
  ConvexOfflineError,
  ConvexServerCallError,
  ConvexServerQueryError,
} from './errors';
export { injectOnline } from './connection';
export { injectAction, injectMutation, type CallRef } from './inject-call';
export { injectQuery, skipToken, type QueryRef, type SkipToken } from './inject-query';
export {
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_SERVER_QUERY_TIMEOUT_MS,
  type ConvexHttpClientLike,
} from './server-query-loader';
