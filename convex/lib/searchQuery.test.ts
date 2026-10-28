import { describe, expect, test } from 'vitest';
import {
  joinSearchText,
  matchesEveryWord,
  parseSearchQuery,
  searchWords,
  suggestFewerWords,
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

describe('searchWords', () => {
  test('lowercases, removes accents, and splits on anything that is not a letter or a digit', () => {
    expect(searchWords('Café  Slow-Pitch, 4s!')).toEqual(['cafe', 'slow', 'pitch', '4s']);
  });

  test('is empty for text with no letter or digit', () => {
    expect(searchWords(' - , ')).toEqual([]);
    expect(searchWords('')).toEqual([]);
  });
});

describe('matchesEveryWord', () => {
  const text =
    'Sunday Reverse Coed 4s Gulf Coast Sport & Social North Beach Sand Courts Corpus Christi, TX';

  test('is true when every word of the search is a word of the text', () => {
    expect(matchesEveryWord(text, 'coed 4s corpus')).toBe(true);
    expect(matchesEveryWord(text, 'corpus coed')).toBe(true);
  });

  test('is false when one word is missing', () => {
    expect(matchesEveryWord(text, 'coed 4s austin')).toBe(false);
    expect(matchesEveryWord(text, 'austin')).toBe(false);
  });

  test('lets the last word be the start of a word', () => {
    expect(matchesEveryWord(text, 'coed corp')).toBe(true);
    expect(matchesEveryWord(text, 'c')).toBe(true);
  });

  test('does not let a word in any other position be the start of a word', () => {
    expect(matchesEveryWord(text, 'corp coed')).toBe(false);
    expect(matchesEveryWord(text, 'rev coed 4s')).toBe(false);
  });

  test('does not let the last word be a longer word than the text holds', () => {
    expect(matchesEveryWord(text, 'coedx')).toBe(false);
  });

  test('ignores case and accents on both sides', () => {
    expect(matchesEveryWord('Café Sand League', 'cafe')).toBe(true);
    expect(matchesEveryWord('Cafe Sand League', 'CAFÉ sand')).toBe(true);
  });

  test('ignores punctuation on both sides', () => {
    expect(matchesEveryWord('Slow-Pitch Softball', 'slow-pitch')).toBe(true);
    expect(matchesEveryWord('Slow-Pitch Softball', 'slow pitch')).toBe(true);
    expect(matchesEveryWord('Slow Pitch Softball', 'slow-pitch')).toBe(true);
  });

  test('is false for a search with no letter or digit', () => {
    expect(matchesEveryWord(text, '-')).toBe(false);
    expect(matchesEveryWord(text, '')).toBe(false);
  });
});

describe('suggestFewerWords', () => {
  const texts = [
    'Sunday Reverse Coed 4s Gulf Corpus Christi',
    'Thursday Night Coed 2s Gulf Corpus Christi',
    'Saturday Coed 6s Lakeshore Dallas',
  ];

  test('suggests nothing for a search of one word', () => {
    expect(suggestFewerWords(texts, 'pickleball')).toEqual([]);
  });

  test('drops one word as typed and keeps the others as typed', () => {
    expect(suggestFewerWords(texts, 'Coed 4s Austin')).toEqual(['Coed 4s']);
  });

  test('leaves out a search that matches no text', () => {
    expect(suggestFewerWords(texts, 'pickleball austin')).toEqual([]);
  });

  test('orders by the texts matched', () => {
    expect(suggestFewerWords(texts, 'coed gulf dallas')).toEqual(['coed gulf', 'coed dallas']);
    expect(suggestFewerWords(texts, 'gulf lakeshore')).toEqual(['gulf', 'lakeshore']);
  });

  test('puts the search that drops the later word first when the matches tie', () => {
    expect(suggestFewerWords(texts, 'sunday thursday')).toEqual(['sunday', 'thursday']);
  });

  test('suggests at most 3', () => {
    expect(suggestFewerWords(texts, 'coed gulf corpus christi')).toEqual([
      'coed gulf corpus',
      'coed gulf christi',
      'coed corpus christi',
    ]);
  });

  test('never suggests the same search twice', () => {
    expect(suggestFewerWords(texts, 'coed coed gulf')).toEqual(['coed coed', 'coed gulf']);
  });
});
