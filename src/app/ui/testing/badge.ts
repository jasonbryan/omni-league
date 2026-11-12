import { expect } from 'vitest';
import type { HlmBadgeSize, HlmBadgeVariant } from '../badge';

function present(badge: Element | null | undefined): Element {
  if (!badge) throw new Error('A badge check needs an element, got nothing');
  return badge;
}

export function expectBadgeSize(badge: Element | null | undefined, size: HlmBadgeSize): void {
  const heights = [...present(badge).classList].filter((name) => name.startsWith('h-'));
  expect(heights).toEqual(size === 'default' ? ['h-5'] : []);
}

export function expectBadge(
  badge: Element | null | undefined,
  variant: HlmBadgeVariant,
  size: HlmBadgeSize,
): void {
  expect(present(badge).getAttribute('data-slot')).toBe('badge');
  expect(badge?.getAttribute('data-variant')).toBe(variant);
  expectBadgeSize(badge, size);
}
