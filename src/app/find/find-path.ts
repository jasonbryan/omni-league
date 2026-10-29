import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

export type FindResults = FunctionReturnType<typeof api.search.leagues>;

export type FindResultRow = FindResults['rows'][number];

export type FindOrganizations = FunctionReturnType<typeof api.search.organizations>;

export type FindOrganizationRow = FindOrganizations['rows'][number];

export const FIND_PATH = '/leagues';

/** Built from a page number, an integer, never copied from the current URL. */
export function organizationsPath(page: number): string {
  return page > 1 ? `${FIND_PATH}?page=${page}` : FIND_PATH;
}

/** Built from the parsed search, never copied from the current URL, which can carry other parameters. */
export function findPath(q: string): string {
  return q === '' ? FIND_PATH : `${FIND_PATH}?q=${encodeURIComponent(q)}`;
}
