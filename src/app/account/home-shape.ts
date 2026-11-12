import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { ChangesInFlight } from '../core/changes-in-flight';

export type HomeShapeKind = 'nextStep' | 'list' | 'new';

interface Remembered {
  shape: HomeShapeKind;
  epoch: number;
}

/** The shape the home had when this tab last left it. It stays in memory, so nothing signed-in is saved on the device. */
@Injectable({ providedIn: 'root' })
export class HomeShape {
  private readonly auth = inject(AuthService);
  private readonly remembered = signal<Remembered | null>(null);

  readonly current = computed(() => {
    const remembered = this.remembered();
    const sameSession = this.auth.signedIn() && remembered?.epoch === this.auth.authEpoch();
    return sameSession ? remembered.shape : null;
  });

  constructor() {
    // A sign-in from another tab reaches this tab as a check that signs it in from signed out.
    merge(inject(ChangesInFlight).settled, this.auth.signedInByCheck)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.remembered.set(null));
  }

  record(shape: HomeShapeKind): void {
    // A sign-out in another tab can end the session before this page is destroyed and records its shape.
    if (this.auth.signedIn()) this.remembered.set({ shape, epoch: this.auth.authEpoch() });
  }
}
