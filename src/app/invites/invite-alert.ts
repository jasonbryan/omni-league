import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideInfo, lucideWifiOff } from '@ng-icons/lucide';
import { ConvexConnection, offlineTitle } from '../core/data/convex';
import { ALERT_DESTRUCTIVE, ALERT_NEUTRAL } from '../organizations/admin/admin-alert';

export type InviteAlertKind = 'error' | 'offline' | 'info';

/** An `offline` alert takes its title from the connection's cause, so it never disagrees with the offline note, and its `title` input is not used. Takes focus through `focus()` and shows the focus ring the mockup draws, because focus moves to it from a button that has just gone. */
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
        {{ heading() }}
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
  readonly title = input<string>();
  readonly description = input.required<string>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly cause = inject(ConvexConnection).cause;

  protected readonly heading = computed(() =>
    this.kind() === 'offline' ? offlineTitle(this.cause()) : (this.title() ?? ''),
  );

  protected readonly classes = computed(
    () =>
      `${this.kind() === 'info' ? ALERT_NEUTRAL : ALERT_DESTRUCTIVE} outline-offset-2 focus:outline-2 focus:outline-ring`,
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
