import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImageOff, lucideLoaderCircle } from '@ng-icons/lucide';
import {
  BrnAlertDialog,
  BrnAlertDialogContent,
  BrnAlertDialogDescription,
  BrnAlertDialogOverlay,
  BrnAlertDialogTitle,
} from '@spartan-ng/brain/alert-dialog';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertTexts } from './alert-text';
import {
  ALERT_DIALOG_CONTENT,
  ALERT_DIALOG_DESCRIPTION,
  ALERT_DIALOG_FOOTER,
  ALERT_DIALOG_HEADER,
  ALERT_DIALOG_MEDIA,
  ALERT_DIALOG_TITLE,
} from './alert-dialog-classes';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON } from './button-classes';

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

/**
 * Built like the publish dialog: the dialog does not restore focus, and `dismissed` tells the page how it ended so the page puts focus where it belongs.
 */
@Component({
  selector: 'app-remove-logo-dialog',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    BrnAlertDialog,
    BrnAlertDialogContent,
    BrnAlertDialogDescription,
    BrnAlertDialogOverlay,
    BrnAlertDialogTitle,
    NgIcon,
  ],
  providers: [provideIcons({ lucideImageOff, lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-alert-dialog
      [autoFocus]="'#remove-logo-cancel'"
      [restoreFocus]="false"
      [disableClose]="true"
      (closed)="onClosed()"
    >
      <brn-alert-dialog-overlay class="bg-foreground/50" />
      <div
        *brnAlertDialogContent
        data-slot="alert-dialog-content"
        data-size="default"
        tabindex="-1"
        [class]="contentClass"
        (keydown.escape)="cancel()"
      >
        <div data-slot="alert-dialog-header" [class]="headerClass">
          <div data-slot="alert-dialog-media" [class]="mediaClass">
            <ng-icon name="lucideImageOff" aria-hidden="true" />
          </div>
          <h2 brnAlertDialogTitle data-slot="alert-dialog-title" [class]="titleClass">
            Remove the logo?
          </h2>
          <div
            brnAlertDialogDescription
            data-slot="alert-dialog-description"
            [class]="descriptionClass"
          >
            <p>
              Your public pages show the initials again. The image is deleted, so upload it again to
              bring it back.
            </p>
            @if (alert(); as kind) {
              @if (kind === 'offline') {
                <app-admin-offline-alert
                  #alertBox
                  [description]="alerts.offline.description"
                  class="mt-3"
                />
              } @else {
                <app-admin-alert
                  #alertBox
                  kind="error"
                  [title]="alerts[kind].title"
                  [description]="alerts[kind].description"
                  class="mt-3"
                />
              }
            }
          </div>
        </div>
        <div data-slot="alert-dialog-footer" [class]="footerClass">
          <button
            id="remove-logo-cancel"
            type="button"
            data-slot="button"
            [class]="cancelClass"
            [attr.aria-disabled]="removing() ? 'true' : null"
            (click)="cancel()"
          >
            Cancel
          </button>
          <button
            type="button"
            data-slot="button"
            [class]="removeClass()"
            [attr.aria-disabled]="removing() || !online() ? 'true' : null"
            (click)="remove()"
          >
            @if (removing()) {
              <ng-icon
                name="lucideLoaderCircle"
                class="motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />Removing…
            } @else {
              Remove logo
            }
          </button>
        </div>
      </div>
    </brn-alert-dialog>
  `,
})
export class RemoveLogoDialog {
  private readonly injector = inject(Injector);
  private readonly removeLogo = injectMutation(api.organizations.removeLogo);

  readonly dismissed = output<RemoveOutcome>();

  protected readonly online = injectOnline();
  protected readonly alerts = REMOVE_LOGO_ALERTS;
  protected readonly contentClass = ALERT_DIALOG_CONTENT;
  protected readonly headerClass = ALERT_DIALOG_HEADER;
  protected readonly mediaClass = ALERT_DIALOG_MEDIA;
  protected readonly titleClass = ALERT_DIALOG_TITLE;
  protected readonly descriptionClass = ALERT_DIALOG_DESCRIPTION;
  protected readonly footerClass = ALERT_DIALOG_FOOTER;
  protected readonly cancelClass = OUTLINE_BUTTON;

  protected readonly removing = signal(false);
  protected readonly alert = signal<RemoveAlert | null>(null);
  protected readonly removeClass = computed(() =>
    !this.online() && !this.removing() ? `${DESTRUCTIVE_BUTTON} opacity-50` : DESTRUCTIVE_BUTTON,
  );

  private readonly dialog = viewChild.required(BrnAlertDialog);
  private readonly alertBox = viewChild<AdminAlert | AdminOfflineAlert>('alertBox');
  private organizationId: Id<'organizations'> | null = null;
  private removed = false;

  readonly isOpen = computed(() => this.dialog().stateComputed() === 'open');

  open(organizationId: Id<'organizations'>): void {
    this.organizationId = organizationId;
    this.alert.set(null);
    this.removed = false;
    this.dialog().open();
  }

  protected cancel(): void {
    if (this.removing()) return;
    this.dialog().close();
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
    afterNextRender(() => this.alertBox()?.focus(), { injector: this.injector });
  }
}
