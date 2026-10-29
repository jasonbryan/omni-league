import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideInfo } from '@ng-icons/lucide';
import {
  ALERT_DESCRIPTION,
  ALERT_DESTRUCTIVE,
  ALERT_NEUTRAL,
  ALERT_TITLE,
} from '../organizations/admin/admin-alert';

export type InviteAlertKind = 'error' | 'info';

/** Takes focus through `focus()` and shows the focus ring the mockup draws, because focus moves to it from a button that has just gone. */
@Component({
  selector: 'app-invite-alert',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideInfo })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div #box data-slot="alert" role="alert" tabindex="-1" [class]="classes()">
      <ng-icon [name]="icon()" aria-hidden="true" />
      <div data-slot="alert-title" [class]="titleClass">{{ title() }}</div>
      <div data-slot="alert-description" [class]="descriptionClass">{{ description() }}</div>
    </div>
  `,
})
export class InviteAlert {
  readonly kind = input.required<InviteAlertKind>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  protected readonly titleClass = ALERT_TITLE;
  protected readonly descriptionClass = ALERT_DESCRIPTION;

  protected readonly classes = computed(
    () =>
      `${this.kind() === 'info' ? ALERT_NEUTRAL : ALERT_DESTRUCTIVE} outline-offset-2 focus:outline-2 focus:outline-ring`,
  );
  protected readonly icon = computed(() => {
    const icons = {
      error: 'lucideCircleAlert',
      info: 'lucideInfo',
    } as const;
    return icons[this.kind()];
  });

  focus(): void {
    this.box().nativeElement.focus();
  }
}
