import { Directive, input } from '@angular/core';

@Directive({
  selector: '[hlmPagination]',
  exportAs: 'hlmPagination',
  host: {
    'data-slot': 'pagination',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class HlmPagination {
  readonly ariaLabel = input<string>('pagination', { alias: 'aria-label' });
}
