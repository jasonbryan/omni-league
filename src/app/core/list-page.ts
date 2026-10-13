import type { Params } from '@angular/router';

/** Rows per page of a numbered list (owner, #106): `PUBLIC_LIST_PAGE_SIZE` in convex/organizations.ts. */
export const LIST_PAGE_SIZE = 5;

/**
 * The page a numbered list asks for, read from every value of its query parameter
 * (`queryParamMap.getAll('page')`, never `get`): N when the parameter appears exactly once and is a
 * canonical whole number of at most three digits (`^[1-9][0-9]{0,2}$`), and 1 in every other case
 * (absent, repeated, `0`, `02`, `2.5`, `abc`, empty, four digits or more). The query then serves
 * the effective page: page 1 for a page past the last or past the cap (#127, as #103). Shared by
 * the server render and the browser, so both compute the same query args, and the only value the
 * URL contributes to the HTML is an integer taken from the query result, never the raw string.
 */
export function parseListPage(values: readonly string[]): number {
  if (values.length !== 1) return 1;
  const [value] = values;
  return /^[1-9][0-9]{0,2}$/.test(value) ? Number(value) : 1;
}

/**
 * The query parameters of the link to `page`: none for page 1 (its URL is the bare path, as the
 * canonical is), `page` for a later one. Used by the page control's links and the canonical.
 */
export function listPageQuery(page: number): Params {
  return page > 1 ? { page } : {};
}
