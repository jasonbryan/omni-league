// Public surface of the Convex adapter (ADR 0006). Code outside this folder imports only from here.
export {
  CONVEX_AUTH,
  CONVEX_CLIENT,
  CONVEX_CLIENT_FACTORY,
  provideConvex,
  type ConvexAuthSource,
  type ConvexClientLike,
} from './convex-client';
export { CONVEX_URL } from './convex-url';
export { ConvexNotConfiguredError, ConvexServerCallError } from './errors';
export { injectAction, injectMutation, type CallRef } from './inject-call';
export { injectQuery, skipToken, type QueryRef, type SkipToken } from './inject-query';
