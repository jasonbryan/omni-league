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

export type TournamentWaitlist = NonNullable<
  FunctionReturnType<typeof api.waitlist.listForTournament>
>;

export type BracketSetup = NonNullable<FunctionReturnType<typeof api.tournamentGames.getSetup>>;

export type BracketView =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; setup: BracketSetup };

export type TournamentState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/**
 * The query waits until Convex has accepted the token, so its first answer is the caller's own. The waitlist is asked only once the
 * tournament has answered, so a refused caller or an unknown web address never reaches it, and the page stays on its skeleton until both answer.
 * The seeds and bracket are asked at the same time, but the page does not wait for them: their panel shows its own skeleton.
 */
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

  private readonly frameState = computed<TournamentState>(() => {
    const error = this.result.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.result.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  private readonly waitlistQuery = injectQuery(api.waitlist.listForTournament, () =>
    this.frameState() === 'ready' ? this.params() : skipToken,
  );

  private readonly bracketQuery = injectQuery(api.tournamentGames.getSetup, () =>
    this.frameState() === 'ready' ? this.params() : skipToken,
  );

  readonly state = computed<TournamentState>(() => {
    const frame = this.frameState();
    if (frame !== 'ready') return frame;
    const waiting =
      this.waitlistQuery.value() === undefined && this.waitlistQuery.error() === undefined;
    return waiting ? 'loading' : 'ready';
  });

  readonly tournament = computed<ManagedTournament | null>(() =>
    this.state() === 'ready' ? (this.result.value() ?? null) : null,
  );

  /** `null` when the list failed: the rest of the page still shows. */
  readonly waitlist = computed<TournamentWaitlist | null>(() =>
    this.state() === 'ready' ? (this.waitlistQuery.value() ?? null) : null,
  );

  readonly bracket = computed<BracketView>(() => {
    if (this.state() !== 'ready') return { status: 'loading' };
    const setup = this.bracketQuery.value();
    if (this.bracketQuery.error() || setup === null) return { status: 'error' };
    return setup === undefined ? { status: 'loading' } : { status: 'ready', setup };
  });
}
