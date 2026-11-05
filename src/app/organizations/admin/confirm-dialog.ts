import { Dialog } from '@angular/cdk/dialog';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle } from '@ng-icons/lucide';
import {
  BrnAlertDialog,
  BrnAlertDialogContent,
  BrnAlertDialogDescription,
  BrnAlertDialogOverlay,
  BrnAlertDialogTitle,
} from '@spartan-ng/brain/alert-dialog';
import { BrnDialogService } from '@spartan-ng/brain/dialog';
import { injectOnline } from '../../core/data/convex';
import { provideSpartanOverlay } from '../../ui/utils/provide-spartan-overlay';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import {
  ALERT_DIALOG_CONTENT,
  ALERT_DIALOG_DESCRIPTION,
  ALERT_DIALOG_FOOTER,
  ALERT_DIALOG_HEADER,
  ALERT_DIALOG_MEDIA,
  ALERT_DIALOG_TITLE,
} from './alert-dialog-classes';
import type { AlertText, AlertTexts, OfflineAlertText } from './alert-text';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';

export type ConfirmAlertView =
  ({ kind: 'offline' } & OfflineAlertText) | ({ kind: 'failed' } & AlertText);

type ConfirmAlertKind = 'failed' | 'offline';

export function confirmAlertView(
  kind: ConfirmAlertKind,
  texts: AlertTexts<ConfirmAlertKind>,
): ConfirmAlertView {
  return kind === 'offline'
    ? { kind, description: texts.offline.description }
    : { kind, title: texts.failed.title, description: texts.failed.description };
}

const CHOICE_CONTENT = 'max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]';

/**
 * Its scrim is the phone-menu sheet's `bg-foreground/50` with no blur, not helm's. Escape is handled here, because the brain dialog reads `disableClose` only when it opens.
 * Focus is not restored by the dialog: the host reports how it ended, and the page puts focus where it belongs once the page behind is no longer inert.
 * `ng-icon` looks icons up through the injector, so the host component provides the icon it names.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    BrnAlertDialog,
    BrnAlertDialogContent,
    BrnAlertDialogDescription,
    BrnAlertDialogOverlay,
    BrnAlertDialogTitle,
    NgIcon,
    NgTemplateOutlet,
  ],
  providers: [
    provideIcons({ lucideLoaderCircle }),
    provideSpartanOverlay(Dialog, BrnDialogService),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-alert-dialog
      [role]="choice() ? 'dialog' : 'alertdialog'"
      [autoFocus]="focusTarget()"
      [restoreFocus]="false"
      [disableClose]="true"
      (closed)="closed.emit()"
    >
      <brn-alert-dialog-overlay class="bg-foreground/50" />
      <div
        *brnAlertDialogContent
        data-slot="alert-dialog-content"
        data-size="default"
        tabindex="-1"
        [class]="contentClass()"
        (keydown.escape)="cancel()"
      >
        <div data-slot="alert-dialog-header" [class]="headerClass">
          <div data-slot="alert-dialog-media" [class]="mediaClass">
            <ng-icon [name]="icon()" aria-hidden="true" />
          </div>
          <h2 brnAlertDialogTitle data-slot="alert-dialog-title" [class]="titleClass">
            {{ heading() }}
          </h2>
          <div
            brnAlertDialogDescription
            data-slot="alert-dialog-description"
            [class]="descriptionClass"
          >
            <ng-content />
            @if (!choice()) {
              <ng-container *ngTemplateOutlet="alertView; context: { margin: 'mt-3' }" />
            }
          </div>
        </div>
        @if (choice()) {
          <div class="-mx-4 overflow-y-auto px-4">
            <ng-content select="[confirm-body]" />
            <ng-container *ngTemplateOutlet="alertView; context: { margin: 'mt-4' }" />
          </div>
        }
        <div data-slot="alert-dialog-footer" [class]="footerClass">
          <button
            [attr.id]="cancelId()"
            type="button"
            data-slot="button"
            [class]="cancelClass"
            [attr.aria-disabled]="pending() ? 'true' : null"
            (click)="cancel()"
          >
            Cancel
          </button>
          <button
            type="button"
            data-slot="button"
            [class]="confirmClass()"
            [attr.aria-disabled]="pending() || !online() ? 'true' : null"
            (click)="confirmed.emit()"
          >
            @if (pending()) {
              <ng-icon
                name="lucideLoaderCircle"
                class="motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />{{ pendingLabel() }}
            } @else {
              @if (buttonIcon()) {
                <ng-icon [name]="icon()" data-icon="inline-start" aria-hidden="true" />
              }
              {{ confirmLabel() }}
            }
          </button>
        </div>
      </div>
    </brn-alert-dialog>
    <ng-template #alertView let-margin="margin">
      @if (alert(); as alert) {
        @if (alert.kind === 'offline') {
          <app-admin-offline-alert #alertBox [class]="margin" [description]="alert.description" />
        } @else {
          <app-admin-alert
            #alertBox
            [class]="margin"
            kind="error"
            [title]="alert.title"
            [description]="alert.description"
          />
        }
      }
    </ng-template>
  `,
})
export class ConfirmDialog {
  private readonly injector = inject(Injector);

  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly pendingLabel = input.required<string>();
  readonly cancelId = input<string>();
  /** A selector for the element to focus on open; Cancel when unset. */
  readonly autoFocus = input<string>();
  readonly variant = input<'primary' | 'destructive'>('primary');
  readonly buttonIcon = input(true, { transform: booleanAttribute });
  readonly pending = input(false, { transform: booleanAttribute });
  readonly alert = input<ConfirmAlertView | null>(null);
  /** A dialog that asks for a choice: it takes a body between the header and the footer, and the alert goes in that body. */
  readonly choice = input(false, { transform: booleanAttribute });

  readonly confirmed = output();
  readonly closed = output();

  protected readonly online = injectOnline();
  protected readonly headerClass = ALERT_DIALOG_HEADER;
  protected readonly mediaClass = ALERT_DIALOG_MEDIA;
  protected readonly titleClass = ALERT_DIALOG_TITLE;
  protected readonly descriptionClass = ALERT_DIALOG_DESCRIPTION;
  protected readonly footerClass = ALERT_DIALOG_FOOTER;
  protected readonly cancelClass = OUTLINE_BUTTON;

  protected readonly contentClass = computed(() =>
    this.choice() ? `${ALERT_DIALOG_CONTENT} ${CHOICE_CONTENT}` : ALERT_DIALOG_CONTENT,
  );
  protected readonly focusTarget = computed(() => this.autoFocus() ?? `#${this.cancelId()}`);
  protected readonly confirmClass = computed(() => {
    const base = this.variant() === 'destructive' ? DESTRUCTIVE_BUTTON : PRIMARY_BUTTON;
    return !this.online() && !this.pending() ? `${base} opacity-50` : base;
  });

  private readonly dialog = viewChild.required(BrnAlertDialog);
  private readonly alertBox = viewChild<AdminAlert | AdminOfflineAlert>('alertBox');

  readonly isOpen = computed(() => this.dialog().stateComputed() === 'open');

  open(): void {
    this.dialog().open();
  }

  close(): void {
    this.dialog().close();
  }

  focusAlert(): void {
    afterNextRender(() => this.alertBox()?.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    if (this.pending()) return;
    this.close();
  }
}
