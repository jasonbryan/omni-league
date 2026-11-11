import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEllipsis } from '@ng-icons/lucide';

export const PAGINATION_ELLIPSIS_CLASSES =
  'flex h-8 w-4 items-center justify-center text-muted-foreground sm:w-8';

@Component({
  selector: 'span[hlmPaginationEllipsis]',
  exportAs: 'hlmPaginationEllipsis',
  imports: [NgIcon],
  providers: [provideIcons({ lucideEllipsis })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-slot': 'pagination-ellipsis', class: PAGINATION_ELLIPSIS_CLASSES },
  template: `<ng-icon name="lucideEllipsis" class="text-base" aria-hidden="true" />`,
})
export class HlmPaginationEllipsis {}
