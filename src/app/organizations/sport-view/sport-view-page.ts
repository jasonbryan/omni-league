import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { api } from '../../../../convex/_generated/api';
import { sportFromSegment } from '../../../../convex/lib/sports';
import { injectOnline, injectQuery, skipToken } from '../../core/data/convex';
import { focusMainAfterRouteChange } from '../../core/focus-main';
import { parseListPage } from '../../core/list-page';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell, ShellSidebar } from '../../shell';
import { OrganizationSidebar } from '../organization-sidebar';
import { SportViewContent } from './sport-view-content';
import { sportViewCanonicalPath, type PublicSportLeagues, type SportView } from './sport-view-path';

/**
 * The sport view, `/organizations/:orgSlug/sports/:sport` (#114), drawn in
 * design/mockups/60-organization-page.html revision 4 (states 9 and 10). A Server route: the
 * render reads two queries anonymously, `organizations:getPublicPage` (the sidebar's sports and
 * the counts under the title) and `organizations:listPublicLeagues` with the sport (the page of
 * published leagues asked for), and after hydration the live subscriptions keep the page current.
 *
 * - Found: the content in the app shell, with the organization's sidebar marking the sport, and
 *   the title, Open Graph tags, and canonical from the query results, once both have arrived.
 * - An unknown organization, a segment the shared map (`convex/lib/sports.ts`) does not know, or a
 *   sport the organization has no published league in: #23's not-found view with status 404, top
 *   bar only. An unknown segment asks no query at all, because `listPublicLeagues` validates its
 *   `sport` argument and would throw (503, not 404).
 * - Either query failed or timed out: the server-error view with status 503 and `no-store`, top
 *   bar only, so an error never enters the CDN cache.
 *
 * The page asked for is `?page=N`, read with `parseListPage` from every value of the parameter, so
 * the server and the browser ask for the same page and the server HTML holds only the page number
 * the query result gives (Angular conventions, "Query strings and the CDN"). A page link changes
 * only the leagues query; while it loads the page keeps the previous rows with `aria-busy`.
 *
 * Offline (#82, design/mockups/82-offline-pages.html): both queries are on the adapter's
 * `OFFLINE_SAVED_QUERIES` (each page of each sport is its own saved copy). While the app is
 * offline (`injectOnline()` false) the content shows the saved-copy note under the `h1`, dated by
 * the older saved copy; offline with either missing, the page shows the not-saved view.
 */
@Component({
  selector: 'app-sport-view-page',
  imports: [
    NotFoundView,
    NotSavedView,
    OrganizationSidebar,
    ServerErrorView,
    Shell,
    ShellSidebar,
    SportViewContent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @if (view(); as view) {
        <ng-template appShellSidebar>
          <app-organization-sidebar
            [organization]="view.organization"
            [currentSport]="view.sport.segment"
          />
        </ng-template>
        <app-sport-view-content [view]="view" [busy]="busy()" [savedAt]="savedAt()" />
      } @else if (state() === 'not-found') {
        <app-not-found-view />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="retryHref()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="retryHref()" />
      }
    </app-shell>
  `,
})
export class SportViewPage {
  private readonly route = inject(ActivatedRoute);
  private readonly orgSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  private readonly segment = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('sport') ?? '')),
    { requireSync: true },
  );
  /** The page asked for, from every `page` value in the URL (`parseListPage`). */
  private readonly requestedPage = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseListPage(params.getAll('page')))),
    { requireSync: true },
  );
  /** The sport key of the URL segment, or `undefined` for a segment the shared map does not know. */
  private readonly sportKey = computed(() => sportFromSegment(this.segment()));

  private readonly organization = injectQuery(api.organizations.getPublicPage, () =>
    this.sportKey() ? { slug: this.orgSlug() } : skipToken,
  );
  private readonly leagues = injectQuery(api.organizations.listPublicLeagues, () => {
    const sport = this.sportKey();
    return sport ? { slug: this.orgSlug(), page: this.requestedPage(), sport } : skipToken;
  });
  private readonly online = injectOnline();
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  /** The organization and sport of the route last seen, to tell a change of sport from a page. */
  private routeKey: string | undefined;
  private focusMainWhenShown = false;

  /**
   * The leagues to show: the query's result, or, only while online, the previous page's result of
   * the same sport while the next page loads (args change: `value()` returns to `undefined` until
   * the first result). Offline, a page that has no saved copy shows nothing, so the not-saved view
   * takes its place (design/mockups/82-offline-pages.html state 2): the previous rows would sit
   * under another page's URL, and the load would never end. Another sport's leagues are never
   * kept.
   */
  private readonly shownLeagues = linkedSignal<
    { key: string; value: PublicSportLeagues | undefined; online: boolean },
    { key: string; value: PublicSportLeagues } | undefined
  >({
    source: () => ({
      key: `${this.orgSlug()}/${this.segment()}`,
      value: this.leagues.value(),
      online: this.online(),
    }),
    computation: ({ key, value, online }, previous) => {
      if (value) return { key, value };
      return online && previous?.value?.key === key ? previous.value : undefined;
    },
  });

  /** The page for "Try again" when there is no result to build it from: the page asked for. */
  protected readonly retryHref = computed(() =>
    sportViewCanonicalPath(this.orgSlug(), this.segment(), this.requestedPage()),
  );

  /** The page of leagues shown is the previous one: the asked-for page has not arrived yet. */
  protected readonly busy = computed(
    () => this.shownLeagues() !== undefined && this.leagues.value() === undefined,
  );

  /** Either query failed, including a missing Convex URL; never its message (adapter README). */
  private readonly failed = computed(
    () => this.organization.error() !== undefined || this.leagues.error() !== undefined,
  );

  /** The organization's entry for this sport; none when it has no published league in it. */
  private readonly entry = computed(() =>
    this.organization.value()?.sports.find((sport) => sport.key === this.sportKey()),
  );

  /**
   * The organization, its entry for the sport, and the leagues shown, once found and both
   * arrived. A failure takes the page away, also when it is the next page's subscription that
   * failed.
   */
  protected readonly view = computed((): SportView | undefined => {
    if (this.failed()) return undefined;
    const organization = this.organization.value();
    const sport = this.entry();
    const leagues = this.shownLeagues();
    if (!organization || !sport || !leagues) return undefined;
    return { organization, sport, leagues: leagues.value };
  });

  /**
   * When the older saved copy on screen was saved, only while offline (the note is hidden online)
   * and only while some of the two results is still a saved copy.
   */
  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [this.organization.savedAt(), this.leagues.savedAt()].filter(
      (time) => time !== undefined,
    );
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  protected readonly state = computed(() => {
    if (this.view()) return 'page';
    if (!this.sportKey()) return 'not-found';
    const organization = this.organization.value();
    if (organization === null) return 'not-found';
    // The organization is found but lists no such sport: it has no published league in it.
    if (organization !== undefined && !this.entry()) return 'not-found';
    if (this.failed()) return 'error';
    // Offline with nothing to show (never on the server, where `online` is always true).
    if (!this.online()) return 'not-saved';
    return 'loading';
  });

  constructor() {
    // A link on the organization page, the league page, or another sport view belongs to the page
    // that goes: focus follows the visitor to main, never to body.
    focusMainAfterRouteChange();
    // A link to another sport keeps this component (only the route's parameters change) and the
    // sidebar that held focus is replaced while the other sport loads, so focus follows the
    // visitor to main once its view has arrived. A page link keeps the sport: it moves focus to
    // the Leagues heading instead (SportViewContent).
    effect(() => {
      const key = `${this.orgSlug()}/${this.segment()}`;
      untracked(() => {
        if (this.routeKey !== undefined && key !== this.routeKey) this.focusMainWhenShown = true;
        this.routeKey = key;
      });
    });
    effect(() => {
      if (!this.view()) return;
      untracked(() => {
        if (!this.focusMainWhenShown) return;
        this.focusMainWhenShown = false;
        afterNextRender(() => this.document.getElementById('main')?.focus(), {
          injector: this.injector,
        });
      });
    });
    bindPageMeta(() => {
      const view = this.view();
      if (!view) return null;
      const { organization, sport, leagues } = view;
      return {
        title: `${sport.name} | ${organization.name} | Omni League`,
        ogTitle: sport.name,
        ogDescription: `${sport.name} leagues of ${organization.name} on Omni League.`,
        ogType: 'website',
        // The page the query served, never the request's: a page past the last is page 1.
        path: sportViewCanonicalPath(organization.slug, sport.segment, leagues.page),
      };
    });
  }
}
