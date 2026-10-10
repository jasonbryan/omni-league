import type { FunctionReference } from 'convex/server';
import { api } from '../../../../../convex/_generated/api';

/**
 * The queries whose live results the browser keeps as saved copies (ADR 0013 section 3, #82).
 *
 * A query is listed only if it is deliberately public (no `ctx.auth` check, Convex conventions,
 * Functions) and its result does not depend on the caller, so a saved copy never holds signed-in
 * or per-user data, whoever was signed in when it was written. A query that reads the caller's
 * identity, or ever may, is never listed. Each public page adds its own query in its own issue
 * (schedules, standings).
 */
export const OFFLINE_SAVED_QUERIES: readonly FunctionReference<'query'>[] = [
  api.organizations.getPublicPage,
];
