export const PUBLIC_LIST_PAGE_SIZE = 5;

// Caps one call at 200 rows whatever the args.
export const PUBLIC_LIST_MAX_PAGE = 40;

export function pageOf(total: number, requested: number): { page: number; pageCount: number } {
  const pageCount = Math.min(Math.ceil(total / PUBLIC_LIST_PAGE_SIZE), PUBLIC_LIST_MAX_PAGE);
  const page =
    Number.isInteger(requested) && requested >= 1 && requested <= pageCount ? requested : 1;
  return { page, pageCount };
}

export function pageRows<D>(read: D[], page: number): D[] {
  return read.slice((page - 1) * PUBLIC_LIST_PAGE_SIZE);
}
