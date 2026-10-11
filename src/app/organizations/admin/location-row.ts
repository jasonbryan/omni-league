import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMapPin, lucidePencil } from '@ng-icons/lucide';
import { OUTLINE_BUTTON } from './button-classes';
import { LocationEditForm, type AdminLocation } from './location-edit-form';

/**
 * One row of the Locations list (#65; design/mockups/65-organization-admin-locations.html states 8
 * and 13 to 16), a `role="listitem"` element of the list: the location's name and address with an Edit button named "Edit <name>". While
 * `editing` is true the row is its edit form in place. The page decides which row is editing, so
 * only one is. Cancelling or saving returns focus to this row's Edit button, once the row is back.
 */
@Component({
  selector: 'app-location-row',
  imports: [LocationEditForm, NgIcon],
  providers: [provideIcons({ lucideMapPin, lucidePencil })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem', '[class]': 'hostClass()' },
  template: `
    @if (editing()) {
      <app-location-edit-form
        [location]="location()"
        (cancelled)="finish()"
        (saved)="finish(); saved.emit($event)"
      />
    } @else {
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
        ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true"
      /></span>
      <div class="min-w-0 flex-1">
        <h3 class="font-medium">{{ location().name }}</h3>
        <p class="mt-0.5 text-sm text-muted-foreground">{{ location().address }}</p>
      </div>
      <button
        #editButton
        type="button"
        data-slot="button"
        [class]="outlineButton"
        (click)="editRequested.emit()"
      >
        <ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Edit<span
          class="sr-only"
        >
          {{ location().name }}</span
        >
      </button>
    }
  `,
})
export class LocationRow {
  private readonly injector = inject(Injector);

  readonly location = input.required<AdminLocation>();
  readonly editing = input(false);
  readonly editRequested = output();
  /** Edit was cancelled, or saved; the page then clears `editing`. */
  readonly closed = output();
  /** The stored name of the location just saved. */
  readonly saved = output<string>();

  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly hostClass = computed(() =>
    this.editing() ? 'block px-4 py-4 md:px-5' : 'flex items-start gap-3 px-4 py-3.5 md:px-5',
  );

  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('editButton');

  /** Closes the form and, once the row is back, puts focus on its Edit button. */
  protected finish(): void {
    this.closed.emit();
    afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
  }
}
