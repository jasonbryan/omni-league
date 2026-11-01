import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmPopoverHeader],hlm-popover-header',
  host: { 'data-slot': 'popover-header', class: 'flex flex-col gap-0.5 text-sm' },
})
export class HlmPopoverHeader {}
