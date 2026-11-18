import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { trainingAgesLabel } from '../../../../convex/lib/trainingInput';
import { trainingPatternText } from '../../../../convex/lib/trainingPattern';
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
import { PublicTrainingContent } from './public-training-content';
import { readPublicTrainingNames } from './public-training-names';
import { publicTrainingPath } from './public-training-path';
import { PublicTrainingSkeleton } from './public-training-skeleton';
import type { PublicTrainingData } from './public-training-view';

function description(training: PublicTrainingData): string {
  const ages =
    training.minimumAge === undefined && training.maximumAge === undefined
      ? ''
      : ` · ${trainingAgesLabel(training.minimumAge, training.maximumAge)}`;
  return `${training.sportName}${ages}. Coach ${training.coachName}. ${trainingPatternText(training.pattern)}.`;
}

@Component({
  selector: 'app-public-training-page',
  imports: [
    NotFoundView,
    NotSavedView,
    PageLoadStatus,
    PublicLayout,
    PublicTrainingContent,
    PublicTrainingSkeleton,
    ServerErrorView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (training(); as training) {
        <app-public-training-content
          [training]="training"
          [savedAt]="savedAt()"
          [now]="now()"
          [registeredSelf]="registeredSelf()"
          [registeredMinors]="registeredMinors()"
          [registeredClasses]="registeredClasses()"
          [waitlist]="waitlist()"
        />
      } @else if (state() === 'not-found') {
        <app-not-found-view [publicSite]="true" />
      } @else if (state() === 'error') {
        <app-server-error-view [retryHref]="retryHref()" />
      } @else if (state() === 'not-saved') {
        <app-not-saved-view [retryHref]="retryHref()" />
      } @else {
        <app-public-training-skeleton [names]="names()" />
      }
      <app-page-load-status [stalled]="stalled()" />
    </app-public-layout>
  `,
})
export class PublicTrainingPage {
  private readonly route = inject(ActivatedRoute);
  private readonly orgSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('orgSlug') ?? '')),
    { requireSync: true },
  );
  private readonly trainingSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('trainingSlug') ?? '')),
    { requireSync: true },
  );
  private readonly arrivedState = inject(Router).currentNavigation()?.extras.state;

  protected readonly names = computed(() =>
    readPublicTrainingNames(this.arrivedState, {
      orgSlug: this.orgSlug(),
      trainingSlug: this.trainingSlug(),
    }),
  );

  private readonly result = injectQuery(api.trainings.getPublicPage, () => ({
    orgSlug: this.orgSlug(),
    trainingSlug: this.trainingSlug(),
  }));
  private readonly auth = inject(AuthService);
  private readonly mine = injectQuery(api.trainingRegistrations.listMineForTraining, () =>
    this.auth.signedIn() && this.auth.convexAuthenticated()
      ? { orgSlug: this.orgSlug(), trainingSlug: this.trainingSlug() }
      : skipToken,
  );
  private readonly waiting = injectQuery(api.trainingWaitlist.listMineForTraining, () =>
    this.auth.signedIn() && this.auth.convexAuthenticated()
      ? { orgSlug: this.orgSlug(), trainingSlug: this.trainingSlug() }
      : skipToken,
  );
  /** The two answers apply together, so the series row changes once and not for each answer. */
  private readonly viewerReady = computed(() => {
    if (!this.auth.signedIn() || !this.auth.convexAuthenticated()) return true;
    return [this.mine, this.waiting].every(
      (query) => query.value() !== undefined || query.error() !== undefined,
    );
  });
  protected readonly registeredSelf = computed(() =>
    this.viewerReady() ? (this.mine.value()?.self ?? false) : false,
  );
  protected readonly registeredMinors = computed(() =>
    this.viewerReady() ? (this.mine.value()?.minorNames ?? []) : [],
  );
  protected readonly registeredClasses = computed(() =>
    this.viewerReady() ? (this.mine.value()?.classes ?? []) : [],
  );
  protected readonly waitlist = computed(() =>
    this.viewerReady() ? (this.waiting.value() ?? []) : [],
  );
  private readonly online = injectOnline();
  protected readonly now = injectNow();

  protected readonly retryHref = computed(() =>
    publicTrainingPath(this.orgSlug(), this.trainingSlug()),
  );

  protected readonly training = computed(() =>
    this.result.error() === undefined ? (this.result.value() ?? undefined) : undefined,
  );

  protected readonly savedAt = computed(() => (this.online() ? undefined : this.result.savedAt()));

  private readonly phase = computed(() => {
    if (this.training()) return 'page';
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
      const training = this.training();
      if (!training) return null;
      const title = `${training.name} | ${training.organization.name} | Omni League`;
      return {
        title,
        ogTitle: title,
        ogDescription: description(training),
        ogType: 'website',
        path: publicTrainingPath(training.organization.slug, training.slug),
      };
    });
  }
}
