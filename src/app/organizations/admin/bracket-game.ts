import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  type WritableSignal,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEraser, lucidePencil, lucideUndo2 } from '@ng-icons/lucide';
import type { FunctionReturnType } from 'convex/server';
import { BRACKET_MESSAGES } from '../../../../convex/lib/bracket';
import { scoresEqual } from '../../../../convex/lib/sports';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { HlmBadge } from '../../ui/badge';
import { Checkbox } from '../../ui/checkbox';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertText } from './alert-text';
import { bracketRefusalMessage } from './bracket-text';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import {
  clearFailedText,
  CLEARED_TEXT,
  CONFIRM_OFFLINE,
  confirmedText,
  confirmFailedText,
  forfeitNote,
  playedText,
  reportedText,
  restoredText,
  restoreFailedText,
  RESTORE_OFFLINE,
  saveFailedText,
  savedText,
  SAVE_OFFLINE,
  undoFailedText,
  undoneText,
  UNDO_OFFLINE,
} from './game-result-text';
import { GameResultDraft, type FocusTarget, type ResultBody } from './game-result-state';
import { GameScoreFields } from './game-score-fields';
import type { BracketGameView, ManagedTournament } from './tournament-context';

type ReportView = BracketGameView['reports'][number];

type Saved = FunctionReturnType<typeof api.tournamentGames.enterResult>;

interface SavedStatus {
  kind: 'saved';
  text: AlertText;
  previous: Saved['previous'];
  resultEnteredAt: number;
}

interface ClearedStatus {
  kind: 'cleared';
  text: AlertText;
  cleared: ResultBody;
  teamIds: readonly (string | null)[];
  resultEnteredAt: null;
}

type Status = SavedStatus | ClearedStatus | { kind: 'ended'; text: AlertText };

type UndoNote = { kind: 'failed'; text: AlertText } | { kind: 'offline'; description: string };

interface Change {
  pending: WritableSignal<boolean>;
  offline: string;
  failed: (refusal: string | null) => AlertText;
  run: () => Promise<Status>;
}

const sameIds = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const TEXT_BUTTON =
  'inline-flex items-center gap-1 rounded-md font-medium underline underline-offset-4 pointer-coarse:min-h-11';

@Component({
  selector: 'app-bracket-game',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    Checkbox,
    ChipRadioGroup,
    GameScoreFields,
    HlmBadge,
    HlmFieldImports,
    HlmFieldSetImports,
    HlmSpinner,
    NgIcon,
  ],
  providers: [provideIcons({ lucideEraser, lucidePencil, lucideUndo2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'listitem',
    class: 'block rounded-lg border border-border px-3 py-2 text-sm',
    '[attr.data-game]': 'game().gameId',
  },
  template: `
    <p data-slot="game-label">
      <span class="sr-only">Game {{ game().slot }}: </span>{{ label() }}
    </p>
    @if (played(); as played) {
      <p data-slot="game-result" class="mt-1 text-muted-foreground">{{ played }}</p>
    }
    @if (status(); as status) {
      <app-admin-alert
        #statusAlert
        class="mt-2"
        kind="success"
        [title]="status.text.title"
        [description]="status.text.description"
      >
        @if (undoable(); as undoable) {
          <button
            type="button"
            [class]="textButton"
            [class.opacity-50]="!online() && !undoing()"
            [attr.aria-disabled]="undoing() || !online() ? 'true' : null"
            (click)="undo(undoable)"
          >
            @if (undoing()) {
              <hlm-spinner data-icon="inline-start" />Undoing…
            } @else {
              <ng-icon name="lucideUndo2" class="text-base" aria-hidden="true" />Undo
            }
          </button>
        }
      </app-admin-alert>
    }
    @if (undoNote(); as note) {
      <div data-slot="undo-note" class="mt-2">
        @if (note.kind === 'offline') {
          <app-admin-offline-alert #undoAlert [description]="note.description" />
        } @else {
          <app-admin-alert
            #undoAlert
            kind="error"
            [title]="note.text.title"
            [description]="note.text.description"
          />
        }
      </div>
    }
    @if (!formMode()) {
      @if (canEnter() && reportedLines().length > 0) {
        <div data-slot="reports" class="mt-2 flex flex-col gap-2">
          <p>
            <span hlmBadge variant="secondary">Reported</span>
            @if (reportedLines().length > 1) {
              <span class="ms-2 text-muted-foreground"
                >The two teams reported different scores.</span
              >
            }
          </p>
          <ul role="list" class="flex flex-col gap-2">
            @for (line of reportedLines(); track line.report.reportId) {
              <li data-slot="report" class="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span class="text-muted-foreground">{{ line.text }}</span>
                <button
                  type="button"
                  data-slot="button"
                  [class]="primaryButton"
                  [class.opacity-50]="!online() && !confirming()"
                  [attr.aria-disabled]="confirming() || !online() ? 'true' : null"
                  (click)="confirm(line.report)"
                >
                  @if (confirming()) {
                    <hlm-spinner data-icon="inline-start" />Confirming…
                  } @else {
                    Confirm<span class="sr-only">
                      the score reported by {{ line.report.teamName }}</span
                    >
                  }
                </button>
              </li>
            }
          </ul>
          <div>
            <button
              #openButton
              type="button"
              data-slot="button"
              [class]="outlineButton"
              (click)="openForm(false, true)"
            >
              <ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Correct
              score<span class="sr-only"> {{ label() }}</span>
            </button>
          </div>
        </div>
      } @else if (canEnter()) {
        <button
          #openButton
          type="button"
          data-slot="button"
          [class]="outlineButton + ' mt-2'"
          (click)="openForm(false)"
        >
          Enter result<span class="sr-only"> {{ label() }}</span>
        </button>
      } @else if (played()) {
        @if (game().locked) {
          <p data-slot="locked" class="mt-2 text-muted-foreground">{{ lockedText }}</p>
        } @else {
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              #openButton
              type="button"
              data-slot="button"
              [class]="outlineButton"
              (click)="openForm(true)"
            >
              <ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Correct
              result<span class="sr-only"> {{ label() }}</span>
            </button>
            <button
              type="button"
              data-slot="button"
              [class]="outlineButton"
              [class.opacity-50]="!online() && !clearing()"
              [attr.aria-disabled]="clearing() || !online() ? 'true' : null"
              (click)="clear()"
            >
              @if (clearing()) {
                <hlm-spinner data-icon="inline-start" />Clearing…
              } @else {
                <ng-icon name="lucideEraser" data-icon="inline-start" aria-hidden="true" />Clear
                result<span class="sr-only"> {{ label() }}</span>
              }
            </button>
          </div>
        }
      }
    } @else {
      <form novalidate class="mt-3" [attr.aria-label]="formLabel()" (submit)="submit($event)">
        @if (draft.alert(); as kind) {
          @if (kind === 'offline') {
            <app-admin-offline-alert #formAlert [description]="saveOffline" class="mb-4" />
          } @else {
            <app-admin-alert
              #formAlert
              kind="error"
              [title]="failure().title"
              [description]="failure().description"
              class="mb-4"
            />
          }
        }
        <div hlmFieldGroup>
          @if (draft.forfeit()) {
            <app-chip-radio-group
              #forfeitChoice
              [name]="gid() + '-forfeit-team'"
              legend="Which team forfeits?"
              [options]="teamOptions()"
              [value]="forfeitValue()"
              [description]="forfeitDescription()"
              [error]="draft.forfeitError()"
              (chosen)="chooseForfeit($event)"
            />
          } @else {
            <app-game-score-fields
              [draft]="draft"
              [idPrefix]="gid()"
              [sport]="tournament().sport"
              [setsPerGame]="tournament().setsPerGame"
              [teamNames]="teamNames()"
            />
          }
          <div hlmField orientation="horizontal">
            <app-checkbox
              [controlId]="gid() + '-forfeit'"
              [checked]="draft.forfeit()"
              (checkedChange)="setForfeit($event)"
            />
            <div hlmFieldContent>
              <label hlmFieldLabel [for]="gid() + '-forfeit'">A team forfeits</label>
            </div>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            data-slot="button"
            [class]="primaryButton"
            [class.opacity-50]="!online() && !draft.submitting()"
            [attr.aria-disabled]="draft.submitting() || !online() ? 'true' : null"
          >
            @if (draft.submitting()) {
              <hlm-spinner data-icon="inline-start" />Saving…
            } @else {
              {{ correcting() ? 'Save correction' : 'Save result' }}
            }
          </button>
          <button
            type="button"
            data-slot="button"
            [class]="outlineButton"
            [attr.aria-disabled]="draft.submitting() ? 'true' : null"
            (click)="cancel()"
          >
            Cancel
          </button>
        </div>
        <p role="status" class="sr-only">{{ draft.submitting() ? 'Saving the result.' : '' }}</p>
      </form>
    }
  `,
})
export class BracketGame {
  readonly game = input.required<BracketGameView>();
  readonly round = input.required<number>();
  readonly tournament = input.required<ManagedTournament>();

  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly enterCall = injectMutation(api.tournamentGames.enterResult);
  private readonly correctCall = injectMutation(api.tournamentGames.correctResult);
  private readonly undoCall = injectMutation(api.tournamentGames.undoResult);
  private readonly confirmCall = injectMutation(api.scoreReports.confirm);

  protected readonly online = injectOnline();
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly textButton = TEXT_BUTTON;
  protected readonly saveOffline = SAVE_OFFLINE;
  protected readonly lockedText = BRACKET_MESSAGES.nextGamePlayed;

  protected readonly formMode = signal<'enter' | 'correct' | null>(null);
  protected readonly status = signal<Status | null>(null);
  protected readonly undoNote = signal<UndoNote | null>(null);
  protected readonly undoing = signal(false);
  protected readonly clearing = signal(false);
  protected readonly confirming = signal(false);

  protected readonly draft = new GameResultDraft(
    () => this.tournament().sport,
    () => this.tournament().setsPerGame,
  );

  private readonly statusAlert = viewChild<AdminAlert>('statusAlert');
  private readonly undoAlert = viewChild<AdminAlert | AdminOfflineAlert>('undoAlert');
  private readonly formAlert = viewChild<AdminAlert | AdminOfflineAlert>('formAlert');
  private readonly openButton = viewChild<ElementRef<HTMLElement>>('openButton');
  private readonly forfeitChoice = viewChild(ChipRadioGroup);

  protected readonly gid = computed(() => this.game().gameId);
  protected readonly correcting = computed(() => this.formMode() === 'correct');

  private readonly teamIds = computed(() => this.game().teams.map((team) => team?.teamId ?? null));
  private readonly bothTeams = computed(() => {
    const [a, b] = this.game().teams;
    return a && b ? ([a, b] as const) : null;
  });
  protected readonly teamNames = computed(() => {
    const [a, b] = this.bothTeams() ?? [];
    return [a?.name ?? '', b?.name ?? ''] as const;
  });
  protected readonly teamOptions = computed<readonly ChipOption[]>(() => [
    { key: '0', label: this.teamNames()[0] },
    { key: '1', label: this.teamNames()[1] },
  ]);
  protected readonly forfeitValue = computed(() => {
    const side = this.draft.forfeitSide();
    return side === null ? null : String(side);
  });
  protected readonly forfeitDescription = computed(() =>
    forfeitNote(this.tournament().sport, this.tournament().setsPerGame),
  );
  protected readonly formLabel = computed(() =>
    this.correcting() ? `Correct the result of ${this.label()}` : `Result of ${this.label()}`,
  );

  protected readonly label = computed(() =>
    this.game()
      .teams.map((team) => team?.name ?? (this.round() === 1 ? 'Bye' : 'To be decided'))
      .join(' v '),
  );

  protected readonly canEnter = computed(
    () => this.bothTeams() !== null && this.game().result === null,
  );

  protected readonly reportedLines = computed(() => {
    const teams = this.bothTeams();
    const { reports } = this.game();
    const [first] = reports;
    if (!teams || !first || !this.canEnter()) return [];
    const names = [teams[0].name, teams[1].name] as const;
    if (reports.every((reported) => scoresEqual(reported.score, first.score))) {
      const reporter = reports.length > 1 ? 'Both teams' : first.teamName;
      return [{ report: first, text: reportedText(reporter, names, first.score) }];
    }
    return reports.map((reported) => ({
      report: reported,
      text: reportedText(reported.teamName, names, reported.score),
    }));
  });

  protected readonly played = computed(() => {
    const { result, winnerTeamId } = this.game();
    const teams = this.bothTeams();
    if (!result || !teams) return null;
    const nameOf = (id: string | null) => teams.find((team) => team.teamId === id)?.name ?? '';
    return playedText({
      teams: [teams[0].name, teams[1].name],
      score: result.score,
      winnerName: nameOf(winnerTeamId),
      forfeitName: result.forfeitTeamId === null ? null : nameOf(result.forfeitTeamId),
    });
  });

  protected readonly undoable = computed(() => {
    const status = this.status();
    if (status === null || status.kind === 'ended') return null;
    const stored = this.game().result?.resultEnteredAt ?? null;
    if (status.resultEnteredAt !== stored || this.game().locked) return null;
    // A correction of a feeding game can put another team here, and the cleared result is not theirs.
    return status.kind === 'cleared' && !sameIds(status.teamIds, this.teamIds()) ? null : status;
  });

  protected readonly failure = computed(() =>
    saveFailedText(this.correcting(), this.draft.refusal()),
  );

  protected setForfeit(forfeit: boolean): void {
    this.draft.forfeit.set(forfeit);
  }

  protected chooseForfeit(key: string): void {
    this.draft.chooseForfeit(key === '1' ? 1 : 0);
  }

  protected openForm(correcting: boolean, fromReport = false): void {
    const { result } = this.game();
    const [lone, ...rest] = this.reportedLines();
    const reported = fromReport && lone && rest.length === 0 ? lone.report.score : null;
    this.status.set(null);
    this.undoNote.set(null);
    this.draft.load(
      correcting ? result : reported && { score: reported, forfeitTeamId: null },
      this.teamIds(),
    );
    this.formMode.set(correcting ? 'correct' : 'enter');
    this.focusAfterRender(() => this.focusTarget(this.draft.forfeit() ? 'forfeit' : 'a1'));
  }

  protected cancel(): void {
    if (this.draft.submitting()) return;
    this.formMode.set(null);
    this.focusAfterRender(() => this.openButton()?.nativeElement.focus());
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const teams = this.bothTeams();
    if (!teams || this.draft.submitting()) return;
    const correcting = this.correcting();
    const gameId = this.game().gameId;
    const send = (body: ResultBody) =>
      correcting
        ? this.correctCall.run({ gameId, ...body })
        : this.enterCall.run({ gameId, ...body });
    const outcome = await this.draft.submit(
      this.online(),
      [teams[0].teamId, teams[1].teamId],
      send,
    );
    if (outcome.sent) {
      const saved = outcome.result;
      this.formMode.set(null);
      this.status.set({
        kind: 'saved',
        text: savedText(saved.winnerName, saved.advancesTo, correcting),
        previous: saved.previous,
        resultEnteredAt: saved.resultEnteredAt,
      });
      this.focusStatusUnlessMoved(() => this.statusAlert()?.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusTarget(outcome.focus));
    } else {
      this.focusAfterRender(() => this.formAlert()?.focus());
    }
  }

  protected clear(): Promise<void> {
    const { gameId, result } = this.game();
    if (!result) return Promise.resolve();
    const cleared: ResultBody =
      result.forfeitTeamId === null
        ? { score: result.score }
        : { forfeitTeamId: result.forfeitTeamId };
    const teamIds = this.teamIds();
    return this.change({
      pending: this.clearing,
      offline: UNDO_OFFLINE,
      failed: clearFailedText,
      run: async () => {
        await this.undoCall.run({ gameId, expected: result.resultEnteredAt });
        return { kind: 'cleared', text: CLEARED_TEXT, cleared, teamIds, resultEnteredAt: null };
      },
    });
  }

  protected confirm({ reportId, reportedAt }: ReportView): Promise<void> {
    return this.change({
      pending: this.confirming,
      offline: CONFIRM_OFFLINE,
      failed: confirmFailedText,
      run: async () => {
        const saved = await this.confirmCall.run({ reportId, expected: reportedAt });
        return {
          kind: 'saved',
          text: confirmedText(saved.winnerName, saved.advancesTo),
          previous: saved.previous,
          resultEnteredAt: saved.resultEnteredAt,
        };
      },
    });
  }

  protected undo(status: SavedStatus | ClearedStatus): Promise<void> {
    const gameId = this.game().gameId;
    if (status.kind === 'cleared') {
      return this.change({
        pending: this.undoing,
        offline: RESTORE_OFFLINE,
        failed: restoreFailedText,
        run: async () => {
          const saved = await this.enterCall.run({ gameId, ...status.cleared });
          return { kind: 'ended', text: restoredText(saved.winnerName, saved.advancesTo) };
        },
      });
    }
    const { previous, resultEnteredAt } = status;
    return this.change({
      pending: this.undoing,
      offline: UNDO_OFFLINE,
      failed: undoFailedText,
      run: async () => {
        await this.undoCall.run({
          gameId,
          expected: resultEnteredAt,
          ...(previous && { restore: previous }),
        });
        return { kind: 'ended', text: undoneText(previous !== null) };
      },
    });
  }

  /** A worded refusal means the status acted on a result that changed; a connection failure keeps it so the press can be retried. */
  private async change({ pending, offline, failed, run }: Change): Promise<void> {
    if (this.clearing() || this.undoing() || this.confirming()) return;
    this.undoNote.set(null);
    if (!this.online()) {
      this.showUndoNote({ kind: 'offline', description: offline });
      return;
    }
    pending.set(true);
    try {
      this.status.set(await run());
      this.focusStatusUnlessMoved(() => this.statusAlert()?.focus());
    } catch (failure) {
      if (failure instanceof ConvexOfflineError) {
        this.showUndoNote({ kind: 'offline', description: offline });
      } else {
        const refusal = bracketRefusalMessage(failure);
        if (refusal !== null) this.status.set(null);
        this.showUndoNote({ kind: 'failed', text: failed(refusal) });
      }
    } finally {
      pending.set(false);
    }
  }

  private showUndoNote(note: UndoNote): void {
    this.undoNote.set(note);
    this.focusAfterRender(() => this.undoAlert()?.focus());
  }

  private focusTarget(target: FocusTarget): void {
    const root = this.host.nativeElement;
    if (target === 'forfeit') {
      this.forfeitChoice()?.focus();
      return;
    }
    root.querySelector<HTMLElement>(`#${this.gid()}-${target}`)?.focus();
  }

  /** The pressed button has gone with the form or the status; a reply that arrives after the user went elsewhere leaves focus there. */
  private focusStatusUnlessMoved(focus: () => void): void {
    afterNextRender(
      () => {
        const active = this.document.activeElement;
        if (active === null || active === this.document.body) focus();
      },
      { injector: this.injector },
    );
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
