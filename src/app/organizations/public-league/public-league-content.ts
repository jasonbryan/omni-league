import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendarDays, lucideChevronRight, lucideMapPin } from '@ng-icons/lucide';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { organizationPath } from '../organization-path';
import { PageControl } from '../page-control';
import { seasonDates } from '../league/season-dates';
import { publicLeaguePath, publicSeasonPath, type PublicLeagueView } from './public-league-path';

/**
 * The public league page's content column (#127, design/mockups/127-128-public-seasons.html): the
 * breadcrumb organization, sport, league; the league as the page's `<h1>`; the sport badge and the
 * locations; and the Seasons panel with one row per published season on this page (a link to the
 * season page, its dates, and its format), the empty state, and #103's numbered control when the
 * league has more than 5 published seasons. With `savedAt` set (a saved copy shown offline, #82),
 * the saved-copy note sits right under the `h1`.
 *
 * `busy` marks the list `aria-busy` while the next page loads (the page keeps the old rows until
 * then). A plain click on a page link remembers that the visitor asked for a page, and when the
 * seasons shown change, focus moves to the panel heading, as the mockup states. A live update of
 * the shown page never moves focus.
 */
@Component({
  selector: 'app-public-league-content',
  imports: [NgIcon, PageControl, RouterLink, SavedCopyNote],
  providers: [provideIcons({ lucideCalendarDays, lucideChevronRight, lucideMapPin })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    <nav aria-label="Breadcrumb">
      <ol role="list" class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <li>
          <a
            [routerLink]="organizationHref()"
            class="font-medium underline underline-offset-4 hover:text-foreground"
            >{{ view().league.organization.name }}</a
          >
        </li>
        <li aria-hidden="true">
          <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
        </li>
        <li>
          <!-- Plain text until #114 adds the sport view (/organizations/<org>/sports/<segment>). -->
          <span class="font-medium">{{ view().league.sportName }}</span>
        </li>
        <li aria-hidden="true">
          <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
        </li>
        <li>
          <a [routerLink]="leagueHref()" aria-current="page" class="font-medium text-foreground">{{
            view().league.name
          }}</a>
        </li>
      </ol>
    </nav>
    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
      {{ view().league.name }}
    </h1>
    @if (savedAt(); as savedAt) {
      <app-saved-copy-note [savedAt]="savedAt" />
    }
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <!-- The mockup's badge: helm's hlmBadge variant="secondary" classes. -->
      <span
        data-slot="badge"
        data-variant="secondary"
        class="group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)] bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80"
        >{{ view().league.sportName }}</span
      >
      @if (view().league.locationNames.length) {
        <p class="flex items-start gap-1.5 text-sm text-muted-foreground">
          <ng-icon name="lucideMapPin" class="mt-0.5 shrink-0 text-base" aria-hidden="true" /><span
            ><span class="sr-only">{{ locationsLabel() }}</span
            >{{ view().league.locationNames.join(', ') }}</span
          >
        </p>
      }
    </div>
    <div class="mt-6">
      <section
        id="seasons"
        aria-labelledby="seasons-heading"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div
          class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
        >
          <h2 #heading id="seasons-heading" tabindex="-1" class="font-semibold focus:outline-none">
            Seasons
          </h2>
        </div>
        @if (seasons().length) {
          <ul role="list" class="divide-y divide-border" [attr.aria-busy]="busy() ? 'true' : null">
            @for (season of seasons(); track season.slug) {
              <li class="flex items-start justify-between gap-3 px-4 py-3.5 md:px-5">
                <div class="min-w-0">
                  <h3 class="font-medium">
                    <a
                      [routerLink]="season.href"
                      class="underline underline-offset-4 hover:text-primary"
                      >{{ season.name }}</a
                    >
                  </h3>
                  <p class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <ng-icon
                      name="lucideCalendarDays"
                      class="mt-0.5 shrink-0 text-base"
                      aria-hidden="true"
                    /><span><span class="sr-only">Dates: </span>{{ season.dates }}</span>
                  </p>
                </div>
                <!-- The mockup's badge: helm's hlmBadge variant="secondary" classes plus mt-0.5. -->
                <span
                  data-slot="badge"
                  data-variant="secondary"
                  class="group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)] bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80 mt-0.5"
                  >{{ season.formatName }}</span
                >
              </li>
            }
          </ul>
          <app-page-control
            label="Seasons pages"
            noun="seasons"
            [page]="view().seasons.page"
            [pageCount]="view().seasons.pageCount"
            [total]="view().seasons.total"
            [path]="leagueHref()"
            fragment="seasons"
            (pageActivated)="pageRequested = true"
          />
        } @else {
          <div class="flex flex-col items-center px-6 py-10 text-center">
            <span
              class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              ><ng-icon name="lucideCalendarDays" class="text-xl" aria-hidden="true"
            /></span>
            <p class="mt-4 font-medium">No seasons yet</p>
            <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
              Seasons of this league will be listed here once they’re published.
            </p>
          </div>
        }
      </section>
    </div>
  `,
})
export class PublicLeagueContent {
  readonly view = input.required<PublicLeagueView>();
  /** The next page of seasons is loading: the rows shown are the previous page's. */
  readonly busy = input(false);
  /** When the saved copy shown was saved; set only while offline (`PublicLeaguePage`). */
  readonly savedAt = input<number | undefined>(undefined);

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly injector = inject(Injector);

  /** A visitor activated a link to another page, so focus follows when its seasons arrive. */
  protected pageRequested = false;

  protected readonly organizationHref = computed(() =>
    organizationPath(this.view().league.organization.slug),
  );
  protected readonly leagueHref = computed(() =>
    publicLeaguePath(this.view().league.organization.slug, this.view().league.slug),
  );
  protected readonly locationsLabel = computed(() =>
    this.view().league.locationNames.length === 1 ? 'Location: ' : 'Locations: ',
  );
  protected readonly seasons = computed(() => {
    const { league, seasons } = this.view();
    return seasons.rows.map((season) => ({
      name: season.name,
      slug: season.slug,
      href: publicSeasonPath(league.organization.slug, league.slug, season.slug),
      dates: seasonDates(season.startDate, season.endDate),
      formatName: season.formatName,
    }));
  });

  private readonly shownSeasons = computed(() => this.view().seasons);

  constructor() {
    // Moves focus, which only the browser does: a side effect outside Angular. The seasons shown
    // change when the page asked for has arrived, or when a live update replaces them; only the
    // first, after a click on a page link, moves focus.
    effect(() => {
      this.shownSeasons();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
      });
    });
  }
}
