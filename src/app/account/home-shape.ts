import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
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
    merge(inject(ChangesInFlight).settled, this.auth.accountChanged)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.remembered.set(null));
  }

  record(shape: HomeShapeKind): void {
    // A sign-out in another tab can end the session before this page is destroyed and records its shape.
    if (this.auth.signedIn()) this.remembered.set(shape);
  }
}
