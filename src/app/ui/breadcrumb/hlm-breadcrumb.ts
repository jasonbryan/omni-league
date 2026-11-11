import { Directive, input } from '@angular/core';

@Directive({
  selector: '[hlmBreadcrumb]',
  exportAs: 'hlmBreadcrumb',
  host: {
    'data-slot': 'breadcrumb',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class HlmBreadcrumb {
  readonly ariaLabel = input<string>('breadcrumb', { alias: 'aria-label' });
}
