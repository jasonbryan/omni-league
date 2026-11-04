import { Injectable, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import type { OrganizerLeague } from '../league/league-context';

export type OrganizerSeason = NonNullable<FunctionReturnType<typeof api.seasons.getOrganizerView>>;

export type SeasonFreeAgents = NonNullable<
  FunctionReturnType<typeof api.freeAgents.listForOrganizer>
>;

export type SeasonWaitlist = NonNullable<FunctionReturnType<typeof api.waitlist.listForOrganizer>>;

export type SeasonState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/**
 * The league and the season are asked once Convex has accepted the token, so their first answers are the caller's own.
 * The free agents and the waitlist are asked only once both say the caller organizes the season, so a refused caller or an unknown slug
 * requests neither.
 */
@Injectable()
export class SeasonContext {
  private readonly auth = inject(AuthService);

  private readonly params = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => ({
        orgSlug: params.get('orgSlug') ?? '',
        leagueSlug: params.get('leagueSlug') ?? '',
        seasonSlug: params.get('seasonSlug') ?? '',
      })),
    ),
    { requireSync: true },
  );

  readonly orgSlug = computed(() => this.params().orgSlug);
  readonly leagueSlug = computed(() => this.params().leagueSlug);
  readonly seasonSlug = computed(() => this.params().seasonSlug);

  private readonly leagueQuery = injectQuery(api.leagues.getOrganizerContext, () =>
    this.auth.convexAuthenticated()
      ? { orgSlug: this.orgSlug(), leagueSlug: this.leagueSlug() }
      : skipToken,
  );

  private readonly seasonQuery = injectQuery(api.seasons.getOrganizerView, () =>
    this.auth.convexAuthenticated() ? this.params() : skipToken,
  );

  private readonly frameState = computed<SeasonState>(() => {
    const errors = [this.leagueQuery.error(), this.seasonQuery.error()];
    if (errors.some(isForbidden)) return 'forbidden';
    if (errors.some((error) => error !== undefined)) return 'error';
    const values = [this.leagueQuery.value(), this.seasonQuery.value()];
    if (values.includes(null)) return 'not-found';
    return values.includes(undefined) ? 'loading' : 'ready';
  });

  private readonly freeAgentsQuery = injectQuery(api.freeAgents.listForOrganizer, () =>
    this.frameState() === 'ready' ? this.params() : skipToken,
  );

  private readonly waitlistQuery = injectQuery(api.waitlist.listForOrganizer, () =>
    this.frameState() === 'ready' ? this.params() : skipToken,
  );

  readonly state = computed<SeasonState>(() => {
    const frame = this.frameState();
    if (frame !== 'ready') return frame;
    const waiting = [this.freeAgentsQuery, this.waitlistQuery].some(
      (query) => query.value() === undefined && query.error() === undefined,
    );
    return waiting ? 'loading' : 'ready';
  });

  readonly league = computed<OrganizerLeague | null>(() =>
    this.state() === 'ready' ? (this.leagueQuery.value() ?? null) : null,
  );

  readonly season = computed<OrganizerSeason | null>(() =>
    this.state() === 'ready' ? (this.seasonQuery.value() ?? null) : null,
  );

  /** `null` when the list failed: the rest of the page still shows. */
  readonly freeAgents = computed<SeasonFreeAgents | null>(() =>
    this.state() === 'ready' ? (this.freeAgentsQuery.value() ?? null) : null,
  );

  /** `null` when the list failed: the rest of the page still shows. */
  readonly waitlist = computed<SeasonWaitlist | null>(() =>
    this.state() === 'ready' ? (this.waitlistQuery.value() ?? null) : null,
  );

  constructor() {
    // The no-access and not-found views set their own title.
    const title = inject(Title);
    effect(() => {
      const league = this.league();
      const season = this.season();
      if (league && season) title.setTitle(`${season.name} | ${league.name} | Omni League`);
    });
  }
}
