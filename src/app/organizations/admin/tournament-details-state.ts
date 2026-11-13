import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import { limitFromText } from '../../../../convex/lib/seasonInput';
import {
  DEFAULT_SETS_PER_GAME,
  type SetsPerGame,
  type TournamentEditable,
} from '../../../../convex/lib/tournamentEdit';
import { checkTournamentDetails } from '../../../../convex/lib/tournamentInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import type { AlertTexts } from './alert-text';
import { inputErrorOf } from './tournament-form';

export type DetailsField = 'startDate' | 'endDate' | 'registrationDeadline' | 'maximumTeams';

// The order of the page, which is the order focus follows to the first invalid field.
export const DETAILS_FIELDS: readonly DetailsField[] = [
  'startDate',
  'endDate',
  'registrationDeadline',
  'maximumTeams',
];

export interface DetailsText {
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  maximumTeams: string;
}

export interface DetailsValues {
  startDate: string;
  /** Left out for a one-day tournament. */
  endDate?: string;
  registrationDeadline: string;
  maximumTeams: number;
  /** Left out for a sport that has no choice. */
  setsPerGame?: SetsPerGame;
}

export type DetailsAlertKind = 'offline' | 'failed' | 'changed';

export const DETAILS_ALERTS = {
  failed: {
    title: 'The tournament details could not be saved.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your changes are still here. Try again when you're connected.",
  },
  changed: {
    title: 'Someone else changed this tournament while you were editing.',
    description: 'Check the details and save again.',
  },
} as const satisfies AlertTexts<DetailsAlertKind>;

export type DetailsSubmitOutcome<Result> =
  | { sent: true; result: Result }
  | { sent: false; focus: DetailsField }
  | { sent: false; alert: DetailsAlertKind };

function textOf(held: TournamentEditable): DetailsText {
  return {
    startDate: held.startDate,
    endDate: held.endDate,
    registrationDeadline: held.registrationDeadline,
    maximumTeams: String(held.maximumTeams),
  };
}

// The refusal's data is the server's own, so only its outline is checked.
function currentOf(failure: unknown): TournamentEditable | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const current = (data as Record<string, unknown>)['current'];
  if (typeof current !== 'object' || current === null) return null;
  const { startDate, endDate, registrationDeadline, maximumTeams, setsPerGame } = current as Record<
    string,
    unknown
  >;
  if (
    typeof startDate !== 'string' ||
    typeof endDate !== 'string' ||
    typeof registrationDeadline !== 'string' ||
    typeof maximumTeams !== 'number' ||
    (setsPerGame !== 1 && setsPerGame !== 3)
  ) {
    return null;
  }
  return { startDate, endDate, registrationDeadline, maximumTeams, setsPerGame };
}

/** The rules and messages are `convex/lib/tournamentInput.ts`, which `tournaments.updateDetails` applies again. */
export class TournamentDetails {
  readonly model: WritableSignal<DetailsText> = signal({
    startDate: '',
    endDate: '',
    registrationDeadline: '',
    maximumTeams: '',
  });
  readonly fields: FieldTree<DetailsText>;
  readonly setsPerGame = signal<SetsPerGame>(DEFAULT_SETS_PER_GAME);
  readonly submitting = signal(false);
  readonly alert = signal<DetailsAlertKind | null>(null);
  readonly errors: Record<DetailsField, Signal<string | null>>;

  // What the form last showed, which the server compares with what it holds.
  private readonly baseline = signal<TournamentEditable | null>(null);
  private readonly clientErrors: Signal<Partial<Record<DetailsField, string>>>;
  private readonly shown: Record<DetailsField, ShownUntilValid>;
  private readonly serverErrors: Record<DetailsField, WritableSignal<string | null>>;

  readonly editedSinceLoad = computed(() => {
    const baseline = this.baseline();
    if (baseline === null) return false;
    const was = textOf(baseline);
    const now = this.model();
    return (
      DETAILS_FIELDS.some((field) => now[field] !== was[field]) ||
      this.setsPerGame() !== baseline.setsPerGame
    );
  });

  constructor(private readonly teamCount: () => number) {
    this.fields = form(this.model, (path) => {
      required(path.startDate);
      required(path.registrationDeadline);
      required(path.maximumTeams);
    });
    this.clientErrors = computed(() => {
      const model = this.model();
      const checked = checkTournamentDetails({
        startDate: model.startDate,
        endDate: model.endDate,
        registrationDeadline: model.registrationDeadline,
        maximumTeams: limitFromText(model.maximumTeams),
        teamCount: this.teamCount(),
      });
      return Object.fromEntries(
        DETAILS_FIELDS.flatMap((field) => {
          const error = checked[field];
          return error ? [[field, error.message]] : [];
        }),
      );
    });
    this.shown = Object.fromEntries(
      DETAILS_FIELDS.map((field) => [
        field,
        new ShownUntilValid(
          () => this.clientErrors()[field] !== undefined,
          () => this.fields[field]().dirty(),
        ),
      ]),
    ) as Record<DetailsField, ShownUntilValid>;
    this.serverErrors = Object.fromEntries(
      DETAILS_FIELDS.map((field) => [
        field,
        linkedSignal<string, string | null>({
          source: () => this.model()[field],
          computation: () => null,
        }),
      ]),
    ) as Record<DetailsField, WritableSignal<string | null>>;
    this.errors = Object.fromEntries(
      DETAILS_FIELDS.map((field) => [
        field,
        computed(() =>
          this.shown[field].shown()
            ? (this.clientErrors()[field] ?? null)
            : this.serverErrors[field](),
        ),
      ]),
    ) as Record<DetailsField, Signal<string | null>>;
  }

  load(held: TournamentEditable): void {
    this.baseline.set(held);
    this.model.set(textOf(held));
    this.setsPerGame.set(held.setsPerGame);
    this.fields().reset();
    this.alert.set(null);
    for (const field of DETAILS_FIELDS) this.shown[field].hide();
  }

  // An edited field keeps its older baseline, so the server refuses a save over another editor's newer value.
  follow(newer: TournamentEditable): void {
    const baseline = this.baseline();
    if (baseline === null) {
      this.load(newer);
      return;
    }
    const was = textOf(baseline);
    const now = this.model();
    const next = textOf(newer);
    const untouched = {
      startDate: now.startDate === was.startDate,
      endDate: now.endDate === was.endDate,
      registrationDeadline: now.registrationDeadline === was.registrationDeadline,
      maximumTeams: now.maximumTeams === was.maximumTeams,
      setsPerGame: this.setsPerGame() === baseline.setsPerGame,
    };
    const pick = <Key extends keyof TournamentEditable>(key: Key) =>
      untouched[key] ? newer[key] : baseline[key];
    this.model.set({
      startDate: untouched.startDate ? next.startDate : now.startDate,
      endDate: untouched.endDate ? next.endDate : now.endDate,
      registrationDeadline: untouched.registrationDeadline
        ? next.registrationDeadline
        : now.registrationDeadline,
      maximumTeams: untouched.maximumTeams ? next.maximumTeams : now.maximumTeams,
    });
    if (untouched.setsPerGame) this.setsPerGame.set(newer.setsPerGame);
    this.baseline.set({
      startDate: pick('startDate'),
      endDate: pick('endDate'),
      registrationDeadline: pick('registrationDeadline'),
      maximumTeams: pick('maximumTeams'),
      setsPerGame: pick('setsPerGame'),
    });
  }

  left(field: DetailsField): void {
    this.shown[field].left();
  }

  async submit<Result>(
    online: boolean,
    hasSetsPerGame: boolean,
    send: (values: DetailsValues, expected: TournamentEditable) => Promise<Result>,
  ): Promise<DetailsSubmitOutcome<Result>> {
    const expected = this.baseline();
    if (expected === null) throw new Error('TournamentDetails.submit before load');
    this.alert.set(null);
    let firstInvalid: DetailsField | null = null;
    const errors = this.clientErrors();
    for (const field of DETAILS_FIELDS) {
      this.shown[field].submitted();
      if (errors[field] !== undefined) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };
    if (!online) return this.showAlert('offline');

    const model = this.model();
    const values: DetailsValues = {
      startDate: model.startDate,
      ...(model.endDate !== '' && { endDate: model.endDate }),
      registrationDeadline: model.registrationDeadline,
      maximumTeams: limitFromText(model.maximumTeams)!,
      ...(hasSetsPerGame && { setsPerGame: this.setsPerGame() }),
    };
    this.submitting.set(true);
    try {
      return { sent: true, result: await send(values, expected) };
    } catch (failure) {
      return this.failed(failure);
    } finally {
      this.submitting.set(false);
    }
  }

  private failed(failure: unknown): DetailsSubmitOutcome<never> {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal?.code === 'changedSince') {
      const current = currentOf(failure);
      if (current) {
        this.follow(current);
        this.baseline.set(current);
      }
      return this.showAlert('changed');
    }
    if (refusal && (DETAILS_FIELDS as readonly string[]).includes(refusal.field)) {
      const field = refusal.field as DetailsField;
      this.serverErrors[field].set(refusal.message);
      return { sent: false, focus: field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: DetailsAlertKind): DetailsSubmitOutcome<never> {
    this.alert.set(alert);
    return { sent: false, alert };
  }
}
