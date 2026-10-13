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
import { lucideChevronRight, lucideMapPin } from '@ng-icons/lucide';
import { SavedCopyNote } from '../../offline/saved-copy-note';
import { organizationPath } from '../organization-path';
import { PageControl } from '../page-control';
import { publicLeaguePath } from '../public-league/public-league-path';
import { sportSummary, sportViewPath, type SportView } from './sport-view-path';

/**
 * The sport view's content column (#114, design/mockups/60-organization-page.html revision 4,
 * state 9): the breadcrumb organization, then the sport (the current page); the sport's name as the
 * page's `<h1>` with its league and location counts under it; and the Leagues panel with one row
 * per published league on this page (a link to its public page, #127, and its locations, without
 * the sport badge the title already says) and #103's numbered control when the sport has more than
 * 5 leagues. With `savedAt` set (a saved copy shown offline, #82), the saved-copy note sits right
 * under the `h1`.
 *
 * `busy` marks the list `aria-busy` while the next page loads (the page keeps the old rows until
 * then). A plain click on a page link remembers that the visitor asked for a page, and when the
 * leagues shown change, focus moves to the panel heading, as the mockup states. A live update of
 * the shown page never moves focus.
 */
@Component({
  selector: 'app-sport-view-content',
  imports: [NgIcon, PageControl, RouterLink, SavedCopyNote],
  providers: [provideIcons({ lucideChevronRight, lucideMapPin })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    <nav aria-label="Breadcrumb">
      <ol role="list" class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <li>
          <a
            [routerLink]="organizationHref()"
            class="font-medium underline underline-offset-4 hover:text-foreground"
            >{{ view().organization.name }}</a
          >
        </li>
        <li aria-hidden="true">
          <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
        </li>
        <li>
          <a [routerLink]="sportHref()" aria-current="page" class="font-medium text-foreground">{{
            view().sport.name
          }}</a>
        </li>
      </ol>
    </nav>
    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
      {{ view().sport.name }}
    </h1>
    @if (savedAt(); as savedAt) {
      <app-saved-copy-note [savedAt]="savedAt" />
    }
    <p class="mt-1 text-sm text-muted-foreground">{{ summary() }}</p>
    <div class="mt-6">
      <section
        id="leagues"
        aria-labelledby="leagues-heading"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div class="border-b border-border px-4 py-3 md:px-5">
          <h2 #heading id="leagues-heading" tabindex="-1" class="font-semibold focus:outline-none">
            Leagues
          </h2>
        </div>
        <ul role="list" class="divide-y divide-border" [attr.aria-busy]="busy() ? 'true' : null">
          @for (league of leagues(); track league.slug) {
            <li class="flex items-start justify-between gap-3 px-4 py-3.5 md:px-5">
              <div class="min-w-0">
                <h3 class="font-medium">
                  <a
                    [routerLink]="league.href"
                    class="underline underline-offset-4 hover:text-primary"
                    >{{ league.name }}</a
                  >
                </h3>
                @if (league.locations) {
                  <p class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <ng-icon
                      name="lucideMapPin"
                      class="mt-0.5 shrink-0 text-base"
                      aria-hidden="true"
                    /><span
                      ><span class="sr-only">{{ league.locationsLabel }}</span
                      >{{ league.locations }}</span
                    >
                  </p>
                }
              </div>
            </li>
          }
        </ul>
        <app-page-control
          label="Leagues pages"
          noun="leagues"
          [page]="view().leagues.page"
          [pageCount]="view().leagues.pageCount"
          [total]="view().leagues.total"
          [path]="sportHref()"
          fragment="leagues"
          (pageActivated)="pageRequested = true"
        />
      </section>
    </div>
  `,
})
export class SportViewContent {
  readonly view = input.required<SportView>();
  /** The next page of leagues is loading: the rows shown are the previous page's. */
  readonly busy = input(false);
  /** When the saved copy shown was saved; set only while offline (`SportViewPage`). */
  readonly savedAt = input<number | undefined>(undefined);

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly injector = inject(Injector);

  /** A visitor activated a link to another page, so focus follows when its leagues arrive. */
  protected pageRequested = false;

  protected readonly organizationHref = computed(() =>
    organizationPath(this.view().organization.slug),
  );
  protected readonly sportHref = computed(() =>
    sportViewPath(this.view().organization.slug, this.view().sport.segment),
  );
  protected readonly summary = computed(() => sportSummary(this.view().sport));
  protected readonly leagues = computed(() =>
    this.view().leagues.rows.map((league) => ({
      name: league.name,
      slug: league.slug,
      href: publicLeaguePath(this.view().organization.slug, league.slug),
      locations: league.locationNames.join(', '),
      locationsLabel: league.locationNames.length === 1 ? 'Location: ' : 'Locations: ',
    })),
  );

  private readonly shownLeagues = computed(() => this.view().leagues);

  constructor() {
    // Moves focus, which only the browser does: a side effect outside Angular. The leagues shown
    // change when the page asked for has arrived, or when a live update replaces them; only the
    // first, after a click on a page link, moves focus.
    effect(() => {
      this.shownLeagues();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
      });
    });
  }
}
