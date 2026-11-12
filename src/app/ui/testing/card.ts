import { expect } from 'vitest';

export const MESSAGE_CARD_LAYOUT =
  'mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12';

const SURFACE =
  'group/card rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';

const sorted = (names: Iterable<string>) => [...names].sort();

export function expectBareCard(card: Element | null | undefined, layoutClasses: string): void {
  if (!card) throw new Error('A card check needs an element, got nothing');
  expect(card.getAttribute('data-slot')).toBe('card');
  expect(card.getAttribute('data-size')).toBe('bare');
  expect(sorted(card.classList)).toEqual(
    sorted([...layoutClasses.split(/\s+/).filter(Boolean), ...SURFACE.split(' ')]),
  );
}

export function expectBareCards(root: ParentNode, layouts: readonly string[]): void {
  const cards = [...root.querySelectorAll('[data-slot="card"]')];
  expect(cards).toHaveLength(layouts.length);
  cards.forEach((card, index) => expectBareCard(card, layouts[index]));
}
