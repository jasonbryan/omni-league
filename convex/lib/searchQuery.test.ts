import { describe, expect, test } from 'vitest';
import {
  joinSearchText,
  parseSearchQuery,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MAX_WORDS,
} from './searchQuery';

describe('parseSearchQuery', () => {
  test('is empty when the parameter is absent or blank', () => {
    expect(parseSearchQuery([])).toBe('');
    expect(parseSearchQuery([''])).toBe('');
    expect(parseSearchQuery(['   \t '])).toBe('');
  });

  test('trims and collapses runs of whitespace into single spaces', () => {
    expect(parseSearchQuery(['  north   beach \n'])).toBe('north beach');
  });

  test('uses the first value of a repeated parameter', () => {
    expect(parseSearchQuery(['a', 'b'])).toBe('a');
    expect(parseSearchQuery(['', 'b'])).toBe('');
  });

  test('keeps the first 16 words', () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i + 1}`);
    expect(parseSearchQuery([words.join(' ')])).toBe(
      words.slice(0, SEARCH_QUERY_MAX_WORDS).join(' '),
    );
  });

  test('keeps the first 100 characters, with no trailing space', () => {
    expect(parseSearchQuery(['x'.repeat(300)])).toBe('x'.repeat(SEARCH_QUERY_MAX_LENGTH));
    const cutAtSpace = `${'a'.repeat(99)} b`;
    expect(parseSearchQuery([cutAtSpace])).toBe('a'.repeat(99));
  });

  test('counts a character outside the basic plane once and never cuts it in two', () => {
    const emoji = '🏐'.repeat(150);
    expect(Array.from(parseSearchQuery([emoji]))).toHaveLength(SEARCH_QUERY_MAX_LENGTH);
  });
});

describe('joinSearchText', () => {
  test('joins the parts with spaces and leaves out missing and empty ones', () => {
    expect(joinSearchText(['Sand 2s', 'Gulf Coast', undefined, '', 'Corpus Christi, TX'])).toBe(
      'Sand 2s Gulf Coast Corpus Christi, TX',
    );
  });
});
