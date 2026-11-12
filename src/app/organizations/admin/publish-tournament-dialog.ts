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

export interface PublishTournamentTarget {
  tournamentId: Id<'tournaments'>;
  name: string;
}

export interface PublishTournamentOutcome extends PublishTournamentTarget {
  published: boolean;
}

type PublishAlert = 'failed' | 'offline';

export const PUBLISH_TOURNAMENT_ALERTS = {
  failed: {
    title: 'The tournament could not be published.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "The tournament is still a draft. Try again when you're connected.",
  },
} as const satisfies AlertTexts<PublishAlert>;

@Component({
  selector: 'app-publish-tournament-dialog',
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideGlobe })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      icon="lucideGlobe"
      cancelId="publish-cancel"
      confirmLabel="Publish tournament"
      pendingLabel="Publishing…"
      [heading]="heading()"
      [pending]="publishing()"
      [alert]="alertView()"
      (confirmed)="publish()"
      (closed)="onClosed()"
    >
      <p>Its page will be public. Tournaments can’t be unpublished yet.</p>
    </app-confirm-dialog>
  `,
})
export class PublishTournamentDialog {
  private readonly publishTournament = injectMutation(api.tournaments.publish);

  readonly dismissed = output<PublishTournamentOutcome>();

  protected readonly online = injectOnline();

  protected readonly target = signal<PublishTournamentTarget | null>(null);
  protected readonly publishing = signal(false);
  private readonly alert = signal<PublishAlert | null>(null);
  protected readonly heading = computed(() => `Publish ${this.target()?.name}?`);
  protected readonly alertView = computed(() => {
    const kind = this.alert();
    return kind ? confirmAlertView(kind, PUBLISH_TOURNAMENT_ALERTS) : null;
  });

  private readonly dialog = viewChild.required(ConfirmDialog);
  private published = false;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(tournament: PublishTournamentTarget): void {
    this.target.set(tournament);
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
      await this.publishTournament.run({ tournamentId: target.tournamentId });
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
