import { Directive, inject, input } from '@angular/core';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';

@Directive({
  selector: '[hlmAlertDialogContent],hlm-alert-dialog-content',
  exportAs: 'hlmAlertDialogContent',
  host: {
    'data-slot': 'alert-dialog-content',
    '[attr.data-state]': 'state()',
    '[attr.data-size]': 'size()',
    class:
      'group/alert-dialog-content grid w-[calc(100vw-2rem)] bg-popover text-popover-foreground ring-foreground/10 gap-4 rounded-xl p-4 ring-1 shadow-xl data-[size=default]:max-w-xs data-[size=default]:sm:max-w-sm',
  },
})
export class HlmAlertDialogContent {
  private readonly _dialogRef = inject(BrnDialogRef);
  public readonly state = this._dialogRef.state;

  public readonly size = input<'sm' | 'default'>('default');
}
