import { pagingWithoutDropped } from './list-paging';

describe('pagingWithoutDropped', () => {
  it('is the paging the query gave while no row was dropped', () => {
    const paging = { page: 1, pageCount: 2, total: 7 };
    expect(pagingWithoutDropped(paging, 5, 5)).toBe(paging);
    expect(pagingWithoutDropped(undefined, 5, 4)).toBeUndefined();
  });

  it('takes the dropped rows off the total and the page count', () => {
    expect(pagingWithoutDropped({ page: 1, pageCount: 2, total: 7 }, 5, 3)).toEqual({
      page: 1,
      pageCount: 1,
      total: 5,
    });
  });

  it('keeps the way back on a later page left with no row', () => {
    expect(pagingWithoutDropped({ page: 2, pageCount: 2, total: 7 }, 2, 0)).toEqual({
      page: 2,
      pageCount: 2,
      total: 6,
    });
  });
});
