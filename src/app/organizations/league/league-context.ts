import { Injectable, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { api } from '../../../../convex/_generated/api';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { AuthService } from '../../core/auth/auth.service';
import { injectQuery, skipToken } from '../../core/data/convex';

export type OrganizerLeague = NonNullable<
  FunctionReturnType<typeof api.leagues.getOrganizerContext>
>;

export type LeagueState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/**
 * The query waits until Convex has accepted the token, so its first answer is the caller's own, and nothing else on the page is requested before it says `ready`
 * (the seasons list is asked only with the `leagueId` this answer gives).
 */
@Injectable()
export class LeagueContext {
  private readonly auth = inject(AuthService);

  private readonly params = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => ({
        orgSlug: params.get('orgSlug') ?? '',
        leagueSlug: params.get('leagueSlug') ?? '',
      })),
    ),
    { requireSync: true },
  );

  readonly orgSlug = computed(() => this.params().orgSlug);
  readonly leagueSlug = computed(() => this.params().leagueSlug);

  private readonly context = injectQuery(api.leagues.getOrganizerContext, () =>
    this.auth.convexAuthenticated() ? this.params() : skipToken,
  );

  readonly state = computed<LeagueState>(() => {
    const error = this.context.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.context.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  readonly league = computed<OrganizerLeague | null>(() =>
    this.state() === 'ready' ? (this.context.value() ?? null) : null,
  );

  constructor() {
    // The no-access and not-found views set their own title.
    const title = inject(Title);
    effect(() => {
      const league = this.league();
      if (league) title.setTitle(`${league.name} | ${league.organization.name} | Omni League`);
    });
  }
}
