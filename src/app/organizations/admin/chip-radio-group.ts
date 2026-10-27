import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';
import {
  CHIP_CHOICE_INPUT_CLASSES,
  CHIP_CHOICE_LABEL_CLASSES,
  CHIP_CHOICE_WRAPPER_CLASSES,
} from '../../ui/chip/chip-classes';
import { FIELD_ERROR } from './field-classes';

export interface ChipOption {
  key: string;
  label: string;
}

@Component({
  selector: 'app-chip-radio-group',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset
      [id]="name()"
      [attr.aria-describedby]="describedBy()"
      [attr.data-invalid]="error() ? 'true' : null"
    >
      <legend class="mb-1.5 text-sm font-medium" [class.text-destructive]="!!error()">
        {{ legend() }}
      </legend>
      <div class="flex flex-wrap gap-2">
        @for (option of options(); track option.key) {
          <label [attr.for]="name() + '-' + option.key" [class]="wrapperClass"
            ><input
              #radio
              type="radio"
              [id]="name() + '-' + option.key"
              [name]="name()"
              [value]="option.key"
              [checked]="value() === option.key"
              [attr.aria-invalid]="error() ? 'true' : null"
              (change)="chosen.emit(option.key)"
              [class]="inputClass"
            /><span [class]="chipClass">{{ option.label }}</span></label
          >
        }
      </div>
      @if (description(); as text) {
        <p [id]="name() + '-description'" [class]="descriptionClass">{{ text }}</p>
      }
      @if (error(); as message) {
        <div role="alert" [id]="name() + '-error'" [class]="errorClass + ' mt-2'">
          <ng-icon name="lucideCircleAlert" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
          <span>{{ message }}</span>
        </div>
      }
    </fieldset>
  `,
})
export class ChipRadioGroup {
  readonly name = input.required<string>();
  readonly legend = input.required<string>();
  readonly options = input.required<readonly ChipOption[]>();
  readonly value = input.required<string | null>();
  readonly description = input<string | null>(null);
  readonly error = input<string | null>(null);

  readonly chosen = output<string>();

  protected readonly wrapperClass = CHIP_CHOICE_WRAPPER_CLASSES;
  protected readonly inputClass = CHIP_CHOICE_INPUT_CLASSES;
  protected readonly chipClass = CHIP_CHOICE_LABEL_CLASSES;
  protected readonly descriptionClass =
    'mt-2 text-muted-foreground text-start text-sm leading-normal font-normal';
  protected readonly errorClass = FIELD_ERROR;

  private readonly radios = viewChildren<ElementRef<HTMLInputElement>>('radio');

  protected readonly describedBy = computed(() => {
    const ids = [
      this.description() ? `${this.name()}-description` : null,
      this.error() ? `${this.name()}-error` : null,
    ].filter((id) => id !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  focus(): void {
    this.radios()[0]?.nativeElement.focus();
  }
}
