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
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from '../../ui/alert';

export type AdminAlertKind = 'success' | 'error' | 'note' | 'info';

/**
 * The caller sets the margin with a class on the `app-admin-alert` element. Content inside the element (a link) follows the description, inside it, so an alert with content needs a description. */
@Component({
  selector: 'app-admin-alert',
  imports: [HlmAlert, HlmAlertDescription, HlmAlertTitle, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideCircleCheck, lucideEyeOff, lucideInfo })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div #box hlmAlert [variant]="variant()" [attr.role]="role()" tabindex="-1">
      <ng-icon [name]="icon()" aria-hidden="true" />
      <div hlmAlertTitle>{{ title() }}</div>
      @if (description(); as description) {
        <div hlmAlertDescription>
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

  protected readonly role = computed(() => {
    const kind = this.kind();
    if (kind === 'info') return null;
    return kind === 'success' ? 'status' : kind === 'note' ? 'note' : 'alert';
  });
  protected readonly variant = computed(() =>
    this.kind() === 'error' ? 'destructive' : 'default',
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
