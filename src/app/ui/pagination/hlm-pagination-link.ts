import type { BooleanInput } from '@angular/cdk/coercion';
import { Directive, booleanAttribute, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BUTTON_BASE } from '../button/button-classes';

// Constants, not `buttonVariants()` calls, so the public page's chunk loads no class-merging code. The spec checks them against `buttonVariants`, so a change to the helm button shows up there.
const GHOST =
  'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground';

export const GHOST_BUTTON = `${BUTTON_BASE} ${GHOST} h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 max-sm:w-8 max-sm:px-0`;
export const GHOST_ICON_BUTTON = `${BUTTON_BASE} ${GHOST} size-8 tabular-nums`;
export const CURRENT_PAGE_BUTTON = `${BUTTON_BASE} bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground size-8 font-semibold tabular-nums`;

@Directive({
  selector: '[hlmPaginationLink]',
  exportAs: 'hlmPaginationLink',
  hostDirectives: [
    {
      directive: RouterLink,
      inputs: [
        'target',
        'queryParams',
        'fragment',
        'queryParamsHandling',
        'state',
        'info',
        'relativeTo',
        'preserveFragment',
        'skipLocationChange',
        'replaceUrl',
        'routerLink: link',
      ],
    },
  ],
  host: {
    'data-slot': 'pagination-link',
    '[attr.data-active]': 'isActive() ? "true" : null',
    '[attr.aria-current]': 'isActive() ? "page" : null',
    '[class]': 'classes()',
    '(click)': 'activated.emit($event)',
  },
})
export class HlmPaginationLink {
  readonly isActive = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  readonly size = input<'icon' | 'default'>('icon');
  readonly link = input<RouterLink['routerLink']>();

  // The template lint rules reject a `(click)` on an `a` that has no `href` attribute of its own.
  readonly activated = output<MouseEvent>();

  protected readonly classes = computed(() =>
    this.isActive()
      ? CURRENT_PAGE_BUTTON
      : this.size() === 'icon'
        ? GHOST_ICON_BUTTON
        : GHOST_BUTTON,
  );
}
