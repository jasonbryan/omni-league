import { Directive } from '@angular/core';

export const PAGINATION_CONTENT_CLASSES = 'flex items-center gap-1';

@Directive({
  selector: 'ul[hlmPaginationContent]',
  exportAs: 'hlmPaginationContent',
  host: {
    'data-slot': 'pagination-content',
    role: 'list',
    class: PAGINATION_CONTENT_CLASSES,
  },
})
export class HlmPaginationContent {}
