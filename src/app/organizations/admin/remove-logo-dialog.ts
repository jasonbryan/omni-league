import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideImageOff } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import type { AlertTexts } from './alert-text';
import { confirmAlertView, ConfirmDialog } from './confirm-dialog';

export interface RemoveOutcome {
  removed: boolean;
}

type RemoveAlert = 'failed' | 'offline';

export const REMOVE_LOGO_ALERTS = {
  failed: {
    title: 'The logo could not be removed.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "The logo is still in place. Try again when you're connected.",
  },
} as const satisfies AlertTexts<RemoveAlert>;

@Component({
  selector: 'app-remove-logo-dialog',
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideImageOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      icon="lucideImageOff"
      heading="Remove the logo?"
      cancelId="remove-logo-cancel"
      confirmLabel="Remove logo"
      pendingLabel="Removing…"
      variant="destructive"
      [buttonIcon]="false"
      [pending]="removing()"
      [alert]="alertView()"
      (confirmed)="remove()"
      (closed)="onClosed()"
    >
      <p>
        Your public pages show the initials again. The image is deleted, so upload it again to bring
        it back.
      </p>
    </app-confirm-dialog>
  `,
})
export class RemoveLogoDialog {
  private readonly removeLogo = injectMutation(api.organizations.removeLogo);

  readonly dismissed = output<RemoveOutcome>();

  protected readonly online = injectOnline();

  protected readonly removing = signal(false);
  private readonly alert = signal<RemoveAlert | null>(null);
  protected readonly alertView = computed(() => {
    const kind = this.alert();
    return kind ? confirmAlertView(kind, REMOVE_LOGO_ALERTS) : null;
  });

  private readonly dialog = viewChild.required(ConfirmDialog);
  private organizationId: Id<'organizations'> | null = null;
  private removed = false;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(organizationId: Id<'organizations'>): void {
    this.organizationId = organizationId;
    this.alert.set(null);
    this.removed = false;
    this.dialog().open();
  }

  protected async remove(): Promise<void> {
    const organizationId = this.organizationId;
    if (!organizationId || this.removing()) return;
    this.alert.set(null);
    if (!this.online()) return this.fail('offline');
    this.removing.set(true);
    try {
      await this.removeLogo.run({ organizationId });
    } catch (failure) {
      this.removing.set(false);
      return this.fail(failure instanceof ConvexOfflineError ? 'offline' : 'failed');
    }
    this.removing.set(false);
    this.removed = true;
    this.dialog().close();
  }

  protected onClosed(): void {
    if (!this.organizationId) return;
    this.dismissed.emit({ removed: this.removed });
  }

  private fail(kind: RemoveAlert): void {
    this.alert.set(kind);
    this.dialog().focusAlert();
  }
}
