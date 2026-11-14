import { computed, signal, type Signal, type WritableSignal, linkedSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import {
  CAMP_SESSION_FIELDS,
  checkCampSessionFields,
  type CampSessionField,
  type CampSessionInputError,
} from '../../../../convex/lib/campSessionInput';
import { limitFromText } from '../../../../convex/lib/seasonInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import type { AlertTexts } from './alert-text';

export type { CampSessionField };

export interface CampSessionTextModel {
  name: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  dailyStartTime: string;
  dailyEndTime: string;
  places: string;
}

export interface CampSessionSend {
  name: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  dailyStartTime?: string;
  dailyEndTime?: string;
  places: number;
}

export type CampSessionFormAlertKind = 'offline' | 'failed';

export const CAMP_SESSION_FORM_ALERTS = {
  failed: {
    title: 'The session could not be added.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your details are still here. Try again when you're connected.",
  },
} as const satisfies AlertTexts<CampSessionFormAlertKind>;

export type CampSessionSubmitOutcome =
  | { sent: true; values: CampSessionSend }
  | { sent: false; focus: CampSessionField }
  | { sent: false; alert: CampSessionFormAlertKind };

const EMPTY: CampSessionTextModel = {
  name: '',
  startDate: '',
  endDate: '',
  registrationDeadline: '',
  dailyStartTime: '',
  dailyEndTime: '',
  places: '',
};

/** The fields whose rule reads another field, so a change to that one can fix or break this one. */
const READS: Partial<Record<CampSessionField, readonly (keyof CampSessionTextModel)[]>> = {
  endDate: ['startDate', 'endDate'],
  registrationDeadline: ['startDate', 'registrationDeadline'],
  dailyStartTime: ['dailyStartTime', 'dailyEndTime'],
  dailyEndTime: ['dailyStartTime', 'dailyEndTime'],
};

function inputErrorOf(failure: unknown): CampSessionInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(CAMP_SESSION_FIELDS as readonly string[]).includes(field)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as CampSessionField, code: code as CampSessionInputError['code'], message };
}

const timeOrNothing = (text: string): string | undefined => (text === '' ? undefined : text);

/** The rules and messages are `convex/lib/campSessionInput.ts`, which `campSessions.add` applies again. */
export class CampSessionFormState {
  readonly model: WritableSignal<CampSessionTextModel> = signal({ ...EMPTY });
  readonly fields: FieldTree<CampSessionTextModel>;
  readonly submitting = signal(false);
  readonly alert = signal<CampSessionFormAlertKind | null>(null);

  private readonly clientErrors: Signal<Partial<Record<CampSessionField, CampSessionInputError>>>;
  private readonly shown: Record<CampSessionField, ShownUntilValid>;
  private readonly serverErrors: Record<CampSessionField, WritableSignal<string | null>>;

  readonly errors: Record<CampSessionField, Signal<string | null>>;

  constructor() {
    // `required` puts the attribute on the inputs; the messages are ours, so the form and `campSessions.add` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.startDate);
      required(path.endDate);
      required(path.registrationDeadline);
      required(path.places);
    });
    this.clientErrors = computed(() => {
      const m = this.model();
      return checkCampSessionFields({
        name: m.name,
        startDate: m.startDate,
        endDate: m.endDate,
        registrationDeadline: m.registrationDeadline,
        dailyStartTime: timeOrNothing(m.dailyStartTime),
        dailyEndTime: timeOrNothing(m.dailyEndTime),
        places: limitFromText(m.places),
      });
    });
    this.shown = Object.fromEntries(
      CAMP_SESSION_FIELDS.map((field) => [
        field,
        new ShownUntilValid(
          () => this.clientErrors()[field] !== undefined,
          () => this.fields[field]().dirty(),
        ),
      ]),
    ) as Record<CampSessionField, ShownUntilValid>;
    this.serverErrors = Object.fromEntries(
      CAMP_SESSION_FIELDS.map((field) => [field, this.untilChanged(field)]),
    ) as Record<CampSessionField, WritableSignal<string | null>>;
    this.errors = Object.fromEntries(
      CAMP_SESSION_FIELDS.map((field) => [field, this.shownError(field)]),
    ) as Record<CampSessionField, Signal<string | null>>;
  }

  left(field: CampSessionField): void {
    this.shown[field].left();
    // A rule that reads this field may now be broken by it, but only a field the user has typed in is scolded.
    for (const other of CAMP_SESSION_FIELDS) {
      if (other !== field && READS[other]?.includes(field) && this.fields[other]().dirty()) {
        this.shown[other].left();
      }
    }
  }

  /** Keeps what the next session of the camp probably shares: its times and places. */
  clear(): void {
    this.model.update((m) => ({
      ...EMPTY,
      dailyStartTime: m.dailyStartTime,
      dailyEndTime: m.dailyEndTime,
      places: m.places,
    }));
    this.fields().reset();
  }

  async submit(
    online: boolean,
    send: (values: CampSessionSend) => Promise<unknown>,
  ): Promise<CampSessionSubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: CampSessionField | null = null;
    const errors = this.clientErrors();
    for (const field of CAMP_SESSION_FIELDS) {
      this.shown[field].submitted();
      if (errors[field] !== undefined) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    const pressedOffline = !online;
    if (pressedOffline) return this.showAlert('offline');

    const m = this.model();
    const dailyStartTime = timeOrNothing(m.dailyStartTime);
    const dailyEndTime = timeOrNothing(m.dailyEndTime);
    const values: CampSessionSend = {
      name: m.name.trim(),
      startDate: m.startDate,
      endDate: m.endDate,
      registrationDeadline: m.registrationDeadline,
      ...(dailyStartTime !== undefined && { dailyStartTime }),
      ...(dailyEndTime !== undefined && { dailyEndTime }),
      places: limitFromText(m.places)!,
    };
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

  private failed(failure: unknown): CampSessionSubmitOutcome {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal) {
      this.serverErrors[refusal.field].set(refusal.message);
      return { sent: false, focus: refusal.field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: CampSessionFormAlertKind): CampSessionSubmitOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private untilChanged(field: CampSessionField): WritableSignal<string | null> {
    const reads = READS[field] ?? [field];
    return linkedSignal<string, string | null>({
      source: () => reads.map((key) => this.model()[key]).join('|'),
      computation: () => null,
    });
  }

  private shownError(field: CampSessionField): Signal<string | null> {
    return computed(() => {
      if (this.shown[field].shown()) return this.clientErrors()[field]?.message ?? null;
      return this.serverErrors[field]();
    });
  }
}
