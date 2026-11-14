import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';
import type { BracketSide } from '../../../../convex/lib/bracket';
import { scoreKindOf, type ScoreField, type Sport } from '../../../../convex/lib/sports';
import { focusLeftGroup } from '../../core/forms/shown-errors';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { pointsLabel } from './game-result-text';
import type { GameResultDraft, ScoreBox } from './game-result-state';

interface SetRow {
  field: ScoreField;
  number: number;
  a: ScoreBox;
  b: ScoreBox;
  optional: boolean;
}

const SET_ROWS: readonly SetRow[] = [
  { field: 'set1', number: 1, a: 'a1', b: 'b1', optional: false },
  { field: 'set2', number: 2, a: 'a2', b: 'b2', optional: false },
  { field: 'set3', number: 3, a: 'a3', b: 'b3', optional: true },
];

@Component({
  selector: 'app-game-score-fields',
  imports: [FormField, HlmFieldImports, HlmFieldSetImports, HlmInputImports, NgIcon],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (isSets()) {
      @for (row of setRows(); track row.field) {
        <fieldset hlmFieldSet (focusout)="left($event, row.field)">
          <legend hlmFieldLegend variant="label">Set {{ row.number }}</legend>
          <div class="grid grid-cols-2 gap-3">
            @for (side of sides; track side) {
              <div
                hlmField
                [attr.data-invalid]="draft().errors[row.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="draft().errors[row.field]() ? 'true' : null"
              >
                <label hlmFieldLabel [for]="idPrefix() + '-' + box(row, side)">{{
                  teamNames()[side]
                }}</label>
                <input
                  hlmInput
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  [id]="idPrefix() + '-' + box(row, side)"
                  [formField]="draft().fields[box(row, side)]"
                  [attr.aria-describedby]="describedBy(row)"
                  [attr.aria-invalid]="draft().errors[row.field]() ? 'true' : null"
                  [attr.data-invalid]="draft().errors[row.field]() ? 'true' : null"
                  [attr.data-matches-spartan-invalid]="draft().errors[row.field]() ? 'true' : null"
                />
              </div>
            }
          </div>
          @if (row.optional) {
            <p hlmFieldDescription [id]="idPrefix() + '-set3-note'">Only if each team won a set.</p>
          }
          @if (draft().errors[row.field](); as error) {
            <div hlmFieldError [id]="idPrefix() + '-' + row.field + '-error'">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </fieldset>
      }
    } @else {
      <div class="flex flex-col gap-4" (focusout)="leftScore($event)">
        <div class="grid grid-cols-2 gap-3">
          @for (side of sides; track side) {
            <div
              hlmField
              [attr.data-invalid]="scoreError() ? 'true' : null"
              [attr.data-matches-spartan-invalid]="scoreError() ? 'true' : null"
            >
              <label hlmFieldLabel [for]="idPrefix() + '-' + scoreBox(side)">{{
                pointsLabels()[side]
              }}</label>
              <input
                hlmInput
                type="text"
                inputmode="numeric"
                autocomplete="off"
                [id]="idPrefix() + '-' + scoreBox(side)"
                [formField]="draft().fields[scoreBox(side)]"
                [attr.aria-describedby]="scoreError() ? idPrefix() + '-score-error' : null"
                [attr.aria-invalid]="scoreError() ? 'true' : null"
                [attr.data-invalid]="scoreError() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="scoreError() ? 'true' : null"
              />
            </div>
          }
        </div>
        @if (scoreError(); as error) {
          <div hlmFieldError [id]="idPrefix() + '-score-error'">
            <ng-icon
              name="lucideCircleAlert"
              class="mt-0.5 shrink-0 text-base"
              aria-hidden="true"
            />
            <span>{{ error }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class GameScoreFields {
  readonly draft = input.required<GameResultDraft>();
  /** Starts every box's id, so two games on one page keep theirs apart. */
  readonly idPrefix = input.required<string>();
  readonly sport = input.required<Sport>();
  readonly setsPerGame = input.required<number>();
  /** In the order of the game, `a` first. */
  readonly teamNames = input.required<readonly [string, string]>();

  protected readonly sides: readonly BracketSide[] = [0, 1];

  protected readonly isSets = computed(() => scoreKindOf(this.sport()) === 'sets');
  protected readonly setRows = computed(() => SET_ROWS.slice(0, this.setsPerGame() === 3 ? 3 : 1));
  protected readonly pointsLabels = computed(() => {
    const [a, b] = this.teamNames();
    return [pointsLabel(this.sport(), a), pointsLabel(this.sport(), b)] as const;
  });
  protected readonly scoreError = computed(() => {
    const { errors } = this.draft();
    return errors.a() ?? errors.b() ?? errors.score();
  });

  protected box(row: SetRow, side: BracketSide): ScoreBox {
    return side === 0 ? row.a : row.b;
  }

  protected scoreBox(side: BracketSide): ScoreBox {
    return side === 0 ? 'a1' : 'b1';
  }

  protected describedBy(row: SetRow): string | null {
    const ids = [
      row.optional ? `${this.idPrefix()}-set3-note` : null,
      this.draft().errors[row.field]() ? `${this.idPrefix()}-${row.field}-error` : null,
    ].filter((id): id is string => id !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  }

  protected left(event: FocusEvent, field: ScoreField): void {
    if (focusLeftGroup(event)) this.draft().left(field);
  }

  protected leftScore(event: FocusEvent): void {
    if (!focusLeftGroup(event)) return;
    const draft = this.draft();
    draft.left('a');
    draft.left('b');
    draft.left('score');
  }
}
