import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import { checkMinorName } from '../../../convex/lib/minorName';
import { ConvexOfflineError } from '../core/data/convex';
import { ShownUntilValid } from '../core/forms/shown-errors';
import { isTeamFull } from './team-invite-form';

export type MinorNameError =
  { kind: 'text'; text: string } | { kind: 'inSeason'; minorName: string; teamName: string };

export type MinorNameFormAlertKind = 'offline' | 'failed' | 'full';

export type MinorNameSubmitOutcome<R> =
  | { sent: true; name: string; result: R }
  | { sent: false; focus: 'name' }
  | { sent: false; alert: MinorNameFormAlertKind };

export function minorNameRefusalOf(failure: unknown): MinorNameError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Record<string, unknown>;
  if (fields['field'] !== 'minorName') return null;
  const minorName = fields['minorName'];
  const teamName = fields['teamName'];
  if (fields['code'] === 'minorInSeason' && typeof minorName === 'string') {
    return { kind: 'inSeason', minorName, teamName: typeof teamName === 'string' ? teamName : '' };
  }
  const message = fields['message'];
  return typeof message === 'string' ? { kind: 'text', text: message } : null;
}

/** The name rules are `checkMinorName`'s, so the form and the server agree. */
export class MinorNameForm {
  readonly model: WritableSignal<{ name: string }>;
  readonly fields: FieldTree<{ name: string }>;
  readonly submitting = signal(false);
  readonly alert = signal<MinorNameFormAlertKind | null>(null);
  readonly error: Signal<MinorNameError | null>;

  private readonly clientError = computed<MinorNameError | null>(() => {
    const checked = checkMinorName(this.model().name);
    return checked.ok ? null : { kind: 'text', text: checked.error.message };
  });
  private readonly shown: ShownUntilValid;
  private readonly serverError = linkedSignal<string, MinorNameError | null>({
    source: () => this.model().name,
    computation: () => null,
  });

  constructor(initial = '') {
    this.model = signal({ name: initial });
    this.fields = form(this.model, (path) => {
      required(path.name);
    });
    this.shown = new ShownUntilValid(
      () => this.clientError() !== null,
      () => this.fields.name().dirty(),
    );
    this.error = computed(() => (this.shown.shown() ? this.clientError() : this.serverError()));
  }

  left(): void {
    this.shown.left();
  }

  clear(): void {
    this.model.set({ name: '' });
    this.fields().reset();
    this.alert.set(null);
  }

  check(): string | null {
    this.shown.submitted();
    const checked = checkMinorName(this.model().name);
    return checked.ok ? checked.name : null;
  }

  showRefusal(refusal: MinorNameError): void {
    this.serverError.set(refusal);
  }

  async submit<R>(
    online: boolean,
    send: (name: string) => Promise<R>,
  ): Promise<MinorNameSubmitOutcome<R>> {
    this.alert.set(null);
    const name = this.check();
    if (name === null) return { sent: false, focus: 'name' };
    if (!online) return this.showAlert('offline');
    this.submitting.set(true);
    try {
      return { sent: true, name, result: await send(name) };
    } catch (failure) {
      if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
      if (isTeamFull(failure)) return this.showAlert('full');
      const refusal = minorNameRefusalOf(failure);
      if (refusal === null) return this.showAlert('failed');
      this.serverError.set(refusal);
      return { sent: false, focus: 'name' };
    } finally {
      this.submitting.set(false);
    }
  }

  private showAlert(alert: MinorNameFormAlertKind): MinorNameSubmitOutcome<never> {
    this.alert.set(alert);
    return { sent: false, alert };
  }
}
