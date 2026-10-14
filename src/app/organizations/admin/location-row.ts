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
  readonly closed = output();
  readonly saved = output<string>();
  readonly saving = computed(() => this.editForm()?.saving() ?? false);

  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly hostClass = computed(() =>
    this.editing() ? 'block px-4 py-4 md:px-5' : 'flex items-start gap-3 px-4 py-3.5 md:px-5',
  );

  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('editButton');
  private readonly editForm = viewChild(LocationEditForm);

  protected finish(): void {
    this.closed.emit();
    afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
  }
}
