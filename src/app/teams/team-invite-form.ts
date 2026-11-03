import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import { checkTeamInviteEmail } from '../../../convex/lib/teamInviteInput';
import { ConvexOfflineError } from '../core/data/convex';
import { ShownUntilValid } from '../core/forms/shown-errors';

export type TeamInviteFormAlertKind = 'offline' | 'failed';

export const TEAM_INVITE_FORM_ALERTS = {
  failed: {
    title: 'The invite could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: { description: "The address is still here. Try again when you're connected." },
} as const;

export type TeamInviteSubmitOutcome<R> =
  | { sent: true; email: string; result: R }
  | { sent: false; focus: 'email' }
  | { sent: false; alert: TeamInviteFormAlertKind };

function emailRefusalOf(failure: unknown): string | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, message } = data as Record<string, unknown>;
  return field === 'email' && typeof message === 'string' ? message : null;
}

/** The address rules are `checkTeamInviteEmail`'s, so the form and `teamInvites.create` agree. */
export class TeamInviteForm {
  readonly model: WritableSignal<{ email: string }> = signal({ email: '' });
  readonly fields: FieldTree<{ email: string }>;
  readonly submitting = signal(false);
  readonly alert = signal<TeamInviteFormAlertKind | null>(null);
  readonly error: Signal<string | null>;

  private readonly clientError = computed(() => {
    const checked = checkTeamInviteEmail(this.model().email);
    return checked.ok ? null : checked.error.message;
  });
  private readonly shown: ShownUntilValid;
  private readonly serverError = linkedSignal<string, string | null>({
    source: () => this.model().email,
    computation: () => null,
  });

  constructor() {
    this.fields = form(this.model, (path) => {
      required(path.email);
    });
    this.shown = new ShownUntilValid(
      () => this.clientError() !== null,
      () => this.fields.email().dirty(),
    );
    this.error = computed(() => (this.shown.shown() ? this.clientError() : this.serverError()));
  }

  left(): void {
    this.shown.left();
  }

  clear(): void {
    this.model.set({ email: '' });
    this.fields().reset();
    this.alert.set(null);
  }

  async submit<R>(
    online: boolean,
    send: (email: string) => Promise<R>,
  ): Promise<TeamInviteSubmitOutcome<R>> {
    this.alert.set(null);
    this.shown.submitted();
    const checked = checkTeamInviteEmail(this.model().email);
    if (!checked.ok) return { sent: false, focus: 'email' };
    if (!online) return this.showAlert('offline');
    this.submitting.set(true);
    try {
      return { sent: true, email: checked.email, result: await send(checked.email) };
    } catch (failure) {
      if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
      const refusal = emailRefusalOf(failure);
      if (refusal === null) return this.showAlert('failed');
      this.serverError.set(refusal);
      return { sent: false, focus: 'email' };
    } finally {
      this.submitting.set(false);
    }
  }

  private showAlert(alert: TeamInviteFormAlertKind): TeamInviteSubmitOutcome<never> {
    this.alert.set(alert);
    return { sent: false, alert };
  }
}
