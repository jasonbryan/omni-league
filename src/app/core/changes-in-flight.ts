import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Counts the saves and account requests under way, so the app never reloads between a request and its answer. */
@Injectable({ providedIn: 'root' })
export class ChangesInFlight {
  private count = 0;
  private readonly settledSubject = new Subject<void>();

  readonly settled = this.settledSubject.asObservable();

  active(): boolean {
    return this.count > 0;
  }

  begin(): () => void {
    this.count += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.count -= 1;
      if (this.count === 0) this.settledSubject.next();
    };
  }

  async track<T>(work: () => Promise<T>): Promise<T> {
    const end = this.begin();
    try {
      return await work();
    } finally {
      end();
    }
  }
}
