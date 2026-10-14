import type { Params } from '@angular/router';

/** Rows per page of a numbered list: `PUBLIC_LIST_PAGE_SIZE` in convex/organizations.ts. */
export const LIST_PAGE_SIZE = 5;

/**
 * Read from every value of the query parameter (`getAll`, never `get`), so a repeated or malformed `page` is page 1. Shared by the server render
 * and the browser, so both compute the same query args, and the only value the URL contributes to the HTML is an integer taken from the query result,
 * never the raw string.
 */
export function parseListPage(values: readonly string[]): number {
  if (values.length !== 1) return 1;
  const [value] = values;
  return /^[1-9][0-9]{0,2}$/.test(value) ? Number(value) : 1;
}

export function listPageQuery(page: number): Params {
  return page > 1 ? { page } : {};
}
