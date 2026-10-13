import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarDays,
  lucideChevronRight,
  lucideMapPin,
  lucideShirt,
  lucideUsers,
} from '@ng-icons/lucide';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { seasonDateParts } from '../league/season-dates';
import { organizationPath } from '../organization-path';
import { publicLeaguePath, publicSeasonPath } from '../public-league/public-league-path';
import type { PublicSeasonView } from './public-season-view';

/**
 * The public season page's content column (#128, design/mockups/127-128-public-seasons.html
 * state 9): the breadcrumb organization, league, season; the season as the page's `<h1>`; the
 * sport badge and the league's name; and the Season details panel, a definition list of the dates
 * (each a `<time>` with its stored `YYYY-MM-DD`), the format, "Teams need at least N players",
 * and the locations. It shows no price and no registration action: #129, #133, and #143 add their
 * panel beside the details. With `savedAt` set (a saved copy shown offline, #82), the saved-copy
 * note sits right under the `h1`.
 *
 * The dates are written from the stored text (`seasonDateParts`), never through `Date`, so the
 * server and a browser in any time zone render the same text.
 */
@Component({
  selector: 'app-public-season-content',
  imports: [NgIcon, RouterLink, SavedCopyNote],
  providers: [
    provideIcons({
      lucideCalendarDays,
      lucideChevronRight,
      lucideMapPin,
      lucideShirt,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    <nav aria-label="Breadcrumb">
      <ol role="list" class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <li>
          <a
            [routerLink]="organizationHref()"
            class="font-medium underline underline-offset-4 hover:text-foreground"
            >{{ season().organization.name }}</a
          >
        </li>
        <li aria-hidden="true">
          <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
        </li>
        <li>
          <a
            [routerLink]="leagueHref()"
            class="font-medium underline underline-offset-4 hover:text-foreground"
            >{{ season().league.name }}</a
          >
        </li>
        <li aria-hidden="true">
          <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
        </li>
        <li>
          <a [routerLink]="seasonHref()" aria-current="page" class="font-medium text-foreground">{{
            season().name
          }}</a>
        </li>
      </ol>
    </nav>
    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
      {{ season().name }}
    </h1>
    @if (savedAt(); as savedAt) {
      <app-saved-copy-note [savedAt]="savedAt" />
    }
    <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <!-- The mockup's badge: helm's hlmBadge variant="secondary" classes. -->
      <span
        data-slot="badge"
        data-variant="secondary"
        class="group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)] bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80"
        >{{ season().league.sportName }}</span
      ><span class="text-sm text-muted-foreground">{{ season().league.name }}</span>
    </div>
    <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
      <section
        aria-labelledby="details-heading"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 lg:col-span-2"
      >
        <div
          class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
        >
          <h2 id="details-heading" class="font-semibold">Season details</h2>
        </div>
        <dl class="divide-y divide-border">
          <div class="relative min-h-16 py-3.5 ps-16 pe-4 md:ps-17 md:pe-5">
            <dt class="text-sm text-muted-foreground">
              <span
                class="absolute start-4 top-3.5 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground md:start-5"
                ><ng-icon name="lucideCalendarDays" class="text-lg" aria-hidden="true" /></span
              >Dates
            </dt>
            <dd class="mt-0.5 font-medium">
              <time [attr.datetime]="season().startDate">{{ dates().start }}</time>
              @if (dates().end; as end) {
                &ndash; <time [attr.datetime]="season().endDate">{{ end }}</time>
              }
            </dd>
          </div>
          <div class="relative min-h-16 py-3.5 ps-16 pe-4 md:ps-17 md:pe-5">
            <dt class="text-sm text-muted-foreground">
              <span
                class="absolute start-4 top-3.5 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground md:start-5"
                ><ng-icon name="lucideShirt" class="text-lg" aria-hidden="true" /></span
              >Format
            </dt>
            <dd class="mt-0.5 font-medium">{{ season().formatName }}</dd>
          </div>
          <div class="relative min-h-16 py-3.5 ps-16 pe-4 md:ps-17 md:pe-5">
            <dt class="text-sm text-muted-foreground">
              <span
                class="absolute start-4 top-3.5 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground md:start-5"
                ><ng-icon name="lucideUsers" class="text-lg" aria-hidden="true" /></span
              >Team size
            </dt>
            <dd class="mt-0.5 font-medium">{{ teamSize() }}</dd>
          </div>
          @if (season().league.locationNames.length) {
            <div class="relative min-h-16 py-3.5 ps-16 pe-4 md:ps-17 md:pe-5">
              <dt class="text-sm text-muted-foreground">
                <span
                  class="absolute start-4 top-3.5 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground md:start-5"
                  ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true" /></span
                >{{ locationsLabel() }}
              </dt>
              <dd class="mt-0.5 font-medium">{{ season().league.locationNames.join(', ') }}</dd>
            </div>
          }
        </dl>
      </section>
    </div>
  `,
})
export class PublicSeasonContent {
  readonly view = input.required<PublicSeasonView>();
  /** When the saved copy shown was saved; set only while offline (`PublicSeasonPage`). */
  readonly savedAt = input<number | undefined>(undefined);

  protected readonly season = computed(() => this.view().season);
  protected readonly dates = computed(() =>
    seasonDateParts(this.season().startDate, this.season().endDate),
  );
  protected readonly teamSize = computed(
    () => `Teams need at least ${this.season().minimumRosterSize} players`,
  );
  protected readonly locationsLabel = computed(() =>
    this.season().league.locationNames.length === 1 ? 'Location' : 'Locations',
  );
  protected readonly organizationHref = computed(() =>
    organizationPath(this.season().organization.slug),
  );
  protected readonly leagueHref = computed(() =>
    publicLeaguePath(this.season().organization.slug, this.season().league.slug),
  );
  protected readonly seasonHref = computed(() =>
    publicSeasonPath(
      this.season().organization.slug,
      this.season().league.slug,
      this.season().slug,
    ),
  );
}
