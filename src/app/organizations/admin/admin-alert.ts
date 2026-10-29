import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideCircleCheck, lucideEyeOff, lucideInfo } from '@ng-icons/lucide';

const BASE =
  "group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]";
export const ALERT_NEUTRAL = `${BASE} bg-card text-card-foreground`;
export const ALERT_DESTRUCTIVE = `${BASE} text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90`;

export const ALERT_TITLE =
  'font-medium group-has-[>ng-icon]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3';
export const ALERT_DESCRIPTION =
  'text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3';

export type AdminAlertKind = 'success' | 'error' | 'note' | 'info';

/**
 * The caller sets the margin with a class on the `app-admin-alert` element. Content inside the element (a link) follows the description, inside it, so an alert with content needs a description. */
@Component({
  selector: 'app-admin-alert',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideCircleCheck, lucideEyeOff, lucideInfo })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div #box data-slot="alert" [attr.role]="role()" tabindex="-1" [class]="classes()">
      <ng-icon [name]="icon()" aria-hidden="true" />
      <div data-slot="alert-title" [class]="titleClass">{{ title() }}</div>
      @if (description(); as description) {
        <div data-slot="alert-description" [class]="descriptionClass">
          {{ description }}
          <ng-content />
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

  protected readonly titleClass = ALERT_TITLE;
  protected readonly descriptionClass = ALERT_DESCRIPTION;

  protected readonly role = computed(() => {
    const kind = this.kind();
    return kind === 'success' ? 'status' : kind === 'note' || kind === 'info' ? 'note' : 'alert';
  });
  protected readonly classes = computed(() =>
    this.kind() === 'error' ? ALERT_DESTRUCTIVE : ALERT_NEUTRAL,
  );
  protected readonly icon = computed(() => {
    const icons = {
      success: 'lucideCircleCheck',
      error: 'lucideCircleAlert',
      note: 'lucideEyeOff',
      info: 'lucideInfo',
    } as const;
    return icons[this.kind()];
  });

  focus(): void {
    this.box().nativeElement.focus();
  }
}
