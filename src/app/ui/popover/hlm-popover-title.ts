import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmPopoverTitle]',
  host: { 'data-slot': 'popover-title', class: 'font-medium' },
})
export class HlmPopoverTitle {}
