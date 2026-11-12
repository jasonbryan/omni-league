import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmCardContent]',
  exportAs: 'hlmCardContent',
  host: { class: 'px-(--card-spacing)', 'data-slot': 'card-content' },
})
export class HlmCardContent {}
