import { Dialog } from '@angular/cdk/dialog';
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
import { lucideGlobe, lucideLoaderCircle } from '@ng-icons/lucide';
import {
  BrnAlertDialog,
  BrnAlertDialogContent,
  BrnAlertDialogDescription,
  BrnAlertDialogOverlay,
  BrnAlertDialogTitle,
} from '@spartan-ng/brain/alert-dialog';
import { BrnDialogService } from '@spartan-ng/brain/dialog';
import type { Id } from '../../../../convex/_generated/dataModel';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import {
  ALERT_DIALOG_CONTENT,
  ALERT_DIALOG_DESCRIPTION,
  ALERT_DIALOG_FOOTER,
  ALERT_DIALOG_HEADER,
  ALERT_DIALOG_MEDIA,
  ALERT_DIALOG_TITLE,
} from '../admin/alert-dialog-classes';
import { AlertText, OfflineAlertText } from '../admin/alert-text';
import { AdminAlert } from '../admin/admin-alert';
import { AdminOfflineAlert } from '../admin/admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../admin/button-classes';
import { provideSpartanOverlay } from '../../ui/utils/provide-spartan-overlay';

export interface PublishSeasonTarget {
  seasonId: Id<'seasons'>;
  name: string;
  registrationDeadline: string;
  leagueName: string;
}

export interface PublishSeasonOutcome {
  seasonId: Id<'seasons'>;
  name: string;
  published: boolean;
}

type PublishAlertView = ({ kind: 'offline' } & OfflineAlertText) | ({ kind: 'failed' } & AlertText);

function alertText(kind: PublishAlert, name: string): PublishAlertView {
  return kind === 'offline'
    ? { kind, description: `${name} is still a draft. Try again when you're connected.` }
    : {
        kind,
        title: 'The season could not be published.',
        description: 'Check your connection and try again.',
      };
}

type PublishAlert = 'failed' | 'offline';

/**
 * Its scrim is the phone-menu sheet's `bg-foreground/50` with no blur, not helm's. Escape is handled here, because the brain dialog reads `disableClose` only when it opens.
 * Focus is not restored by the dialog: `dismissed` tells the page how it ended, and the page puts focus where it belongs once the page behind is no longer inert.
 */
@Component({
  selector: 'app-publish-season-dialog',
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
    provideIcons({ lucideGlobe, lucideLoaderCircle }),
    provideSpartanOverlay(Dialog, BrnDialogService),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-alert-dialog
      [autoFocus]="'#publish-season-cancel'"
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
            <ng-icon name="lucideGlobe" aria-hidden="true" />
          </div>
          <h2 brnAlertDialogTitle data-slot="alert-dialog-title" [class]="titleClass">
            Publish {{ target()?.name }}?
          </h2>
          <div
            brnAlertDialogDescription
            data-slot="alert-dialog-description"
            [class]="descriptionClass"
          >
            <p>
              It will appear on {{ target()?.leagueName }}’s public page, and players can register
              until {{ deadline() }}. Seasons can’t be unpublished yet.
            </p>
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
            id="publish-season-cancel"
            type="button"
            data-slot="button"
            [class]="cancelClass"
            [attr.aria-disabled]="publishing() ? 'true' : null"
            (click)="cancel()"
          >
            Cancel
          </button>
          <button
            type="button"
            data-slot="button"
            [class]="publishClass()"
            [attr.aria-disabled]="publishing() || !online() ? 'true' : null"
            (click)="publish()"
          >
            @if (publishing()) {
              <ng-icon
                name="lucideLoaderCircle"
                class="motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />Publishing…
            } @else {
              <ng-icon name="lucideGlobe" data-icon="inline-start" aria-hidden="true" />Publish
              season
            }
          </button>
        </div>
      </div>
    </brn-alert-dialog>
  `,
})
export class PublishSeasonDialog {
  private readonly injector = inject(Injector);
  private readonly publishSeason = injectMutation(api.seasons.publish);

  readonly dismissed = output<PublishSeasonOutcome>();

  protected readonly online = injectOnline();
  protected readonly contentClass = ALERT_DIALOG_CONTENT;
  protected readonly headerClass = ALERT_DIALOG_HEADER;
  protected readonly mediaClass = ALERT_DIALOG_MEDIA;
  protected readonly titleClass = ALERT_DIALOG_TITLE;
  protected readonly descriptionClass = ALERT_DIALOG_DESCRIPTION;
  protected readonly footerClass = ALERT_DIALOG_FOOTER;
  protected readonly cancelClass = OUTLINE_BUTTON;

  protected readonly target = signal<PublishSeasonTarget | null>(null);
  protected readonly publishing = signal(false);
  private readonly failure = signal<PublishAlert | null>(null);
  protected readonly alert = computed(() => {
    const kind = this.failure();
    const target = this.target();
    return kind && target ? alertText(kind, target.name) : null;
  });
  protected readonly deadline = computed(() => {
    const target = this.target();
    return target ? formatCalendarDate(target.registrationDeadline) : '';
  });
  protected readonly publishClass = computed(() =>
    !this.online() && !this.publishing() ? `${PRIMARY_BUTTON} opacity-50` : PRIMARY_BUTTON,
  );

  private readonly dialog = viewChild.required(BrnAlertDialog);
  private readonly alertBox = viewChild<AdminAlert | AdminOfflineAlert>('alertBox');
  private published = false;

  readonly isOpen = computed(() => this.dialog().stateComputed() === 'open');

  open(season: PublishSeasonTarget): void {
    this.target.set(season);
    this.failure.set(null);
    this.published = false;
    this.dialog().open();
  }

  protected cancel(): void {
    if (this.publishing()) return;
    this.dialog().close();
  }

  protected async publish(): Promise<void> {
    const target = this.target();
    if (!target || this.publishing()) return;
    this.failure.set(null);
    if (!this.online()) return this.fail('offline');
    this.publishing.set(true);
    try {
      await this.publishSeason.run({ seasonId: target.seasonId });
    } catch (error) {
      this.publishing.set(false);
      return this.fail(error instanceof ConvexOfflineError ? 'offline' : 'failed');
    }
    this.publishing.set(false);
    this.published = true;
    this.dialog().close();
  }

  protected onClosed(): void {
    const target = this.target();
    if (!target) return;
    this.dismissed.emit({
      seasonId: target.seasonId,
      name: target.name,
      published: this.published,
    });
  }

  private fail(kind: PublishAlert): void {
    this.failure.set(kind);
    afterNextRender(() => this.alertBox()?.focus(), { injector: this.injector });
  }
}
