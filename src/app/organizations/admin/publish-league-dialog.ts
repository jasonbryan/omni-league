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
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';

/** The league the dialog asks about: its id for `leagues.publish`, its name for the copy. */
export interface PublishTarget {
  leagueId: Id<'leagues'>;
  name: string;
}

/** How the dialog ended: the league that was asked about, and whether it is now published. */
export interface PublishOutcome extends PublishTarget {
  published: boolean;
}

/** The text of each failure alert (design/mockups/66-69-organization-leagues.html state 12). */
export const PUBLISH_ALERTS = {
  failed: {
    title: 'The league could not be published.',
    description: 'Check your connection and try again.',
  },
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "The league is still a draft. Try again when you're connected.",
  },
} as const;

type PublishAlert = keyof typeof PUBLISH_ALERTS;

// The mockup's classes (helm Nova alert dialog, size default), unmerged. The mockup centres the
// content with `fixed` and a translate; here the CDK's global position strategy centres the pane,
// and the content is its normal-flow child, so the `role="alertdialog"` container that wraps it
// has the dialog's own box (a container around a fixed child has none, and reads as hidden).
const CONTENT =
  'group/alert-dialog-content grid w-[calc(100vw-2rem)] bg-popover text-popover-foreground ring-foreground/10 gap-4 rounded-xl p-4 ring-1 shadow-xl data-[size=default]:max-w-xs data-[size=default]:sm:max-w-sm';
const HEADER =
  'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-start sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]';
const MEDIA =
  "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-accent text-accent-foreground sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(6)]";
const TITLE =
  'text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2';
const DESCRIPTION =
  'text-muted-foreground *:[a]:hover:text-foreground text-sm text-balance md:text-pretty *:[a]:underline *:[a]:underline-offset-3 sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2';
const FOOTER =
  'bg-muted/50 -mx-4 -mb-4 rounded-b-xl border-t p-4 flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end';

/**
 * The publish confirmation (#69; design/mockups/66-69-organization-leagues.html states 9 to 12): a
 * helm-style alert dialog, from the brain `alert-dialog` primitives with the mockup's classes as
 * static strings (the admin chunks load no class-merging code, button-classes.ts). `open(league)`
 * opens it for one league from the row's Publish button. Its scrim is the phone-menu sheet's
 * `bg-foreground/50` with no blur, not helm's. Focus starts on Cancel. Cancel and Escape close it
 * and write nothing (Escape is handled here, because the brain dialog reads `disableClose` only
 * when it opens); a press outside does not. While `leagues.publish` runs the button reads
 * "Publishing…" and the dialog stays open and cannot be dismissed. A failure (or the offline
 * refusal of angular.md, State and data) shows the destructive alert inside the dialog, takes
 * focus, and leaves the league a draft. Focus is not restored by the dialog: `dismissed` tells the
 * page how it ended, and the page puts focus where it belongs once the page behind is no longer
 * inert.
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
                [title]="alerts[kind].title"
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

  /** The dialog ended, after it left the page: the league and whether it was published. */
  readonly dismissed = output<PublishOutcome>();

  protected readonly online = injectOnline();
  protected readonly alerts = PUBLISH_ALERTS;
  protected readonly contentClass = CONTENT;
  protected readonly headerClass = HEADER;
  protected readonly mediaClass = MEDIA;
  protected readonly titleClass = TITLE;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly footerClass = FOOTER;
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

  /** Whether the dialog is open: the page behind it is inert while it is. */
  readonly isOpen = computed(() => this.dialog().stateComputed() === 'open');

  /** Opens the confirmation for `league`. */
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

  /** The dialog has left the page. */
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
