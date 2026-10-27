import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { api } from '../../../../convex/_generated/api';
import { injectOnline, injectQuery } from '../../core/data/convex';
import { injectNow } from '../../core/now';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { PublicLayout } from '../../public-layout/public-layout';
import { seasonDates } from '../league/season-dates';
import { publicSeasonPath } from '../public-league/public-league-path';
import { PublicSeasonContent } from './public-season-content';
import { PublicSeasonSkeleton } from './public-season-skeleton';
import type { PublicSeasonView } from './public-season-view';

/** The query arguments are the route's slugs only; the query string is never read, so the server HTML holds none of it. */
@Component({
  selector: 'app-public-season-page',
  imports: [
    NotFoundView,
    NotSavedView,
    PublicLayout,
    PublicSeasonContent,
    PublicSeasonSkeleton,
    ServerErrorView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (view(); as view) {
        <app-public-season-content [view]="view" [savedAt]="savedAt()" [now]="now()" />
      } @else if (state() === 'not-found') {
        <app-not-found-view />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="path()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="path()" />
      } @else {
        <app-public-season-skeleton />
      }
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

  private readonly season = injectQuery(api.seasons.getPublicPage, () => ({
    orgSlug: this.orgSlug(),
    leagueSlug: this.leagueSlug(),
    seasonSlug: this.seasonSlug(),
  }));
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  protected readonly path = computed(() =>
    publicSeasonPath(this.orgSlug(), this.leagueSlug(), this.seasonSlug()),
  );

  private readonly failed = computed(() => this.season.error() !== undefined);

  protected readonly view = computed((): PublicSeasonView | undefined => {
    if (this.failed()) return undefined;
    const season = this.season.value();
    return season ? { season } : undefined;
  });

  protected readonly savedAt = computed(() => (this.online() ? undefined : this.season.savedAt()));

  protected readonly state = computed(() => {
    if (this.view()) return 'page';
    if (this.season.value() === null) return 'not-found';
    if (this.failed()) return 'error';
    const offlineWithoutSavedCopy = !this.online();
    if (offlineWithoutSavedCopy) return 'not-saved';
    return 'loading';
  });

  constructor() {
    bindPageMeta(() => {
      const view = this.view();
      if (!view) return null;
      const { season } = view;
      const dates = seasonDates(season.startDate, season.endDate);
      const heading = `${season.league.name} · ${season.name}`;
      return {
        title: `${heading} | ${season.organization.name} | Omni League`,
        ogTitle: `${heading} | ${season.organization.name} | Omni League`,
        ogDescription: `${dates}. ${season.formatName}, teams need at least ${season.minimumRosterSize} players.`,
        ogType: 'website',
        // The page the query served, built from its slugs, never the request's.
        path: publicSeasonPath(season.organization.slug, season.league.slug, season.slug),
      };
    });
  }
}
