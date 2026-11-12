import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { api, injectOnline, injectQuery } from '../../core/data/convex';
import { injectNow } from '../../core/now';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { PageLoadStatus } from '../../public-layout/page-load-status';
import { injectPageLoadWait } from '../../public-layout/page-load-wait';
import { PublicLayout } from '../../public-layout/public-layout';
import { ServerErrorView } from '../../server-error/server-error-view';
import { seasonDates } from '../league/season-dates';
import { PublicTournamentContent } from './public-tournament-content';
import { readPublicTournamentNames } from './public-tournament-names';
import { publicTournamentPath } from './public-tournament-path';
import { PublicTournamentSkeleton } from './public-tournament-skeleton';

@Component({
  selector: 'app-public-tournament-page',
  imports: [
    NotFoundView,
    NotSavedView,
    PageLoadStatus,
    PublicLayout,
    PublicTournamentContent,
    PublicTournamentSkeleton,
    ServerErrorView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (tournament(); as tournament) {
        <app-public-tournament-content
          [tournament]="tournament"
          [savedAt]="savedAt()"
          [now]="now()"
        />
      } @else if (state() === 'not-found') {
        <app-not-found-view [publicSite]="true" />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="retryHref()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="retryHref()" />
      } @else {
        <app-public-tournament-skeleton [names]="names()" />
      }
      <app-page-load-status [stalled]="stalled()" />
    </app-public-layout>
  `,
})
export class PublicTournamentPage {
  private readonly route = inject(ActivatedRoute);
  private readonly orgSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  private readonly tournamentSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('tournamentSlug') ?? '')),
    { requireSync: true },
  );
  private readonly arrivedState = inject(Router).currentNavigation()?.extras.state;

  protected readonly names = computed(() =>
    readPublicTournamentNames(this.arrivedState, {
      orgSlug: this.orgSlug(),
      tournamentSlug: this.tournamentSlug(),
    }),
  );

  private readonly result = injectQuery(api.tournaments.getPublicPage, () => ({
    orgSlug: this.orgSlug(),
    tournamentSlug: this.tournamentSlug(),
  }));
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  protected readonly retryHref = computed(() =>
    publicTournamentPath(this.orgSlug(), this.tournamentSlug()),
  );

  protected readonly tournament = computed(() =>
    this.result.error() === undefined ? (this.result.value() ?? undefined) : undefined,
  );

  protected readonly savedAt = computed(() => (this.online() ? undefined : this.result.savedAt()));

  private readonly phase = computed(() => {
    if (this.tournament()) return 'page';
    if (this.result.value() === null) return 'not-found';
    if (this.result.error() !== undefined) return 'error';
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
      const tournament = this.tournament();
      if (!tournament) return null;
      const title = `${tournament.name} | ${tournament.organization.name} | Omni League`;
      return {
        title,
        ogTitle: title,
        ogDescription: `${seasonDates(tournament.startDate, tournament.endDate)}. ${tournament.sportName} · ${tournament.divisionLabel}. Up to ${tournament.maximumTeams} teams.`,
        ogType: 'website',
        path: publicTournamentPath(tournament.organization.slug, tournament.slug),
      };
    });
  }
}
