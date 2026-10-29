import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideWifiOff } from '@ng-icons/lucide';
import { injectOfflineCause, offlineTitle } from '../core/data/convex';
import {
  ALERT_DESCRIPTION,
  ALERT_DESTRUCTIVE,
  ALERT_TITLE,
} from '../organizations/admin/admin-alert';

/** Takes its title from the connection's cause, so it never disagrees with the offline note. Takes focus through `focus()` and shows the focus ring the mockup draws, because focus moves to it from a button that has just gone. */
@Component({
  selector: 'app-invite-offline-alert',
  imports: [NgIcon],
  providers: [provideIcons({ lucideWifiOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div #box data-slot="alert" role="alert" tabindex="-1" [class]="classes">
      <ng-icon name="lucideWifiOff" aria-hidden="true" />
      <div data-slot="alert-title" [class]="titleClass">{{ title() }}</div>
      <div data-slot="alert-description" [class]="descriptionClass">{{ description() }}</div>
    </div>
  `,
})
export class InviteOfflineAlert {
  readonly description = input.required<string>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly cause = injectOfflineCause();

  protected readonly title = computed(() => offlineTitle(this.cause()));
  protected readonly classes = `${ALERT_DESTRUCTIVE} outline-offset-2 focus:outline-2 focus:outline-ring`;
  protected readonly titleClass = ALERT_TITLE;
  protected readonly descriptionClass = ALERT_DESCRIPTION;

  focus(): void {
    this.box().nativeElement.focus();
  }
}
