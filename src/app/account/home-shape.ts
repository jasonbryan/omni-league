import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/auth/auth.service';
import { ChangesInFlight } from '../core/changes-in-flight';

export type HomeShapeKind = 'nextStep' | 'list' | 'new';

/** The shape the home had when this tab last left it. It stays in memory, so nothing signed-in is saved on the device. */
@Injectable({ providedIn: 'root' })
export class HomeShape {
  private readonly auth = inject(AuthService);
  private readonly remembered = signal<HomeShapeKind | null>(null);

  readonly current = this.remembered.asReadonly();

  constructor() {
    inject(ChangesInFlight)
      .settled.pipe(takeUntilDestroyed())
      .subscribe(() => this.forget());

    let epochSeen = untracked(this.auth.authEpoch);
    // An effect, not a linkedSignal: a reset that waits for a read would miss a session that changed while no page read the shape.
    effect(() => {
      const signedIn = this.auth.signedIn();
      const epoch = this.auth.authEpoch();
      untracked(() => {
        if (!signedIn || epoch !== epochSeen) this.forget();
        epochSeen = epoch;
      });
    });
  }

  record(shape: HomeShapeKind): void {
    // A sign-out in another tab can end the session before this page is destroyed and records its shape.
    if (this.auth.signedIn()) this.remembered.set(shape);
  }

  private forget(): void {
    this.remembered.set(null);
  }
}
