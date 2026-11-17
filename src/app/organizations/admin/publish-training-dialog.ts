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
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import type { AlertText, OfflineAlertText } from './alert-text';
import { ConfirmDialog, type ConfirmAlertView } from './confirm-dialog';

export interface PublishTrainingTarget {
  trainingId: Id<'trainings'>;
  name: string;
}

export interface PublishTrainingOutcome extends PublishTrainingTarget {
  published: boolean;
}

const FAILED: AlertText = {
  title: 'The training program could not be published.',
  description: 'Check your connection and try again.',
};

const OFFLINE: OfflineAlertText = {
  description: "The training program is still a draft. Try again when you're connected.",
};

@Component({
  selector: 'app-publish-training-dialog',
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideGlobe })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      icon="lucideGlobe"
      cancelId="publish-cancel"
      confirmLabel="Publish training program"
      pendingLabel="Publishing…"
      [heading]="heading()"
      [pending]="publishing()"
      [alert]="alert()"
      (confirmed)="publish()"
      (closed)="onClosed()"
    >
      <p>Its page will be public. Training programs can’t be unpublished yet.</p>
    </app-confirm-dialog>
  `,
})
export class PublishTrainingDialog {
  private readonly publishTraining = injectMutation(api.trainings.publish);

  readonly dismissed = output<PublishTrainingOutcome>();

  protected readonly online = injectOnline();

  protected readonly target = signal<PublishTrainingTarget | null>(null);
  protected readonly publishing = signal(false);
  protected readonly alert = signal<ConfirmAlertView | null>(null);
  protected readonly heading = computed(() => `Publish ${this.target()?.name}?`);

  private readonly dialog = viewChild.required(ConfirmDialog);
  private published = false;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(training: PublishTrainingTarget): void {
    this.target.set(training);
    this.alert.set(null);
    this.published = false;
    this.dialog().open();
  }

  protected async publish(): Promise<void> {
    const target = this.target();
    if (!target || this.publishing()) return;
    this.alert.set(null);
    if (!this.online()) return this.fail({ kind: 'offline', ...OFFLINE });
    this.publishing.set(true);
    try {
      await this.publishTraining.run({ trainingId: target.trainingId });
    } catch (failure) {
      this.publishing.set(false);
      return this.fail(failureView(failure));
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

  private fail(view: ConfirmAlertView): void {
    this.alert.set(view);
    this.dialog().focusAlert();
  }
}

function failureView(failure: unknown): ConfirmAlertView {
  if (failure instanceof ConvexOfflineError) return { kind: 'offline', ...OFFLINE };
  const refusal = failure instanceof ConvexError ? (failure.data as { message?: unknown }) : null;
  const message = typeof refusal?.message === 'string' ? refusal.message : null;
  return { kind: 'failed', ...FAILED, ...(message && { description: message }) };
}
