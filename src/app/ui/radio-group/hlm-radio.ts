import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { BrnRadio, type BrnRadioChange } from '@spartan-ng/brain/radio-group';

export const RADIO_CLASSES =
  'group/radio relative mt-0.5 flex data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50';

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
  protected readonly _computedClass = computed(() => `${RADIO_CLASSES} ${this.userClass()}`);

  /** Used to set the id on the underlying brn element. */
  readonly inputId = input<string | undefined>(undefined);

  /** Used to set the aria-label attribute on the underlying brn element. */
  readonly ariaLabel = input<string | undefined>(undefined, { alias: 'aria-label' });

  /** Used to set the aria-labelledby attribute on the underlying brn element. */
  readonly ariaLabelledby = input<string | undefined>(undefined, { alias: 'aria-labelledby' });

  /** Used to set the aria-describedby attribute on the underlying brn element. */
  readonly ariaDescribedby = input<string | undefined>(undefined, { alias: 'aria-describedby' });

  /** The value this radio button represents. */
  readonly value = input.required<T>();

  readonly required = input(false, { transform: booleanAttribute });

  readonly disabled = input(false, { transform: booleanAttribute });

  /** Event emitted when the checked state of this radio button changes. */
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly change = output<BrnRadioChange<T>>();
}
