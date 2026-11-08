export const ACCOUNTS_PER_SEED_CALL = 25;

export interface SeedCallRange {
  from: number;
  count: number;
}

export function seedCallRanges(total: number): SeedCallRange[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error('total must be a non-negative integer');
  }
  const ranges: SeedCallRange[] = [];
  for (let from = 1; from <= total; from += ACCOUNTS_PER_SEED_CALL) {
    ranges.push({ from, count: Math.min(ACCOUNTS_PER_SEED_CALL, total - from + 1) });
  }
  return ranges;
}
