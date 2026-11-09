import { describe, expect, test } from 'vitest';
import { ACCOUNTS_PER_SEED_CALL, seedCallRanges } from './seedCallLimits';

describe('seedCallRanges', () => {
  test('splits 201 accounts into 9 calls of at most 25 that number 1 to 201 with no gap or overlap', () => {
    const ranges = seedCallRanges(201);
    expect(ranges).toHaveLength(9);
    expect(ranges[0]).toEqual({ from: 1, count: 25 });
    expect(ranges[8]).toEqual({ from: 201, count: 1 });
    expect(Math.max(...ranges.map((range) => range.count))).toBe(ACCOUNTS_PER_SEED_CALL);
    let next = 1;
    for (const { from, count } of ranges) {
      expect(from).toBe(next);
      next = from + count;
    }
    expect(next).toBe(202);
  });

  test('makes one call for a total within the limit and none for zero', () => {
    expect(seedCallRanges(25)).toEqual([{ from: 1, count: 25 }]);
    expect(seedCallRanges(1)).toEqual([{ from: 1, count: 1 }]);
    expect(seedCallRanges(0)).toEqual([]);
  });

  test.each([-1, 1.5, Number.NaN])('refuses a total of %s', (total) => {
    expect(() => seedCallRanges(total)).toThrow(/non-negative integer/);
  });
});
