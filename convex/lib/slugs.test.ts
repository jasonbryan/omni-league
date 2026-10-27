import { describe, expect, test } from 'vitest';
import glossary from '../../docs/glossary.md?raw';
import {
  DEMO_ORGANIZATION_SLUGS,
  isChoosableSlug,
  isReservedSlug,
  isSlug,
  MAX_SLUG_LENGTH,
  MIN_SLUG_LENGTH,
  RESERVED_SLUGS,
  slugify,
} from './slugs';

describe('isSlug', () => {
  test('answers false, true, true, false at 2, 3, 60, and 61 characters', () => {
    expect(MIN_SLUG_LENGTH).toBe(3);
    expect(MAX_SLUG_LENGTH).toBe(60);
    expect(isSlug('ab')).toBe(false);
    expect(isSlug('abc')).toBe(true);
    expect(isSlug('a'.repeat(60))).toBe(true);
    expect(isSlug('a'.repeat(61))).toBe(false);
  });

  test('refuses uppercase, double hyphens, edge hyphens, spaces, and the empty string', () => {
    for (const bad of ['Bad-Slug', 'a--b', '-ab', 'ab-', 'a b', 'ab_c', 'é-é', '']) {
      expect(isSlug(bad), bad).toBe(false);
    }
    for (const good of ['a-b', 'abc-123', '123', 'a-b-c-d']) {
      expect(isSlug(good), good).toBe(true);
    }
  });

  test('does not refuse reserved slugs: the demo seeds and public pages use them', () => {
    expect(isSlug('new')).toBe(true);
    expect(isSlug('gulf-coast-sport-social')).toBe(true);
  });

  test('keeps the glossary entry in step with the rule', () => {
    const entry = glossary.split('\n').find((line) => line.startsWith('- **Slug:**')) ?? '';
    expect(entry).toContain('3 to 60 characters');
    expect(entry).not.toContain('64');
  });
});

describe('reserved slugs', () => {
  test('are `new` and the six demo organization slugs, all of which are valid slugs', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      [
        'new',
        'gulf-coast-sport-social',
        'port-aransas-beach-volleyball-club',
        'front-range-rec-sports',
        'lakeshore-sand-league',
        'saguaro-valley-softball',
        'rockport-sand-volleyball',
      ].sort(),
    );
    expect(DEMO_ORGANIZATION_SLUGS).toHaveLength(6);
    for (const slug of RESERVED_SLUGS) {
      expect(isSlug(slug), slug).toBe(true);
      expect(isReservedSlug(slug), slug).toBe(true);
      expect(isChoosableSlug(slug), slug).toBe(false);
    }
  });

  test('a slug that only contains a reserved word is choosable', () => {
    expect(isReservedSlug('new-york-rec')).toBe(false);
    expect(isChoosableSlug('new-york-rec')).toBe(true);
    expect(isChoosableSlug('abc')).toBe(true);
    expect(isChoosableSlug('a'.repeat(60))).toBe(true);
    expect(isChoosableSlug('ab')).toBe(false);
  });
});

describe('slugify', () => {
  test('gives slugs from names, and `item` when nothing is left', () => {
    expect(slugify('Coastal Bend Rec Club')).toBe('coastal-bend-rec-club');
    expect(slugify('Café  Ñandú!')).toBe('cafe-nandu');
    expect(slugify('!!!')).toBe('item');
    expect(slugify('x'.repeat(100))).toHaveLength(MAX_SLUG_LENGTH);
  });
});
