import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClipboardCheck } from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { scoreKindOf, type Sport } from '../../../convex/lib/sports';
import { api, injectQuery } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { HlmCard } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';
import { ScoreReportForm } from './score-report-form';
import { LOAD_FAILED, NO_GAME_TEXT, NO_GAME_TITLE } from './score-report-text';

@Component({
  selector: 'app-score-report-panel',
  imports: [AdminAlert, HlmCard, HlmSkeleton, NgIcon, NgTemplateOutlet, ScoreReportForm],
  providers: [provideIcons({ lucideClipboardCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (query.error() !== undefined) {
      <app-admin-alert
        kind="error"
        [title]="loadFailed.title"
        [description]="loadFailed.description"
      />
    } @else if (query.value() !== null) {
      <section
        aria-labelledby="score-report-heading"
        hlmCard
        size="bare"
        class="overflow-hidden"
        data-testid="score-report"
      >
        <div
          class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
        >
          <h2 id="score-report-heading" class="font-semibold">Report score</h2>
        </div>
        @if (query.value(); as value) {
          @for (game of games(); track game.gameId) {
            <app-score-report-form
              [game]="game"
              [teamId]="teamId()"
              [sport]="value.sport"
              [setsPerGame]="value.setsPerGame"
            />
          } @empty {
            <div class="grid">
              <div class="invisible col-start-1 row-start-1 px-4 py-4 md:px-5" aria-hidden="true">
                <ng-container [ngTemplateOutlet]="skeleton" />
              </div>
              <div
                class="col-start-1 row-start-1 flex flex-col items-center justify-center px-6 py-10 text-center"
                data-slot="empty"
              >
                <span
                  class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  ><ng-icon name="lucideClipboardCheck" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">{{ noGameTitle }}</p>
                <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                  {{ noGameText }}
                </p>
              </div>
            </div>
          }
        } @else {
          <div class="px-4 py-4 md:px-5">
            <p role="status" class="sr-only">Loading the game.</p>
            <ng-container [ngTemplateOutlet]="skeleton" />
          </div>
        }
      </section>
    }
    <ng-template #skeleton>
      <div aria-hidden="true">
        <div hlmSkeleton class="rounded-md h-6 w-64 max-w-full"></div>
        @for (row of rows(); track row) {
          <div [class]="row === 0 ? 'mt-3' : 'mt-5'" data-slot="skeleton-set">
            @if (named()) {
              <div
                hlmSkeleton
                class="rounded-md mb-1.5 h-5 w-12"
                data-slot="skeleton-set-name"
              ></div>
            }
            <div class="grid grid-cols-2 gap-3">
              @for (box of boxes; track box) {
                <div>
                  <div hlmSkeleton class="rounded-md w-20 max-w-full text-sm leading-snug">
                    <span class="invisible">Name</span>
                  </div>
                  <div hlmSkeleton class="rounded-md mt-2 h-9 pointer-coarse:h-11"></div>
                </div>
              }
            </div>
            @if (row === 2) {
              <div
                hlmSkeleton
                class="rounded-md mt-4 w-48 max-w-full text-sm leading-normal"
                data-slot="skeleton-note"
              >
                <span class="invisible">Note</span>
              </div>
            }
          </div>
        }
        <div hlmSkeleton class="rounded-md mt-4 h-9 w-32 pointer-coarse:h-11"></div>
      </div>
    </ng-template>
  `,
})
export class ScoreReportPanel {
  readonly teamId = input.required<Id<'teams'>>();
  /** The tournament's, known from the team before the game answers, so the skeleton has the form's rows. */
  readonly sport = input<Sport>('beachVolleyball');
  readonly setsPerGame = input(1);

  protected readonly query = injectQuery(api.scoreReports.forTeam, () => ({
    teamId: this.teamId(),
  }));
  protected readonly boxes = [0, 1];
  private readonly shape = computed(() => {
    const answered = this.query.value();
    return {
      sport: answered?.sport ?? this.sport(),
      setsPerGame: answered?.setsPerGame ?? this.setsPerGame(),
    };
  });
  protected readonly named = computed(() => scoreKindOf(this.shape().sport) === 'sets');
  protected readonly rows = computed(() =>
    this.named() && this.shape().setsPerGame === 3 ? [0, 1, 2] : [0],
  );
  protected readonly loadFailed = LOAD_FAILED;
  protected readonly noGameTitle = NO_GAME_TITLE;
  protected readonly noGameText = NO_GAME_TEXT;

  /** One game at most, in a list so a new game gets a new form with empty boxes. */
  protected readonly games = computed(() => {
    const game = this.query.value()?.game;
    return game ? [game] : [];
  });
}
