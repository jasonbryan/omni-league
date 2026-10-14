import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  booleanAttribute,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import type { FormCheckboxControl } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck } from '@ng-icons/lucide';

@Component({
  selector: 'app-checkbox',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-slot': 'checkbox', class: 'contents peer' },
  // helm checkbox (Nova) classes with no focus halo, so the base layer's `:focus-visible` outline is the focus indicator, as the approved mockup draws them.
  // Static, so they are set before the button is inserted. The mockup's invalid box has `border-destructive` in place of `border-input`;
  // `data-invalid` gives the same edge without a class binding.
  template: `
    <button
      #box
      type="button"
      role="checkbox"
      [id]="controlId()"
      [attr.name]="controlId()"
      [attr.aria-checked]="checked()"
      [attr.aria-required]="required() || null"
      [attr.aria-invalid]="showInvalid() || null"
      [attr.aria-describedby]="describedBy() || null"
      [attr.data-state]="checked() ? 'checked' : 'unchecked'"
      class="peer shrink-0 cursor-default disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary data-[matches-spartan-invalid=true]:aria-checked:border-primary data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 flex size-4 items-center justify-center rounded-[4px] border transition-colors group-has-disabled/field:opacity-50 data-[matches-spartan-invalid=true]:ring-3 mt-0.5 border-input data-[invalid=true]:border-destructive"
      [attr.data-invalid]="showInvalid() ? 'true' : null"
      (click)="toggle()"
      (blur)="touch.emit()"
    >
      @if (checked()) {
        <span
          class="flex items-center justify-center text-current transition-none [&>ng-icon]:text-[length:--spacing(3.5)]"
        >
          <ng-icon name="lucideCheck" aria-hidden="true" />
        </span>
      }
    </button>
  `,
})
export class Checkbox implements FormCheckboxControl {
  readonly checked = model(false);
  readonly required = input(false, { transform: booleanAttribute });
  readonly touch = output();

  readonly controlId = input.required<string>();
  readonly describedBy = input<string | null>(null);
  readonly showInvalid = input(false);

  private readonly box = viewChild.required<ElementRef<HTMLButtonElement>>('box');

  protected toggle(): void {
    this.checked.update((checked) => !checked);
  }

  focus(options?: FocusOptions): void {
    this.box().nativeElement.focus(options);
  }
}
