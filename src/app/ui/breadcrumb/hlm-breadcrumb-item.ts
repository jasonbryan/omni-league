import { Directive } from '@angular/core';

@Directive({
  selector: 'li[hlmBreadcrumbItem]',
  exportAs: 'hlmBreadcrumbItem',
  host: { 'data-slot': 'breadcrumb-item' },
})
export class HlmBreadcrumbItem {}
