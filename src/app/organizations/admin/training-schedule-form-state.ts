import { computed, signal, type Signal, type WritableSignal, linkedSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import { limitFromText } from '../../../../convex/lib/seasonInput';
import {
  TRAINING_PATTERN_FIELDS,
  TRAINING_PATTERN_MESSAGES,
  checkTrainingPattern,
  type TrainingPatternError,
  type TrainingPatternField,
} from '../../../../convex/lib/trainingPattern';
import { dateAtUtcMinus12 } from '../../../../convex/lib/registration';
import { ConvexOfflineError } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import type { AlertTexts } from './alert-text';

export type { TrainingPatternField };

export interface TrainingScheduleTextModel {
  startTime: string;
  endTime: string;
  firstDate: string;
  weeks: string;
  placesPerClass: string;
  registrationDeadline: string;
}

export interface TrainingScheduleSend {
  weekday: number;
  startTime: string;
  endTime: string;
  firstDate: string;
  weeks: number;
  placesPerClass: number;
  registrationDeadline: string;
  allowSingleRegistration: boolean;
}

export type TrainingScheduleAlertKind = 'offline' | 'failed' | 'alreadyScheduled';

export const TRAINING_SCHEDULE_ALERTS = {
  failed: {
    title: 'The classes could not be scheduled.',
    description: 'Check your connection and try again.',
  },
  alreadyScheduled: {
    title: 'The classes could not be scheduled.',
    description: TRAINING_PATTERN_MESSAGES.alreadyScheduled,
  },
  offline: {
    description: "Your details are still here. Try again when you're connected.",
  },
} as const satisfies AlertTexts<TrainingScheduleAlertKind>;

export type TrainingScheduleOutcome =
  | { sent: true; values: TrainingScheduleSend }
  | { sent: false; focus: TrainingPatternField }
  | { sent: false; alert: TrainingScheduleAlertKind };

const EMPTY: TrainingScheduleTextModel = {
  startTime: '',
  endTime: '',
  firstDate: '',
  weeks: '',
  placesPerClass: '',
  registrationDeadline: '',
};

type Reads = TrainingPatternField | keyof TrainingScheduleTextModel;

/** The fields whose rule reads another field, so a change to that one can fix or break this one. */
const READS: Partial<Record<TrainingPatternField, readonly Reads[]>> = {
  startTime: ['startTime', 'endTime'],
  endTime: ['startTime', 'endTime'],
  firstDate: ['weekday', 'firstDate'],
  weeks: ['firstDate', 'weeks'],
  registrationDeadline: ['firstDate', 'registrationDeadline'],
};

function isAlreadyScheduled(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && 'code' in data && data.code === 'alreadyScheduled'
  );
}

function inputErrorOf(failure: unknown): TrainingPatternError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (
    typeof field !== 'string' ||
    !(TRAINING_PATTERN_FIELDS as readonly string[]).includes(field)
  ) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return {
    field: field as TrainingPatternField,
    code: code as TrainingPatternError['code'],
    message,
  };
}

/** The rules and messages are `convex/lib/trainingPattern.ts`, which `trainingClasses.schedule` applies again. */
export class TrainingScheduleFormState {
  readonly model: WritableSignal<TrainingScheduleTextModel> = signal({ ...EMPTY });
  readonly fields: FieldTree<TrainingScheduleTextModel>;
  private readonly chosenWeekday = signal<number | null>(null);
  readonly weekday = this.chosenWeekday.asReadonly();
  readonly allowSingleRegistration = signal(false);
  readonly submitting = signal(false);
  readonly alert = signal<TrainingScheduleAlertKind | null>(null);

  private readonly clientErrors: Signal<
    Partial<Record<TrainingPatternField, TrainingPatternError>>
  >;
  private readonly shown: Record<TrainingPatternField, ShownUntilValid>;
  private readonly serverErrors: Record<TrainingPatternField, WritableSignal<string | null>>;

  readonly errors: Record<TrainingPatternField, Signal<string | null>>;

  constructor(private readonly today: () => string = () => dateAtUtcMinus12(Date.now())) {
    // `required` puts the attribute on the inputs; the messages come from `trainingPattern.ts`, so the form and `trainingClasses.schedule` agree.
    this.fields = form(this.model, (path) => {
      required(path.startTime);
      required(path.endTime);
      required(path.firstDate);
      required(path.weeks);
      required(path.placesPerClass);
      required(path.registrationDeadline);
    });
    this.clientErrors = computed(() => {
      const m = this.model();
      return checkTrainingPattern(
        {
          weekday: this.weekday() ?? undefined,
          startTime: m.startTime,
          endTime: m.endTime,
          firstDate: m.firstDate,
          weeks: limitFromText(m.weeks),
          placesPerClass: limitFromText(m.placesPerClass),
          registrationDeadline: m.registrationDeadline,
        },
        this.today(),
      );
    });
    this.shown = Object.fromEntries(
      TRAINING_PATTERN_FIELDS.map((field) => [
        field,
        new ShownUntilValid(
          () => this.clientErrors()[field] !== undefined,
          // A chosen weekday is always valid, so leaving it cannot show an error.
          () => field !== 'weekday' && this.fields[field]().dirty(),
        ),
      ]),
    ) as Record<TrainingPatternField, ShownUntilValid>;
    this.serverErrors = Object.fromEntries(
      TRAINING_PATTERN_FIELDS.map((field) => [field, this.untilChanged(field)]),
    ) as Record<TrainingPatternField, WritableSignal<string | null>>;
    this.errors = Object.fromEntries(
      TRAINING_PATTERN_FIELDS.map((field) => [field, this.shownError(field)]),
    ) as Record<TrainingPatternField, Signal<string | null>>;
  }

  chooseWeekday(weekday: number): void {
    this.chosenWeekday.set(weekday);
  }

  left(field: TrainingPatternField): void {
    this.shown[field].left();
    // A rule that reads this field may now be broken by it, but only a field the user has typed in is scolded.
    for (const other of TRAINING_PATTERN_FIELDS) {
      if (other === field || other === 'weekday') continue;
      if (READS[other]?.includes(field) && this.fields[other]().dirty()) this.shown[other].left();
    }
  }

  async submit(
    online: boolean,
    send: (values: TrainingScheduleSend) => Promise<unknown>,
  ): Promise<TrainingScheduleOutcome> {
    this.alert.set(null);
    let firstInvalid: TrainingPatternField | null = null;
    const errors = this.clientErrors();
    for (const field of TRAINING_PATTERN_FIELDS) {
      this.shown[field].submitted();
      if (errors[field] !== undefined) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    const pressedOffline = !online;
    if (pressedOffline) return this.showAlert('offline');

    const m = this.model();
    const values: TrainingScheduleSend = {
      weekday: this.weekday()!,
      startTime: m.startTime,
      endTime: m.endTime,
      firstDate: m.firstDate,
      weeks: limitFromText(m.weeks)!,
      placesPerClass: limitFromText(m.placesPerClass)!,
      registrationDeadline: m.registrationDeadline,
      allowSingleRegistration: this.allowSingleRegistration(),
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

  private failed(failure: unknown): TrainingScheduleOutcome {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    if (failure instanceof ConvexError && isAlreadyScheduled(failure.data)) {
      return this.showAlert('alreadyScheduled');
    }
    const refusal = inputErrorOf(failure);
    if (refusal) {
      this.serverErrors[refusal.field].set(refusal.message);
      return { sent: false, focus: refusal.field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: TrainingScheduleAlertKind): TrainingScheduleOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private readValue(key: Reads): string {
    return key === 'weekday' ? String(this.weekday()) : this.model()[key];
  }

  private untilChanged(field: TrainingPatternField): WritableSignal<string | null> {
    const reads = READS[field] ?? [field];
    return linkedSignal<string, string | null>({
      source: () => reads.map((key) => this.readValue(key)).join('|'),
      computation: () => null,
    });
  }

  private shownError(field: TrainingPatternField): Signal<string | null> {
    return computed(() => {
      if (this.shown[field].shown()) return this.clientErrors()[field]?.message ?? null;
      return this.serverErrors[field]();
    });
  }
}
