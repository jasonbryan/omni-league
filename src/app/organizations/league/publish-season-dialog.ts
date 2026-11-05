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
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { ConfirmDialog, type ConfirmAlertView } from '../admin/confirm-dialog';

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

type PublishAlert = 'failed' | 'offline';

function alertText(kind: PublishAlert, name: string): ConfirmAlertView {
  return kind === 'offline'
    ? { kind, description: `${name} is still a draft. Try again when you're connected.` }
    : {
        kind,
        title: 'The season could not be published.',
        description: 'Check your connection and try again.',
      };
}

@Component({
  selector: 'app-publish-season-dialog',
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideGlobe })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      icon="lucideGlobe"
      cancelId="publish-season-cancel"
      confirmLabel="Publish season"
      pendingLabel="Publishing…"
      [heading]="heading()"
      [pending]="publishing()"
      [alert]="alert()"
      (confirmed)="publish()"
      (closed)="onClosed()"
    >
      <p>
        It will appear on {{ target()?.leagueName }}’s public page, and players can register until
        {{ deadline() }}. Seasons can’t be unpublished yet.
      </p>
    </app-confirm-dialog>
  `,
})
export class PublishSeasonDialog {
  private readonly publishSeason = injectMutation(api.seasons.publish);

  readonly dismissed = output<PublishSeasonOutcome>();

  protected readonly online = injectOnline();

  protected readonly target = signal<PublishSeasonTarget | null>(null);
  protected readonly publishing = signal(false);
  private readonly failure = signal<PublishAlert | null>(null);
  protected readonly heading = computed(() => `Publish ${this.target()?.name}?`);
  protected readonly alert = computed(() => {
    const kind = this.failure();
    const target = this.target();
    return kind && target ? alertText(kind, target.name) : null;
  });
  protected readonly deadline = computed(() => {
    const target = this.target();
    return target ? formatCalendarDate(target.registrationDeadline) : '';
  });

  private readonly dialog = viewChild.required(ConfirmDialog);
  private published = false;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(season: PublishSeasonTarget): void {
    this.target.set(season);
    this.failure.set(null);
    this.published = false;
    this.dialog().open();
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
    this.dialog().focusAlert();
  }
}
