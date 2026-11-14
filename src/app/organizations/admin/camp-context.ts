import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';

export type ManagedCamp = NonNullable<FunctionReturnType<typeof api.camps.getForManagement>>;

export type CampSessionRow = FunctionReturnType<typeof api.campSessions.listForCamp>[number];

export type SessionsView =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; sessions: readonly CampSessionRow[] };

export type CampState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/**
 * The query waits until Convex has accepted the token, so its first answer is the caller's own.
 * The sessions are asked only once the camp has answered, so a refused caller never reaches them.
 */
@Injectable()
export class CampContext {
  private readonly auth = inject(AuthService);

  private readonly params = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => ({
        orgSlug: params.get('orgSlug') ?? '',
        campSlug: params.get('campSlug') ?? '',
      })),
    ),
    { requireSync: true },
  );

  readonly orgSlug = computed(() => this.params().orgSlug);
  readonly campSlug = computed(() => this.params().campSlug);

  private readonly result = injectQuery(api.camps.getForManagement, () =>
    this.auth.convexAuthenticated() ? this.params() : skipToken,
  );

  readonly state = computed<CampState>(() => {
    const error = this.result.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.result.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  readonly camp = computed<ManagedCamp | null>(() =>
    this.state() === 'ready' ? (this.result.value() ?? null) : null,
  );

  private readonly sessionsQuery = injectQuery(api.campSessions.listForCamp, () => {
    const camp = this.camp();
    return camp ? { campId: camp.campId } : skipToken;
  });

  readonly sessions = computed<SessionsView>(() => {
    if (this.sessionsQuery.error()) return { status: 'error' };
    const sessions = this.sessionsQuery.value();
    return sessions === undefined ? { status: 'loading' } : { status: 'ready', sessions };
  });
}
