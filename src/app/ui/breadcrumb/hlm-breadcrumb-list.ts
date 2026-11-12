import { Directive } from '@angular/core';

export const BREADCRUMB_LIST_CLASSES = 'flex items-center text-sm text-muted-foreground';

@Directive({
  selector: 'ol[hlmBreadcrumbList]',
  exportAs: 'hlmBreadcrumbList',
  host: {
    'data-slot': 'breadcrumb-list',
    role: 'list',
    class: BREADCRUMB_LIST_CLASSES,
  },
})
export class HlmBreadcrumbList {}
