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
import { DESCRIPTION, FIELD, FIELD_GROUP, INPUT, LABEL } from './field-classes';
import type { LocationField, LocationModel } from './location-form';

@Component({
  selector: 'app-location-fields',
  imports: [FormField, NgIcon],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-slot': 'field-group',
    class: FIELD_GROUP,
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
