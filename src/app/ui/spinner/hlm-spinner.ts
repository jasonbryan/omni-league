import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle } from '@ng-icons/lucide';

export const SPINNER_CLASSES = 'inline-flex text-base motion-safe:animate-spin';

@Component({
  selector: 'hlm-spinner',
  exportAs: 'hlmSpinner',
  imports: [NgIcon],
  providers: [provideIcons({ lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-slot': 'spinner',
    'aria-hidden': 'true',
    class: SPINNER_CLASSES,
  },
  template: `<ng-icon name="lucideLoaderCircle" />`,
})
export class HlmSpinner {}
