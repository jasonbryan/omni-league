import { Directive, input } from '@angular/core';

export type HlmCardSize = 'default' | 'sm' | 'lg';

// Vendored from spartan helm 1.9.0 (Nova style). Local changes, to keep when re-copying from upstream:
// - the Nova style's classes are inlined in place of its `spartan-card-*` names, and `classes()` is a host `class`;
// - `shadow-xs`, and 20px spacing (helm's is 16px), as the pages draw their cards;
// - no image rules (`img:first-child`, `img:last-child`) and no `pb-0` with a footer: the home has
//   neither, and each rule adds to the global stylesheet;
// - a `lg` size with 24px spacing, for the cards that stand alone on a page;
// - no `HlmCardConfig` token: the size defaults to `default`.
@Directive({
  selector: '[hlmCard],hlm-card',
  exportAs: 'hlmCard',
  host: {
    class:
      'group/card flex flex-col ring-foreground/10 bg-card text-card-foreground shadow-xs gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm ring-1 [--card-spacing:--spacing(5)] data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=lg]:[--card-spacing:--spacing(6)]',
    'data-slot': 'card',
    '[attr.data-size]': 'size()',
  },
})
export class HlmCard {
  public readonly size = input<HlmCardSize>('default');
}
