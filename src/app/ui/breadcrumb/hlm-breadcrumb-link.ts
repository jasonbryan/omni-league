import { Directive, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export const BREADCRUMB_LINK_CLASSES = 'hover:text-foreground transition-colors';

@Directive({
  selector: '[hlmBreadcrumbLink]',
  exportAs: 'hlmBreadcrumbLink',
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
  host: { 'data-slot': 'breadcrumb-link', class: BREADCRUMB_LINK_CLASSES },
})
export class HlmBreadcrumbLink {
  readonly link = input<RouterLink['routerLink']>();
}
