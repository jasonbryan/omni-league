import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmCardDescription]',
  exportAs: 'hlmCardDescription',
  host: { class: 'text-muted-foreground text-sm', 'data-slot': 'card-description' },
})
export class HlmCardDescription {}
