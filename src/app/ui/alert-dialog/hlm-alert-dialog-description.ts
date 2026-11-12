import { Directive } from '@angular/core';
import { BrnAlertDialogDescription } from '@spartan-ng/brain/alert-dialog';

@Directive({
  selector: '[hlmAlertDialogDescription]',
  exportAs: 'hlmAlertDialogDescription',
  hostDirectives: [BrnAlertDialogDescription],
  host: {
    'data-slot': 'alert-dialog-description',
    class:
      'text-muted-foreground *:[a]:hover:text-foreground text-sm text-balance md:text-pretty *:[a]:underline *:[a]:underline-offset-3 sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
  },
})
export class HlmAlertDialogDescription {}
