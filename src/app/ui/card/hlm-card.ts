import { computed, Directive, input } from '@angular/core';
import { CARD_CLASSES } from './card-classes';

export type HlmCardSize = 'bare' | 'default' | 'lg';

const STACKED_CLASSES = `${CARD_CLASSES} flex flex-col gap-4 overflow-hidden py-(--card-spacing) text-sm [--card-spacing:--spacing(5)] data-[size=lg]:[--card-spacing:--spacing(6)]`;

const SIZES: Readonly<Record<HlmCardSize, string>> = {
  bare: CARD_CLASSES,
  default: STACKED_CLASSES,
  lg: STACKED_CLASSES,
};

// Vendored from spartan helm 1.9.0 (Nova style). Local changes, to keep when re-copying from upstream:
// - the Nova style's classes are inlined in place of its `spartan-card-*` names, and `classes()` is a host `[class]` binding
//   of one static string per size;
// - `shadow-xs`, and 20px spacing (helm's is 16px), as the pages draw their cards;
// - no footer, no `sm` size, and no image rules (`img:first-child`, `img:last-child`): the app has
//   none of them, and each rule adds to the global stylesheet;
// - a 16px gap between the parts, and a `lg` size with 24px spacing for the cards that stand alone on a page;
// - a `bare` size, the surface only, with no flex, gap, overflow, padding, or text size, for cards that lay out
//   their own sections: with no `tailwind-merge`, a page cannot take those off the other sizes;
// - `card-classes.ts` exports the `bare` surface and a `shadow-lg` one for the update prompt, which loads
//   with the first page and so cannot import this directive;
// - no `HlmCardConfig` token: the size defaults to `default`.
@Directive({
  selector: '[hlmCard],hlm-card',
  exportAs: 'hlmCard',
  host: {
    'data-slot': 'card',
    '[attr.data-size]': 'size()',
    '[class]': 'classes()',
  },
})
export class HlmCard {
  public readonly size = input<HlmCardSize>('default');

  protected readonly classes = computed(() => SIZES[this.size()]);
}
