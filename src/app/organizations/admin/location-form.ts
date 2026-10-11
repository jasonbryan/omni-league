import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import {
  checkLocationAddress,
  checkLocationName,
  type LocationInputError,
} from '../../../../convex/lib/locationInput';
import { ConvexOfflineError } from '../../core/data/convex';

export type LocationField = 'name' | 'address';
const FIELDS: readonly LocationField[] = ['name', 'address'];

export interface LocationModel {
  name: string;
  address: string;
}

/** A failure that is not about one field: the form alert above the fields. */
export type FormAlertKind = 'offline' | 'failed';

/** The text of each form alert (design/mockups/65-organization-admin-locations.html, state 12). */
export const FORM_ALERTS = {
  failed: {
    title: 'The location could not be saved.',
    description: 'Check your connection and try again.',
  },
  // design/mockups/88-offline-note.html state 3, shared by every form that needs the server.
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "Your details are still here. Try again when you're connected.",
  },
} as const;

/** The `LocationInputError` a `ConvexError` carries, or `null` for any other failure. */
function inputErrorOf(failure: unknown): LocationInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if ((field !== 'name' && field !== 'address') || typeof code !== 'string') return null;
  if (typeof message !== 'string') return null;
  return { field, code: code as LocationInputError['code'], message };
}

/** What a submit leaves the component to do: where focus goes, or nothing more. */
export type SubmitOutcome =
  | { sent: true; values: LocationModel }
  | { sent: false; focus: LocationField }
  | { sent: false; alert: FormAlertKind };

/**
 * The state of one location form, the add form and a row's edit form alike (#65): the signal form,
 * the messages each field shows, and the submit sequence. Errors show after a submit, under their
 * field, and clear once the field is valid; a server refusal about a field shows until that field
 * changes. Construct it in an injection context (a component field initializer).
 */
export class LocationForm {
  readonly model: WritableSignal<LocationModel>;
  readonly fields: FieldTree<LocationModel>;
  readonly submitting = signal(false);
  readonly alert = signal<FormAlertKind | null>(null);

  /** The first client-side error of each field, whether or not it is shown. */
  private readonly clientErrors: Record<LocationField, Signal<string | null>>;
  /** Set on a submit for each invalid field; cleared once the field is valid. */
  private readonly shown: Record<LocationField, WritableSignal<boolean>>;
  /** A server answer about one field, until that field's value changes. */
  private readonly serverErrors: Record<LocationField, WritableSignal<string | null>>;

  /** The error each field shows now, or `null`. */
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

  /** Empties both fields (after an add succeeded). */
  clear(): void {
    this.model.set({ name: '', address: '' });
  }

  /**
   * One press of the submit button. Clears the form alert and checks both fields; an invalid one
   * shows its message, and focus goes to the first (Name, else Address). Valid and offline: the
   * offline alert, nothing sent. Otherwise `send` runs with the trimmed values; a refusal about a
   * field shows on it, and any other failure shows the form alert.
   */
  async submit(
    online: boolean,
    send: (values: LocationModel) => Promise<unknown>,
  ): Promise<SubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: LocationField | null = null;
    for (const field of FIELDS) {
      const invalid = this.clientErrors[field]() !== null;
      this.shown[field].set(invalid);
      if (invalid) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    // A press while offline is refused here; one the adapter refuses at call time (the 3-second
    // check, before the note has appeared) takes the same path below.
    if (!online) return this.showAlert('offline');

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

  private shownUntilValid(field: LocationField): WritableSignal<boolean> {
    return linkedSignal<boolean, boolean>({
      source: () => this.clientErrors[field]() === null,
      computation: (valid, previous) => !valid && (previous?.value ?? false),
    });
  }

  private untilChanged(value: () => unknown): WritableSignal<string | null> {
    return linkedSignal<unknown, string | null>({ source: value, computation: () => null });
  }

  private shownError(field: LocationField): Signal<string | null> {
    return computed(() =>
      this.shown[field]() ? this.clientErrors[field]() : this.serverErrors[field](),
    );
  }
}
