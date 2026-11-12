import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmAlertDescription]',
  exportAs: 'hlmAlertDescription',
  host: {
    'data-slot': 'alert-description',
    class:
      'text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3',
  },
})
export class HlmAlertDescription {}
