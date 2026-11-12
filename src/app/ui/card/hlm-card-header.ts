import { Directive } from '@angular/core';

// Local changes from spartan helm 1.9.0: a 2px gap between rows, as the pages draw it, and no padding rule for a header border.
@Directive({
  selector: '[hlmCardHeader],hlm-card-header',
  exportAs: 'hlmCardHeader',
  host: {
    class:
      'group/card-header @container/card-header grid auto-rows-min items-start gap-0.5 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]',
    'data-slot': 'card-header',
  },
})
export class HlmCardHeader {}
