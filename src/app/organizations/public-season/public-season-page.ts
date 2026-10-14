import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { api } from '../../../../convex/_generated/api';
import { injectOnline, injectQuery } from '../../core/data/convex';
import { focusMainAfterRouteChange } from '../../core/focus-main';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { PublicLayout } from '../../public-layout/public-layout';
import { seasonDates } from '../league/season-dates';
import { publicSeasonPath } from '../public-league/public-league-path';
import { PublicSeasonContent } from './public-season-content';
import type { PublicSeasonView } from './public-season-view';

/**
 * The query arguments are the route's slugs only and the query string is never read, so the server
 * HTML holds none of it. A failed or timed-out query renders the server-error view (503,
 * `no-store`) so the CDN never stores it.
 */
@Component({
  selector: 'app-public-season-page',
  imports: [NotFoundView, NotSavedView, PublicLayout, PublicSeasonContent, ServerErrorView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (view(); as view) {
        <app-public-season-content [view]="view" [savedAt]="savedAt()" />
      } @else if (state() === 'not-found') {
        <app-not-found-view />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="path()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="path()" />
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

  private readonly organization = injectQuery(api.organizations.getPublicPage, () => ({
    slug: this.orgSlug(),
  }));
  private readonly season = injectQuery(api.seasons.getPublicPage, () => ({
    orgSlug: this.orgSlug(),
    leagueSlug: this.leagueSlug(),
    seasonSlug: this.seasonSlug(),
  }));
  private readonly online = injectOnline();

  /** The page's own path, for "Try again": built from the slugs, never the request URL. */
  protected readonly path = computed(() =>
    publicSeasonPath(this.orgSlug(), this.leagueSlug(), this.seasonSlug()),
  );

  /** Either failed, including a missing Convex URL; never its message (adapter README). */
  private readonly failed = computed(
    () => this.organization.error() !== undefined || this.season.error() !== undefined,
  );

  /** The organization and the season, once found and both arrived. */
  protected readonly view = computed((): PublicSeasonView | undefined => {
    if (this.failed()) return undefined;
    const organization = this.organization.value();
    const season = this.season.value();
    if (!organization || !season) return undefined;
    return { organization, season };
  });

  /** When the older saved copy on screen was saved, only while offline (the note is hidden online). */
  protected readonly savedAt = computed(() => {
    if (this.online()) return undefined;
    const times = [this.organization.savedAt(), this.season.savedAt()].filter(
      (time) => time !== undefined,
    );
    return times.length > 0 ? Math.min(...times) : undefined;
  });

  protected readonly state = computed(() => {
    if (this.view()) return 'page';
    if (this.season.value() === null || this.organization.value() === null) return 'not-found';
    if (this.failed()) return 'error';
    // Offline with nothing to show (never on the server, where `online` is always true).
    if (!this.online()) return 'not-saved';
    return 'loading';
  });

  constructor() {
    // A link on the league page belongs to the page that goes: focus follows the visitor to main,
    // never to body (#127).
    focusMainAfterRouteChange();
    bindPageMeta(() => {
      const view = this.view();
      if (!view) return null;
      const { season } = view;
      const dates = seasonDates(season.startDate, season.endDate);
      return {
        title: `${season.name} | ${season.league.name} | Omni League`,
        ogTitle: season.name,
        ogDescription: `${dates}. ${season.formatName}, teams need at least ${season.minimumRosterSize} players.`,
        ogType: 'website',
        // The page the query served, built from its slugs, never the request's.
        path: publicSeasonPath(season.organization.slug, season.league.slug, season.slug),
      };
    });
  }
}
