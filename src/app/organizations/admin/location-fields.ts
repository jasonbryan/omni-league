import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChildren,
  type Signal,
} from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';
import type { LocationField, LocationModel } from './location-form';

const LABEL =
  'flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed gap-2 text-sm font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 group/field-label peer/field-label w-fit has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-data-checked:bg-primary/5 has-data-checked:border-primary/30 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5';
const INPUT =
  'file:text-foreground placeholder:text-muted-foreground w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 border-input data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-9 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium data-[matches-spartan-invalid=true]:ring-3 md:text-sm';
const DESCRIPTION =
  'text-muted-foreground text-start text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal group-has-data-horizontal/field:text-balance last:mt-0 nth-last-2:-mt-1 [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4';
const FIELD =
  'group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2';

@Component({
  selector: 'app-location-fields',
  imports: [FormField, NgIcon],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-slot': 'field-group',
    class:
      'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
  },
  template: `
    @for (field of list; track field.key) {
      <div
        role="group"
        data-slot="field"
        data-orientation="vertical"
        [attr.data-matches-spartan-invalid]="errors()[field.key]() ? 'true' : null"
        [attr.data-invalid]="errors()[field.key]() ? 'true' : null"
        [class]="fieldClass"
      >
        <label [attr.for]="id(field.key)" data-slot="field-label" [class]="labelClass">{{
          field.label
        }}</label>
        <input
          #input
          [id]="id(field.key)"
          type="text"
          data-slot="input"
          autocomplete="off"
          [formField]="fields()[field.key]"
          (blur)="fieldLeft.emit(field.key)"
          [attr.aria-describedby]="describedBy(field.key)"
          [attr.aria-invalid]="errors()[field.key]() ? 'true' : null"
          [attr.data-invalid]="errors()[field.key]() ? 'true' : null"
          [attr.data-matches-spartan-invalid]="errors()[field.key]() ? 'true' : null"
          [class]="inputClass"
        />
        <p
          data-slot="field-description"
          [id]="id(field.key) + '-description'"
          [class]="descriptionClass"
        >
          {{ descriptions()[field.key] }}
        </p>
        @if (errors()[field.key](); as error) {
          <div
            role="alert"
            data-slot="field-error"
            [id]="id(field.key) + '-error'"
            class="text-destructive text-sm font-normal flex items-start gap-1.5"
          >
            <ng-icon
              name="lucideCircleAlert"
              class="mt-0.5 shrink-0 text-base"
              aria-hidden="true"
            />
            <span>{{ error }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class LocationFields {
  readonly idPrefix = input('');
  readonly fields = input.required<FieldTree<LocationModel>>();
  readonly errors = input.required<Record<LocationField, Signal<string | null>>>();
  readonly descriptions = input.required<Record<LocationField, string>>();
  readonly fieldLeft = output<LocationField>();

  protected readonly list: readonly { key: LocationField; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'address', label: 'Address' },
  ];
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;

  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('input');

  protected id(field: LocationField): string {
    return `${this.idPrefix()}${field}`;
  }

  protected describedBy(field: LocationField): string {
    const description = `${this.id(field)}-description`;
    return this.errors()[field]() ? `${description} ${this.id(field)}-error` : description;
  }

  focus(field: LocationField): void {
    this.inputs()[field === 'name' ? 0 : 1]?.nativeElement.focus();
  }
}
