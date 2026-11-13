import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, type FieldTree } from '@angular/forms/signals';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { BracketSide } from '../../../../convex/lib/bracket';
import {
  checkScore,
  scoreKindOf,
  type Score,
  type ScoreDraft,
  type Sport,
} from '../../../../convex/lib/sports';
import { ConvexOfflineError } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import { bracketRefusalMessage } from './bracket-text';
import {
  FORFEIT_CHOICE_ERROR,
  RESULT_FIELDS,
  scoreRefusalOf,
  type ResultField,
} from './game-result-text';

/** The score boxes: `a` and `b` are the game's first and second team, and the number is the set. */
export type ScoreBox = 'a1' | 'b1' | 'a2' | 'b2' | 'a3' | 'b3';

export type ResultText = Record<ScoreBox, string>;

export type ResultBody = { score: Score } | { forfeitTeamId: Id<'teams'> };

export type FocusTarget = ScoreBox | 'forfeit';

export type ResultAlertKind = 'offline' | 'failed';

export type ResultOutcome<Result> =
  | { sent: true; result: Result }
  | { sent: false; focus: FocusTarget }
  | { sent: false; alert: 'offline' }
  | { sent: false; alert: 'failed'; refusal: string | null };

export interface HeldResult {
  score: Score;
  forfeitTeamId: Id<'teams'> | null;
}

const EMPTY: ResultText = { a1: '', b1: '', a2: '', b2: '', a3: '', b3: '' };

const BOXES_OF: Record<ResultField, readonly ScoreBox[]> = {
  set1: ['a1', 'b1'],
  set2: ['a2', 'b2'],
  set3: ['a3', 'b3'],
  a: ['a1'],
  b: ['b1'],
  score: ['a1', 'b1'],
};

const pointsOf = (text: string): number | null => (text.trim() === '' ? null : Number(text));

const textOf = (points: number): string => String(points);

/** The rules and messages are `convex/lib/sports.ts`, which `tournamentGames` applies again. */
export class GameResultDraft {
  readonly model: WritableSignal<ResultText> = signal({ ...EMPTY });
  readonly fields: FieldTree<ResultText>;
  readonly forfeit = signal(false);
  readonly forfeitSide = signal<BracketSide | null>(null);
  readonly submitting = signal(false);
  readonly alert = signal<ResultAlertKind | null>(null);
  readonly refusal = signal<string | null>(null);
  readonly errors: Record<ResultField, Signal<string | null>>;
  readonly forfeitError: Signal<string | null>;

  readonly shownFields = computed<readonly ResultField[]>(() => {
    if (scoreKindOf(this.sport()) !== 'sets') return ['a', 'b', 'score'];
    return RESULT_FIELDS.filter((field) => field.startsWith('set')).slice(0, this.setsPerGame());
  });

  private readonly forfeitAsked = signal(false);
  private readonly issue: Signal<{ field: ResultField; message: string } | null>;
  private readonly shown: Record<ResultField, ShownUntilValid>;
  private readonly serverIssue: WritableSignal<{ field: ResultField; message: string } | null>;

  constructor(
    private readonly sport: () => Sport,
    private readonly setsPerGame: () => number,
  ) {
    this.fields = form(this.model);
    const draft = computed<ScoreDraft>(() => {
      const model = this.model();
      if (scoreKindOf(this.sport()) !== 'sets') {
        return {
          kind: scoreKindOf(this.sport()) as 'goals' | 'runs',
          a: pointsOf(model.a1),
          b: pointsOf(model.b1),
        };
      }
      const sets = (['1', '2', '3'] as const)
        .slice(0, this.setsPerGame())
        .map((n) => ({ a: pointsOf(model[`a${n}`]), b: pointsOf(model[`b${n}`]) }));
      return { kind: 'sets', sets };
    });
    this.issue = computed(() => {
      const found = checkScore(this.sport(), this.setsPerGame(), draft());
      return found && { field: found.field as ResultField, message: found.message };
    });
    this.shown = Object.fromEntries(
      RESULT_FIELDS.map((field) => [
        field,
        new ShownUntilValid(
          () => this.issue()?.field === field,
          () => BOXES_OF[field].some((box) => this.fields[box]().dirty()),
        ),
      ]),
    ) as Record<ResultField, ShownUntilValid>;
    this.serverIssue = linkedSignal<ResultText, { field: ResultField; message: string } | null>({
      source: () => this.model(),
      computation: () => null,
    });
    this.errors = Object.fromEntries(
      RESULT_FIELDS.map((field) => [
        field,
        computed(() => {
          const issue = this.issue();
          if (this.shown[field].shown() && issue?.field === field) return issue.message;
          const server = this.serverIssue();
          return server?.field === field ? server.message : null;
        }),
      ]),
    ) as Record<ResultField, Signal<string | null>>;
    this.forfeitError = computed(() =>
      this.forfeitAsked() && this.forfeitSide() === null ? FORFEIT_CHOICE_ERROR : null,
    );
  }

  load(held: HeldResult | null, teamIds: readonly (Id<'teams'> | null)[]): void {
    const model = { ...EMPTY };
    if (held?.score.kind === 'sets') {
      for (const [index, set] of held.score.sets.entries()) {
        model[`a${index + 1}` as ScoreBox] = textOf(set.a);
        model[`b${index + 1}` as ScoreBox] = textOf(set.b);
      }
    } else if (held) {
      model.a1 = textOf(held.score.a);
      model.b1 = textOf(held.score.b);
    }
    const side = held?.forfeitTeamId ? teamIds.indexOf(held.forfeitTeamId) : -1;
    this.model.set(model);
    this.forfeit.set(side !== -1);
    this.forfeitSide.set(side === 0 || side === 1 ? side : null);
    this.forfeitAsked.set(false);
    this.alert.set(null);
    this.refusal.set(null);
    this.fields().reset();
    for (const field of RESULT_FIELDS) this.shown[field].hide();
  }

  left(field: ResultField): void {
    this.shown[field].left();
  }

  chooseForfeit(side: BracketSide): void {
    this.forfeitSide.set(side);
  }

  async submit<Result>(
    online: boolean,
    teamIds: readonly [Id<'teams'>, Id<'teams'>],
    send: (body: ResultBody) => Promise<Result>,
  ): Promise<ResultOutcome<Result>> {
    this.alert.set(null);
    this.refusal.set(null);
    let body: ResultBody;
    if (this.forfeit()) {
      this.forfeitAsked.set(true);
      const side = this.forfeitSide();
      if (side === null) return { sent: false, focus: 'forfeit' };
      body = { forfeitTeamId: teamIds[side] };
    } else {
      for (const field of this.shownFields()) this.shown[field].submitted();
      const issue = this.issue();
      if (issue) return { sent: false, focus: BOXES_OF[issue.field][0] };
      body = { score: this.completeScore() };
    }
    if (!online) return this.showAlert('offline');
    this.submitting.set(true);
    try {
      return { sent: true, result: await send(body) };
    } catch (failure) {
      return this.failed(failure);
    } finally {
      this.submitting.set(false);
    }
  }

  private completeScore(): Score {
    const model = this.model();
    const kind = scoreKindOf(this.sport());
    if (kind !== 'sets') return { kind, a: Number(model.a1), b: Number(model.b1) };
    const sets = (['1', '2', '3'] as const)
      .slice(0, this.setsPerGame())
      .filter((n) => model[`a${n}`].trim() !== '' || model[`b${n}`].trim() !== '')
      .map((n) => ({ a: Number(model[`a${n}`]), b: Number(model[`b${n}`]) }));
    return { kind, sets };
  }

  private failed(failure: unknown): ResultOutcome<never> {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refused = scoreRefusalOf(failure);
    if (refused) {
      this.serverIssue.set(refused);
      return { sent: false, focus: BOXES_OF[refused.field][0] };
    }
    const refusal = bracketRefusalMessage(failure);
    this.alert.set('failed');
    this.refusal.set(refusal);
    return { sent: false, alert: 'failed', refusal };
  }

  private showAlert(alert: 'offline'): ResultOutcome<never> {
    this.alert.set(alert);
    return { sent: false, alert };
  }
}
