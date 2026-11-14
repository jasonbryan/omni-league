import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePencil } from '@ng-icons/lucide';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '../../../convex/_generated/dataModel';
import type { Sport } from '../../../convex/lib/sports';
import { api, injectMutation, injectOnline } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import type { AlertText } from '../organizations/admin/alert-text';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../organizations/admin/button-classes';
import { GameResultDraft } from '../organizations/admin/game-result-state';
import { SAVE_OFFLINE } from '../organizations/admin/game-result-text';
import { GameScoreFields } from '../organizations/admin/game-score-fields';
import { HlmSpinner } from '../ui/spinner';
import {
  gameLabel,
  REPORTED_NOTE,
  REPORTED_STATUS,
  reportedLine,
  reportFailedText,
} from './score-report-text';

export type ReportableGame = NonNullable<
  NonNullable<FunctionReturnType<typeof api.scoreReports.forTeam>>['game']
>;

/** A new game gets a new form, so no box or status carries over. */
@Component({
  selector: 'app-score-report-form',
  imports: [AdminAlert, AdminOfflineAlert, GameScoreFields, HlmSpinner, NgIcon],
  providers: [provideIcons({ lucidePencil })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block px-4 py-4 md:px-5' },
  template: `
    <p class="font-medium" data-slot="game-label">{{ label() }}</p>
    @if (status(); as status) {
      <app-admin-alert
        #statusAlert
        class="mt-3"
        kind="success"
        [title]="status.title"
        [description]="status.description"
      />
    }
    @if (formOpen()) {
      <form
        novalidate
        class="mt-3"
        [attr.aria-label]="'Report the score of ' + label()"
        (submit)="submit($event)"
      >
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
        <div class="flex flex-col gap-5">
          <app-game-score-fields
            [draft]="draft"
            [idPrefix]="idPrefix()"
            [sport]="sport()"
            [setsPerGame]="setsPerGame()"
            [teamNames]="names()"
          />
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
              <hlm-spinner data-icon="inline-start" />Reporting…
            } @else {
              Report score
            }
          </button>
          @if (game().report) {
            <button
              type="button"
              data-slot="button"
              [class]="outlineButton"
              [attr.aria-disabled]="draft.submitting() ? 'true' : null"
              (click)="cancel()"
            >
              Cancel
            </button>
          }
        </div>
        <p role="status" class="sr-only">
          {{ draft.submitting() ? 'Reporting the score.' : '' }}
        </p>
      </form>
    } @else {
      <p class="mt-3" data-slot="reported">
        <span class="text-muted-foreground">Your report: </span>{{ reportedText() }}
      </p>
      <p class="mt-1 text-sm text-muted-foreground">{{ reportedNote }}</p>
      <button
        #openButton
        type="button"
        data-slot="button"
        [class]="outlineButton + ' mt-3'"
        (click)="edit()"
      >
        <ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Change score
      </button>
    }
  `,
})
export class ScoreReportForm {
  readonly game = input.required<ReportableGame>();
  readonly teamId = input.required<Id<'teams'>>();
  readonly sport = input.required<Sport>();
  readonly setsPerGame = input.required<number>();

  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly reportCall = injectMutation(api.scoreReports.report);

  protected readonly online = injectOnline();
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly saveOffline = SAVE_OFFLINE;
  protected readonly reportedNote = REPORTED_NOTE;

  protected readonly draft = new GameResultDraft(
    () => this.sport(),
    () => this.setsPerGame(),
  );
  private readonly editing = signal(false);
  protected readonly status = signal<AlertText | null>(null);

  protected readonly idPrefix = computed(() => `report-${this.game().gameId}`);
  protected readonly names = computed(() => {
    const [a, b] = this.game().teams;
    return [a.name, b.name] as const;
  });
  protected readonly label = computed(() => gameLabel(this.game().roundName, this.names()));
  protected readonly reportedText = computed(() => {
    const { report } = this.game();
    return report ? reportedLine(this.names(), report.score) : '';
  });
  protected readonly formOpen = computed(() => this.editing() || this.game().report === null);
  protected readonly failure = computed(() => reportFailedText(this.draft.refusal()));

  private readonly statusAlert = viewChild<AdminAlert>('statusAlert');
  private readonly formAlert = viewChild<AdminAlert | AdminOfflineAlert>('formAlert');
  private readonly openButton = viewChild<ElementRef<HTMLElement>>('openButton');

  protected edit(): void {
    const { report } = this.game();
    this.status.set(null);
    this.draft.load(report && { score: report.score, forfeitTeamId: null }, []);
    this.editing.set(true);
    this.focusAfterRender(() => this.focusBox('a1'));
  }

  protected cancel(): void {
    if (this.draft.submitting()) return;
    this.editing.set(false);
    this.focusAfterRender(() => this.openButton()?.nativeElement.focus());
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.draft.submitting()) return;
    const gameId = this.game().gameId;
    const teamId = this.teamId();
    const outcome = await this.draft.submitScore(this.online(), (score) =>
      this.reportCall.run({ gameId, teamId, score }),
    );
    if (outcome.sent) {
      this.editing.set(false);
      this.status.set(REPORTED_STATUS);
      this.focusAfterRender(() => this.focusStatusUnlessMoved());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusBox(outcome.focus));
    } else {
      this.focusAfterRender(() => this.formAlert()?.focus());
    }
  }

  /** The form and its Report score button are gone, so a reply that arrives after the user went elsewhere leaves focus there. */
  private focusStatusUnlessMoved(): void {
    const active = this.document.activeElement;
    if (active === null || active === this.document.body) this.statusAlert()?.focus();
  }

  private focusBox(box: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`#${this.idPrefix()}-${box}`)?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
