import { Directive, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export const BREADCRUMB_PAGE_CLASSES = 'font-medium text-foreground';

@Directive({
  selector: 'a[hlmBreadcrumbPage]',
  exportAs: 'hlmBreadcrumbPage',
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
    'data-slot': 'breadcrumb-page',
    'aria-current': 'page',
    class: BREADCRUMB_PAGE_CLASSES,
  },
})
export class HlmBreadcrumbPage {
  readonly link = input<RouterLink['routerLink']>();
}
