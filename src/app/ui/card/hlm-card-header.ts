import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmCardHeader],hlm-card-header',
  exportAs: 'hlmCardHeader',
  host: {
    class:
      'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) [.border-b]:pb-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]',
    'data-slot': 'card-header',
  },
})
export class HlmCardHeader {}
