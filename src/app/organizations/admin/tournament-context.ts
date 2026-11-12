import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';

export type ManagedTournament = NonNullable<
  FunctionReturnType<typeof api.tournaments.getForManagement>
>;

export type TournamentState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/** The query waits until Convex has accepted the token, so its first answer is the caller's own. */
@Injectable()
export class TournamentContext {
  private readonly auth = inject(AuthService);

  private readonly params = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => ({
        orgSlug: params.get('orgSlug') ?? '',
        tournamentSlug: params.get('tournamentSlug') ?? '',
      })),
    ),
    { requireSync: true },
  );

  readonly orgSlug = computed(() => this.params().orgSlug);
  readonly tournamentSlug = computed(() => this.params().tournamentSlug);

  private readonly result = injectQuery(api.tournaments.getForManagement, () =>
    this.auth.convexAuthenticated() ? this.params() : skipToken,
  );

  readonly state = computed<TournamentState>(() => {
    const error = this.result.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.result.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  readonly tournament = computed<ManagedTournament | null>(() =>
    this.state() === 'ready' ? (this.result.value() ?? null) : null,
  );
}
