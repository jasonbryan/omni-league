import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { HlmBadge } from '../ui/badge';
import { teamPath } from './team-paths';
import { HlmCard } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';

export interface SeasonTeamRow {
  teamId: Id<'teams'>;
  name: string;
  isViewerTeam: boolean;
}

const PANEL = 'overflow-hidden';

export function seasonTeamsCount(shown: number, total: number): string {
  const teams = `${total} ${total === 1 ? 'team' : 'teams'}`;
  return shown < total ? `${shown} of ${teams}` : teams;
}

@Component({
  selector: 'app-season-teams-panel',
  imports: [AdminAlert, HlmBadge, HlmCard, HlmSkeleton, NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="season-teams-heading" hlmCard size="bare" class="${PANEL}">
      <div
        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="season-teams-heading" class="font-semibold">Teams in this {{ scope() }}</h2>
        @if (count(); as count) {
          <p data-testid="season-teams-count" class="text-sm text-muted-foreground tabular-nums">
            {{ count }}
          </p>
        }
      </div>
      @if (failed()) {
        <div class="px-4 py-4 md:px-5">
          <app-admin-alert
            kind="error"
            [title]="'The ' + scope() + '’s teams could not be loaded.'"
            description="Check your connection and try again."
          />
        </div>
      } @else if (rows(); as rows) {
        <ul role="list" class="divide-y divide-border">
          @for (row of rows; track row.teamId) {
            <li>
              <a
                [routerLink]="href(row.teamId)"
                [attr.aria-current]="row.teamId === currentTeamId() ? 'page' : null"
                class="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-muted md:px-5"
                ><span class="min-w-0 flex-1 font-medium break-words">{{ row.name }}</span>
                <!-- A flex container drops this space visually; it keeps the badge a separate word in the link's name. -->
                &ngsp;
                @if (row.teamId === currentTeamId()) {
                  <span hlmBadge variant="outline">This team</span>
                } @else if (row.isViewerTeam) {
                  <span hlmBadge variant="secondary">Your team</span>
                }
                <ng-icon
                  name="lucideChevronRight"
                  class="shrink-0 text-base text-muted-foreground"
                  aria-hidden="true"
              /></a>
            </li>
          }
        </ul>
      } @else {
        <p role="status" class="sr-only">Loading the {{ scope() }}’s teams.</p>
        <div aria-hidden="true" class="divide-y divide-border">
          @for (placeholder of placeholders; track placeholder) {
            <div class="flex min-h-11 items-center px-4 py-2.5 md:px-5">
              <div hlmSkeleton class="rounded-md h-5 w-40 max-w-full"></div>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class SeasonTeamsPanel {
  readonly rows = input<readonly SeasonTeamRow[] | undefined>();
  readonly total = input<number | undefined>();
  readonly failed = input(false);
  readonly currentTeamId = input.required<string>();
  readonly scope = input<'season' | 'tournament'>('season');

  protected readonly placeholders = [1, 2, 3];
  protected readonly href = teamPath;

  protected readonly count = computed(() => {
    const rows = this.rows();
    const total = this.total();
    return rows === undefined || total === undefined ? null : seasonTeamsCount(rows.length, total);
  });
}
