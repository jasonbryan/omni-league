import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideGlobe } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import type { AlertTexts } from './alert-text';
import { confirmAlertView, ConfirmDialog } from './confirm-dialog';

export interface PublishTarget {
  leagueId: Id<'leagues'>;
  name: string;
  slug: string;
}

export interface PublishOutcome extends PublishTarget {
  published: boolean;
}

type PublishAlert = 'failed' | 'offline';

export const PUBLISH_ALERTS = {
  failed: {
    title: 'The league could not be published.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "The league is still a draft. Try again when you're connected.",
  },
} as const satisfies AlertTexts<PublishAlert>;

@Component({
  selector: 'app-publish-league-dialog',
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideGlobe })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      icon="lucideGlobe"
      cancelId="publish-cancel"
      confirmLabel="Publish league"
      pendingLabel="Publishing…"
      [heading]="heading()"
      [pending]="publishing()"
      [alert]="alertView()"
      (confirmed)="publish()"
      (closed)="onClosed()"
    >
      <p>It will appear on your public page. Leagues can’t be unpublished yet.</p>
    </app-confirm-dialog>
  `,
})
export class PublishLeagueDialog {
  private readonly publishLeague = injectMutation(api.leagues.publish);

  readonly dismissed = output<PublishOutcome>();

  protected readonly online = injectOnline();

  protected readonly target = signal<PublishTarget | null>(null);
  protected readonly publishing = signal(false);
  private readonly alert = signal<PublishAlert | null>(null);
  protected readonly heading = computed(() => `Publish ${this.target()?.name}?`);
  protected readonly alertView = computed(() => {
    const kind = this.alert();
    return kind ? confirmAlertView(kind, PUBLISH_ALERTS) : null;
  });

  private readonly dialog = viewChild.required(ConfirmDialog);
  private published = false;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(league: PublishTarget): void {
    this.target.set(league);
    this.alert.set(null);
    this.published = false;
    this.dialog().open();
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
    this.dialog().focusAlert();
  }
}
