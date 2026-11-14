import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClipboardCheck } from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { api, injectQuery } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { HlmCard } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';
import { ScoreReportForm } from './score-report-form';
import { LOAD_FAILED, NO_GAME_TEXT, NO_GAME_TITLE } from './score-report-text';

@Component({
  selector: 'app-score-report-panel',
  imports: [AdminAlert, HlmCard, HlmSkeleton, NgIcon, ScoreReportForm],
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
            <div
              class="flex min-h-54 flex-col items-center justify-center px-6 py-10 text-center pointer-coarse:min-h-57"
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
          }
        } @else {
          <div class="min-h-54 px-4 py-4 pointer-coarse:min-h-57 md:px-5">
            <p role="status" class="sr-only">Loading the game.</p>
            <div aria-hidden="true">
              <div hlmSkeleton class="rounded-md h-6 w-64 max-w-full"></div>
              <div hlmSkeleton class="rounded-md mt-3 h-5 w-12"></div>
              <div class="mt-2 grid grid-cols-2 gap-3">
                @for (box of boxes; track box) {
                  <div>
                    <div hlmSkeleton class="rounded-md h-5 w-20 max-w-full"></div>
                    <div hlmSkeleton class="rounded-md mt-2 h-9 pointer-coarse:h-11"></div>
                  </div>
                }
              </div>
              <div hlmSkeleton class="rounded-md mt-4 h-9 w-32 pointer-coarse:h-11"></div>
            </div>
          </div>
        }
      </section>
    }
  `,
})
export class ScoreReportPanel {
  readonly teamId = input.required<Id<'teams'>>();

  protected readonly query = injectQuery(api.scoreReports.forTeam, () => ({
    teamId: this.teamId(),
  }));
  protected readonly boxes = [0, 1];
  protected readonly loadFailed = LOAD_FAILED;
  protected readonly noGameTitle = NO_GAME_TITLE;
  protected readonly noGameText = NO_GAME_TEXT;

  /** One game at most, in a list so a new game gets a new form with empty boxes. */
  protected readonly games = computed(() => {
    const game = this.query.value()?.game;
    return game ? [game] : [];
  });
}
