import { LIST_PAGE_SIZE } from '../core/list-page';

export interface ListPaging {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
}

/** The query counts the rows that have ended since it ran, so the total drops them, and a page left with none keeps its control for the way back. */
export function pagingWithoutDropped(
  paging: ListPaging | undefined,
  rowsRead: number,
  rowsKept: number,
): ListPaging | undefined {
  const dropped = rowsRead - rowsKept;
  if (!paging || dropped === 0) return paging;
  const total = Math.max(
    paging.total - dropped,
    paging.page > 1 ? (paging.page - 1) * LIST_PAGE_SIZE + 1 : 0,
  );
  const pageCount = Math.min(paging.pageCount, Math.ceil(total / LIST_PAGE_SIZE));
  return { page: paging.page, total, pageCount: Math.max(paging.page, pageCount) };
}
