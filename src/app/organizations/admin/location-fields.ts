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
import { HlmFieldGroup, HlmFieldImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import type { LocationField, LocationModel } from './location-form';

@Component({
  selector: 'app-location-fields',
  imports: [FormField, HlmFieldImports, HlmInputImports, NgIcon],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [HlmFieldGroup],
  template: `
    @for (field of list; track field.key) {
      <div
        hlmField
        [attr.data-matches-spartan-invalid]="errors()[field.key]() ? 'true' : null"
        [attr.data-invalid]="errors()[field.key]() ? 'true' : null"
      >
        <label hlmFieldLabel [attr.for]="id(field.key)">{{ field.label }}</label>
        <input
          hlmInput
          #input
          [id]="id(field.key)"
          type="text"
          autocomplete="off"
          [formField]="fields()[field.key]"
          (blur)="fieldLeft.emit(field.key)"
          [attr.aria-describedby]="describedBy(field.key)"
          [attr.aria-invalid]="errors()[field.key]() ? 'true' : null"
          [attr.data-invalid]="errors()[field.key]() ? 'true' : null"
          [attr.data-matches-spartan-invalid]="errors()[field.key]() ? 'true' : null"
        />
        <p hlmFieldDescription [id]="id(field.key) + '-description'">
          {{ descriptions()[field.key] }}
        </p>
        @if (errors()[field.key](); as error) {
          <div hlmFieldError [id]="id(field.key) + '-error'">
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
