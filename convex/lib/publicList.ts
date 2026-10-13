// The paging rules of every public list (#100, #127): 5 rows a page, at most 40 pages, and the
// effective-page rule. `organizations.ts` (locations, leagues) and `seasons.ts` (a league's
// seasons) share them from here, so function modules do not import each other.

/** Rows per page of a public list (owner, #106). Never taken from args. */
export const PUBLIC_LIST_PAGE_SIZE = 5;

/**
 * The last page a public list serves, so one call reads at most 200 rows
 * (`PUBLIC_LIST_MAX_PAGE * PUBLIC_LIST_PAGE_SIZE`) whatever the args. Never taken from args.
 */
export const PUBLIC_LIST_MAX_PAGE = 40;

/**
 * The page to serve and the number of pages, for a list of `total` rows. The requested page is
 * served when it is a whole number from 1 to the page count, and page 1 in every other case (0,
 * negative, fractional, `NaN`, past the last page, past `PUBLIC_LIST_MAX_PAGE`): the approved
 * mockup's rule (#106). So `page * PUBLIC_LIST_PAGE_SIZE` is at most 200.
 */
export function pageOf(total: number, requested: number): { page: number; pageCount: number } {
  const pageCount = Math.min(Math.ceil(total / PUBLIC_LIST_PAGE_SIZE), PUBLIC_LIST_MAX_PAGE);
  const page =
    Number.isInteger(requested) && requested >= 1 && requested <= pageCount ? requested : 1;
  return { page, pageCount };
}

/** The rows of `page` out of the first `page * PUBLIC_LIST_PAGE_SIZE` rows read. */
export function pageRows<D>(read: D[], page: number): D[] {
  return read.slice((page - 1) * PUBLIC_LIST_PAGE_SIZE);
}
