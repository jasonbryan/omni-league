export const PUBLIC_LIST_PAGE_SIZE = 5;

export const PUBLIC_LIST_MAX_ROWS = 200;

export const PUBLIC_LIST_MAX_PAGE = PUBLIC_LIST_MAX_ROWS / PUBLIC_LIST_PAGE_SIZE;

export function pageOf(total: number, requested: number): { page: number; pageCount: number } {
  const pageCount = Math.min(Math.ceil(total / PUBLIC_LIST_PAGE_SIZE), PUBLIC_LIST_MAX_PAGE);
  const page =
    Number.isInteger(requested) && requested >= 1 && requested <= pageCount ? requested : 1;
  return { page, pageCount };
}

export function pageRows<D>(read: D[], page: number): D[] {
  return read.slice((page - 1) * PUBLIC_LIST_PAGE_SIZE);
}
