import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideUserMinus } from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../core/data/convex';
import { ConfirmDialog } from '../organizations/admin/confirm-dialog';
import { removeFailureOf, removeFailureText, type RemoveFailure } from './remove-player-text';

export interface RemovePlayerTarget {
  rosterEntryId: Id<'rosterEntries'>;
  name: string;
}

export interface RemovePlayerOutcome extends RemovePlayerTarget {
  removed: boolean;
}

@Component({
  selector: 'app-remove-player-dialog',
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideUserMinus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      icon="lucideUserMinus"
      cancelId="remove-player-cancel"
      confirmLabel="Remove player"
      pendingLabel="Removing…"
      variant="destructive"
      [heading]="heading()"
      [pending]="removing()"
      [alert]="alert()"
      (confirmed)="remove()"
      (closed)="onClosed()"
    >
      <p>They’ll lose access to the team page. You can invite them again later.</p>
    </app-confirm-dialog>
  `,
})
export class RemovePlayerDialog {
  private readonly removeEntry = injectMutation(api.rosterEntries.remove);

  readonly teamName = input.required<string>();
  readonly dismissed = output<RemovePlayerOutcome>();

  protected readonly online = injectOnline();

  protected readonly target = signal<RemovePlayerTarget | null>(null);
  protected readonly removing = signal(false);
  private readonly failure = signal<RemoveFailure | null>(null);

  protected readonly heading = computed(
    () => `Remove ${this.target()?.name} from ${this.teamName()}?`,
  );
  protected readonly alert = computed(() => {
    const failure = this.failure();
    const target = this.target();
    return failure && target ? removeFailureText(failure, target.name) : null;
  });

  private readonly dialog = viewChild.required(ConfirmDialog);
  private removed = false;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(target: RemovePlayerTarget): void {
    this.target.set(target);
    this.failure.set(null);
    this.removed = false;
    this.dialog().open();
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
    this.dialog().focusAlert();
  }
}
