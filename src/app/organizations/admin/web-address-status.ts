import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck } from '@ng-icons/lucide';
import { FIELD_NOTE } from './field-note';

const ROOM_FOR_ONE_LINE = `${FIELD_NOTE} min-h-5`;

/** A polite status that is in the page from the first render, so a screen reader announces its text when it appears. */
@Component({
  selector: 'app-web-address-status',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCircleCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    id: 'slug-availability',
    'data-slot': 'field-status',
    '[class]': 'hostClass()',
  },
  template: `
    @if (available()) {
      <ng-icon name="lucideCircleCheck" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
      <span>Available</span>
    }
  `,
})
export class WebAddressStatus {
  readonly available = input.required<boolean>();
  /** Keeps a line free while the answer is on its way, so the form below does not move when it arrives. */
  readonly reserveRoom = input.required<boolean>();

  protected readonly hostClass = computed(() =>
    this.reserveRoom() ? ROOM_FOR_ONE_LINE : 'sr-only',
  );
}
