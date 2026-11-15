import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { campAgesLabel } from '../../../../convex/lib/campInput';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectOnline, injectQuery, skipToken } from '../../core/data/convex';
import { injectNow } from '../../core/now';
import { bindPageMeta } from '../../core/page-meta';
import { NotFoundView } from '../../not-found/not-found-view';
import { NotSavedView } from '../../offline/not-saved-view';
import { PageLoadStatus } from '../../public-layout/page-load-status';
import { injectPageLoadWait } from '../../public-layout/page-load-wait';
import { PublicLayout } from '../../public-layout/public-layout';
import { ServerErrorView } from '../../server-error/server-error-view';
import { seasonDates } from '../league/season-dates';
import { PublicCampContent } from './public-camp-content';
import { readPublicCampNames } from './public-camp-names';
import { publicCampPath } from './public-camp-path';
import { PublicCampSkeleton } from './public-camp-skeleton';
import type { PublicCampData } from './public-camp-view';

function description(camp: PublicCampData): string {
  const ages = campAgesLabel(camp.minimumAge, camp.maximumAge);
  const count = camp.sessions.length;
  const sessions = `${count} ${count === 1 ? 'session' : 'sessions'}`;
  const first = camp.sessions[0];
  if (!first) return `${camp.sportName} · ${ages}.`;
  const lastEnd = camp.sessions.reduce((end, { endDate }) => (endDate > end ? endDate : end), '');
  return `${camp.sportName} · ${ages}. ${sessions}, ${seasonDates(first.startDate, lastEnd)}.`;
}

@Component({
  selector: 'app-public-camp-page',
  imports: [
    NotFoundView,
    NotSavedView,
    PageLoadStatus,
    PublicCampContent,
    PublicCampSkeleton,
    PublicLayout,
    ServerErrorView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (camp(); as camp) {
        <app-public-camp-content
          [camp]="camp"
          [savedAt]="savedAt()"
          [now]="now()"
          [registeredSessionIds]="registeredSessionIds()"
        />
      } @else if (state() === 'not-found') {
        <app-not-found-view [publicSite]="true" />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="retryHref()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="retryHref()" />
      } @else {
        <app-public-camp-skeleton [names]="names()" />
      }
      <app-page-load-status [stalled]="stalled()" />
    </app-public-layout>
  `,
})
export class PublicCampPage {
  private readonly route = inject(ActivatedRoute);
  private readonly orgSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  private readonly campSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('campSlug') ?? '')),
    { requireSync: true },
  );
  private readonly arrivedState = inject(Router).currentNavigation()?.extras.state;

  protected readonly names = computed(() =>
    readPublicCampNames(this.arrivedState, {
      orgSlug: this.orgSlug(),
      campSlug: this.campSlug(),
    }),
  );

  private readonly result = injectQuery(api.camps.getPublicPage, () => ({
    orgSlug: this.orgSlug(),
    campSlug: this.campSlug(),
  }));
  private readonly auth = inject(AuthService);
  private readonly registrations = injectQuery(api.campRegistrations.listMineForCamp, () =>
    this.auth.signedIn() && this.auth.convexAuthenticated()
      ? { orgSlug: this.orgSlug(), campSlug: this.campSlug() }
      : skipToken,
  );
  protected readonly registeredSessionIds = computed(() => this.registrations.value() ?? []);
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  protected readonly retryHref = computed(() => publicCampPath(this.orgSlug(), this.campSlug()));

  protected readonly camp = computed(() =>
    this.result.error() === undefined ? (this.result.value() ?? undefined) : undefined,
  );

  protected readonly savedAt = computed(() => (this.online() ? undefined : this.result.savedAt()));

  private readonly phase = computed(() => {
    if (this.camp()) return 'page';
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
      const camp = this.camp();
      if (!camp) return null;
      const title = `${camp.name} | ${camp.organization.name} | Omni League`;
      return {
        title,
        ogTitle: title,
        ogDescription: description(camp),
        ogType: 'website',
        path: publicCampPath(camp.organization.slug, camp.slug),
      };
    });
  }
}
