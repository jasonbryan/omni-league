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
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from './admin-alert';
import {
  ALERT_DIALOG_CONTENT,
  ALERT_DIALOG_DESCRIPTION,
  ALERT_DIALOG_FOOTER,
  ALERT_DIALOG_HEADER,
  ALERT_DIALOG_MEDIA,
  ALERT_DIALOG_TITLE,
} from './alert-dialog-classes';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';

export interface PublishTarget {
  leagueId: Id<'leagues'>;
  name: string;
  slug: string;
}

export interface PublishOutcome extends PublishTarget {
  published: boolean;
}

export const PUBLISH_ALERTS = {
  failed: {
    title: 'The league could not be published.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "The league is still a draft. Try again when you're connected.",
  },
} as const;

type PublishAlert = keyof typeof PUBLISH_ALERTS;

/**
 * Its scrim is the phone-menu sheet's `bg-foreground/50` with no blur, not helm's. Escape is handled here, because the brain dialog reads `disableClose` only when it opens.
 * Focus is not restored by the dialog: `dismissed` tells the page how it ended, and the page puts focus where it belongs once the page behind is no longer inert.
 */
@Component({
  selector: 'app-publish-league-dialog',
  imports: [
    AdminAlert,
    BrnAlertDialog,
    BrnAlertDialogContent,
    BrnAlertDialogDescription,
    BrnAlertDialogOverlay,
    BrnAlertDialogTitle,
    NgIcon,
  ],
  providers: [provideIcons({ lucideGlobe, lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-alert-dialog
      [autoFocus]="'#publish-cancel'"
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
            <p>It will appear on your public page. Leagues can’t be unpublished yet.</p>
            @if (alert(); as kind) {
              <app-admin-alert
                #alertBox
                class="mt-3"
                [kind]="kind === 'offline' ? 'offline' : 'error'"
                [title]="kind === 'failed' ? alerts.failed.title : undefined"
                [description]="alerts[kind].description"
              />
            }
          </div>
        </div>
        <div data-slot="alert-dialog-footer" [class]="footerClass">
          <button
            id="publish-cancel"
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
              league
            }
          </button>
        </div>
      </div>
    </brn-alert-dialog>
  `,
})
export class PublishLeagueDialog {
  private readonly injector = inject(Injector);
  private readonly publishLeague = injectMutation(api.leagues.publish);

  readonly dismissed = output<PublishOutcome>();

  protected readonly online = injectOnline();
  protected readonly alerts = PUBLISH_ALERTS;
  protected readonly contentClass = ALERT_DIALOG_CONTENT;
  protected readonly headerClass = ALERT_DIALOG_HEADER;
  protected readonly mediaClass = ALERT_DIALOG_MEDIA;
  protected readonly titleClass = ALERT_DIALOG_TITLE;
  protected readonly descriptionClass = ALERT_DIALOG_DESCRIPTION;
  protected readonly footerClass = ALERT_DIALOG_FOOTER;
  protected readonly cancelClass = OUTLINE_BUTTON;

  protected readonly target = signal<PublishTarget | null>(null);
  protected readonly publishing = signal(false);
  protected readonly alert = signal<PublishAlert | null>(null);
  protected readonly publishClass = computed(() =>
    !this.online() && !this.publishing() ? `${PRIMARY_BUTTON} opacity-50` : PRIMARY_BUTTON,
  );

  private readonly dialog = viewChild.required(BrnAlertDialog);
  private readonly alertBox = viewChild<AdminAlert>('alertBox');
  private published = false;

  readonly isOpen = computed(() => this.dialog().stateComputed() === 'open');

  open(league: PublishTarget): void {
    this.target.set(league);
    this.alert.set(null);
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
    this.alert.set(null);
    if (!this.online()) return this.fail('offline');
    this.publishing.set(true);
    try {
      await this.publishLeague.run({ leagueId: target.leagueId });
    } catch (failure) {
      this.publishing.set(false);
      return this.fail(failure instanceof ConvexOfflineError ? 'offline' : 'failed');
    }
    this.publishing.set(false);
    this.published = true;
    this.dialog().close();
  }

  protected onClosed(): void {
    const target = this.target();
    if (!target) return;
    this.dismissed.emit({ ...target, published: this.published });
  }

  private fail(kind: PublishAlert): void {
    this.alert.set(kind);
    afterNextRender(() => this.alertBox()?.focus(), { injector: this.injector });
  }
}
