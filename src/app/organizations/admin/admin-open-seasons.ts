import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { api, injectQuery } from '../../core/data/convex';
import { injectNow } from '../../core/now';
import { seasonManagementPath } from '../season-management/season-management-path';
import { openSeasonsBySoonestDeadline } from '../season-status';
import { AdminAlert } from './admin-alert';
import { AdminContext } from './admin-context';
import { adminPath } from './admin-path';
import { HlmSkeleton } from '../../ui/skeleton';

/** The query reads no clock, so `registrationIsOpen` runs here at the viewer's time. */
@Component({
  selector: 'app-admin-open-seasons',
  imports: [AdminAlert, HlmSkeleton, NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block self-start xl:col-span-2' },
  template: `
    <section
      aria-labelledby="open-heading"
      class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
    >
      <div
        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="open-heading" class="font-semibold">Registration open</h2>
      </div>
      @if (failed()) {
        <div class="px-4 py-4 md:px-5">
          <app-admin-alert
            kind="error"
            title="Registration open could not be loaded."
            description="Check your connection."
            ><a [href]="overviewPath()">Try again</a></app-admin-alert
          >
        </div>
      } @else if (seasons(); as seasons) {
        @if (seasons.length > 0) {
          <ul role="list" class="divide-y divide-border">
            @for (season of seasons; track season.league.slug + '/' + season.slug) {
              <li>
                <a
                  [routerLink]="seasonLink(season.league.slug, season.slug)"
                  class="group flex min-h-16 items-center gap-3 px-4 py-3.5 hover:bg-muted md:px-5"
                  ><div class="min-w-0 flex-1">
                    <p class="font-medium group-hover:underline">
                      {{ season.league.name }}
                      <span class="font-normal text-muted-foreground">· {{ season.name }}</span>
                    </p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      Closes {{ closes(season.registrationDeadline) }}
                    </p>
                  </div>
                  <ng-icon
                    name="lucideChevronRight"
                    class="shrink-0 text-lg text-muted-foreground"
                    aria-hidden="true"
                /></a>
              </li>
            }
          </ul>
        } @else {
          <p class="px-4 py-4 text-muted-foreground md:px-5">No season is open for registration.</p>
        }
      } @else {
        <p role="status" class="sr-only">Loading the seasons open for registration.</p>
        <div aria-hidden="true" class="divide-y divide-border">
          @for (row of skeletonRows; track row) {
            <div class="flex min-h-16 items-center gap-3 px-4 py-3.5 md:px-5">
              <div class="min-w-0 flex-1">
                <div hlmSkeleton class="h-5 w-48 max-w-full rounded-md"></div>
                <div hlmSkeleton class="mt-1 h-4 w-28 rounded-md"></div>
              </div>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class AdminOpenSeasons {
  private readonly context = inject(AdminContext);
  private readonly now = injectNow();

  protected readonly skeletonRows = [1, 2];

  private readonly query = injectQuery(api.seasons.listOpenForOrganization, () => ({
    orgSlug: this.context.slug(),
  }));

  protected readonly failed = computed(() => this.query.error() !== undefined);

  protected readonly seasons = computed(() => {
    const rows = this.query.value();
    return rows && openSeasonsBySoonestDeadline(rows, this.now());
  });

  protected readonly overviewPath = computed(() => adminPath(this.context.slug()));
  protected readonly closes = formatCalendarDate;

  protected seasonLink(leagueSlug: string, seasonSlug: string): string {
    return seasonManagementPath(this.context.slug(), leagueSlug, seasonSlug);
  }
}
