import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';
import { CHIP_CHOICE_WRAPPER_CLASSES, RADIO_CHIP_CLASSES } from '../../ui/chip/chip-classes';
import { HlmFieldImports } from '../../ui/field';
import { HlmRadioGroupImports } from '../../ui/radio-group';
import { FieldNoteText, type FieldNote } from './field-note';

export interface ChipOption {
  key: string;
  label: string;
}

// The radio group is an inner div, not the fieldset: brain binds `data-invalid` and `aria-invalid` on its host, which would collide
// with the fieldset's own `data-invalid`. Brain's radio binds no `aria-invalid` on its input, so while the error shows each radio
// is described by it, and a screen reader on any chip hears it.
@Component({
  selector: 'app-chip-radio-group',
  imports: [FieldNoteText, HlmFieldImports, HlmRadioGroupImports, NgIcon],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset
      [id]="name()"
      [attr.aria-describedby]="describedBy()"
      [attr.data-invalid]="error() ? 'true' : null"
    >
      <legend
        [id]="name() + '-legend'"
        class="mb-1.5 text-sm font-medium"
        [class.text-destructive]="!!error()"
      >
        {{ legend() }}
      </legend>
      <div
        hlmRadioGroup
        [name]="name()"
        [value]="value()"
        [attr.aria-labelledby]="name() + '-legend'"
        (valueChange)="choose($event)"
      >
        <div class="flex flex-wrap gap-2">
          @for (option of options(); track option.key) {
            <!-- eslint-disable-next-line @angular-eslint/template/label-has-associated-control -- the input is rendered inside hlm-radio, out of the rule's sight -->
            <label [class]="wrapperClass">
              <hlm-radio
                [inputId]="name() + '-' + option.key"
                [value]="option.key"
                [aria-describedby]="error() ? name() + '-error' : undefined"
                [class]="chipClass"
                >{{ option.label }}</hlm-radio
              >
            </label>
          }
        </div>
      </div>
      @if (description(); as text) {
        <p [id]="name() + '-description'" [class]="descriptionClass">{{ text }}</p>
      }
      @if (note(); as shownNote) {
        <app-field-note [id]="name() + '-note'" [note]="shownNote" class="mt-2" />
      }
      @if (error(); as message) {
        <div hlmFieldError [id]="name() + '-error'" class="mt-2">
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
  readonly note = input<FieldNote | null>(null);
  readonly error = input<string | null>(null);

  readonly chosen = output<string>();

  protected readonly wrapperClass = CHIP_CHOICE_WRAPPER_CLASSES;
  protected readonly chipClass = RADIO_CHIP_CLASSES;
  protected readonly descriptionClass =
    'mt-2 text-muted-foreground text-start text-sm leading-normal font-normal';

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly describedBy = computed(() => {
    const ids = [
      this.description() ? `${this.name()}-description` : null,
      this.note() ? `${this.name()}-note` : null,
      this.error() ? `${this.name()}-error` : null,
    ].filter((id) => id !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  protected choose(key: string | null): void {
    if (key !== null) this.chosen.emit(key);
  }

  focus(): void {
    this.host.nativeElement.querySelector<HTMLInputElement>('brn-radio input')?.focus();
  }
}
