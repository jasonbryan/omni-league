import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmCardTitle]',
  exportAs: 'hlmCardTitle',
  host: {
    class: 'text-base leading-snug font-medium group-data-[size=sm]/card:text-sm',
    'data-slot': 'card-title',
  },
})
export class HlmCardTitle {}
