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
import { injectOfflineCause, offlineTitle } from '../../core/data/convex';
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from '../../ui/alert';

/**
 * Takes its title from the connection's cause, so it never disagrees with the offline note.
 * The caller sets the margin with a class on the element.
 */
@Component({
  selector: 'app-admin-offline-alert',
  imports: [HlmAlert, HlmAlertDescription, HlmAlertTitle, NgIcon],
  providers: [provideIcons({ lucideWifiOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div #box hlmAlert variant="destructive" role="alert" tabindex="-1">
      <ng-icon name="lucideWifiOff" aria-hidden="true" />
      <div hlmAlertTitle>{{ title() }}</div>
      <div hlmAlertDescription>
        {{ description() }}
        <ng-content />
      </div>
    </div>
  `,
})
export class AdminOfflineAlert {
  readonly description = input.required<string>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly cause = injectOfflineCause();

  protected readonly title = computed(() => offlineTitle(this.cause()));

  focus(): void {
    this.box().nativeElement.focus();
  }
}
