import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { api, injectOnline, injectQuery } from '../../core/data/convex';
import { parseListPage } from '../../core/list-page';
import { injectNow } from '../../core/now';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { PageLoadStatus } from '../../public-layout/page-load-status';
import { injectPageLoadWait } from '../../public-layout/page-load-wait';
import { PublicLayout } from '../../public-layout/public-layout';
import { seasonDates } from '../league/season-dates';
import { publicSeasonCanonicalPath } from '../public-league/public-league-path';
import { PublicSeasonContent } from './public-season-content';
import { PublicSeasonSkeleton } from './public-season-skeleton';
import type { PublicSeasonTeams, PublicSeasonView } from './public-season-view';

/**
 * The query arguments are the route's slugs and the teams page asked for, `?page=N`, read with `parseListPage` from every value of the parameter,
 * so the server and the browser ask for the same page and the server HTML holds only the page number the query result gives.
 */
@Component({
  selector: 'app-public-season-page',
  imports: [
    NotFoundView,
    NotSavedView,
    PageLoadStatus,
    PublicLayout,
    PublicSeasonContent,
    PublicSeasonSkeleton,
    ServerErrorView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (view(); as view) {
        <app-public-season-content
          [view]="view"
          [savedAt]="savedAt()"
          [now]="now()"
          [busy]="busy()"
        />
      } @else if (state() === 'not-found') {
        <app-not-found-view [publicSite]="true" />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="retryHref()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="retryHref()" />
      } @else {
        <app-public-season-skeleton />
      }
      <app-page-load-status [stalled]="stalled()" />
    </app-public-layout>
  `,
})
export class PublicSeasonPage {
  private readonly route = inject(ActivatedRoute);
  private readonly orgSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  private readonly leagueSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('leagueSlug') ?? '')),
    { requireSync: true },
  );
  private readonly seasonSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('seasonSlug') ?? '')),
    { requireSync: true },
  );
  private readonly requestedPage = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseListPage(params.getAll('page')))),
    { requireSync: true },
  );

  private readonly season = injectQuery(api.seasons.getPublicPage, () => ({
    orgSlug: this.orgSlug(),
    leagueSlug: this.leagueSlug(),
    seasonSlug: this.seasonSlug(),
  }));
  private readonly teams = injectQuery(api.teams.listPublic, () => ({
    orgSlug: this.orgSlug(),
    leagueSlug: this.leagueSlug(),
    seasonSlug: this.seasonSlug(),
    page: this.requestedPage(),
  }));
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  /**
   * While another page of teams loads, the previous one stays, so the panel keeps its height. Offline it does not: the rows would sit under
   * another page's URL. Another season's teams are never kept.
   */
  private readonly shownTeams = linkedSignal<
    { key: string; value: PublicSeasonTeams | undefined; online: boolean },
    { key: string; value: PublicSeasonTeams } | undefined
  >({
    source: () => ({
      key: `${this.orgSlug()}/${this.leagueSlug()}/${this.seasonSlug()}`,
      value: this.teams.value(),
      online: this.online(),
    }),
    computation: ({ key, value, online }, previous) => {
      if (value) return { key, value };
      return online && previous?.value?.key === key ? previous.value : undefined;
    },
  });

  protected readonly retryHref = computed(() =>
    publicSeasonCanonicalPath(
      this.orgSlug(),
      this.leagueSlug(),
      this.seasonSlug(),
      this.requestedPage(),
    ),
  );

  protected readonly busy = computed(
    () => this.shownTeams() !== undefined && this.teams.value() === undefined,
  );

  private readonly failed = computed(
    () => this.season.error() !== undefined || this.teams.error() !== undefined,
  );

  protected readonly view = computed((): PublicSeasonView | undefined => {
    if (this.failed()) return undefined;
    const season = this.season.value();
    const teams = this.shownTeams();
    if (!season || !teams) return undefined;
    return { season, teams: teams.value };
  });

  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [this.season.savedAt(), this.teams.savedAt()].filter(
      (time) => time !== undefined,
    );
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  private readonly phase = computed(() => {
    if (this.view()) return 'page';
    if (this.season.value() === null) return 'not-found';
    if (this.failed()) return 'error';
    const offlineWithoutSavedCopy = !this.online();
    if (offlineWithoutSavedCopy) return 'not-saved';
    return 'loading';
  });

  private readonly waitedOut = injectPageLoadWait(
    () => this.phase() === 'loading',
    () => this.retryHref(),
  );
  protected readonly stalled = computed(() => this.phase() === 'loading' && this.waitedOut());

  protected readonly state = computed(() => (this.stalled() ? 'error' : this.phase()));

  constructor() {
    bindPageMeta(() => {
      const view = this.view();
      if (!view) return null;
      const { season, teams } = view;
      const dates = seasonDates(season.startDate, season.endDate);
      const heading = `${season.league.name} · ${season.name}`;
      return {
        title: `${heading} | ${season.organization.name} | Omni League`,
        ogTitle: `${heading} | ${season.organization.name} | Omni League`,
        ogDescription: `${dates}. ${season.formatName}, teams need at least ${season.minimumRosterSize} players.`,
        ogType: 'website',
        // The page the queries served, built from their slugs and page number, never the request's: a page past the last is page 1.
        path: publicSeasonCanonicalPath(
          season.organization.slug,
          season.league.slug,
          season.slug,
          teams.page,
        ),
      };
    });
  }
}
