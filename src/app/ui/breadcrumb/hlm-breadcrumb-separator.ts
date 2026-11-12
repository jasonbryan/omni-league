import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';

@Component({
  selector: 'li[hlmBreadcrumbSeparator]',
  exportAs: 'hlmBreadcrumbSeparator',
  imports: [NgIcon],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-slot': 'breadcrumb-separator',
    role: 'presentation',
    'aria-hidden': 'true',
  },
  template: `
    <ng-content>
      <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
    </ng-content>
  `,
})
export class HlmBreadcrumbSeparator {}
