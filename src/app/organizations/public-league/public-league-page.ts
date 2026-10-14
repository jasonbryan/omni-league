import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { api } from '../../../../convex/_generated/api';
import { injectOnline, injectQuery } from '../../core/data/convex';
import { focusMainAfterRouteChange } from '../../core/focus-main';
import { parseListPage } from '../../core/list-page';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell, ShellSidebar } from '../../shell';
import { PublicLeagueContent } from './public-league-content';
import {
  publicLeagueCanonicalPath,
  type PublicLeagueSeasons,
  type PublicLeagueView,
} from './public-league-path';
import { PublicLeagueSidebar } from './public-league-sidebar';

/**
 * The page asked for is `?page=N`, read with `parseListPage` from every value of the parameter, so the server and the browser ask for the same page
 * and the server HTML holds only the page number the query result gives.
 * Any of the three failed or timed out: the server-error view with status 503 and `no-store`, so an error never enters the CDN cache.
 */
@Component({
  selector: 'app-public-league-page',
  imports: [
    NotFoundView,
    NotSavedView,
    PublicLeagueContent,
    PublicLeagueSidebar,
    ServerErrorView,
    Shell,
    ShellSidebar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @if (view(); as view) {
        <ng-template appShellSidebar>
          <app-public-league-sidebar
            [organization]="view.organization"
            [sportName]="view.league.sportName"
          />
        </ng-template>
        <app-public-league-content [view]="view" [busy]="busy()" [savedAt]="savedAt()" />
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
export class PublicLeaguePage {
  private readonly route = inject(ActivatedRoute);
  private readonly orgSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  private readonly leagueSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('leagueSlug') ?? '')),
    { requireSync: true },
  );
  private readonly requestedPage = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseListPage(params.getAll('page')))),
    { requireSync: true },
  );

  private readonly organization = injectQuery(api.organizations.getPublicPage, () => ({
    slug: this.orgSlug(),
  }));
  private readonly league = injectQuery(api.leagues.getPublicPage, () => ({
    orgSlug: this.orgSlug(),
    leagueSlug: this.leagueSlug(),
  }));
  private readonly seasons = injectQuery(api.seasons.listPublic, () => ({
    orgSlug: this.orgSlug(),
    leagueSlug: this.leagueSlug(),
    page: this.requestedPage(),
  }));
  private readonly online = injectOnline();

  /**
   * Offline, a page that has no saved copy shows nothing, so the not-saved view takes its place: the previous rows would sit under another page's URL,
   * and the load would never end. Another league's seasons are never kept.
   */
  private readonly shownSeasons = linkedSignal<
    { key: string; value: PublicLeagueSeasons | undefined; online: boolean },
    { key: string; value: PublicLeagueSeasons } | undefined
  >({
    source: () => ({
      key: `${this.orgSlug()}/${this.leagueSlug()}`,
      value: this.seasons.value(),
      online: this.online(),
    }),
    computation: ({ key, value, online }, previous) => {
      if (value) return { key, value };
      return online && previous?.value?.key === key ? previous.value : undefined;
    },
  });

  protected readonly retryHref = computed(() =>
    publicLeagueCanonicalPath(this.orgSlug(), this.leagueSlug(), this.requestedPage()),
  );

  protected readonly busy = computed(
    () => this.shownSeasons() !== undefined && this.seasons.value() === undefined,
  );

  private readonly failed = computed(
    () =>
      this.organization.error() !== undefined ||
      this.league.error() !== undefined ||
      this.seasons.error() !== undefined,
  );

  protected readonly view = computed((): PublicLeagueView | undefined => {
    if (this.failed()) return undefined;
    const organization = this.organization.value();
    const league = this.league.value();
    const seasons = this.shownSeasons();
    if (!organization || !league || !seasons) return undefined;
    return { organization, league, seasons: seasons.value };
  });

  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [
      this.organization.savedAt(),
      this.league.savedAt(),
      this.seasons.savedAt(),
    ].filter((time) => time !== undefined);
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  protected readonly state = computed(() => {
    if (this.view()) return 'page';
    if (this.league.value() === null || this.organization.value() === null) return 'not-found';
    if (this.failed()) return 'error';
    // Offline with nothing to show (never on the server, where `online` is always true).
    if (!this.online()) return 'not-saved';
    return 'loading';
  });

  constructor() {
    // A link on the organization page or a sport view belongs to the page that goes: focus follows the visitor to main, never to body.
    focusMainAfterRouteChange();
    bindPageMeta(() => {
      const view = this.view();
      if (!view) return null;
      const { league, seasons } = view;
      const { organization } = league;
      return {
        title: `${league.name} | ${organization.name} | Omni League`,
        ogTitle: league.name,
        ogDescription: `Seasons of ${league.name} from ${organization.name} on Omni League.`,
        ogType: 'website',
        // The page the query served, never the request's: a page past the last is page 1.
        path: publicLeagueCanonicalPath(organization.slug, league.slug, seasons.page),
      };
    });
  }
}
