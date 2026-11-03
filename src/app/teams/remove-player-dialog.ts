import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle, lucideUserMinus } from '@ng-icons/lucide';
import {
  BrnAlertDialog,
  BrnAlertDialogContent,
  BrnAlertDialogDescription,
  BrnAlertDialogOverlay,
  BrnAlertDialogTitle,
} from '@spartan-ng/brain/alert-dialog';
import { BrnDialogService } from '@spartan-ng/brain/dialog';
import type { Id } from '../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import {
  ALERT_DIALOG_CONTENT,
  ALERT_DIALOG_DESCRIPTION,
  ALERT_DIALOG_FOOTER,
  ALERT_DIALOG_HEADER,
  ALERT_DIALOG_MEDIA,
  ALERT_DIALOG_TITLE,
} from '../organizations/admin/alert-dialog-classes';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON } from '../ui/button/button-classes';
import { provideSpartanOverlay } from '../ui/utils/provide-spartan-overlay';
import { removeFailureOf, removeFailureText, type RemoveFailure } from './remove-player-text';

export interface RemovePlayerTarget {
  rosterEntryId: Id<'rosterEntries'>;
  name: string;
}

export interface RemovePlayerOutcome extends RemovePlayerTarget {
  removed: boolean;
}

/**
 * Built like the remove-logo dialog: Escape is handled here, because the brain dialog reads `disableClose` only when it opens, and the dialog does not
 * restore focus: `dismissed` tells the page how it ended, and the page puts focus where it belongs once the page behind is no longer inert.
 */
@Component({
  selector: 'app-remove-player-dialog',
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
  providers: [
    provideIcons({ lucideLoaderCircle, lucideUserMinus }),
    provideSpartanOverlay(Dialog, BrnDialogService),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-alert-dialog
      [autoFocus]="'#remove-player-cancel'"
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
            <ng-icon name="lucideUserMinus" aria-hidden="true" />
          </div>
          <h2 brnAlertDialogTitle data-slot="alert-dialog-title" [class]="titleClass">
            Remove {{ target()?.name }} from {{ teamName() }}?
          </h2>
          <div
            brnAlertDialogDescription
            data-slot="alert-dialog-description"
            [class]="descriptionClass"
          >
            <p>They’ll lose access to the team page. You can invite them again later.</p>
            @if (alert(); as alert) {
              @if (alert.kind === 'offline') {
                <app-admin-offline-alert #alertBox class="mt-3" [description]="alert.description" />
              } @else {
                <app-admin-alert
                  #alertBox
                  class="mt-3"
                  kind="error"
                  [title]="alert.title"
                  [description]="alert.description"
                />
              }
            }
          </div>
        </div>
        <div data-slot="alert-dialog-footer" [class]="footerClass">
          <button
            id="remove-player-cancel"
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
              <ng-icon name="lucideUserMinus" data-icon="inline-start" aria-hidden="true" />Remove
              player
            }
          </button>
        </div>
      </div>
    </brn-alert-dialog>
  `,
})
export class RemovePlayerDialog {
  private readonly injector = inject(Injector);
  private readonly removeEntry = injectMutation(api.rosterEntries.remove);

  readonly teamName = input.required<string>();
  readonly dismissed = output<RemovePlayerOutcome>();

  protected readonly online = injectOnline();
  protected readonly contentClass = ALERT_DIALOG_CONTENT;
  protected readonly headerClass = ALERT_DIALOG_HEADER;
  protected readonly mediaClass = ALERT_DIALOG_MEDIA;
  protected readonly titleClass = ALERT_DIALOG_TITLE;
  protected readonly descriptionClass = ALERT_DIALOG_DESCRIPTION;
  protected readonly footerClass = ALERT_DIALOG_FOOTER;
  protected readonly cancelClass = OUTLINE_BUTTON;

  protected readonly target = signal<RemovePlayerTarget | null>(null);
  protected readonly removing = signal(false);
  private readonly failure = signal<RemoveFailure | null>(null);

  protected readonly alert = computed(() => {
    const failure = this.failure();
    const target = this.target();
    return failure && target ? removeFailureText(failure, target.name) : null;
  });
  protected readonly removeClass = computed(() =>
    !this.online() && !this.removing() ? `${DESTRUCTIVE_BUTTON} opacity-50` : DESTRUCTIVE_BUTTON,
  );

  private readonly dialog = viewChild.required(BrnAlertDialog);
  private readonly alertBox = viewChild<AdminAlert | AdminOfflineAlert>('alertBox');
  private removed = false;

  readonly isOpen = computed(() => this.dialog().stateComputed() === 'open');

  open(target: RemovePlayerTarget): void {
    this.target.set(target);
    this.failure.set(null);
    this.removed = false;
    this.dialog().open();
  }

  protected cancel(): void {
    if (this.removing()) return;
    this.dialog().close();
  }

  protected async remove(): Promise<void> {
    const target = this.target();
    if (!target || this.removing()) return;
    this.failure.set(null);
    if (!this.online()) return this.fail({ kind: 'offline' });
    this.removing.set(true);
    try {
      await this.removeEntry.run({ rosterEntryId: target.rosterEntryId });
    } catch (error) {
      this.removing.set(false);
      return this.fail(
        error instanceof ConvexOfflineError ? { kind: 'offline' } : removeFailureOf(error),
      );
    }
    this.removing.set(false);
    this.removed = true;
    this.dialog().close();
  }

  protected onClosed(): void {
    const target = this.target();
    if (!target) return;
    this.dismissed.emit({ ...target, removed: this.removed });
  }

  private fail(failure: RemoveFailure): void {
    this.failure.set(failure);
    afterNextRender(() => this.alertBox()?.focus(), { injector: this.injector });
  }
}
