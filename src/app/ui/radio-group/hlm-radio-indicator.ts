import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmRadioGroup } from './hlm-radio-group';

const INDICATOR_CLASSES =
  'relative flex size-4 shrink-0 rounded-full border group-has-checked/radio:border-primary group-has-checked/radio:bg-primary group-has-focus-visible/radio:outline-2 group-has-focus-visible/radio:outline-offset-2 group-has-focus-visible/radio:outline-ring';
const EDGE_CLASSES = 'border-input';
const INVALID_EDGE_CLASSES = 'border-destructive';

@Component({
  selector: 'hlm-radio-indicator',
  exportAs: 'hlmRadioIndicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-slot': 'radio-group-indicator',
    '[class]': '_classes()',
  },
  template: `
    <span
      class="absolute start-1/2 top-1/2 hidden size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground group-has-checked/radio:block"
    ></span>
  `,
})
export class HlmRadioIndicator {
  private readonly group = inject(HlmRadioGroup, { optional: true });

  protected readonly _classes = computed(
    () => `${INDICATOR_CLASSES} ${this.group?.invalid() ? INVALID_EDGE_CLASSES : EDGE_CLASSES}`,
  );
}
