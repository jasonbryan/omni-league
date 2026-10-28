import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

export type FindResults = FunctionReturnType<typeof api.search.leagues>;

export type FindResultRow = FindResults['rows'][number];

export const FIND_PATH = '/leagues';

/** Built from the parsed search, never copied from the current URL, which can carry other parameters. */
export function findPath(q: string): string {
  return q === '' ? FIND_PATH : `${FIND_PATH}?q=${encodeURIComponent(q)}`;
}
