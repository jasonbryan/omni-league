import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmCardTitle]',
  exportAs: 'hlmCardTitle',
  host: {
    class: 'text-base leading-snug font-medium',
    'data-slot': 'card-title',
  },
})
export class HlmCardTitle {}
