import { Directive } from '@angular/core';

@Directive({
  selector: '[hlmCardFooter],hlm-card-footer',
  exportAs: 'hlmCardFooter',
  host: {
    class: 'bg-muted/50 rounded-b-xl border-t p-(--card-spacing) flex items-center',
    'data-slot': 'card-footer',
  },
})
export class HlmCardFooter {}
