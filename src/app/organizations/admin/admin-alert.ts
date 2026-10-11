import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideCircleCheck, lucideWifiOff } from '@ng-icons/lucide';

const BASE =
  "group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]";
const NEUTRAL = `${BASE} bg-card text-card-foreground`;
const DESTRUCTIVE = `${BASE} text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90`;

/** What an alert says: a success message, a failure, or the offline refusal. */
export type AdminAlertKind = 'success' | 'error' | 'offline';

/**
 * The admin forms' message box (design/mockups/65-organization-admin-locations.html, states 11,
 * 12, and 16; design/mockups/88-offline-note.html state 3): helm's alert in the mockup's classes.
 * A success is a `role="status"` region and a failure is a `role="alert"`. The box takes focus
 * through `focus()` (`tabindex="-1"`), for a failure that moves the user's attention to it. The
 * caller sets the margin with a class on the `app-admin-alert` element.
 */
@Component({
  selector: 'app-admin-alert',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideCircleCheck, lucideWifiOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      #box
      data-slot="alert"
      [attr.role]="kind() === 'success' ? 'status' : 'alert'"
      tabindex="-1"
      [class]="classes()"
    >
      <ng-icon [name]="icon()" aria-hidden="true" />
      <div
        data-slot="alert-title"
        class="font-medium group-has-[>ng-icon]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
      >
        {{ title() }}
      </div>
      @if (description(); as description) {
        <div
          data-slot="alert-description"
          class="text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
        >
          {{ description }}
        </div>
      }
    </div>
  `,
})
export class AdminAlert {
  readonly kind = input.required<AdminAlertKind>();
  readonly title = input.required<string>();
  readonly description = input<string>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  protected readonly classes = computed(() => (this.kind() === 'success' ? NEUTRAL : DESTRUCTIVE));
  protected readonly icon = computed(() => {
    const icons = {
      success: 'lucideCircleCheck',
      error: 'lucideCircleAlert',
      offline: 'lucideWifiOff',
    } as const;
    return icons[this.kind()];
  });

  focus(): void {
    this.box().nativeElement.focus();
  }
}
