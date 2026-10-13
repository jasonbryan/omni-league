import { listPageQuery, parseListPage } from './list-page';

describe('parseListPage', () => {
  it.each([
    [[], 1],
    [['0'], 1],
    [['-1'], 1],
    [['2.5'], 1],
    [['02'], 1],
    [['1e1'], 1],
    [['abc'], 1],
    [[''], 1],
    [[' 2'], 1],
    [['2 '], 1],
    [['+2'], 1],
    [['١٢'], 1],
    [['1000'], 1],
    [['2', '3'], 1],
    [['2', '2'], 1],
    [['9999999999999999999999'], 1],
    [['2\n'], 1],
    [['1'], 1],
    [['2'], 2],
    [['3'], 3],
    [['40'], 40],
    [['41'], 41],
    [['999'], 999],
  ])('reads %j as %i', (values, expected) => {
    expect(parseListPage(values)).toBe(expected);
  });
});

describe('listPageQuery', () => {
  it('has no page for page 1 and the page number above it', () => {
    expect(listPageQuery(1)).toEqual({});
    expect(listPageQuery(2)).toEqual({ page: 2 });
    expect(listPageQuery(40)).toEqual({ page: 40 });
  });
});
