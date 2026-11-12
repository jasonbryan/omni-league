import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmAlertDialogMedia],hlm-alert-dialog-media',
  exportAs: 'hlmAlertDialogMedia',
  host: {
    'data-slot': 'alert-dialog-media',
    class:
      "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-accent text-accent-foreground sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(6)]",
  },
})
export class HlmAlertDialogMedia {}
