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

export interface PublishCampTarget {
  campId: Id<'camps'>;
  name: string;
}

export interface PublishCampOutcome extends PublishCampTarget {
  published: boolean;
}

const FAILED: AlertText = {
  title: 'The camp could not be published.',
  description: 'Check your connection and try again.',
};

const OFFLINE: OfflineAlertText = {
  description: "The camp is still a draft. Try again when you're connected.",
};

@Component({
  selector: 'app-publish-camp-dialog',
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideGlobe })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      icon="lucideGlobe"
      cancelId="publish-cancel"
      confirmLabel="Publish camp"
      pendingLabel="Publishing…"
      [heading]="heading()"
      [pending]="publishing()"
      [alert]="alert()"
      (confirmed)="publish()"
      (closed)="onClosed()"
    >
      <p>Its page will be public. Camps can’t be unpublished yet.</p>
    </app-confirm-dialog>
  `,
})
export class PublishCampDialog {
  private readonly publishCamp = injectMutation(api.camps.publish);

  readonly dismissed = output<PublishCampOutcome>();

  protected readonly online = injectOnline();

  protected readonly target = signal<PublishCampTarget | null>(null);
  protected readonly publishing = signal(false);
  protected readonly alert = signal<ConfirmAlertView | null>(null);
  protected readonly heading = computed(() => `Publish ${this.target()?.name}?`);

  private readonly dialog = viewChild.required(ConfirmDialog);
  private published = false;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(camp: PublishCampTarget): void {
    this.target.set(camp);
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
      await this.publishCamp.run({ campId: target.campId });
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
