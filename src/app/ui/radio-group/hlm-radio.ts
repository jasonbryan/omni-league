import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { BrnRadio, type BrnRadioChange } from '@spartan-ng/brain/radio-group';
import { HlmRadioGroup } from './hlm-radio-group';

export const RADIO_CLASSES =
  'group/radio relative mt-0.5 flex size-4 shrink-0 rounded-full border has-checked:border-primary has-checked:bg-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring';
const EDGE_CLASSES = 'border-input';
const INVALID_EDGE_CLASSES = 'border-destructive';
const DISABLED_CLASSES = 'opacity-50';

export const RADIO_INPUT_STYLES =
  'position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; appearance: none; border-radius: 9999px; opacity: 0; cursor: default;';

@Component({
  selector: 'hlm-radio',
  exportAs: 'hlmRadio',
  imports: [BrnRadio],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-label]': 'null',
    '[attr.aria-labelledby]': 'null',
    '[attr.aria-describedby]': 'null',
    '[attr.data-disabled]': 'disabled() ? "" : null',
    'data-slot': 'radio-group-item',
    class: 'shrink-0',
  },
  template: `
    <brn-radio
      [id]="inputId()"
      [class]="_computedClass()"
      [inputStyles]="inputStyles"
      [value]="value()"
      [required]="required()"
      [disabled]="disabled()"
      [aria-label]="ariaLabel()"
      [aria-labelledby]="ariaLabelledby()"
      [aria-describedby]="ariaDescribedby()"
      (change)="change.emit($event)"
    >
      <ng-content select="[target],[indicator],hlm-radio-indicator" indicator />
      <ng-content />
    </brn-radio>
  `,
})
export class HlmRadio<T = unknown> {
  protected readonly inputStyles = RADIO_INPUT_STYLES;

  readonly userClass = input('', { alias: 'class' });
  private readonly group = inject(HlmRadioGroup, { optional: true });

  protected readonly _computedClass = computed(() =>
    [
      RADIO_CLASSES,
      this.group?.invalid() ? INVALID_EDGE_CLASSES : EDGE_CLASSES,
      this.disabled() ? DISABLED_CLASSES : '',
      this.userClass(),
    ].join(' '),
  );

  readonly inputId = input<string | undefined>(undefined);

  readonly ariaLabel = input<string | undefined>(undefined, { alias: 'aria-label' });

  readonly ariaLabelledby = input<string | undefined>(undefined, { alias: 'aria-labelledby' });

  readonly ariaDescribedby = input<string | undefined>(undefined, { alias: 'aria-describedby' });

  readonly value = input.required<T>();

  readonly required = input(false, { transform: booleanAttribute });

  readonly disabled = input(false, { transform: booleanAttribute });

  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly change = output<BrnRadioChange<T>>();
}
