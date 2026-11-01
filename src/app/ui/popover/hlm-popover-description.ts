import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmPopoverDescription]',
  host: { 'data-slot': 'popover-description', class: 'text-muted-foreground' },
})
export class HlmPopoverDescription {}
