import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClipboardCheck } from '@ng-icons/lucide';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '../../../convex/_generated/dataModel';
import { scoreKindOf, type Sport } from '../../../convex/lib/sports';
import { api, injectQuery } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { pointsLabel } from '../organizations/admin/game-result-text';
import { HlmCard } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';
import { ScoreReportForm } from './score-report-form';
import {
  gameLabel,
  LOAD_FAILED,
  NO_GAME_TEXT,
  NO_GAME_TITLE,
  reportedLine,
  reportedNote,
  SET_THREE_NOTE,
} from './score-report-text';

export type ReportableGames = NonNullable<
  NonNullable<FunctionReturnType<typeof api.teams.getForMember>>['tournament']
>['reportableGames'];

/** The text one skeleton block draws, invisibly, so its bars wrap as the loaded text does. */
interface SkeletonGame {
  label: string;
  boxLabels: readonly [string, string];
  reported: { line: string; note: string } | null;
}

const isNamedSets = (sport: Sport) => scoreKindOf(sport) === 'sets';

const BLANK_GAME: SkeletonGame = { label: 'Game', boxLabels: ['Name', 'Name'], reported: null };

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
              class="border-border"
              [class.border-t]="!$first"
              [game]="game"
              [teamId]="teamId()"
              [sport]="value.sport"
              [setsPerGame]="value.setsPerGame"
            />
          } @empty {
            <div class="grid">
              <div class="invisible col-start-1 row-start-1 px-4 py-4 md:px-5" aria-hidden="true">
                <ng-container
                  [ngTemplateOutlet]="skeleton"
                  [ngTemplateOutletContext]="{ $implicit: blank }"
                />
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
          <p role="status" class="sr-only">Loading the game.</p>
          @for (game of skeletonGames(); track $index) {
            <div
              class="border-border px-4 py-4 md:px-5"
              [class.border-t]="!$first"
              data-slot="skeleton-block"
            >
              <ng-container
                [ngTemplateOutlet]="skeleton"
                [ngTemplateOutletContext]="{ $implicit: game }"
              />
            </div>
          }
        }
      </section>
    }
    <ng-template #skeleton let-game>
      <div aria-hidden="true">
        <div hlmSkeleton class="w-fit max-w-full rounded-md font-medium" data-slot="skeleton-label">
          <span class="invisible">{{ game.label }}</span>
        </div>
        @if (game.reported; as reported) {
          <div
            class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1"
            data-slot="skeleton-reported"
          >
            <span
              hlmSkeleton
              class="inline-flex h-5 shrink-0 items-center rounded-4xl border border-transparent px-2 text-xs font-medium whitespace-nowrap"
            >
              <span class="invisible">Reported</span>
            </span>
            <span hlmSkeleton class="rounded-md" data-slot="skeleton-reported-line">
              <span class="invisible">Your report: {{ reported.line }}</span>
            </span>
          </div>
          <div
            hlmSkeleton
            class="mt-1 w-fit max-w-full rounded-md text-sm"
            data-slot="skeleton-reported-note"
          >
            <span class="invisible">{{ reported.note }}</span>
          </div>
          <span
            hlmSkeleton
            class="mt-3 inline-flex h-9 w-36 items-center rounded-lg text-sm font-medium pointer-coarse:h-11"
            data-slot="skeleton-button"
          >
            <span class="invisible">Change score</span>
          </span>
        } @else {
          @for (row of rows(); track row) {
            <div [class]="row === 0 ? 'mt-3' : 'mt-5'" data-slot="skeleton-set">
              @if (named()) {
                <div
                  hlmSkeleton
                  class="mb-1.5 w-fit rounded-md text-sm font-medium"
                  data-slot="skeleton-set-name"
                >
                  <span class="invisible">Set {{ row + 1 }}</span>
                </div>
              }
              <div class="grid grid-cols-2 gap-3">
                @for (boxLabel of game.boxLabels; track $index) {
                  <div>
                    <div
                      hlmSkeleton
                      class="w-fit max-w-full rounded-md text-sm leading-snug font-medium"
                      data-slot="skeleton-box-label"
                    >
                      <span class="invisible">{{ boxLabel }}</span>
                    </div>
                    <div hlmSkeleton class="mt-2 h-9 rounded-md pointer-coarse:h-11"></div>
                  </div>
                }
              </div>
              @if (row === 2) {
                <div
                  hlmSkeleton
                  class="mt-4 w-fit max-w-full rounded-md text-sm leading-normal"
                  data-slot="skeleton-note"
                >
                  <span class="invisible">{{ setThreeNote }}</span>
                </div>
              }
            </div>
          }
          <div
            hlmSkeleton
            class="mt-4 h-9 w-32 rounded-md pointer-coarse:h-11"
            data-slot="skeleton-button"
          ></div>
        }
      </div>
    </ng-template>
  `,
})
export class ScoreReportPanel {
  readonly teamId = input.required<Id<'teams'>>();
  /** The tournament's, known from the team before the game answers, so the skeleton has the form's rows. */
  readonly sport = input<Sport>('beachVolleyball');
  readonly setsPerGame = input(1);
  /** The games the team page counted, so the skeleton holds the space of that many forms when it has no list. */
  readonly gameCount = input(1);
  /** The games the team page listed, so the skeleton draws each one's text and takes the height it loads at. */
  readonly reportableGames = input<ReportableGames>();

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
  protected readonly named = computed(() => isNamedSets(this.shape().sport));
  protected readonly rows = computed(() =>
    this.named() && this.shape().setsPerGame === 3 ? [0, 1, 2] : [0],
  );
  protected readonly loadFailed = LOAD_FAILED;
  protected readonly noGameTitle = NO_GAME_TITLE;
  protected readonly noGameText = NO_GAME_TEXT;

  protected readonly setThreeNote = SET_THREE_NOTE;

  protected readonly blank = BLANK_GAME;
  protected readonly skeletonGames = computed<readonly SkeletonGame[]>(() => {
    const listed = this.reportableGames();
    if (listed === undefined) {
      return Array.from({ length: Math.max(1, this.gameCount()) }, () => BLANK_GAME);
    }
    if (listed.length === 0) return [BLANK_GAME];
    const { sport } = this.shape();
    return listed.map((game) => {
      const names = [game.teams[0].name, game.teams[1].name] as const;
      return {
        label: gameLabel(game.roundName, names),
        boxLabels: isNamedSets(sport)
          ? names
          : ([pointsLabel(sport, names[0]), pointsLabel(sport, names[1])] as const),
        reported: game.report && {
          line: reportedLine(names, game.report.score),
          note: reportedNote(game.stage),
        },
      };
    });
  });

  /** In a list so a new game gets a new form with empty boxes. */
  protected readonly games = computed(() => this.query.value()?.games ?? []);
}
