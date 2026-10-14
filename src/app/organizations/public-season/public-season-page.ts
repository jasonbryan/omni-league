import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { api } from '../../../../convex/_generated/api';
import { injectOnline, injectQuery } from '../../core/data/convex';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell, ShellSidebar } from '../../shell';
import { seasonDates } from '../league/season-dates';
import { publicSeasonPath } from '../public-league/public-league-path';
import { PublicLeagueSidebar } from '../public-league/public-league-sidebar';
import { PublicSeasonContent } from './public-season-content';
import type { PublicSeasonView } from './public-season-view';

/** The query arguments are the route's slugs only; the query string is never read, so the server HTML holds none of it. */
@Component({
  selector: 'app-public-season-page',
  imports: [
    NotFoundView,
    NotSavedView,
    PublicLeagueSidebar,
    PublicSeasonContent,
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
            [sportName]="view.season.league.sportName"
          />
        </ng-template>
        <app-public-season-content [view]="view" [savedAt]="savedAt()" />
      } @else if (state() === 'not-found') {
        <app-not-found-view />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="path()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="path()" />
      }
    </app-shell>
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

  protected readonly path = computed(() =>
    publicSeasonPath(this.orgSlug(), this.leagueSlug(), this.seasonSlug()),
  );

  private readonly failed = computed(
    () => this.organization.error() !== undefined || this.season.error() !== undefined,
  );

  protected readonly view = computed((): PublicSeasonView | undefined => {
    if (this.failed()) return undefined;
    const organization = this.organization.value();
    const season = this.season.value();
    if (!organization || !season) return undefined;
    return { organization, season };
  });

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
    if (!this.online()) return 'not-saved';
    return 'loading';
  });

  constructor() {
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
