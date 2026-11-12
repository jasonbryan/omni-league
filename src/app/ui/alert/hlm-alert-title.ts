import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmAlertTitle]',
  exportAs: 'hlmAlertTitle',
  host: {
    'data-slot': 'alert-title',
    class:
      'font-medium group-has-[>ng-icon]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3',
  },
})
export class HlmAlertTitle {}
