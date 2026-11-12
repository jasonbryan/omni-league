import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideInfo, lucideListOrdered, lucideUsers } from '@ng-icons/lucide';
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from '../ui/alert';

/** `notice` is a refusal the user resolves themselves, such as signing in with another account: neutral, with the alert icon. `full` is a refusal because the team has no room, and `waitlist` one because the person's own team is on the waitlist. */
export type InviteAlertKind = 'error' | 'notice' | 'info' | 'full' | 'waitlist';

/** Takes focus through `focus()` and shows the focus ring the mockup draws, because focus moves to it from a button that has just gone. */
@Component({
  selector: 'app-invite-alert',
  imports: [HlmAlert, HlmAlertDescription, HlmAlertTitle, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideInfo, lucideListOrdered, lucideUsers })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      #box
      hlmAlert
      [variant]="variant()"
      role="alert"
      tabindex="-1"
      class="outline-offset-2 focus:outline-2 focus:outline-ring"
    >
      <ng-icon [name]="icon()" aria-hidden="true" />
      <div hlmAlertTitle>{{ title() }}</div>
      <div hlmAlertDescription>{{ description() }}</div>
    </div>
  `,
})
export class InviteAlert {
  readonly kind = input.required<InviteAlertKind>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  protected readonly variant = computed(() =>
    this.kind() === 'error' ? 'destructive' : 'default',
  );
  protected readonly icon = computed(() => {
    const icons = {
      error: 'lucideCircleAlert',
      notice: 'lucideCircleAlert',
      info: 'lucideInfo',
      full: 'lucideUsers',
      waitlist: 'lucideListOrdered',
    } as const;
    return icons[this.kind()];
  });

  focus(): void {
    this.box().nativeElement.focus();
  }
}
