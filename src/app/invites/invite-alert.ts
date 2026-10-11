import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideInfo, lucideWifiOff } from '@ng-icons/lucide';

const BASE =
  "group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]";
const NEUTRAL = `${BASE} bg-card text-card-foreground`;
const DESTRUCTIVE = `${BASE} text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90`;

/** What an invite-page alert says: a failure, the offline refusal, or plain information. */
export type InviteAlertKind = 'error' | 'offline' | 'info';

/**
 * The invite page's message box (design/mockups/70-accept-invite.html states 7, 8, and 10;
 * design/mockups/88-offline-note.html state 3): helm's alert in the mockup's classes. It is a
 * `role="alert"` region that takes focus through `focus()` (`tabindex="-1"`), and shows the
 * focus ring the mockup draws, because focus moves to it from a button that has just gone.
 */
@Component({
  selector: 'app-invite-alert',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideInfo, lucideWifiOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div #box data-slot="alert" role="alert" tabindex="-1" [class]="classes()">
      <ng-icon [name]="icon()" aria-hidden="true" />
      <div
        data-slot="alert-title"
        class="font-medium group-has-[>ng-icon]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
      >
        {{ title() }}
      </div>
      <div
        data-slot="alert-description"
        class="text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
      >
        {{ description() }}
      </div>
    </div>
  `,
})
export class InviteAlert {
  readonly kind = input.required<InviteAlertKind>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  protected readonly classes = computed(
    () =>
      `${this.kind() === 'info' ? NEUTRAL : DESTRUCTIVE} outline-offset-2 focus:outline-2 focus:outline-ring`,
  );
  protected readonly icon = computed(() => {
    const icons = {
      error: 'lucideCircleAlert',
      offline: 'lucideWifiOff',
      info: 'lucideInfo',
    } as const;
    return icons[this.kind()];
  });

  focus(): void {
    this.box().nativeElement.focus();
  }
}
