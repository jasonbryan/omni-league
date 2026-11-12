import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmCardAction]',
  exportAs: 'hlmCardAction',
  host: {
    class: 'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
    'data-slot': 'card-action',
  },
})
export class HlmCardAction {}
