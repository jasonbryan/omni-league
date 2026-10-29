import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import {
  checkLocationAddress,
  checkLocationName,
  type LocationInputError,
} from '../../../../convex/lib/locationInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';

export type LocationField = 'name' | 'address';
const FIELDS: readonly LocationField[] = ['name', 'address'];

export interface LocationModel {
  name: string;
  address: string;
}

export type FormAlertKind = 'offline' | 'failed';

export const FORM_ALERTS = {
  failed: {
    title: 'The location could not be saved.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your details are still here. Try again when you're connected.",
  },
} as const;

function inputErrorOf(failure: unknown): LocationInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if ((field !== 'name' && field !== 'address') || typeof code !== 'string') return null;
  if (typeof message !== 'string') return null;
  return { field, code: code as LocationInputError['code'], message };
}

export type SubmitOutcome =
  | { sent: true; values: LocationModel }
  | { sent: false; focus: LocationField }
  | { sent: false; alert: FormAlertKind };

export class LocationForm {
  readonly model: WritableSignal<LocationModel>;
  readonly fields: FieldTree<LocationModel>;
  readonly submitting = signal(false);
  readonly alert = signal<FormAlertKind | null>(null);

  private readonly clientErrors: Record<LocationField, Signal<string | null>>;
  private readonly shown: Record<LocationField, ShownUntilValid>;
  private readonly serverErrors: Record<LocationField, WritableSignal<string | null>>;

  readonly errors: Record<LocationField, Signal<string | null>>;

  constructor(initial: LocationModel) {
    this.model = signal(initial);
    // `required` puts the attribute on both inputs; the messages are ours (`locationInput.ts`), so
    // the form and `locations.create` / `locations.update` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.address);
    });
    this.clientErrors = {
      name: computed(() => {
        const checked = checkLocationName(this.model().name);
        return checked.ok ? null : checked.error.message;
      }),
      address: computed(() => {
        const checked = checkLocationAddress(this.model().address);
        return checked.ok ? null : checked.error.message;
      }),
    };
    this.shown = {
      name: this.shownUntilValid('name'),
      address: this.shownUntilValid('address'),
    };
    this.serverErrors = {
      name: this.untilChanged(() => this.model().name),
      address: this.untilChanged(() => this.model().address),
    };
    this.errors = { name: this.shownError('name'), address: this.shownError('address') };
  }

  clear(): void {
    this.model.set({ name: '', address: '' });
    this.fields().reset();
  }

  left(field: LocationField): void {
    this.shown[field].left();
  }

  async submit(
    online: boolean,
    send: (values: LocationModel) => Promise<unknown>,
  ): Promise<SubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: LocationField | null = null;
    for (const field of FIELDS) {
      this.shown[field].submitted();
      if (this.clientErrors[field]() !== null) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    const pressedOffline = !online;
    if (pressedOffline) return this.showAlert('offline');

    const { name, address } = this.model();
    const values = { name: name.trim(), address: address.trim() };
    this.submitting.set(true);
    try {
      await send(values);
    } catch (failure) {
      return this.failed(failure);
    } finally {
      this.submitting.set(false);
    }
    return { sent: true, values };
  }

  private failed(failure: unknown): SubmitOutcome {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal) {
      this.serverErrors[refusal.field].set(refusal.message);
      return { sent: false, focus: refusal.field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: FormAlertKind): SubmitOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private shownUntilValid(field: LocationField): ShownUntilValid {
    return new ShownUntilValid(
      () => this.clientErrors[field]() !== null,
      () => this.fields[field]().dirty(),
    );
  }

  private untilChanged(value: () => unknown): WritableSignal<string | null> {
    return linkedSignal<unknown, string | null>({ source: value, computation: () => null });
  }

  private shownError(field: LocationField): Signal<string | null> {
    return computed(() =>
      this.shown[field].shown() ? this.clientErrors[field]() : this.serverErrors[field](),
    );
  }
}
