import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';

export type ManagedTraining = NonNullable<
  FunctionReturnType<typeof api.trainings.getForManagement>
>;

export type TrainingClassRow = FunctionReturnType<
  typeof api.trainingClasses.listForTraining
>[number];

export type ClassesView =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; classes: readonly TrainingClassRow[] };

export type TrainingState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/**
 * The query waits until Convex has accepted the token, so its first answer is the caller's own.
 * The classes are asked only once the training program has answered, so a refused caller never reaches them.
 */
@Injectable()
export class TrainingContext {
  private readonly auth = inject(AuthService);

  private readonly params = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => ({
        orgSlug: params.get('orgSlug') ?? '',
        trainingSlug: params.get('trainingSlug') ?? '',
      })),
    ),
    { requireSync: true },
  );

  readonly orgSlug = computed(() => this.params().orgSlug);
  readonly trainingSlug = computed(() => this.params().trainingSlug);

  private readonly result = injectQuery(api.trainings.getForManagement, () =>
    this.auth.convexAuthenticated() ? this.params() : skipToken,
  );

  readonly state = computed<TrainingState>(() => {
    const error = this.result.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.result.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  readonly training = computed<ManagedTraining | null>(() =>
    this.state() === 'ready' ? (this.result.value() ?? null) : null,
  );

  private readonly classesQuery = injectQuery(api.trainingClasses.listForTraining, () => {
    const training = this.training();
    return training ? { trainingId: training.trainingId } : skipToken;
  });

  readonly classes = computed<ClassesView>(() => {
    if (this.classesQuery.error()) return { status: 'error' };
    const classes = this.classesQuery.value();
    return classes === undefined ? { status: 'loading' } : { status: 'ready', classes };
  });
}
