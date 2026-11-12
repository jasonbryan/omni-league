import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'hlm-radio-indicator',
  exportAs: 'hlmRadioIndicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-slot': 'radio-group-indicator' },
  template: `
    <span
      class="pointer-events-none absolute start-1/2 top-1/2 hidden size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground group-has-checked/radio:block"
    ></span>
  `,
})
export class HlmRadioIndicator {}
